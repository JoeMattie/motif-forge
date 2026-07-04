# Noodle Panel — implementation plan

A **Noodle panel** under the generation panel: the way Joe's *own* musical ideas enter the triage pool alongside generated ones. Two input paths into one editable piano roll:

1. **MIDI noodling** — a Web MIDI device or computer-keyboard musical typing, captured live with optional key/mode lock (circle-of-fifths dial) and snap-to-grid. Recording arms on the first incoming note and loops with overdub.
2. **Mic RECORD** — NeuralNote-style audio-to-MIDI: sing/hum/whistle, beatbox, or play an instrument into the microphone for N bars; the app transcribes it onto the same roll.

Either way the take is **staged** in the panel — edited, auditioned on loop, quantized/key-snapped — and an **ADD TO POOL** key commits it to the triage grid as a fresh family (`source: { kind: 'recorded', … }`). The panel keeps the take so variants can be committed.

## Decisions (locked)

- **Transcription engine: hybrid, staged.** A VOICE / INST / BEATS input switch.
  - **VOICE** — hand-rolled YIN/pYIN monophonic pitch tracker + note segmentation. Pure DSP, zero download, best for hum/whistle/singing.
  - **BEATS** — onset detection + spectral-feature heuristic → kick/snare/hat drum notes. Pure DSP, zero download.
  - **INST** — Spotify **Basic Pitch** `nmp.onnx` (~225 KB, Apache-2.0) for polyphonic instruments, run through the same onnxruntime-web worker pattern as the neural tier. Ships **last**, as an opt-in.
- **Click-synced window, no tempo estimation.** The panel owns tempo / bars / time-sig (defaulted from the generation brief). MIDI records as a loop-overdub against a metronome; mic records a count-in + exactly N bars, then transcribes. Beat positions are exact by construction, so quantize is trivial.
- **Stage, then commit.** Nothing enters the pool until ADD TO POOL. Noisy transcriptions get cleaned in the panel, not the triage grid.
- **Piano-roll editor: hand-rolled SVG**, using **ryohey/signal as an interaction-design reference only** (see research notes).
- **Zero new runtime npm deps.** Web MIDI, getUserMedia, and AudioWorklet are platform APIs; YIN/onset DSP and the Basic Pitch post-processing are hand-rolled/ported; onnxruntime-web is already a dependency.

## Research notes

### NeuralNote → Basic Pitch

