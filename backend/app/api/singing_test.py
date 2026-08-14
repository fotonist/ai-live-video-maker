from __future__ import annotations

import base64
import os
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/singing-test", tags=["singing-test"])
ROOT = Path("uploads") / "singing-tests"
MAX_IMAGE_SIZE = 15 * 1024 * 1024
MAX_AUDIO_SIZE = 5 * 1024 * 1024

KLING_BASE_URL = "https://api.klingai.com/v1"


class SingingTestResponse(BaseModel):
    id: UUID
    status: str
    phase: str
    message: str = ""
    video_url: str = ""
    error: str | None = None


def _api_key() -> str:
    value = os.getenv("KLING_API_KEY", "").strip()
    if not value:
        raise RuntimeError("KLING_API_KEY is not configured. Add a Kling API key to the Render service environment.")
    return value


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }


def _write_status(job_dir: Path, status: str, phase: str, message: str = "") -> None:
    (job_dir / "status.json").write_text(
        __import__("json").dumps({"status": status, "phase": phase, "message": message}),
        encoding="utf-8",
    )


def _read_status(job_dir: Path) -> dict[str, str]:
    path = job_dir / "status.json"
    if not path.exists():
        return {"status": "queued", "phase": "queued", "message": "Queued."}
    return __import__("json").loads(path.read_text(encoding="utf-8"))


def _extract_task_id(payload: dict) -> str:
    task_id = payload.get("data", {}).get("task_id")
    if task_id:
        return str(task_id)
    raise RuntimeError(f"Kling did not return a task id: {payload}")


def _extract_video(payload: dict) -> tuple[str, str]:
    data = payload.get("data", {})
    result = data.get("task_result") or {}
    videos = result.get("videos") or []
    if not videos:
        raise RuntimeError(f"Kling completed without a video result: {payload}")
    video = videos[0]
    return str(video.get("id") or ""), str(video.get("url") or "")


def _kling_post(path: str, body: dict) -> dict:
    with httpx.Client(timeout=60.0) as client:
        response = client.post(f"{KLING_BASE_URL}{path}", headers=_headers(), json=body)
    try:
        payload = response.json()
    except Exception:
        payload = {"raw": response.text}
    if response.status_code >= 400:
        raise RuntimeError(f"Kling API {response.status_code}: {payload}")
    if payload.get("code") not in (None, 0):
        raise RuntimeError(f"Kling API error: {payload}")
    return payload


def _kling_get(path: str) -> dict:
    with httpx.Client(timeout=60.0) as client:
        response = client.get(f"{KLING_BASE_URL}{path}", headers=_headers())
    try:
        payload = response.json()
    except Exception:
        payload = {"raw": response.text}
    if response.status_code >= 400:
        raise RuntimeError(f"Kling API {response.status_code}: {payload}")
    if payload.get("code") not in (None, 0):
        raise RuntimeError(f"Kling API error: {payload}")
    return payload


def _poll_task(path: str, job_dir: Path, phase: str, timeout_seconds: int = 600) -> dict:
    import time

    started = time.monotonic()
    while time.monotonic() - started < timeout_seconds:
        payload = _kling_get(path)
        data = payload.get("data", {})
        state = str(data.get("task_status", "")).lower()
        message = str(data.get("task_status_msg", ""))
        _write_status(job_dir, "rendering", phase, message or f"Kling {phase} is {state or 'processing'}...")
        if state == "succeed":
            return payload
        if state == "failed":
            raise RuntimeError(message or f"Kling {phase} failed.")
        time.sleep(5)
    raise RuntimeError(f"Kling {phase} timed out after {timeout_seconds} seconds.")


