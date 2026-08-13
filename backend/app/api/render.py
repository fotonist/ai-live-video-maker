from pathlib import Path
from subprocess import PIPE, run
from uuid import UUID

import imageio_ffmpeg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db, get_session_factory
from app.models import Project

router = APIRouter(prefix="/projects", tags=["render"])
PROJECT_ROOT = Path("uploads") / "projects"


class RenderResponse(BaseModel):
    project_id: UUID
    status: str
    video_url: str = ""
    width: int
    height: int
    duration_seconds: float
    format: str
    error: str | None = None


def _audio_path(project: Project) -> Path:
    if project.audio is None:
        raise HTTPException(status_code=409, detail="Audio upload is required before rendering")
    path = Path(project.audio.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found for project")
    return path


def _dimensions(output_format: str) -> tuple[int, int]:
    return (1920, 1080) if output_format == "16:9" else (1080, 1920)


def _validate_video(ffmpeg: str, video_path: Path) -> None:
    validation = run(
        [ffmpeg, "-v", "error", "-i", str(video_path), "-map", "0", "-c", "copy", "-f", "null", "-"],
        stdout=PIPE, stderr=PIPE, check=False,
    )
    if validation.returncode != 0:
        detail = validation.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Rendered MP4 validation failed: {detail[:500]}")


def recover_interrupted_renders() -> None:
    """Fail renders left behind when the Render web process restarted/OOM-killed."""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        projects = db.query(Project).filter(Project.status == "rendering").all()
        for project in projects:
            project.status = "render_failed"
            db.add(project)
        if projects:
            db.commit()
    finally:
        db.close()


def _render_video_job(project_id: UUID, output_format: str) -> None:
    SessionLocal = get_session_factory()
    db = SessionLocal()
    temp_video_path = PROJECT_ROOT / str(project_id) / "video.mp4.part"

    try:
        project = db.get(Project, project_id)
        if project is None or project.analysis is None:
            return

        try:
            audio_path = _audio_path(project)
            width, height = _dimensions(output_format)
            project_dir = PROJECT_ROOT / str(project_id)
            project_dir.mkdir(parents=True, exist_ok=True)

            video_path = project_dir / "video.mp4"
            temp_video_path = project_dir / "video.mp4.part"
            temp_video_path.unlink(missing_ok=True)

            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
            duration = max(float(project.analysis.duration_seconds), 0.1)

            # Current renderer is a static background. One frame per second
            # avoids encoding 30 identical frames every second and cuts CPU/RAM.
            result = run(
                [
                    ffmpeg, "-y", "-nostdin", "-v", "error",
                    "-f", "lavfi", "-i",
                    f"color=c=0x0b1020:s={width}x{height}:r=1",
                    "-i", str(audio_path),
                    "-map", "0:v:0", "-map", "1:a:0",
                    "-t", f"{duration:.3f}",
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-tune", "stillimage",
                    "-threads", "1",
                    "-crf", "30",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "96k",
                    "-movflags", "+faststart",
                    str(temp_video_path),
                ],
                stdout=PIPE, stderr=PIPE, check=False,
            )

            if result.returncode != 0:
                detail = result.stderr.decode("utf-8", errors="replace").strip()
                raise RuntimeError(f"Video render failed: {detail[:500]}")

            if not temp_video_path.exists() or temp_video_path.stat().st_size == 0:
                raise RuntimeError("Video render failed: generated MP4 is empty")

            _validate_video(ffmpeg, temp_video_path)
            temp_video_path.replace(video_path)

            project.status = "rendered"
            db.add(project)
            db.commit()

        except Exception:
            temp_video_path.unlink(missing_ok=True)
            project = db.get(Project, project_id)
            if project is not None:
                project.status = "render_failed"
                db.add(project)
                db.commit()

    finally:
        db.close()


@router.post("/{project_id}/render", response_model=RenderResponse, status_code=202)
def render_project(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    output_format: str = "9:16",
    db: Session = Depends(get_db),
) -> RenderResponse:
    project = db.get(Project, project_id)

    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.analysis is None:
        raise HTTPException(status_code=409, detail="Audio analysis is required before rendering")
    if output_format not in {"9:16", "16:9"}:
        raise HTTPException(status_code=422, detail="Output format must be 9:16 or 16:9")
    if project.status == "rendering":
        raise HTTPException(status_code=409, detail="Video rendering is already in progress")

    _audio_path(project)
    width, height = _dimensions(output_format)

    project.status = "rendering"
    db.add(project)
    db.commit()

    background_tasks.add_task(_render_video_job, project_id, output_format)

    return RenderResponse(
        project_id=project_id,
        status="rendering",
        width=width,
        height=height,
        duration_seconds=round(project.analysis.duration_seconds, 3),
        format=output_format,
    )


@router.get("/{project_id}/render/status", response_model=RenderResponse)
def render_status(project_id: UUID, db: Session = Depends(get_db)) -> RenderResponse:
    project = db.get(Project, project_id)

    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.analysis is None:
        raise HTTPException(status_code=409, detail="Audio analysis is required before rendering")

    output_format = "9:16"
    width, height = _dimensions(output_format)

    if project.status == "rendered":
        return RenderResponse(
            project_id=project_id,
            status="completed",
            video_url=f"/projects/{project_id}/video",
            width=width,
            height=height,
            duration_seconds=round(project.analysis.duration_seconds, 3),
            format=output_format,
        )

    if project.status == "render_failed":
        return RenderResponse(
            project_id=project_id,
            status="failed",
            width=width,
            height=height,
            duration_seconds=round(project.analysis.duration_seconds, 3),
            format=output_format,
            error="Video rendering failed. Please try again.",
        )

    return RenderResponse(
        project_id=project_id,
        status="rendering",
        width=width,
        height=height,
        duration_seconds=round(project.analysis.duration_seconds, 3),
        format=output_format,
    )


@router.get("/{project_id}/video")
def get_rendered_video(project_id: UUID, db: Session = Depends(get_db)) -> FileResponse:
    project = db.get(Project, project_id)

    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status != "rendered":
        raise HTTPException(status_code=409, detail="Rendered video is not ready")

    video_path = PROJECT_ROOT / str(project_id) / "video.mp4"

    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Rendered video not found")
    if video_path.stat().st_size == 0:
        raise HTTPException(status_code=500, detail="Rendered video is empty")

    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=f"{project.name}.mp4",
    )
