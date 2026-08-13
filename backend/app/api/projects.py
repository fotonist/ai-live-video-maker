from datetime import datetime, timezone
from pathlib import Path
from subprocess import PIPE, run
from uuid import UUID

import imageio_ffmpeg
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AudioAnalysis, AudioAsset, Project

router = APIRouter(prefix="/projects", tags=["projects"])
UPLOAD_ROOT = Path("uploads") / "projects"
ALLOWED_AUDIO_TYPES = {"audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav"}
MAX_AUDIO_SIZE = 100 * 1024 * 1024
ANALYSIS_SAMPLE_RATE = 22050
ANALYSIS_FRAME_SIZE = 2048
ANALYSIS_HOP_SIZE = 512

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

class AudioAnalysisResponse(BaseModel):
    project_id: UUID
    duration_seconds: float
    sample_rate: int
    bpm: float
    beat_interval_seconds: float
    beat_positions_seconds: list[float]
    energy_curve: list[float]
    sections: list[dict[str, float | str]]
    status: str

def _project_response(project: Project) -> ProjectResponse:
    return ProjectResponse(id=project.id, name=project.name, status=project.status, created_at=project.created_at)

def _audio_path(project: Project) -> Path:
    if project.audio is None:
        raise HTTPException(status_code=404, detail="Audio file not found for project")
    path = Path(project.audio.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found for project")
    return path

def _decode_audio(path: Path) -> np.ndarray:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    result = run([ffmpeg, "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(ANALYSIS_SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"], stdout=PIPE, stderr=PIPE, check=False)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(status_code=422, detail=f"Audio could not be decoded: {detail[:300]}")
    samples = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32)
    if samples.size == 0:
        raise HTTPException(status_code=422, detail="Audio contains no decodable samples")
    return samples / 32768.0

def _frame_signal(samples: np.ndarray) -> np.ndarray:
    if samples.size < ANALYSIS_FRAME_SIZE:
        return np.pad(samples, (0, ANALYSIS_FRAME_SIZE - samples.size))[np.newaxis, :]
    return np.lib.stride_tricks.sliding_window_view(samples, ANALYSIS_FRAME_SIZE)[::ANALYSIS_HOP_SIZE]

def _energy_curve(samples: np.ndarray) -> list[float]:
    window_size = ANALYSIS_SAMPLE_RATE // 2
    values = [float(np.sqrt(np.mean(np.square(samples[start:start + window_size])))) for start in range(0, samples.size, window_size) if samples[start:start + window_size].size]
    if not values:
        return [0.0]
    maximum = max(values)
    return [round(value / maximum, 4) for value in values] if maximum > 0 else [0.0 for _ in values]

def _onset_envelope(frames: np.ndarray) -> np.ndarray:
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(ANALYSIS_FRAME_SIZE).astype(np.float32), axis=1))
    flux = np.concatenate(([0.0], np.maximum(np.diff(spectrum, axis=0), 0.0).sum(axis=1)))
    if flux.size < 3:
        return flux
    novelty = np.maximum(flux - np.convolve(flux, np.ones(9) / 9.0, mode="same"), 0.0)
    maximum = float(novelty.max())
    return novelty / maximum if maximum > 0 else novelty

def _estimate_bpm(onsets: np.ndarray) -> float:
    if onsets.size < 4 or float(onsets.max()) <= 0:
        return 120.0
    centered = onsets - float(onsets.mean())
    min_lag = max(1, int(ANALYSIS_SAMPLE_RATE * 60 / 180 / ANALYSIS_HOP_SIZE))
    max_lag = min(int(ANALYSIS_SAMPLE_RATE * 60 / 50 / ANALYSIS_HOP_SIZE), centered.size - 1)
    if min_lag >= max_lag:
        return 120.0
    scores = [float(np.dot(centered[:-lag], centered[lag:])) for lag in range(min_lag, max_lag + 1)]
    best_lag = min_lag + int(np.argmax(scores))
    return round(float(np.clip(60.0 * ANALYSIS_SAMPLE_RATE / (best_lag * ANALYSIS_HOP_SIZE), 50.0, 180.0)), 2)

def _beat_positions(bpm: float, duration: float) -> list[float]:
    return [round(float(value), 3) for value in np.arange(0.0, duration, 60.0 / bpm)] if duration > 0 else []

