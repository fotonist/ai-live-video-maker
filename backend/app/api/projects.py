from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field


router = APIRouter(prefix="/projects", tags=["projects"])

UPLOAD_ROOT = Path("uploads") / "projects"
ALLOWED_AUDIO_TYPES = {
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
}
MAX_AUDIO_SIZE = 100 * 1024 * 1024


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    status: str
    created_at: datetime


class AudioUploadResponse(BaseModel):
    project_id: UUID
    filename: str
    content_type: str
    size_bytes: int
    status: str


_projects: dict[UUID, ProjectResponse] = {}


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate) -> ProjectResponse:
    project = ProjectResponse(
        id=uuid4(),
        name=payload.name.strip(),
        status="draft",
        created_at=datetime.now(timezone.utc),
    )
    _projects[project.id] = project
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID) -> ProjectResponse:
    project = _projects.get(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("/{project_id}/audio", response_model=AudioUploadResponse)
async def upload_audio(project_id: UUID, file: UploadFile = File(...)) -> AudioUploadResponse:
    if project_id not in _projects:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    extension = ALLOWED_AUDIO_TYPES.get(file.content_type or "")
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only MP3 and WAV audio files are supported",
        )

    original_name = Path(file.filename or "audio").name
    project_dir = UPLOAD_ROOT / str(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    destination = project_dir / f"audio{extension}"

    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_AUDIO_SIZE:
                    destination.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Audio file must be 100 MB or smaller",
                    )
                output.write(chunk)
    finally:
        await file.close()

    return AudioUploadResponse(
        project_id=project_id,
        filename=original_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        status="uploaded",
    )
