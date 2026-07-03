# Motif Forge — Full MVP Implementation Plan

## Context

Greenfield build. The repo contains only [motif-forge-project-brief.md](motif-forge-project-brief.md) (the spec — source of truth) and CLAUDE.md. The app is a local-first SPA for generating ~100 melodic motif candidates via the Anthropic API, triaging them by ear with a keyboard-first UX, mutating survivors (deterministic + LLM), organizing them as leitmotifs by song concept, and exporting MIDI/WAV that the user feeds to Suno as seed audio.

**Decisions made with the user:** Vite + React, full MVP scope (all 7 build steps). Derived decisions: TypeScript strict (unit-heavy numeric code — beats/ticks/semitones/degrees — and binary formats benefit most), standalone app → IndexedDB persistence, hand-rolled Web Audio synth (no Tone.js). Runtime deps: `react`, `react-dom` only; everything else (MIDI writer, WAV encoder, synth, IDB wrapper) hand-rolled per the brief's near-zero-dependency constraint.

## Architecture

```
src/
  main.tsx, App.tsx, styles.css      # dark studio-tool theme, plain CSS custom props
  types.ts                           # Note, Motif, MotifSource, Concept, GenerationBrief
  core/                              # pure, framework-free
    theory.ts        # mode intervals, key parsing, isInScale, pitch<->degree math
    transforms.ts    # deterministic transforms (pure) + applyTransform wrapper
    validate.ts      # raw LLM JSON -> Motif[], drop/warn counts
    midi.ts          # SMF format-0 writer (VLQ, note on/off, tempo meta), 480 TPQN
    wav.ts           # AudioBuffer -> 16-bit mono PCM WAV Blob
    downloads.ts     # Blob + anchor download
    sampleMotifs.ts  # 3 hardcoded dev fixtures (step 1)
  audio/
    voice.ts         # scheduleMotif/Metronome/Drone against BaseAudioContext
    engine.ts        # AudioEngine singleton: play/stop/toggle, position clock,
                     #   useSyncExternalStore-compatible subscribe
    renderOffline.ts # OfflineAudioContext render for WAV export
  api/
    client.ts        # POST api.anthropic.com/v1/messages, model claude-sonnet-4-6
    prompts.ts       # generation + mutation prompt builders
    parse.ts         # fence stripping, brace extraction, safe JSON.parse
    generate.ts      # batching orchestration -> ValidationResult
  store/
    persistence.ts   # PersistenceAdapter interface
    memoryAdapter.ts # no-op impl used through step 6
    idbAdapter.ts    # IndexedDB impl (step 7)
    appState.ts      # reducer + actions
    AppContext.tsx   # provider; write-through persistence wrapper around dispatch
  components/
    TransportBar, TriageGrid, MotifCard, PianoRoll, GenerationPanel,
    MutationPanel, LineageStrip, LibraryView, ConceptView
    hooks/useKeyboardTriage, usePlayhead, useGridColumns
```

### Key design decisions