def _sections(energy: list[float], duration: float) -> list[dict[str, float | str]]:
    if duration <= 0:
        return []
    if not energy:
        return [{"label": "full", "start": 0.0, "end": round(duration, 3)}]
    values = np.asarray(energy, dtype=np.float32)
    smooth = np.convolve(values, np.ones(5) / 5.0, mode="same")
    high, low = float(np.quantile(smooth, 0.72)), float(np.quantile(smooth, 0.28))
    labels = ["intro" if i == 0 else "chorus" if value >= high else "bridge" if value <= low else "verse" for i, value in enumerate(smooth)]
    labels[-1] = "outro"
    sections, start_index, current = [], 0, labels[0]
    for index in range(1, len(labels)):
        if labels[index] != current:
            sections.append({"label": current, "start": round(start_index * 0.5, 3), "end": round(min(index * 0.5, duration), 3)})
            start_index, current = index, labels[index]
    sections.append({"label": current, "start": round(start_index * 0.5, 3), "end": round(duration, 3)})
    return sections

def _analyze_audio(project: Project) -> AudioAnalysisResponse:
    samples = _decode_audio(_audio_path(project))
    duration = samples.size / ANALYSIS_SAMPLE_RATE
    onsets = _onset_envelope(_frame_signal(samples))
    bpm = _estimate_bpm(onsets)
    energy = _energy_curve(samples)
    return AudioAnalysisResponse(project_id=project.id, duration_seconds=round(float(duration), 3), sample_rate=ANALYSIS_SAMPLE_RATE, bpm=bpm, beat_interval_seconds=round(60.0 / bpm, 4), beat_positions_seconds=_beat_positions(bpm, duration), energy_curve=energy, sections=_sections(energy, duration), status="analyzed")

@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> ProjectResponse:
    project = Project(name=payload.name.strip(), status="draft", created_at=datetime.now(timezone.utc))
    db.add(project); db.commit(); db.refresh(project)
    return _project_response(project)

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID, db: Session = Depends(get_db)) -> ProjectResponse:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_response(project)

@router.post("/{project_id}/audio", response_model=AudioUploadResponse)
async def upload_audio(project_id: UUID, file: UploadFile = File(...), db: Session = Depends(get_db)) -> AudioUploadResponse:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    extension = ALLOWED_AUDIO_TYPES.get(file.content_type or "")
    if extension is None:
        raise HTTPException(status_code=415, detail="Only MP3 and WAV audio files are supported")
    original_name = Path(file.filename or "audio").name
    project_dir = UPLOAD_ROOT / str(project_id); project_dir.mkdir(parents=True, exist_ok=True)
    destination = project_dir / f"audio{extension}"
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_AUDIO_SIZE:
                    destination.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Audio file must be 100 MB or smaller")
                output.write(chunk)
    finally:
        await file.close()
    if project.audio is None:
        project.audio = AudioAsset(filename=original_name, content_type=file.content_type or "application/octet-stream", size_bytes=size, storage_path=str(destination))
    else:
        project.audio.filename = original_name; project.audio.content_type = file.content_type or "application/octet-stream"; project.audio.size_bytes = size; project.audio.storage_path = str(destination)
    project.status = "audio_uploaded"; db.add(project); db.commit()
    return AudioUploadResponse(project_id=project_id, filename=original_name, content_type=file.content_type or "application/octet-stream", size_bytes=size, status="uploaded")

@router.post("/{project_id}/analyze", response_model=AudioAnalysisResponse)
def analyze_audio(project_id: UUID, db: Session = Depends(get_db)) -> AudioAnalysisResponse:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    result = _analyze_audio(project)
    if project.analysis is None:
        project.analysis = AudioAnalysis(project_id=project_id)
    project.analysis.duration_seconds = result.duration_seconds; project.analysis.sample_rate = result.sample_rate; project.analysis.bpm = result.bpm; project.analysis.beat_interval_seconds = result.beat_interval_seconds; project.analysis.beat_positions_seconds = result.beat_positions_seconds; project.analysis.energy_curve = result.energy_curve; project.analysis.sections = result.sections; project.analysis.status = "analyzed"
    project.status = "analyzed"; db.add(project); db.commit()
    return result

@router.get("/{project_id}/analysis", response_model=AudioAnalysisResponse)
def get_audio_analysis(project_id: UUID, db: Session = Depends(get_db)) -> AudioAnalysisResponse:
    project = db.get(Project, project_id)
    if project is None or project.analysis is None:
        raise HTTPException(status_code=404, detail="Audio analysis not found")
    analysis = project.analysis
    return AudioAnalysisResponse(project_id=project_id, duration_seconds=analysis.duration_seconds, sample_rate=analysis.sample_rate, bpm=analysis.bpm, beat_interval_seconds=analysis.beat_interval_seconds, beat_positions_seconds=analysis.beat_positions_seconds, energy_curve=analysis.energy_curve, sections=analysis.sections, status=analysis.status)
