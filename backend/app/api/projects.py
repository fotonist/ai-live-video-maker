from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field


router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    status: str
    created_at: datetime


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
