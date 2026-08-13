from datetime import datetime, timezone
from pathlib import Path
from subprocess import PIPE, run
from uuid import UUID, uuid4

import imageio_ffmpeg
import numpy as np
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


_projects: dict[UUID, ProjectResponse] = {}
_project_audio: dict[UUID, Path] = {}
_project_analysis: dict[UUID, AudioAnalysisResponse] = {}


def _audio_path(project_id: UUID) -> Path:
    path = _project_audio.get(project_id)
    if path is None or not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found for project",
        )
    return path


def _decode_audio(path: Path) -> np.ndarray:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg,
        "-v",
        "error",
        "-i",
        str(path),
        "-ac",
        "1",
        "-ar",
        str(ANALYSIS_SAMPLE_RATE),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "pipe:1",
    ]
    result = run(command, stdout=PIPE, stderr=PIPE, check=False)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Audio could not be decoded: {detail[:300]}",
        )

    samples = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32)
    if samples.size == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Audio contains no decodable samples",
        )
    return samples / 32768.0


def _frame_signal(samples: np.ndarray) -> np.ndarray:
    if samples.size < ANALYSIS_FRAME_SIZE:
        padded = np.pad(samples, (0, ANALYSIS_FRAME_SIZE - samples.size))
        return padded[np.newaxis, :]

    frame_count = 1 + (samples.size - ANALYSIS_FRAME_SIZE) // ANALYSIS_HOP_SIZE
    frames = np.lib.stride_tricks.sliding_window_view(
        samples, ANALYSIS_FRAME_SIZE
    )[::ANALYSIS_HOP_SIZE]
    return frames[:frame_count]


def _energy_curve(samples: np.ndarray) -> list[float]:
    window_size = ANALYSIS_SAMPLE_RATE // 2
    values: list[float] = []
    for start in range(0, samples.size, window_size):
        chunk = samples[start : start + window_size]
        if chunk.size == 0:
            continue
        rms = float(np.sqrt(np.mean(np.square(chunk))))
        values.append(rms)

    if not values:
        return [0.0]

    maximum = max(values)
    if maximum <= 0:
        return [0.0 for _ in values]
    return [round(value / maximum, 4) for value in values]


def _onset_envelope(frames: np.ndarray) -> np.ndarray:
    window = np.hanning(ANALYSIS_FRAME_SIZE).astype(np.float32)
    spectrum = np.abs(np.fft.rfft(frames * window, axis=1))
    flux = np.maximum(np.diff(spectrum, axis=0), 0.0).sum(axis=1)
    flux = np.concatenate(([0.0], flux))
    if flux.size < 3:
        return flux

    baseline = np.convolve(flux, np.ones(9) / 9.0, mode="same")
    novelty = np.maximum(flux - baseline, 0.0)
    maximum = float(novelty.max())
    return novelty / maximum if maximum > 0 else novelty


def _estimate_bpm(onsets: np.ndarray) -> float:
    if onsets.size < 4 or float(onsets.max()) <= 0:
        return 120.0

    centered = onsets - float(onsets.mean())
    max_lag = int(ANALYSIS_SAMPLE_RATE * 60 / 50 / ANALYSIS_HOP_SIZE)
    min_lag = int(ANALYSIS_SAMPLE_RATE * 60 / 180 / ANALYSIS_HOP_SIZE)
    max_lag = min(max_lag, centered.size - 1)
    min_lag = max(1, min_lag)
    if min_lag >= max_lag:
        return 120.0

    scores = []
    for lag in range(min_lag, max_lag + 1):
        scores.append(float(np.dot(centered[:-lag], centered[lag:])))

    best_lag = min_lag + int(np.argmax(scores))
    bpm = 60.0 * ANALYSIS_SAMPLE_RATE / (best_lag * ANALYSIS_HOP_SIZE)
    return round(float(np.clip(bpm, 50.0, 180.0)), 2)


def _beat_positions(onsets: np.ndarray, bpm: float, duration: float) -> list[float]:
    interval = 60.0 / bpm
    if duration <= 0:
        return []

    threshold = max(0.35, float(np.quantile(onsets, 0.82)))
    candidate_indices = np.where(onsets >= threshold)[0]
    candidate_times = candidate_indices * ANALYSIS_HOP_SIZE / ANALYSIS_SAMPLE_RATE

    if candidate_times.size:
        first_beat = float(candidate_times[0])
        first_beat = min(first_beat, interval)
    else:
        first_beat = 0.0

    beats = np.arange(first_beat, duration, interval)
    return [round(float(value), 3) for value in beats]


def _sections(energy: list[float], duration: float) -> list[dict[str, float | str]]:
    if duration <= 0:
        return []

    window = 0.5
    values = np.asarray(energy, dtype=np.float32)
    if values.size == 0:
        return [{"label": "full", "start": 0.0, "end": round(duration, 3)}]

    smooth = np.convolve(values, np.ones(5) / 5.0, mode="same")
    high = float(np.quantile(smooth, 0.72))
    low = float(np.quantile(smooth, 0.28))

    labels = [
        "intro" if index == 0 else "chorus" if value >= high else "bridge" if value <= low else "verse"
        for index, value in enumerate(smooth)
    ]
    labels[-1] = "outro"

    sections: list[dict[str, float | str]] = []
    start_index = 0
    current = labels[0]
    for index in range(1, len(labels)):
        if labels[index] == current:
            continue
        start = start_index * window
        end = min(index * window, duration)
        sections.append({"label": current, "start": round(start, 3), "end": round(end, 3)})
        start_index = index
        current = labels[index]

    sections.append(
        {
            "label": current,
            "start": round(start_index * window, 3),
            "end": round(duration, 3),
        }
    )
    return sections


def _analyze_audio(project_id: UUID) -> AudioAnalysisResponse:
    path = _audio_path(project_id)
    samples = _decode_audio(path)
    duration = samples.size / ANALYSIS_SAMPLE_RATE
    frames = _frame_signal(samples)
    onsets = _onset_envelope(frames)
    bpm = _estimate_bpm(onsets)
    interval = 60.0 / bpm
    energy = _energy_curve(samples)
    beats = _beat_positions(onsets, bpm, duration)
    sections = _sections(energy, duration)

    return AudioAnalysisResponse(
        project_id=project_id,
        duration_seconds=round(float(duration), 3),
        sample_rate=ANALYSIS_SAMPLE_RATE,
        bpm=bpm,
        beat_interval_seconds=round(interval, 4),
        beat_positions_seconds=beats,
        energy_curve=energy,
        sections=sections,
        status="analyzed",
    )


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

    _project_audio[project_id] = destination

    return AudioUploadResponse(
        project_id=project_id,
        filename=original_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        status="uploaded",
    )


@router.post("/{project_id}/analyze", response_model=AudioAnalysisResponse)
def analyze_audio(project_id: UUID) -> AudioAnalysisResponse:
    if project_id not in _projects:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    analysis = _analyze_audio(project_id)
    _project_analysis[project_id] = analysis
    return analysis


@router.get("/{project_id}/analysis", response_model=AudioAnalysisResponse)
def get_audio_analysis(project_id: UUID) -> AudioAnalysisResponse:
    if project_id not in _projects:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    analysis = _project_analysis.get(project_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio analysis not found")
    return analysis
