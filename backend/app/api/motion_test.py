from __future__ import annotations

from pathlib import Path
from subprocess import PIPE, run
from uuid import UUID, uuid4

import imageio_ffmpeg
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/motion-test", tags=["motion-test"])
ROOT = Path("uploads") / "motion-tests"
MAX_IMAGE_SIZE = 25 * 1024 * 1024
MAX_AUDIO_SIZE = 100 * 1024 * 1024
DURATION = 10.0


class MotionTestResponse(BaseModel):
    id: UUID
    status: str
    message: str = ""
    video_url: str = ""
    error: str | None = None


def _safe_extension(filename: str, allowed: set[str], default: str) -> str:
    extension = Path(filename).suffix.lower()
    return extension if extension in allowed else default


def _run(command: list[str], label: str) -> None:
    result = run(command, stdout=PIPE, stderr=PIPE, check=False)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg {label} failed: {detail[-2500:]}")


def _render(job_dir: Path) -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    image = next(job_dir.glob("image.*"), None)
    audio = next(job_dir.glob("audio.*"), None)
    if image is None or audio is None:
        raise RuntimeError("Motion test assets are missing")

    final = job_dir / "video.mp4"
    width, height = 1080, 1920
    movie_path = str(image.resolve()).replace("\\", "/").replace("'", "\\'")

    # Keep the whole render in one FFmpeg process. The previous two-pass
    # approach could create an MP4 container that existed on disk but exposed
    # no readable video stream to the second FFmpeg invocation.
    visual_filter = (
        f"movie='{movie_path}':loop=1,"
        f"scale={int(width * 1.18)}:{int(height * 1.18)}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:"
        "x='(iw-ow)/2+sin(t*0.24)*((iw-ow)*0.16)':"
        "y='(ih-oh)/2+cos(t*0.18)*((ih-oh)*0.10)',"
        f"trim=duration={DURATION},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v]"
    )

    _run(
        [
            ffmpeg,
            "-y",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(audio),
            "-filter_complex",
            visual_filter,
            "-map",
            "[v]",
            "-map",
            "0:a:0",
            "-t",
            str(DURATION),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "26",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(final),
        ],
        "motion video + audio",
    )

    if not final.exists() or final.stat().st_size == 0:
        raise RuntimeError("Final motion-test video was not created")


def _job(job_id: UUID) -> None:
    job_dir = ROOT / str(job_id)
    status_file = job_dir / "status.txt"
    try:
        status_file.write_text("rendering", encoding="utf-8")
        _render(job_dir)
        status_file.write_text("completed", encoding="utf-8")
    except Exception as exc:
        (job_dir / "error.txt").write_text(str(exc), encoding="utf-8")
        status_file.write_text("failed", encoding="utf-8")
        print(f"[motion-test] failed id={job_id}: {exc}", flush=True)


@router.post("", response_model=MotionTestResponse, status_code=202)
async def create_motion_test(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
) -> MotionTestResponse:
    image_type = image.content_type or ""
    if image_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Image must be JPG, PNG or WEBP")
    if not (audio.content_type or "").startswith("audio/"):
        raise HTTPException(status_code=415, detail="Audio must be an MP3 or WAV file")

    job_id = uuid4()
    job_dir = ROOT / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    image_ext = _safe_extension(image.filename or "image", {".jpg", ".jpeg", ".png", ".webp"}, ".jpg")
    audio_ext = _safe_extension(audio.filename or "audio", {".mp3", ".wav"}, ".mp3")
    image_path = job_dir / f"image{image_ext}"
    audio_path = job_dir / f"audio{audio_ext}"

    try:
        image_size = 0
        with image_path.open("wb") as output:
            while chunk := await image.read(1024 * 1024):
                image_size += len(chunk)
                if image_size > MAX_IMAGE_SIZE:
                    raise HTTPException(status_code=413, detail="Image must be 25 MB or smaller")
                output.write(chunk)

        audio_size = 0
        with audio_path.open("wb") as output:
            while chunk := await audio.read(1024 * 1024):
                audio_size += len(chunk)
                if audio_size > MAX_AUDIO_SIZE:
                    raise HTTPException(status_code=413, detail="Audio must be 100 MB or smaller")
                output.write(chunk)
    finally:
        await image.close()
        await audio.close()

    (job_dir / "status.txt").write_text("queued", encoding="utf-8")
    background_tasks.add_task(_job, job_id)
    return MotionTestResponse(id=job_id, status="queued", message="Motion test queued.")


@router.get("/{job_id}", response_model=MotionTestResponse)
def motion_test_status(job_id: UUID) -> MotionTestResponse:
    job_dir = ROOT / str(job_id)
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Motion test not found")
    status_file = job_dir / "status.txt"
    status = status_file.read_text(encoding="utf-8").strip() if status_file.exists() else "queued"
    if status == "completed":
        return MotionTestResponse(
            id=job_id,
            status=status,
            message="Motion test completed.",
            video_url=f"/motion-test/{job_id}/video",
        )
    if status == "failed":
        error_file = job_dir / "error.txt"
        error = error_file.read_text(encoding="utf-8") if error_file.exists() else "Motion test failed."
        return MotionTestResponse(id=job_id, status=status, message="Motion test failed.", error=error)
    return MotionTestResponse(
        id=job_id,
        status=status,
        message="Creating a moving shot from the uploaded image...",
    )


@router.get("/{job_id}/video")
def motion_test_video(job_id: UUID) -> FileResponse:
    video = ROOT / str(job_id) / "video.mp4"
    if not video.exists():
        raise HTTPException(status_code=404, detail="Motion test video is not ready")
    return FileResponse(video, media_type="video/mp4", filename="motion-test.mp4")
