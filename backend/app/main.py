import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.projects import router as projects_router
from app.api.render import recover_interrupted_renders, router as render_router
from app.api.storyboard import router as storyboard_router
from app.db import get_engine
from app.models import Base


app = FastAPI(
    title="AI Live Video Maker API",
    version="0.1.0",
    description="API for turning lyrics and music into AI-generated live performance videos.",
)

cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

vercel_origin_regex = r"^https://ai-live-video-maker(?:-[a-z0-9-]+)*\.vercel\.app$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=vercel_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)
app.include_router(storyboard_router)
app.include_router(render_router)


@app.on_event("startup")
def initialize_database() -> None:
    """Create tables and recover renders interrupted by a previous restart."""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    recover_interrupted_renders()


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", tags=["system"])
def root() -> dict[str, str]:
    return {
        "name": "AI Live Video Maker API",
        "version": "0.1.0",
        "status": "running",
    }
