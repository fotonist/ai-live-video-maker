# AI Layer

The AI layer contains domain logic that transforms music and lyrics into structured generation instructions.

Planned components:

- `lyrics/` — lyric parsing and section extraction
- `song_analysis/` — tempo, sections, energy and musical context
- `scene_planner/` — scene and shot planning
- `character/` — singer identity and visual consistency
- `performance/` — singer movement, staging and performance timing
- `video_generation/` — provider adapters for video generation

The AI layer must produce structured data first. Provider-specific prompts are generated from that structured representation.