- **Data model**: `Motif` = notes `{pitch, startBeat, durationBeats, velocity}[]` + key/mode/bars/timeSig/tempo, `conceptId`, `rating 0–5`, `discarded` (soft flag), `scaleWarning`, and `source` (tagged union: `seed | generated{brief} | transform{parentId, transform} | llm-mutation{parentId, brief}`). Lineage IS the `source` chain — no separate table; `parentId` denormalized onto stored records for an IDB index. IDs via `crypto.randomUUID()`.
- **State**: React Context + `useReducer`. Persistence is a **write-through wrapper around dispatch** (pattern-matches persistent actions → adapter calls), so the reducer stays pure and swapping memory→IDB at step 7 is one constructor change. **Playback state lives outside React** in the AudioEngine singleton, read via `useSyncExternalStore` — the grid never re-renders during playback.
- **Playback**: motifs ≤8 bars (~16 s), so schedule the whole motif up front at absolute `ctx.currentTime`-relative times — no lookahead loop, no drift. Triangle osc → per-note gain envelope (5 ms attack, `setTargetAtTime` decay) → master gain → `DynamicsCompressorNode`. Stop = 15 ms master-gain ramp (click-free). AudioContext created lazily on first play (autoplay policy). All scheduling written against `BaseAudioContext` so live playback and offline WAV render share the exact same code path.
- **Playhead**: SVG piano roll with `viewBox` in beat units, so playhead x = position in beats. One rAF loop on the playing card only, mutating the line's transform via ref; position derived from `ctx.currentTime` each frame.
- **Generation**: batches of **10 per call, `max_tokens: 8000`** (the brief's example `1000` would truncate; treat `stop_reason === "max_tokens"` as failed batch, retry smaller — never parse truncated JSON). "Generate 20" = two parallel calls of 10. Prompt enumerates the allowed pitch classes concretely, demands exact bar fill, ≥3 notes, no overlaps, rhythmic variety across the batch, raw JSON only. Validation per brief: pitches 36–96, bounds with `EPS=1e-6` (LLM floats), monophony, ≥3 notes; in-scale is **warn-only** (badge, never drop).
- **Triage keyboard UX**: selection is app state (not DOM focus); one window keydown listener with input-element guard (bail on input/textarea/select/contentEditable). `←→` ±1, `↑↓` ±columns (ResizeObserver-derived column count), `Space` toggle play (preventDefault), `1–5` rate + auto-advance, `x` discard + auto-advance, `u` undo discard. `scrollIntoView({block:'nearest'})` on selection change.
- **Transforms**: pure `(parent, Transform) -> child` with lineage recorded. Inversion reflects around first note's pitch (chromatic; set `scaleWarning` rather than snap). Mode swap via `pitchToDegree` that maps chromatic notes to nearest-degree-below + offset, so it's total. Octave displacement uses PianoRoll interactive mode (click notes to select, ±8va).
- **MIDI**: 480 TPQN, tempo + time-sig meta at tick 0, absolute ticks → deltas with **note-off-before-note-on tie-break** at equal ticks, no running status. VLQ: MSB group first, continuation bits, build low-to-high then reverse.
- **IndexedDB**: DB `motif-forge` v1 via ~40-line promise wrapper. Stores: `motifs` (keyPath `id`; indexes `conceptId`, `parentId`, `rating`, `createdAt`, `discarded`), `concepts`, `meta`. Persist everything including unrated/discarded (refresh mid-triage must lose nothing; `discarded` is a filter, not a delete). Hydrate on boot → `HYDRATED` action.

## Implementation order (each step ends demoable)

0. **Scaffold**: Vite react-ts, strip boilerplate, dark CSS base, `types.ts`, module skeletons, `memoryAdapter`. Update CLAUDE.md with actual dev/build commands.
1. **Playback + piano roll**: `theory.ts`, 3 sample motifs, `voice.ts`, `engine.ts`, `PianoRoll`, `MotifCard`, `TransportBar`, `usePlayhead`. ✓ Samples play with clean timbre, synced playhead, metronome/drone/tempo work.
2. **Export**: `midi.ts`, `wav.ts`, `renderOffline.ts`, `downloads.ts`, card export buttons. ✓ .mid opens correctly in an external player (VLQ spot-check: 0→`00`, 0x80→`81 00`, 0x2000→`C0 00`); .wav plays and matches in-app sound with decay tail (render length +1 s).
3. **Generation**: `client.ts`, `prompts.ts`, `parse.ts`, `validate.ts`, `generate.ts`, `GenerationPanel`, accumulation + dropped/warning toast. ✓ Two batches of 10 land as playable cards; malformed responses fail cleanly.
4. **Triage UX**: selection, `useKeyboardTriage`, `useGridColumns`, rating badges, discard/restore, filters, playing-card highlight, optional auto-play-on-advance. ✓ Triage 20 candidates mouse-free; typing in briefs triggers nothing.
5. **Deterministic transforms**: `transforms.ts`, MutationPanel buttons, interactive PianoRoll selection, `LineageStrip`. ✓ retrograde∘retrograde = identity; children playable/exportable, grouped under parent.
6. **LLM mutations**: `mutateBatch`, mutation-brief UI, lineage breadcrumbs. ✓ "keep bar 1, resolve differently" children match parent's bar 1 on the rolls; two-deep chains display.
7. **Persistence + concepts**: `idbAdapter`, hydration, concept CRUD, `LibraryView`, `ConceptView` with "transform for new track" prefill. ✓ Hard refresh preserves everything; fresh DB boots clean.

## Known tricky spots

- Envelope gains must never `exponentialRamp` to 0 — use `setTargetAtTime`/linear ramps; start gains at 0; ramp master down before disconnect (clicks).
- Float beat arithmetic: epsilon (1e-6) on all bounds/overlap checks; round to integer ticks exactly once, at MIDI export.
- Augmentation ×2 on an 8-bar motif exceeds the 2–8 bar spec — allow with a warning (the range governs generation, not derived material).
- Never duplicate the synth graph between live and offline paths — one `scheduleMotif` against `BaseAudioContext`.

## Verification (end-to-end)

Run `npm run dev` and walk the success criteria from the brief: write a constraint brief → generate ~40–100 candidates across batches → triage by keyboard only → apply retrograde + a mode swap + an LLM mutation to a survivor → tag it to a concept → export .mid and .wav and confirm both open/play correctly (QuickLook/GarageBand/Finder) → hard-refresh → confirm library, ratings, lineage, and concept view are intact. `npm run build` must pass TypeScript strict with zero errors.
