# Motif Forge

A local-first web app for generating, auditioning, mutating, and exporting short melodic motifs ("hooks" / leitmotifs) as MIDI and WAV — entirely in the browser.

The workflow mirrors a curation-heavy writing process: **generate candidates in batches → triage them by ear in minutes → mutate the survivors → export the winners.** Exported files are meant to be fed to Suno (or any tool) as seed audio, so arrangements get built around melodic material you authored instead of genre-generic output.

Motifs are polyphonic and multi-part — chords, sustained pads under moving lines, counterpoint, with up to 4 parts each carrying its own instrument. Generation picks instruments per part (and can sound-design synth parts with oscillator/ADSR presets); playback runs each part through a Tone.js polysynth or sampled instruments via [smplr](https://github.com/danigb/smplr) (piano, e-piano, marimba, strings; fetched from a CDN on first use, cached after). Partless motifs use the transport-bar sound picker. MIDI export maps parts to channels with GM program changes. The Standard MIDI File writer, WAV encoder, and IndexedDB persistence remain hand-rolled from spec.

## Quick start

```sh
npm install
cp .env.example .env.local   # then fill in your Anthropic API key (or see "API access" below)
npm run dev                  # http://localhost:5173
```

Generation and LLM mutations call the Anthropic API through a dev-server proxy that injects your credentials server-side (see `vite.config.ts`) — they never reach browser code. Everything else (playback, transforms, export, library) works without credentials.

## API access

Two ways to give the dev-server proxy credentials:

**Option A — static API key.** Put a key from [console.anthropic.com](https://console.anthropic.com) in `.env.local`:

```sh
cp .env.example .env.local   # then paste ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

**Option B — `ant` CLI (no static key to manage).** The [Anthropic CLI](https://platform.claude.com/docs/en/api/sdks/cli) authenticates via a browser OAuth flow and mints short-lived tokens:

```sh
# one-time setup
brew install anthropics/tap/ant
xattr -d com.apple.quarantine "$(brew --prefix)/bin/ant"   # macOS Gatekeeper
ant auth login               # opens a browser

# each dev session — exports ANTHROPIC_AUTH_TOKEN for the proxy
set -a; eval "$(ant auth print-credentials --env)"; set +a
npm run dev
```

The proxy prefers `ANTHROPIC_API_KEY` when both are present. OAuth tokens are short-lived — if generation starts returning 401s mid-session, re-run the `print-credentials` line and restart the dev server. `ant auth status` shows which credential source is active, and `ant` is also handy on its own (e.g. `ant models list`, `ant messages create` for testing prompts from the shell).

`npm run build` runs the TypeScript strict check and produces a production build in `dist/`.

## Features

- **Generation** — describe a constraint brief (key/mode, tempo, bars, texture — lead line vs free polyphony — optional rhythm part, contour, emotional intent, concept name) and generate candidates via the Anthropic API (default batch of 5, or 20 at once), or hit **🎲 Surprise me** for free-rein motifs where the model picks its own key, tempo, texture, and instrumentation. Batches queue with pulsing placeholder cards in the grid, so you can stack requests and keep triaging. Every motif is validated (pitch range, bar bounds, ≤8 simultaneous voices, ≥3 notes); invalid ones are dropped with a count, out-of-scale notes get a warning badge instead. Rhythm parts use GM drum pitches and play through a built-in synthesized kit.
- **Audition** — a triage grid of piano-roll thumbnails with a selectable sound (plain polysynth by default, or sampled piano/e-piano/marimba/strings), a moving playhead synced to the audio clock, metronome click, root-note drone, and a global tempo override.
- **Keyboard-first triage** — built to get through 100 candidates fast:

  | Key | Action |
  |-----|--------|
  | `← → ↑ ↓` | move between candidates |
  | `Space` | play / stop |
  | `1`–`5` | rate and advance |
  | `x` | discard and advance |
  | `u` | undo last discard |

- **Mutation** — deterministic transforms applied instantly client-side (inversion, retrograde, retrograde-inversion, transposition, augmentation/diminution, mode swap via scale-degree remapping, octave displacement of selected notes), plus free-text LLM mutations ("keep the first bar intact but resolve differently", "add a drum groove") returning 5 children per request — with a **lock rhythm** option that freezes the parent's note timings so only pitches change, and its own **🎲 Surprise me** for free-rein reinterpretations. Every child records its parent and the transformation applied.
- **Leitmotif library** — tag motifs to song concepts, then browse a concept across tracks with each motif's full descendant tree, and jump straight into transforming a winner for the next track. Everything persists in IndexedDB, including mid-triage state.
- **Export** — download any motif as a Standard MIDI File (format 0, 480 TPQN) or as a WAV rendered offline through the exact same synth graph as live playback.

## Architecture

```
src/
  core/        pure domain logic: music theory, transforms, validation,
               MIDI writer, WAV encoder
  audio/       Web Audio synth voice (shared live/offline), playback engine
  api/         Anthropic API client, prompt builders, JSON parsing, batching
  store/       reducer + context, swappable persistence (IndexedDB / memory)
  components/  triage grid, piano roll, mutation panel, library, concept view
```

Design notes worth knowing before hacking on it:

- `core/` is framework-free and pure — testable without a browser.
- Playback state lives in a singleton engine outside React (`useSyncExternalStore`); the playhead is a single rAF loop mutating an SVG ref, so the grid never re-renders during playback.
- Instruments sit behind one adapter interface (`audio/instruments.ts`): Tone.js PolySynth or smplr sampled sounds, selectable in the transport bar. Live playback and WAV export schedule through the same adapter; the master chain, metronome, and drone are shared raw WebAudio.
- Lineage is stored on each motif as its `source` (parent id + transform description); the motif store *is* the lineage graph.

The original spec lives in [motif-forge-project-brief.md](motif-forge-project-brief.md) and the implementation plan in [docs/PLAN.md](docs/PLAN.md).

## Out of scope (MVP)

Drum patterns, audio input/transcription, direct Suno API integration (the handoff is manual file upload), multi-user, auth.
