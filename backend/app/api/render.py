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
from app.services.scene_planner import plan_scenes
from app.services.visual_provider import build_visual_filter

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


def recover_interrupted_renders() -> None:
    """Mark renders interrupted by a process restart as failed."""
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
    temp_video_path: Path | None = None

    try:
        project = db.get(Project, project_id)
        if project is None or project.analysis is None:
            return

        audio_path = _audio_path(project)
        width, height = _dimensions(output_format)
        project_dir = PROJECT_ROOT / str(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)

        video_path = project_dir / "video.mp4"
        temp_video_path = project_dir / "video.mp4.part"
        temp_video_path.unlink(missing_ok=True)
        video_path.unlink(missing_ok=True)

        duration = max(float(project.analysis.duration_seconds), 0.1)
        scenes = plan_scenes(
            duration_seconds=duration,
            sections=project.analysis.sections or [],
            energy_curve=project.analysis.energy_curve or [],
        )
        if not scenes:
            raise RuntimeError("Scene planner produced no renderable scenes")

        visual_filter = build_visual_filter(scenes, width, height)
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

        command = [
            ffmpeg,
            "-y",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-filter_complex",
            visual_filter,
            "-i",
            str(audio_path),
            "-map",
            "[vout]",
            "-map",
            "0:a:0",
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-threads",
            "1",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            str(temp_video_path),
        ]

        print(
            f"[render] starting project={project_id} scenes={len(scenes)} duration={duration:.3f}s format={output_format}",
            flush=True,
        )
        result = run(command, stdout=PIPE, stderr=PIPE, check=False)
        stderr = result.stderr.decode("utf-8", errors="replace").strip()

        if result.returncode != 0:
            print(f"[render] FFmpeg failed for {project_id}: {stderr[-4000:]}", flush=True)
            raise RuntimeError(f"FFmpeg render failed: {stderr[-1000:]}")

        if not temp_video_path.exists() or temp_video_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg completed without producing a valid MP4")

        temp_video_path.replace(video_path)

        project.status = "rendered"
        db.add(project)
        db.commit()
        print(
            f"[render] completed project={project_id} size={video_path.stat().st_size} bytes duration={duration:.3f}s scenes={len(scenes)}",
            flush=True,
        )

    except Exception as exc:
        if temp_video_path is not None:
            temp_video_path.unlink(missing_ok=True)

        project = db.get(Project, project_id)
        if project is not None:
            project.status = "render_failed"
            db.add(project)
            db.commit()

        print(f"[render] failed project={project_id}: {exc}", flush=True)

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
            error="Video rendering failed. Check the Render service logs for the FFmpeg error.",
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