def _run(job_id: UUID) -> None:
    job_dir = ROOT / str(job_id)
    try:
        _write_status(job_dir, "rendering", "image-to-video", "Generating a live performance clip from the singer image...")
        image_path = next(job_dir.glob("image.*"))
        audio_path = next(job_dir.glob("audio.*"))
        image_b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
        audio_b64 = base64.b64encode(audio_path.read_bytes()).decode("ascii")

        # Kling's image-to-video task creates the 5/10 second face/performance
        # video first. Lip Sync then uses the generated Kling video_id and the
        # original singing audio to drive the mouth movements.
        i2v = _kling_post(
            "/videos/image2video",
            {
                "model_name": os.getenv("KLING_VIDEO_MODEL", "kling-v2-6"),
                "image": image_b64,
                "prompt": (
                    "A realistic live music performance. The singer performs naturally for the camera, "
                    "with subtle head, shoulder and facial movement, expressive eyes and believable "
                    "concert-performance energy. Preserve the person's identity and facial structure. "
                    "Keep the face clearly visible and front-facing enough for accurate lip synchronization."
                ),
                "mode": "std",
                "duration": 10,
                "aspect_ratio": "9:16",
            },
        )
        i2v_task = _extract_task_id(i2v)
        i2v_result = _poll_task(f"/videos/image2video/{i2v_task}", job_dir, "image-to-video")
        video_id, video_url = _extract_video(i2v_result)
        if not video_id and not video_url:
            raise RuntimeError("Kling image-to-video returned no video identifier or URL.")

        _write_status(job_dir, "rendering", "lip-sync", "Synchronizing the singer's mouth to the uploaded vocal...")
        lip_input: dict = {
            "mode": "audio2video",
            "audio_type": "file",
            "audio_file": audio_b64,
        }
        if video_id:
            lip_input["video_id"] = video_id
        else:
            lip_input["video_url"] = video_url

        lip = _kling_post("/videos/lip-sync", {"input": lip_input})
        lip_task = _extract_task_id(lip)
        lip_result = _poll_task(f"/videos/lip-sync/{lip_task}", job_dir, "lip-sync")
        _, final_url = _extract_video(lip_result)
        if not final_url:
            raise RuntimeError("Kling lip-sync completed without a video URL.")

        (job_dir / "video_url.txt").write_text(final_url, encoding="utf-8")
        _write_status(job_dir, "completed", "completed", "Singing video is ready.")
    except Exception as exc:
        (job_dir / "error.txt").write_text(str(exc), encoding="utf-8")
        _write_status(job_dir, "failed", "failed", str(exc))
        print(f"[singing-test] failed id={job_id}: {exc}", flush=True)


@router.post("", response_model=SingingTestResponse, status_code=202)
async def create_singing_test(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
) -> SingingTestResponse:
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Singer image must be JPG, PNG or WEBP.")
    if not (audio.content_type or "").startswith("audio/"):
        raise HTTPException(status_code=415, detail="Singing audio must be an audio file.")

    job_id = uuid4()
    job_dir = ROOT / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)

    image_ext = Path(image.filename or "image.jpg").suffix.lower() or ".jpg"
    audio_ext = Path(audio.filename or "audio.mp3").suffix.lower() or ".mp3"
    if image_ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        image_ext = ".jpg"
    if audio_ext not in {".mp3", ".wav", ".m4a", ".aac"}:
        audio_ext = ".mp3"

    image_path = job_dir / f"image{image_ext}"
    audio_path = job_dir / f"audio{audio_ext}"

    try:
        image_size = 0
        with image_path.open("wb") as output:
            while chunk := await image.read(1024 * 1024):
                image_size += len(chunk)
                if image_size > MAX_IMAGE_SIZE:
                    raise HTTPException(status_code=413, detail="Singer image must be 15 MB or smaller.")
                output.write(chunk)

        audio_size = 0
        with audio_path.open("wb") as output:
            while chunk := await audio.read(1024 * 1024):
                audio_size += len(chunk)
                if audio_size > MAX_AUDIO_SIZE:
                    raise HTTPException(status_code=413, detail="Singing audio must be 5 MB or smaller for the Kling lip-sync test.")
                output.write(chunk)
    finally:
        await image.close()
        await audio.close()

    _write_status(job_dir, "queued", "queued", "Queued for Kling singing-video generation.")
    background_tasks.add_task(_run, job_id)
    return SingingTestResponse(id=job_id, status="queued", phase="queued", message="Singing video test queued.")


@router.get("/{job_id}", response_model=SingingTestResponse)
def singing_test_status(job_id: UUID) -> SingingTestResponse:
    job_dir = ROOT / str(job_id)
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Singing test not found.")
    status = _read_status(job_dir)
    video_url = (job_dir / "video_url.txt").read_text(encoding="utf-8").strip() if (job_dir / "video_url.txt").exists() else ""
    error = (job_dir / "error.txt").read_text(encoding="utf-8") if (job_dir / "error.txt").exists() else None
    return SingingTestResponse(
        id=job_id,
        status=status.get("status", "queued"),
        phase=status.get("phase", "queued"),
        message=status.get("message", ""),
        video_url=video_url,
        error=error,
    )


@router.get("/{job_id}/video")
def singing_test_video(job_id: UUID) -> StreamingResponse:
    job_dir = ROOT / str(job_id)
    url_file = job_dir / "video_url.txt"
    if not url_file.exists():
        raise HTTPException(status_code=404, detail="Singing test video is not ready.")
    video_url = url_file.read_text(encoding="utf-8").strip()
    if not video_url:
        raise HTTPException(status_code=404, detail="Singing test video URL is empty.")

    async def stream():
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("GET", video_url) as response:
                if response.status_code >= 400:
                    raise RuntimeError(f"Kling video download failed with status {response.status_code}.")
                async for chunk in response.aiter_bytes(1024 * 1024):
                    yield chunk

    return StreamingResponse(stream(), media_type="video/mp4", headers={"Content-Disposition": 'inline; filename="singing-test.mp4"'})
