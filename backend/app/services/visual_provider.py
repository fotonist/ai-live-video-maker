from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.services.scene_planner import Scene


_OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"
_IMAGE_MODEL = os.getenv("AI_IMAGE_MODEL", "gpt-image-1")
_IMAGE_QUALITY = os.getenv("AI_IMAGE_QUALITY", "low")
_SCENE_IMAGE_LIMIT = max(1, int(os.getenv("AI_SCENE_IMAGE_LIMIT", "12")))


def _visual_root() -> Path:
    root = Path(os.getenv("UPLOAD_ROOT", "uploads")) / "generated_visuals"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _energy_label(energy: float) -> str:
    value = max(0.0, min(1.0, float(energy)))
    if value >= 0.78:
        return "high-energy"
    if value >= 0.48:
        return "mid-energy"
    return "low-energy"


def _scene_prompt(scene: Scene) -> str:
    shot = str(scene.shot or "wide_stage").replace("_", " ")
    lighting = str(scene.lighting or "concert_wash").replace("_", " ")
    energy = _energy_label(scene.energy)

    framing = {
        "wide_stage": "wide cinematic shot showing the full stage and audience",
        "medium": "medium cinematic shot of the performer on stage",
        "close_up": "intimate close-up of the performer singing into a microphone",
        "extreme_close_up": "dramatic extreme close-up of the performer during the performance",
    }.get(str(scene.shot), f"cinematic {shot} framing")

    return (
        "Photorealistic live music concert photography, not illustration, not CGI, not vector art. "
        "A professional male singer performing passionately on a large modern concert stage, "
        f"{framing}. "
        f"Lighting: {lighting}, with cinematic blue, violet and magenta stage lights. "
        f"Mood: {energy}, emotionally expressive live performance, realistic audience silhouettes, "
        "realistic skin, clothing and stage equipment, volumetric light beams, atmospheric haze, "
        "shallow depth of field where appropriate, high-end music video cinematography, "
        "natural photographic detail. Vertical 9:16 composition. No text, no logos, no watermark."
    )


def _request_image(prompt: str, destination: Path) -> None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not configured. Add an OpenAI API key to the Render service environment."
        )

    payload = {
        "model": _IMAGE_MODEL,
        "prompt": prompt,
        "size": "1024x1536",
        "quality": _IMAGE_QUALITY,
    }
    request = Request(
        _OPENAI_IMAGES_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AI image generation failed ({exc.code}): {detail[:1000]}") from exc
    except URLError as exc:
        raise RuntimeError(f"AI image generation network error: {exc}") from exc

    items = body.get("data") or []
    if not items or not items[0].get("b64_json"):
        raise RuntimeError("AI image generation returned no image data.")

    destination.write_bytes(base64.b64decode(items[0]["b64_json"]))


def _cached_image(prompt: str) -> Path:
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:24]
    destination = _visual_root() / f"scene_{digest}.png"
    if destination.exists() and destination.stat().st_size > 1024:
        return destination

    temporary = destination.with_suffix(".png.part")
    if temporary.exists():
        temporary.unlink()

    _request_image(prompt, temporary)
    temporary.replace(destination)
    return destination


def _unique_scene_indices(scenes: list[Scene]) -> dict[int, int]:
    """Map scenes to a small number of visual beats to control API cost."""
    groups: dict[tuple[str, str, str], int] = {}
    mapping: dict[int, int] = {}

    for index, scene in enumerate(scenes):
        energy = float(scene.energy)
        key = (
            str(scene.shot or "wide_stage"),
            str(scene.lighting or "concert_wash"),
            _energy_label(energy),
        )
        if key not in groups and len(groups) < _SCENE_IMAGE_LIMIT:
            groups[key] = len(groups)
        mapping[index] = groups.get(key, index % max(1, len(groups)))

    return mapping


def _escape_movie_path(path: Path) -> str:
    # FFmpeg filter syntax needs backslashes for special characters. Render
    # paths are normally simple Linux paths, but escaping makes this robust.
    return str(path.resolve()).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _scene_filter(scene: Scene, image: Path, width: int, height: int, index: int) -> str:
    duration = max(float(scene.end) - float(scene.start), 0.1)
    movie_path = _escape_movie_path(image)

    # Repeat the generated still for the scene duration and apply a subtle
    # Ken Burns movement. This creates motion without asking the image model
    # to generate a full video clip for every scene.
    frames = max(1, int(duration * 8))
    zoom_direction = "1" if index % 2 == 0 else "-1"
    x_motion = f"(iw-ow)/2+sin(t*0.22+{index})*(iw-ow)*0.12*{zoom_direction}"
    y_motion = f"(ih-oh)/2+cos(t*0.18+{index})*(ih-oh)*0.08"

    return (
        f"movie='{movie_path}':loop=1,"
        f"scale={int(width * 1.12)}:{int(height * 1.12)}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:x='{x_motion}':y='{y_motion}',"
        f"trim=duration={duration:.3f},setpts=PTS-STARTPTS,"
        f"fps=8,format=yuv420p[v{index}]"
    )


def build_visual_filter(scenes: list[Scene], width: int, height: int) -> str:
    """Generate photorealistic AI scene images and build the FFmpeg filter."""
    if not scenes:
        raise ValueError("Cannot build visual filter without scenes")

    mapping = _unique_scene_indices(scenes)
    images: dict[int, Path] = {}
    generated = 0

    for index, scene in enumerate(scenes):
        group = mapping[index]
        if group in images:
            continue

        prompt = _scene_prompt(scene)
        images[group] = _cached_image(prompt)
        generated += 1
        print(f"[visual] AI image {generated} ready for visual beat {group + 1}", flush=True)

    parts = [
        _scene_filter(scene, images[mapping[index]], width, height, index)
        for index, scene in enumerate(scenes)
    ]
    concat_inputs = "".join(f"[v{index}]" for index in range(len(scenes)))
    return ";".join(parts) + f";{concat_inputs}concat=n={len(scenes)}:v=1:a=0,format=yuv420p[vout]"


__all__ = ["build_visual_filter"]
