from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Scene:
    start: float
    end: float
    section: str
    shot: str
    camera_motion: str
    lighting: str
    energy: float


def _section_name(section: dict[str, Any]) -> str:
    return str(section.get("name") or section.get("label") or "section").lower()


def _energy_for(scene_start: float, energy_curve: list[Any]) -> float:
    """Return the energy value nearest to the scene start.

    The current audio-analysis API stores energy_curve as a list of normalized
    float values sampled every 0.5 seconds. Older/future analysis payloads may
    use objects such as {"time": ..., "energy": ...}. Support both shapes so
    storyboard generation remains compatible with persisted analysis records.
    """
    if not energy_curve:
        return 0.5

    first = energy_curve[0]

    if isinstance(first, dict):
        nearest = min(
            energy_curve,
            key=lambda point: abs(float(point.get("time", 0.0)) - scene_start),
        )
        value = nearest.get("energy", 0.5)
    else:
        index = min(
            max(int(round(scene_start / 0.5)), 0),
            len(energy_curve) - 1,
        )
        value = energy_curve[index]

    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.5


def plan_scenes(
    duration_seconds: float,
    sections: list[dict[str, Any]],
    energy_curve: list[dict[str, Any]] | None = None,
) -> list[Scene]:
    """Convert audio-analysis sections into a deterministic concert storyboard."""
    energy_curve = energy_curve or []
    scenes: list[Scene] = []

    if not sections and duration_seconds > 0:
        sections = [{"name": "intro", "start": 0.0, "end": duration_seconds}]

    for section in sections:
        start = max(0.0, float(section.get("start", 0.0)))
        end = min(duration_seconds, float(section.get("end", duration_seconds)))
        if end <= start:
            continue

        name = _section_name(section)
        energy = _energy_for(start, energy_curve)

        if "chorus" in name or "hook" in name:
            shot = "wide_stage"
            camera_motion = "push_in_and_crane"
            lighting = "dynamic_beams"
        elif "bridge" in name:
            shot = "singer_closeup"
            camera_motion = "slow_dolly"
            lighting = "dramatic_backlight"
        elif "outro" in name:
            shot = "wide_stage"
            camera_motion = "slow_pull_out"
            lighting = "fade_to_stage_black"
        elif "intro" in name:
            shot = "stage_establishing"
            camera_motion = "slow_pan"
            lighting = "ambient_stage_glow"
        else:
            shot = "singer_medium"
            camera_motion = "tracking_shot"
            lighting = "concert_wash"

        scenes.append(
            Scene(
                start=start,
                end=end,
                section=name,
                shot=shot,
                camera_motion=camera_motion,
                lighting=lighting,
                energy=energy,
            )
        )

    return scenes


def scenes_to_dict(scenes: list[Scene]) -> list[dict[str, Any]]:
    return [
        {
            "start": scene.start,
            "end": scene.end,
            "duration": round(scene.end - scene.start, 3),
            "section": scene.section,
            "shot": scene.shot,
            "camera_motion": scene.camera_motion,
            "lighting": scene.lighting,
            "energy": scene.energy,
        }
        for scene in scenes
    ]
