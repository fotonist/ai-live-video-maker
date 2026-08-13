from pathlib import Path
from subprocess import PIPE, run
from uuid import UUID

import imageio_ffmpeg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Project

router = APIRouter(prefix="/projects", tags=["render"])
PROJECT_ROOT = Path("uploads") / "projects"


class RenderResponse(BaseModel):
    project_id: UUID
    status: str
    video_url: str
    width: int
    height: int
    duration_seconds: float
    format: str


def _audio_path(project: Project) -> Path:
    if project.audio is None:
        raise HTTPException(
            status_code=409,
            detail="Audio upload is required before rendering",
        )

    path = Path(project.audio.storage_path)

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Audio file not found for project",
        )

    return path


def _dimensions(output_format: str) -> tuple[int, int]:
    return (1920, 1080) if output_format == "16:9" else (1080, 1920)


def _validate_video(ffmpeg: str, video_path: Path) -> None:
    """Run FFmpeg against the completed file to ensure the MP4 is readable."""
    validation = run(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(video_path),
            "-f",
            "null",
            "-",
        ],
        stdout=PIPE,
        stderr=PIPE,
        check=False,
    )

    if validation.returncode != 0:
        detail = validation.stderr.decode(
            "utf-8", errors="replace"
        ).strip()
        video_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail=f"Rendered MP4 validation failed: {detail[:500]}",
        )


@router.post("/{project_id}/render", response_model=RenderResponse)
def render_project(
    project_id: UUID,
    output_format: str = "9:16",
    db: Session = Depends(get_db),
) -> RenderResponse:
    project = db.get(Project, project_id)

    if project is None:
        raise HTTPException(
            status_code=404,
            detail="Project not found",
        )

    if project.analysis is None:
        raise HTTPException(
            status_code=409,
            detail="Audio analysis is required before rendering",
        )

    if output_format not in {"9:16", "16:9"}:
        raise HTTPException(
            status_code=422,
            detail="Output format must be 9:16 or 16:9",
        )

    audio_path = _audio_path(project)
    width, height = _dimensions(output_format)

    project_dir = PROJECT_ROOT / str(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)

    video_path = project_dir / "video.mp4"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    result = run(
        [
            ffmpeg,
            "-y",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c=0x0b1020:s={width}x{height}:r=30",
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(video_path),
        ],
        stdout=PIPE,
        stderr=PIPE,
        check=False,
    )

    if result.returncode != 0 or not video_path.exists():
        video_path.unlink(missing_ok=True)
        detail = result.stderr.decode(
            "utf-8", errors="replace"
        ).strip()
        raise HTTPException(
            status_code=500,
            detail=f"Video render failed: {detail[:500]}",
        )

    if video_path.stat().st_size == 0:
        video_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Video render failed: generated MP4 is empty",
        )

    # Do not mark the project as rendered until the resulting MP4
    # has been reopened successfully by FFmpeg.
    _validate_video(ffmpeg, video_path)

    project.status = "rendered"
    db.add(project)
    db.commit()

    return RenderResponse(
        project_id=project_id,
        status="completed",
        video_url=f"/projects/{project_id}/video",
        width=width,
        height=height,
        duration_seconds=round(project.analysis.duration_seconds, 3),
        format=output_format,
    )


@router.get("/{project_id}/video")
def get_rendered_video(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> FileResponse:
    project = db.get(Project, project_id)

    if project is None:
        raise HTTPException(
            status_code=404,
            detail="Project not found",
        )

    video_path = PROJECT_ROOT / str(project_id) / "video.mp4"

    if not video_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Rendered video not found",
        )

    if video_path.stat().st_size == 0:
        raise HTTPException(
            status_code=500,
            detail="Rendered video is empty",
        )

    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=f"{project.name}.mp4",
    )
