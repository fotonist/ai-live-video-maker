import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.projects import router as projects_router
from app.api.render import router as render_router
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

# Vercel creates deployment-specific *.vercel.app hostnames. A fixed
# CORS_ORIGINS list therefore breaks direct browser-to-Render uploads whenever
# the frontend is opened from a new deployment URL. Keep explicit origins for
# configured hosts, while allowing only this application's Vercel hostnames.
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
    """Create the application tables when a database is configured."""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Return a minimal service health response."""
    return {"status": "ok"}


@app.get("/", tags=["system"])
def root() -> dict[str, str]:
    """Return basic API identity information."""
    return {
        "name": "AI Live Video Maker API",
        "version": "0.1.0",
        "status": "running",
    }
