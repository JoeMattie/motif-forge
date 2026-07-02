# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — TypeScript strict check (`tsc -b`) + production build; must pass with zero errors
- No test runner. Pure core modules (`src/core/`, `src/api/parse.ts`) are framework-free; verify them by bundling a scratch script with `node_modules/.bin/esbuild <script>.ts --bundle --format=esm --platform=node` and running it with node.

The full spec is [motif-forge-project-brief.md](motif-forge-project-brief.md) — the source of truth for scope, data model, validation rules, and success criteria.

## Architecture

Vite + React 18 + TypeScript strict. Runtime deps: `react`/`react-dom`, `tone` (synth playback), `smplr` (sampled instruments). The MIDI writer, WAV encoder, and IndexedDB wrapper remain hand-rolled by design; do not add libraries for those.

- `src/core/` — pure, framework-free domain logic: `theory.ts` (mode intervals, pitch↔scale-degree math; chromatic pitches decompose to nearest-degree-below + offset so mode swap is total), `transforms.ts` (deterministic transforms; each returns a child motif with lineage in `source`), `validate.ts` (LLM JSON → Motif with drop/warn counts; **polyphony allowed, ≤8 simultaneous voices**; in-scale violations warn, never drop; all float comparisons use `EPS = 1e-6`), `midi.ts` (SMF format-0, 480 TPQN; note-off sorts before note-on at equal ticks), `wav.ts`.
- `src/audio/` — `instruments.ts` is the adapter over two backends behind one `Instrument` interface: `'synth'` = Tone.js PolySynth (no network; built per playback with the part's optional `SynthPreset`, disposed on stop) and smplr sampled sounds (piano/e-piano/marimba/strings; CDN-fetched on first use, `CacheStorage`-cached, cached per context by the engine). Playback routes each note to its part's instrument (`scheduleMotif(instruments[], …)`); partless motifs use the transport-bar sound picker, and the transport "force" toggle (`transport.forceSound`) overrides parts to audition everything through the picked sound. Drum parts play a hand-built Tone kit (MembraneSynth/NoiseSynth/MetalSynth mapped from GM pitches) — transient per playback like synth parts. Master chain, metronome, and drone stay hand-rolled raw WebAudio in `voice.ts` against `BaseAudioContext`, shared by live playback and WAV export. Offline render (`renderOffline.ts`) uses one `Tone.OfflineContext` for everything: Tone parts bind to it, smplr parts bind to its `rawContext`, and `.render()` drives Tone's clock while the raw graph renders alongside — mixed-instrument motifs render in a single pass. `engine.ts` is a singleton holding all playback state **outside React**; components subscribe via `useSyncExternalStore` and the playhead is one rAF loop mutating an SVG ref — the grid must never re-render per frame. Motifs are ≤8 bars, so everything is scheduled up front at absolute context times (no lookahead loop); `play()` awaits all part instruments' `ready` promises first (snapshot exposes `loading`), guarded by a token against stale async scheduling.
- `src/api/` — Anthropic API client (`claude-sonnet-4-6`) calling through the Vite dev-server proxy at `/api/anthropic/*` (see `vite.config.ts`), which injects `x-api-key` (from `ANTHROPIC_API_KEY` in `.env.local`) and `anthropic-version` server-side — the browser must never call `api.anthropic.com` directly (CORS + key exposure). Prompt builders (enumerate allowed pitch classes concretely; texture rule from `GenerationBrief.texture`: `'lead'` = melodic line + light harmony ≤4 voices, `'poly'` = free polyphony ≤6 voices; `includeRhythm` demands a drums part; mutation supports `lockRhythm` — children keep exact note timings, only pitches change; "surprise" prompts give the model free rein over key/mode/tempo/bars — per-motif `tempo` is parsed and clamped in validation), fence-stripping JSON extraction, and batch orchestration. All LLM calls go through `queue.ts` (concurrency 2); each queued batch dispatches `BATCH_QUEUED`/`BATCH_FINISHED` and renders as a pulsing placeholder card in the triage grid. Default generation is 5 per batch (≤10 → single call, >10 → split in two); LLM mutations default to 5 children (`max_tokens` 8000; a `max_tokens` stop reason means truncated JSON — retry smaller, never parse it).
- `src/store/` — Context + reducer. Persistence is a write-through wrapper around dispatch in `AppContext.tsx` targeting the `PersistenceAdapter` interface (`idbAdapter` in prod, `memoryAdapter` for tests). Lineage is the `source` field on each motif (`parentId` denormalized only in the IDB records). Discard is a soft flag, not a delete.
- `src/components/` — triage grid is the primary screen. Keyboard triage is a single window keydown listener (`hooks/useKeyboardTriage.ts`) gated on selection state, not DOM focus, with a typing-target guard; arrow-row height comes from ResizeObserver-derived grid columns.

## What this is

Motif Forge: a local-first, single-page web app for generating, auditioning, mutating, and exporting short melodic motifs (2–8 bars, polyphonic) as MIDI/WAV. Motifs are generated in batches via the Anthropic API, triaged by ear with a keyboard-first UX, mutated (deterministically client-side or via LLM), tagged to song concepts (leitmotif management), and exported for use as Suno seed audio.

## Hard constraints (from the brief, as amended)

- **Minimal dependencies.** Everything runs in the browser: melody generation, Web Audio playback, mutation, MIDI/WAV export. No DAW, no Python, no native binaries. Permitted libraries: `tone` and `smplr` for playback instruments (a later amendment to the brief's zero-dep rule), plus the Anthropic API. The MIDI file writer (SMF format 0) and WAV encoder stay hand-rolled — do not add libraries for those. smplr fetches instrument samples from a CDN on first use; everything else works fully offline.
- **Anthropic API**: `POST https://api.anthropic.com/v1/messages` with model `claude-sonnet-4-6`; no API key needed in this environment. Response `data.content` is an array of blocks — concatenate `.text` fields, strip markdown fences, `JSON.parse` in try/catch. Keep batch size 10–20 motifs per call; the UI accumulates batches toward ~100 candidates.
- **If built as a Claude artifact**: no `<form>` tags (use onClick handlers) and no localStorage/sessionStorage (use `window.storage`); standalone builds use IndexedDB. Persistence must go through a thin swappable interface — decide the target once at project start.

## Core data model

A motif is a note list `{ pitch (MIDI number), startBeat, durationBeats, velocity, part? }[]` plus `parts` (up to 4: `{ name, instrument, preset? }` — the LLM picks instruments per part, may sound-design `synth` parts with an oscillator+ADSR preset (clamped in validation), and may include a `drums` part using GM drum pitches: kick 36, snare 38, hats 42/46 etc. — drum-part notes are exempt from the scale check, allowed down to pitch 35, play through a hand-built Tone drum kit, and export to MIDI channel 9) and metadata (key, mode, tempo, time signature, tags, generation lineage). Notes may overlap (polyphonic; validation caps at 8 simultaneous voices — this amends the brief's monophonic-MVP rule). `parts: []` means partless — played on the transport-bar sound; records from before this migration are normalized in `idbAdapter.loadAll`. MIDI export maps parts to channels with GM program changes. Every mutation records its parent motif and the transformation applied. Remaining validation rules per the brief: pitches 36–96, notes within bar count, ≥3 notes, in-scale unless chromaticism requested (warn rather than drop for scale violations only).

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

Dark, focused, studio-tool aesthetic (DAW side panel, not SaaS dashboard). The triage grid is the primary screen — optimize for speed and low visual noise. Piano-roll thumbnails are the visual anchor; playback state must be unmissable (highlighted card, moving playhead). The default synth timbre is deliberately plain so the user judges melodic bones; sampled instruments are opt-in via the transport-bar sound picker.

## Out of scope for MVP

Drum patterns, audio input/transcription, Suno API integration (manual file upload is the handoff), multi-user, auth, mobile polish, zip batch export.
