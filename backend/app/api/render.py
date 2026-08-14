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
    phase: str = "idle"
    message: str = ""
    scene_current: int = 0
    scene_total: int = 0


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


def _run_ffmpeg(command: list[str], project_id: UUID, label: str) -> None:
    print(f"[render] ffmpeg start project={project_id} step={label}", flush=True)
    result = run(command, stdout=PIPE, stderr=PIPE, check=False)
    stderr = result.stderr.decode("utf-8", errors="replace").strip()
    if result.returncode != 0:
        print(f"[render] FFmpeg failed project={project_id} step={label}: {stderr[-4000:]}", flush=True)
        raise RuntimeError(f"FFmpeg failed during {label}: {stderr[-1500:]}")


def _render_scene(*, scene, scene_index: int, width: int, height: int, scene_path: Path, ffmpeg: str, project_id: UUID) -> None:
    duration = max(float(scene.end - scene.start), 0.1)
    visual_filter = build_visual_filter([scene], width, height)
    command = [
        ffmpeg, "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-filter_complex", visual_filter, "-map", "[vout]", "-t", f"{duration:.3f}",
        "-an", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1",
        "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4",
        str(scene_path),
    ]
    _run_ffmpeg(command, project_id, f"scene-{scene_index + 1}/{scene_index + 1}")
    if not scene_path.exists() or scene_path.stat().st_size == 0:
        raise RuntimeError(f"Scene {scene_index + 1} was not created correctly")


def _concat_scenes(*, scene_paths: list[Path], concat_file: Path, video_path: Path, ffmpeg: str, project_id: UUID) -> None:
    concat_file = concat_file.resolve()
    video_path = video_path.resolve()
    with concat_file.open("w", encoding="utf-8") as file:
        for scene_path in scene_paths:
            escaped = str(scene_path.resolve()).replace("\\", "/").replace("'", "'\\''")
            file.write(f"file '{escaped}'\n")
    command = [
        ffmpeg, "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-c", "copy", "-movflags", "+faststart", "-f", "mp4", str(video_path),
    ]
    _run_ffmpeg(command, project_id, "scene-concat")
    if not video_path.exists() or video_path.stat().st_size == 0:
        raise RuntimeError("Final concatenated video was not created")


def _mux_audio(*, video_path: Path, audio_path: Path, final_path: Path, duration: float, ffmpeg: str, project_id: UUID) -> None:
    temp_final = final_path.with_name("video.final.mp4")
    temp_final.unlink(missing_ok=True)
    command = [
        ffmpeg, "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path), "-i", str(audio_path),
        "-map", "0:v:0", "-map", "1:a:0", "-t", f"{duration:.3f}",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
        "-f", "mp4", str(temp_final),
    ]
    _run_ffmpeg(command, project_id, "audio-mux")
    if not temp_final.exists() or temp_final.stat().st_size == 0:
        raise RuntimeError("Final video with audio was not created")
    temp_final.replace(final_path)


