# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — TypeScript strict check (`tsc -b`) + production build; must pass with zero errors
- No test runner. Pure core modules (`src/core/`, `src/api/parse.ts`) are framework-free; verify them by bundling a scratch script with `node_modules/.bin/esbuild <script>.ts --bundle --format=esm --platform=node` and running it with node.

The full spec is [motif-forge-project-brief.md](motif-forge-project-brief.md) — the source of truth for scope, data model, validation rules, and success criteria.

## Architecture

Vite + React 18 + TypeScript strict. Runtime deps are `react`/`react-dom` only — the MIDI writer, WAV encoder, synth, and IndexedDB wrapper are hand-rolled by design; do not add libraries for these.

- `src/core/` — pure, framework-free domain logic: `theory.ts` (mode intervals, pitch↔scale-degree math; chromatic pitches decompose to nearest-degree-below + offset so mode swap is total), `transforms.ts` (deterministic transforms; each returns a child motif with lineage in `source`), `validate.ts` (LLM JSON → Motif with drop/warn counts; in-scale violations warn, never drop; all float comparisons use `EPS = 1e-6`), `midi.ts` (SMF format-0, 480 TPQN; note-off sorts before note-on at equal ticks), `wav.ts`.
- `src/audio/` — `voice.ts` schedules against `BaseAudioContext` so live playback (`engine.ts`) and WAV export (`renderOffline.ts`) share the identical synth graph; never fork these paths. `engine.ts` is a singleton holding all playback state **outside React**; components subscribe via `useSyncExternalStore` and the playhead is one rAF loop mutating an SVG ref — the grid must never re-render per frame. Motifs are ≤8 bars, so everything is scheduled up front at absolute context times (no lookahead loop).
- `src/api/` — Anthropic API client (`claude-sonnet-4-6`) calling through the Vite dev-server proxy at `/api/anthropic/*` (see `vite.config.ts`), which injects `x-api-key` (from `ANTHROPIC_API_KEY` in `.env.local`) and `anthropic-version` server-side — the browser must never call `api.anthropic.com` directly (CORS + key exposure). Prompt builders (enumerate allowed pitch classes concretely), fence-stripping JSON extraction, and batch orchestration (10/call, `max_tokens` 8000; a `max_tokens` stop reason means truncated JSON — retry smaller, never parse it).
- `src/store/` — Context + reducer. Persistence is a write-through wrapper around dispatch in `AppContext.tsx` targeting the `PersistenceAdapter` interface (`idbAdapter` in prod, `memoryAdapter` for tests). Lineage is the `source` field on each motif (`parentId` denormalized only in the IDB records). Discard is a soft flag, not a delete.
- `src/components/` — triage grid is the primary screen. Keyboard triage is a single window keydown listener (`hooks/useKeyboardTriage.ts`) gated on selection state, not DOM focus, with a typing-target guard; arrow-row height comes from ResizeObserver-derived grid columns.

## What this is

Motif Forge: a local-first, single-page web app for generating, auditioning, mutating, and exporting short monophonic melodic motifs (2–8 bars) as MIDI/WAV. Motifs are generated in batches via the Anthropic API, triaged by ear with a keyboard-first UX, mutated (deterministically client-side or via LLM), tagged to song concepts (leitmotif management), and exported for use as Suno seed audio.

## Hard constraints (from the brief)

- **Near-zero dependencies.** Everything runs in the browser: melody generation, Web Audio playback, mutation, MIDI/WAV export. No DAW, no Python, no native binaries. The only permitted external items are (optionally) Tone.js from cdnjs and the Anthropic API. Hand-roll the MIDI file writer (~150 lines, SMF format 0) and WAV encoder (OfflineAudioContext) rather than adding libraries.
- **Anthropic API**: `POST https://api.anthropic.com/v1/messages` with model `claude-sonnet-4-6`; no API key needed in this environment. Response `data.content` is an array of blocks — concatenate `.text` fields, strip markdown fences, `JSON.parse` in try/catch. Keep batch size 10–20 motifs per call; the UI accumulates batches toward ~100 candidates.
- **If built as a Claude artifact**: no `<form>` tags (use onClick handlers) and no localStorage/sessionStorage (use `window.storage`); standalone builds use IndexedDB. Persistence must go through a thin swappable interface — decide the target once at project start.

## Core data model

A motif is a note list `{ pitch (MIDI number), startBeat, durationBeats, velocity }[]` plus metadata (key, mode, tempo, time signature, tags, generation lineage). Every mutation records its parent motif and the transformation applied. The exact JSON schema the generation prompt must demand, and the validation rules (pitches 36–96, notes within bar count, ≥3 notes, no overlaps, in-scale unless chromaticism requested — warn rather than drop for scale violations only), are specified in the brief.

## Build order

Follow the brief's incremental sequence — each step must leave the app working and demoable:

1. Data model + hand-rolled synth playback + piano-roll rendering (against 3 hardcoded motifs)
2. MIDI export + WAV export (verify files open/play correctly)
3. Claude API generation with JSON validation
4. Triage UX (arrow keys, space to play, `1`–`5` to rate, `x` to discard)
5. Deterministic transforms (inversion, retrograde, transposition, augmentation/diminution, mode swap, octave displacement)
6. LLM mutations + lineage display
7. Library persistence + concept/leitmotif view

## Design intent

Dark, focused, studio-tool aesthetic (DAW side panel, not SaaS dashboard). The triage grid is the primary screen — optimize for speed and low visual noise. Piano-roll thumbnails are the visual anchor; playback state must be unmissable (highlighted card, moving playhead). Playback timbre is deliberately plain (triangle/sine synth) so the user judges melodic bones, not sound design.

## Out of scope for MVP

Polyphony/chords, drum patterns, audio input/transcription, Suno API integration (manual file upload is the handoff), multi-user, auth, mobile polish, zip batch export.