[NeuralNote](https://github.com/DamRsn/NeuralNote) (Apache-2.0) is a C++/JUCE desktop plugin that wraps [Spotify Basic Pitch](https://github.com/spotify/basic-pitch) (ICASSP 2022). Its RTNeural/split-ONNX plumbing is a desktop workaround we don't need — Spotify's official **`nmp.onnx` export is self-contained** (the CQT + harmonic-stacking frontend is inside the graph) and is only **~225 KB / ~17K parameters**, Apache-2.0 code *and* weights. Pipeline facts to implement against:

- Input: **22050 Hz mono**; processed in 2-second windows of **43844 samples** with ~7680-sample overlap, stitched in post.
- Outputs: three posteriogram heads at ~86 fps (11.6 ms/frame) — `onset` (88 bins, MIDI 21–108), `note`/frames (88 bins), `contour` (264 bins, 3/semitone; used for pitch bends — we drop bends, our data model has none).
- Post-processing to **port from [basic-pitch-ts](https://github.com/spotify/basic-pitch-ts)** (Apache-2.0, keep the notice): `outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLenFrames)` + `noteFramesToTime`. Reference defaults: onset 0.5, frame 0.3, min note ~128 ms (TS demo uses 0.25/0.25/5-frames ≈ 58 ms — note the frames-vs-ms unit difference).
- NeuralNote's parameter UX worth copying: **note sensitivity** (frame threshold), **split sensitivity** (onset threshold), **min note duration**, **min/max pitch gate**, **key/scale snap**, **grid quantize** (the last two are post-hoc features NeuralNote adds — ours come free from the panel's lock/snap).
- Verified downstream: [sevagh/basicpitch.cpp](https://github.com/sevagh/basicpitch.cpp) runs `nmp.onnx` end-to-end under ONNX Runtime. Before implementation, confirm tensor names in Netron.

### Why not Basic-Pitch-for-everything

Basic Pitch is a *polyphonic instrument* model and is demonstrably weak on hummed/whistled/sung monophonic input: it emits harmonic/octave ghosts and over-segments notes with vibrato/portamento/breathy onsets. Real hum-to-MIDI tools use a **monophonic tracker + segmentation** instead. Survey results (2025/2026):

| Option | Verdict |
|---|---|
| **YIN/pYIN** (hand-rolled) | ✅ VOICE v1. Zero download, MIT-clean, excellent on hum/whistle (near-sinusoidal). Needs octave-error correction + smoothing. |
| **Basic Pitch ONNX** | ✅ INST. Best browser-ready polyphonic option; tiny; Apache-2.0. |
| Onset + spectral heuristic | ✅ BEATS. No small browser beatbox model worth shipping; band-energy/centroid/ZCR → kick/snare/hat is the pragmatic answer. |
| [PESTO](https://github.com/SonyCSLParis/pesto) | Possible future VOICE upgrade: <30K params, singing-validated, ONNX-exportable — but LGPL-3.0 (verify weights license first). |
| SPICE (Apache-2.0, TF.js) | Outputs *relative* pitch, needs calibration; fallback option only. |
| CREPE | Full model = 89 MB (no); "tiny" variant makes octave errors. |
| MT3/YourMT3, SVT research models (VOCANO etc.) | Too heavy / no web ports. Not browser-practical. |
| **essentia.js / aubiojs** | ❌ **Do not use**: AGPL-3.0 / GPL, and MELODIA is patent-encumbered for commercial use. |
| ByteDance piano transcription | Optional future "piano mode" (Pianolyze proves it runs on onnxruntime-web); out of scope. |

### ryohey/signal (the MIDI editor question)

[signal](https://github.com/ryohey/signal) (MIT, React 19) was evaluated as the editor. **Verdict: overkill as a dependency; excellent as a blueprint.** Nothing embeddable is on npm (`@signal-app/*` are internal-only; `@ryohey/webgl-react` is a generic WebGL rect renderer with zero editor logic). Vendoring the real editor drags in MobX **and** Jotai (mid-migration), Emotion, webgl-react + gl-matrix, lodash, and its core domain model — 100 KB+ gz and two state libraries against the minimal-deps rule — and WebGL solves a thousands-of-notes scale problem an ≤8-bar roll doesn't have. What we **adopt from it** (behavior, not code):

- Gesture decomposition into small separate handlers: create / move / resize-left / resize-right / marquee / click-select / shift-add / cmd-remove / drag-scroll.
- Pencil vs selection tool modes.
- Snap rules: `quantizeFloor` for melodic note creation, `quantizeRound` for drum/rhythm.
- **Last-used duration** applied to newly penciled notes.
- Velocity edited in a slim separate lane under the roll, not on the note bodies.
- Touchpad-aware wheel zoom centered on the cursor.

## Architecture

### New files

**Components**

- `src/components/NoodlePanel.tsx` — the panel: collapsed strip / expanded `.module` (same pattern as `GenerationPanel`, rendered by `App.tsx` right after it inside the triage keep-alive wrapper).
  - **Input row**: MIDI device `Select` (hidden when Web MIDI unsupported — Safari) · KEYS toggle (musical typing) · mic cluster: RECORD key + VOICE/INST/BEATS `SegmentedControl`.
  - **Key row**: `CircleOfFifths` (reused from `src/components/hw/CircleOfFifths.tsx`) + mode `SegmentedControl` + **LOCK** toggle (snap input to key/mode).
  - **Grid row**: **SNAP** toggle + resolution (1/4 · 1/8 · 1/16 · 1/8T — a `SegmentedControl`, or finally a use for the unused `Knob`).
  - **Timing row**: tempo / bars / time-sig, seeded from the generation brief; metronome `HardToggle`; count-in.
  - **Transport/take strip**: `PlayRound` loop audition · REC arm (`data-danger`) · QUANTIZE · CLEAR · **ADD TO POOL**.
- `src/components/NoodleRoll.tsx` — the editable SVG piano roll per the signal blueprint above. Reuses `LcdRoll`'s LCD skin and `viewBox`/`preserveAspectRatio="none"` beat×pitch coordinate math (`src/components/LcdRoll.tsx`) but is a new component — LcdRoll's dormant `onToggleNote` hook is far short of an editor. Fixed pitch viewport with scroll (not auto-fit), in-scale row shading when LOCK is on, `x`/alt-click delete, velocity lane below, playhead via the existing `usePlayhead` rAF pattern (no per-frame re-render).

**`src/noodle/` module**

- `takeStore.ts` — the staged take as a singleton outside React (`useSyncExternalStore`, same pattern as `audio/engine.ts` / `generation/activity.ts`): `{ notes, tempo, bars, timeSig, key, mode }`, edit ops, undo stack; persisted to localStorage (`motif-forge:noodle-take`) so a take survives reloads.
- `midiInput.ts` — Web MIDI singleton: `navigator.requestMIDIAccess` feature gate, device list + selected-device pref, note-on/off → `{ pitch, velocity, timeMs }` events.
- `musicalTyping.ts` — Ableton-style layout (`awsedftgyhujk` = piano keys, `z`/`x` octave shift), same event shape. Active only while KEYS is armed; reuses `isTypingTarget` from `src/components/hooks/useKeyboardTriage.ts`. **Mutually exclusive with triage keys**: `App.tsx` passes `enabled=false` to `useKeyboardTriage` while noodle capture is armed (same mechanism as the Mutation Bay drawer).
- `recorder.ts` — state machine `idle → armed → recording → done`. Armed = live monitoring (a `createToneSynth` on the shared context) with the click running; recording starts at the bar boundary of the **first note-on**; loops N bars, each pass **overdubbing** into the take. Note beats derived from the AudioContext clock (engine-style: computed from `ctx.currentTime`, never accumulated). Click scheduled per-pass via `scheduleMetronome` (`src/audio/voice.ts`) using the engine's gapless-loop reschedule pattern. LOCK snaps pitches on capture via `pitchToDegree`/`degreeToPitch` (`src/core/theory.ts`); SNAP quantizes `startBeat` on capture; QUANTIZE applies the grid destructively later.
- `micCapture.ts` — `getUserMedia` + AudioWorklet capture to Float32 chunks on the shared context; count-in via `scheduleMetronome`; records exactly `bars × beatsPerBar × secondsPerBeat` (+ small tail); fixed latency-compensation offset as a pref.
- `transcribe/voice.ts` — hand-rolled YIN: difference function + CMNDF (threshold ~0.15) + parabolic interpolation, window 2048 / hop 256 on downsampled mono; confidence/voicing gate, median smoothing, octave-jump correction; segmentation = new note on sustained pitch change ≥ ~0.6 semitone or energy re-onset, min note ~80 ms; RMS → velocity; frames → beats (tempo known). Pure functions → unit-testable on synthesized signals.
- `transcribe/beats.ts` — spectral-flux onset detection + per-hit features (low/high band-energy ratio, spectral centroid, ZCR) → kick 36 / snare 38 / closed hat 42; velocity from peak energy. Produces a single-`drums`-part take.
- `transcribe/basicPitch/` (last phase) — `manifest.ts` (nmp.onnx name/bytes/sha256, `VITE_MODEL_BASE_URL` convention), `client.ts` + `worker.ts` cloned from the `src/generation/neural/` pattern (ES-module worker, OPFS cache, streamed download + sha256 verify, snapshot/subscribe status strip like `NeuralStrip`) — but **wasm EP is fine** (~17K params; no WebGPU gate), and `postprocess.ts` = TS port of `outputToNotesPoly`/`noteFramesToTime` with NeuralNote-style knobs (sensitivity, split, min length, pitch range). Resample to 22050 mono via `OfflineAudioContext`; window/stitch per the spec above. Given the size, bundling in `public/models/` is acceptable — the real gate is mic permission, not download consent; keep the manifest/OPFS pattern anyway so it can move to HF hosting unchanged.

### Touched files

- `src/types.ts` — new `MotifSource` kind: `{ kind: 'recorded'; input: 'midi' | 'keys' | 'mic'; method?: 'voice' | 'beats' | 'basic-pitch' }`; update exhaustive readers (`parentIdOf` → undefined; any source-label switches in cards).
- `src/App.tsx` — render `<NoodlePanel/>` after `GenerationPanel`; wire the triage-keyboard `enabled` gate.
- `src/audio/engine.ts` — expose the shared context (currently private) for monitoring + capture.
- `src/uiPrefs.ts` — noodle prefs (MIDI device id, snap resolution, keyboard octave, lock/snap toggles, mic mode, latency offset), `motif-forge:noodle-*` keys.
- `src/styles.css` — `.noodle-*` classes on existing tokens (`.module`, `.lcd`, `--note-*`, `.wb-btn` modifiers).

### Commit path

ADD TO POOL builds the motif with `buildMotif` and wraps via `toResult`/direct dispatch (`src/generation/symbolic/index.ts`) → `MOTIFS_ADDED` (write-through persistence handles IDB automatically). Melodic takes are partless (play on the transport sound); BEATS takes carry `parts: [{ name: 'Drums', instrument: 'drums' }]`. Loop audition plays an ephemeral motif id `noodle::take` (the transport already strips `::` suffixes) with `engine.play({ loop })` + `swap()` on edit, like the bay mix.

## Phased build (each phase leaves the app working and demoable)

1. **Shell + editor + commit** — panel shell, `NoodleRoll` with full mouse editing on an empty grid (manual note entry is itself a feature), take store + undo, loop audition, ADD TO POOL with `kind: 'recorded'`.
2. **MIDI + musical typing + overdub record** — `midiInput` / `musicalTyping` / `recorder`, monitoring synth, click, arm-on-first-note, loop overdub.
3. **Lock + snap** — key/mode LOCK on capture, SNAP on capture, QUANTIZE key, in-scale row shading.
4. **Mic VOICE + BEATS** — capture worklet, YIN pipeline, beats heuristic, count-in, latency offset. Zero download.
5. **Mic INST (Basic Pitch)** — manifest/OPFS/worker, post-processing port, NeuralNote-style knobs, status strip.

## Verification

- `npm run build` (strict tsc) and `npm run lint` clean at every phase.
- Unit tests (Vitest, pure modules): `tests/noodleQuantize.test.ts` (snap/lock math), `tests/yin.test.ts` (synthesized sines/sweeps/vibrato → correct f0 and octave), `tests/voiceSegment.test.ts` (synthetic f0 tracks → note events), `tests/beatsClassify.test.ts` (synthetic kick/snare/hat bursts); phase 5 adds `tests/basicPitchPost.test.ts` against posteriogram fixtures (golden-fixture discipline, like the neural tokenizer tests).
- One Playwright spec (`e2e/noodle.spec.ts`) for the deterministic path: open panel → pencil notes → ADD TO POOL → new triage card exists. Mic/MIDI hardware paths are manual — Joe tests the app himself.

## Licensing

Everything shipped is MIT/Apache-clean: Basic Pitch model + ported post-processing are Apache-2.0 (keep Spotify's notice on the port); YIN/onset DSP hand-rolled; signal used as a behavior reference only (MIT; no code copied, no notice needed). Rejected on license grounds: essentia.js (AGPL + MELODIA patent), aubiojs (GPL).
