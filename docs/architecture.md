# Architecture

## Core pipeline

```text
Lyrics + Audio
      ↓
Song Analyzer
      ↓
Scene Planner
      ↓
Singer / Character Bible
      ↓
Performance Planner
      ↓
Video Provider Adapter
      ↓
Scene Consistency / Validation
      ↓
Video Composer
      ↓
MP4
```

## Domain objects

### Project

The top-level user workspace for one generated video.

### Song

Lyrics, optional audio, detected duration, tempo and song structure.

### Singer Profile

Stable visual and performance identity used across generated shots.

### Scene

A semantic section of the final video with a purpose, duration, location, lighting, singer direction and audience direction.

### Shot

A concrete camera/performance unit generated from a scene.

### Generation Job

An asynchronous execution record connecting a project to analysis, scene generation, video generation and final assembly.

### Asset

A generated or uploaded file with a lifecycle and provenance.

## Initial output

The first renderer targets 9:16 vertical MP4. Resolution and aspect ratio remain configuration values so additional formats can be added without redesigning the domain model.

## Critical design rule

The system should never ask a video model to invent the whole song video in one prompt. It should generate a structured sequence of short shots and assemble them against the audio. This is necessary for temporal continuity, singer identity, scene continuity and controllable editing.
