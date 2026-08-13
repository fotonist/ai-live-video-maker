# AI Live Video Maker

AI-powered music performance video generation from lyrics and optional audio.

## Product goal

Turn a song into a coherent live-performance video:

`Lyrics + Audio → Song Analysis → Scene Plan → Singer/Character Bible → Performance Plan → Video Generation → Assembly → MP4`

The MVP targets realistic concert/performance videos in 9:16 vertical format.

## MVP scope

1. Upload lyrics.
2. Optionally upload MP3/WAV audio.
3. Analyze song structure and lyrical sections.
4. Generate a structured scene plan.
5. Define a consistent singer/performance identity.
6. Generate performance shots through a pluggable video provider.
7. Assemble shots against the original audio.
8. Export MP4.

## Repository structure

```text
ai-live-video-maker/
├── backend/        # FastAPI API and orchestration
├── frontend/       # Next.js application
├── ai/             # Analysis, planning, character and generation logic
├── workers/        # Long-running generation/render jobs
├── storage/        # Storage abstractions and generated asset handling
├── docs/            # Architecture and product documentation
└── .github/         # CI/CD workflows
```

## Architecture principles

- Provider-agnostic AI generation interfaces.
- Asynchronous video generation jobs.
- Persistent job and asset state.
- Explicit scene/shot metadata rather than ad-hoc prompts.
- Character consistency as a first-class domain concept.
- Audio remains the timing authority for the final edit.
- 9:16 is the initial output target; the rendering model should not hard-code it permanently.

## Development status

**Phase 0 — repository foundation**

The repository currently contains the initial project skeleton. Implementation will proceed incrementally, with each module kept runnable before moving to the next.
