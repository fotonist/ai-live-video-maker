from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AudioAnalysis, Project
from app.services.scene_planner import plan_scenes, scenes_to_dict

router = APIRouter(prefix="/projects", tags=["storyboard"])


@router.post("/{project_id}/storyboard")
def create_storyboard(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    analysis = db.query(AudioAnalysis).filter(AudioAnalysis.project_id == project_id).one_or_none()
    if analysis is None:
        raise HTTPException(status_code=409, detail="Audio analysis is required before storyboard generation")

    scenes = plan_scenes(
        duration_seconds=analysis.duration_seconds,
        sections=analysis.sections or [],
        energy_curve=analysis.energy_curve or [],
    )

    return {
        "project_id": str(project_id),
        "status": "planned",
        "scenes": scenes_to_dict(scenes),
    }
