from fastapi import FastAPI


app = FastAPI(
    title="AI Live Video Maker API",
    version="0.1.0",
    description="API for turning lyrics and music into AI-generated live performance videos.",
)


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