def _render_video_job(project_id: UUID, output_format: str) -> None:
    SessionLocal = get_session_factory()
    db = SessionLocal()
    project_dir: Path | None = None
    scene_paths: list[Path] = []
    concat_file: Path | None = None
    video_path: Path | None = None
    try:
        project = db.get(Project, project_id)
        if project is None:
            print(f"[render] project not found: {project_id}", flush=True)
            return
        if project.analysis is None:
            raise RuntimeError("Audio analysis is required before rendering")

        audio_path = _audio_path(project)
        width, height = _dimensions(output_format)
        project_dir = PROJECT_ROOT / str(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)
        video_path = project_dir / "video.mp4"
        video_path.unlink(missing_ok=True)

        duration = max(float(project.analysis.duration_seconds), 0.1)
        scenes = plan_scenes(
            duration_seconds=duration,
            sections=project.analysis.sections or [],
            energy_curve=project.analysis.energy_curve or [],
        )
        if not scenes:
            raise RuntimeError("Scene planner produced no renderable scenes")

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        print(f"[render] starting project={project_id} scenes={len(scenes)} duration={duration:.3f}s format={output_format} resolution={width}x{height}", flush=True)

        for index, scene in enumerate(scenes):
            scene_path = project_dir / f"scene_{index:04d}.mp4"
            scene_path.unlink(missing_ok=True)
            _render_scene(scene=scene, scene_index=index, width=width, height=height, scene_path=scene_path, ffmpeg=ffmpeg, project_id=project_id)
            scene_paths.append(scene_path)
            print(f"[render] scene {index + 1}/{len(scenes)} completed size={scene_path.stat().st_size}", flush=True)

        concat_file = project_dir / "concat.txt"
        visual_video = project_dir / "visual.mp4"
        visual_video.unlink(missing_ok=True)
        _concat_scenes(scene_paths=scene_paths, concat_file=concat_file, video_path=visual_video, ffmpeg=ffmpeg, project_id=project_id)
        _mux_audio(video_path=visual_video, audio_path=audio_path, final_path=video_path, duration=duration, ffmpeg=ffmpeg, project_id=project_id)

        if not video_path.exists() or video_path.stat().st_size <= 0:
            raise RuntimeError("Final video file is empty")

        project = db.get(Project, project_id)
        if project is None:
            raise RuntimeError("Project disappeared before render completion")
        project.status = "rendered"
        db.add(project)
        db.commit()
        print(f"[render] completed project={project_id} size={video_path.stat().st_size} bytes duration={duration:.3f}s scenes={len(scenes)}", flush=True)

        for scene_path in scene_paths:
            scene_path.unlink(missing_ok=True)
        concat_file.unlink(missing_ok=True)
        visual_video.unlink(missing_ok=True)
        print(f"[render] cleanup completed project={project_id}", flush=True)
    except Exception as exc:
        if project_dir is not None:
            print(f"[render] preserving failed render directory for diagnostics: {project_dir}", flush=True)
        project = db.get(Project, project_id)
        if project is not None:
            project.status = "render_failed"
            db.add(project)
            db.commit()
        print(f"[render] failed project={project_id}: {exc}", flush=True)
    finally:
        db.close()


@router.post("/{project_id}/render", response_model=RenderResponse, status_code=202)
def render_project(project_id: UUID, background_tasks: BackgroundTasks, output_format: str = "9:16", db: Session = Depends(get_db)) -> RenderResponse:
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
        project_id=project_id, status="rendering", width=width, height=height,
        duration_seconds=round(project.analysis.duration_seconds, 3), format=output_format,
        phase="preparing", message="Preparing render...",
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
    duration = round(project.analysis.duration_seconds, 3)
    project_dir = PROJECT_ROOT / str(project_id)

    try:
        scenes = plan_scenes(
            duration_seconds=max(float(project.analysis.duration_seconds), 0.1),
            sections=project.analysis.sections or [],
            energy_curve=project.analysis.energy_curve or [],
        )
        scene_total = len(scenes)
    except Exception:
        scene_total = 0

    video_path = project_dir / "video.mp4"
    visual_path = project_dir / "visual.mp4"
    concat_path = project_dir / "concat.txt"
    scene_files = sorted(project_dir.glob("scene_*.mp4")) if project_dir.exists() else []
    scene_current = len(scene_files)

    if project.status == "rendered" or (video_path.exists() and video_path.stat().st_size > 0):
        return RenderResponse(project_id=project_id, status="completed", video_url=f"/projects/{project_id}/video", width=width, height=height, duration_seconds=duration, format=output_format, phase="completed", message="Video ready.", scene_current=scene_total, scene_total=scene_total)

    if project.status == "render_failed":
        return RenderResponse(project_id=project_id, status="failed", width=width, height=height, duration_seconds=duration, format=output_format, phase="failed", message="Rendering failed.", error="Video rendering failed. Check the Render service logs for the FFmpeg error.", scene_current=scene_current, scene_total=scene_total)

    if visual_path.exists():
        phase = "audio-mux"
        message = "Adding audio to the rendered video..."
    elif concat_path.exists():
        phase = "scene-concat"
        message = "Concatenating completed scenes..."
    elif scene_current > 0:
        phase = "scenes"
        message = f"Rendering scene {min(scene_current + 1, scene_total or scene_current)} of {scene_total or scene_current}..."
    else:
        phase = "preparing"
        message = "Preparing scenes..."

    return RenderResponse(
        project_id=project_id, status="rendering", width=width, height=height,
        duration_seconds=duration, format=output_format, phase=phase, message=message,
        scene_current=scene_current, scene_total=scene_total,
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
    return FileResponse(video_path, media_type="video/mp4", filename=f"{project.name}.mp4")
