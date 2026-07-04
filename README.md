# Motif Forge

A local-first web app for generating, auditioning, mutating, and exporting short melodic motifs ("hooks" / leitmotifs) as MIDI and WAV — entirely in the browser.

The workflow mirrors a curation-heavy writing process: **generate candidates in batches → triage them by ear in minutes → mutate the survivors → export the winners.** Exported files are meant to be fed to Suno (or any tool) as seed audio, so arrangements get built around melodic material you authored instead of genre-generic output.

Motifs are 2–8 bars, polyphonic, and multi-part — chords, sustained pads under moving lines, counterpoint, optional drum grooves — with up to 6 parts each carrying its own instrument. The UI is a **hardware workbench**: matte panel modules, chunky 3D keys, rotary knobs, and piano rolls rendered on inset dark LCD screens, in a light **Day** theme, a dark **Nite** theme, or following the system.

## Quick start

```sh
npm install
npm run dev        # http://localhost:5173
```

That's it for the default experience — the **INSTANT** generation engine, playback, triage, deterministic mutation, the library, and MIDI/WAV export all run fully offline with no credentials. An Anthropic API key is only needed for the **CLAUDE** engine and LLM mutations (see [API access](#api-access)), and the **NEURAL** engine needs a one-time model download.

## Three generation engines

The generation panel's ENGINE switch selects how candidates are made:

- **INSTANT** (default) — fully offline, deterministic, immediate, free. A constrained random walk composes single melodic lines in scale-degree space (always in-key), pulled toward a contour template (arch / ascend / descend / zigzag / flat) with leap-recovery and per-beat rhythm archetypes on a 16th grid. Once you've kept some motifs (rating ★3+), a genetic algorithm joins in: bar-boundary crossover between keepers plus small in-scale mutations, mixed with fresh "immigrants" for diversity. Every candidate stores its PRNG seed, so any motif is reproducible.
- **NEURAL** — an on-device transformer ([SkyTNT midi-model](https://github.com/SkyTNT/midi-model) `tv2o-medium`, int8-quantized) running in a Web Worker via `onnxruntime-web` on **WebGPU** (no WASM fallback — without WebGPU the app stays on INSTANT + CLAUDE). Opt-in one-time download of ~226 MB, streamed with progress, sha256-verified against a pinned manifest, and cached in OPFS (removable from the panel). Offline after that. A share of each batch continues one of your keepers — the neural analog of the GA. The tokenizer is a byte-identical TypeScript port of the Python reference, verified against golden fixtures.
- **CLAUDE** — the Anthropic API (`claude-sonnet-4-6`) as composer. The only engine that honors the free-text brief, multi-part textures, sound-designed synth presets, and drum parts. Runs on your own API key (KEY in the header; see [API access](#api-access)) in chunks of ≤5 motifs, two concurrent.

All three engines funnel through the same validation and land in the same triage queue; batches render as pulsing placeholder cards so you can stack requests and keep triaging.

## Features

- **Constraint-brief generation** — key/mode, tempo, bars, in-scale strict vs chromatic, texture (lead line with light harmony vs free polyphony), optional rhythm/drums part, an EXTRA toggle for 4–6 instrument parts, free-text direction (contour, emotional intent, references), and a song-concept tag. Or hit **🎲 Surprise me** for free-rein motifs where the model picks its own key, tempo, texture, and instrumentation. Every candidate is validated (pitch range 36–96, bar bounds, ≤8 simultaneous voices, ≥3 notes); invalid ones are dropped with a count, out-of-scale notes get a warning badge instead of being rejected. Drum parts use GM drum pitches, play through a built-in synthesized kit, and export on MIDI channel 9.
- **Families** — a motif plus all its lineage descendants form a family, and the triage grid shows exactly **one card per family** (its promoted "face"), so mutating never inflates the pool you're triaging. Variants live in a fold-out tray under the card (`F`); promoting (`P`) picks which member fronts the family. Filters, triage progress, and concept tags all operate family-wide.
- **Audition** — piano-roll LCD thumbnails with a selectable sound: plain polysynth by default (deliberately neutral, so you judge the melodic bones) or sampled piano / e-piano / marimba / strings via [smplr](https://github.com/danigb/smplr) (CDN-fetched on first use, then cached). Multi-part motifs route each part to its own instrument; a "force" toggle auditions everything through the picked sound. Moving playhead synced to the audio clock, metronome, root-note drone, global tempo override.
- **Two triage modes** — the grid, or a **Focus** deck: one large LCD, a prev/play/next cluster, a 1–5 rate keypad with auto-advance, and a queue strip. Both are keyboard-first, built to get through 100 candidates fast:

  | Key | Action |
  |-----|--------|
  | `← → ↑ ↓` | move between candidates (down enters an open family tray) |
  | `Space` | play / stop |
  | `1`–`5` | rate and advance |
  | `x` | discard and advance |
  | `u` | undo last discard |
  | `f` | fold / unfold the family tray |
  | `p` | promote as the family's face |
  | `m` | open the mutation bay |

- **Deterministic transforms** — applied instantly client-side: inversion, retrograde, retrograde-inversion, transposition, augmentation/diminution, mode swap via scale-degree remapping, octave displacement of selected notes. Every child records its parent and the transformation applied — the store *is* the lineage graph.
- **LLM mutations** — free-text direction ("keep the first bar intact but resolve differently", "add a drum groove"), a **lock rhythm** option that freezes the parent's note timings so only pitches change, and a mutation-side **🎲 Surprise me**.
- **Mutation Bay** — a per-part variation workspace that slides up over any view (`m`). Each part gets its own row: MUTATE fires an instant LLM batch on *that part only* with every other part locked note-for-note; ADVANCED adds part-scoped deterministic transforms and a custom brief. Results nest rightward as a tree; `Enter` selects a take per part, `Space` loops the composite mix, and changing a selection mid-loop swaps it in on the next bar boundary. PROMOTE MIX adds the assembled composite to the family; REBASE and PRUNE keep the tree tidy. Variation trees persist alongside everything else.
- **Leitmotif library & concepts** — the Library gates by rating, filters by concept, and exports all promoted takes as .MID in one click. The Concepts view is a leitmotif desk: per-root variant trays, derived variants tagged with the track they were transformed for, play-all-in-sequence, and a TRANSFORM FOR NEW TRACK shortcut into the bay. Everything — motifs, ratings, families, concepts, bay trees, mid-triage state — persists in IndexedDB; discard is a soft flag, so a refresh mid-triage loses nothing.
- **Export** — any motif as a Standard MIDI File (format 0, 480 TPQN, parts mapped to channels with GM program changes, drums on channel 9) or as a WAV rendered offline through the exact same instrument adapters as live playback — mixed Tone.js + sampled parts render in a single pass.

## API access

Only the CLAUDE engine and LLM mutations need credentials.

**Primary path — bring your own key (works everywhere, including the deployed site).** Click **KEY** in the header and paste an API key from [console.anthropic.com](https://console.anthropic.com). It's stored only in your browser's localStorage and sent only to `api.anthropic.com` (direct browser calls, opted in via Anthropic's `anthropic-dangerous-direct-browser-access` header). Clear it any time from the same panel.

**Dev fallback — server-side credentials via the Vite proxy.** With no key set in the UI, dev builds route calls through a dev-server proxy (`/api/anthropic/*`, see `vite.config.ts`) that injects credentials server-side, so they never reach browser code:

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

The proxy prefers `ANTHROPIC_API_KEY` when both are present. OAuth tokens are short-lived — if generation starts returning 401s mid-session, re-run the `print-credentials` line and restart the dev server. `ant auth status` shows which credential source is active.

## Development

```sh
npm run dev        # Vite dev server
npm run build      # TypeScript strict check (tsc -b) + production build — zero errors required
npm test           # Vitest unit tests over the pure core modules (npm run test:watch to watch)
npm run test:e2e   # Playwright e2e — auto-starts the dev server, mocks the Anthropic proxy
                   # (no key or network needed); one-time: npx playwright install chromium
npm run lint       # Biome — zero diagnostics required (npm run lint:fix for safe fixes)
```

Vitest, Playwright, and Biome are dev-only; runtime dependencies stay minimal.

## Architecture

Vite + React 19 + TypeScript strict. Runtime deps: `react`/`react-dom`, `@mantine/core`/`@mantine/hooks` (UI), `@phosphor-icons/react` (icons), `tone` + `smplr` (playback instruments), `onnxruntime-web` (neural engine). The MIDI writer, WAV encoder, and IndexedDB wrapper are hand-rolled from spec by design.

```
src/
  core/          pure, framework-free domain logic: music theory, transforms,
                 validation, family derivation, MIDI writer, WAV encoder,
                 mutation-bay model
  audio/         instrument adapters (Tone.js synth / smplr samples / drum kit),
                 playback engine singleton, shared live/offline scheduling,
                 offline WAV render
  api/           Anthropic client, prompt builders, JSON parsing, batch queue
  generation/
    symbolic/    INSTANT engine: seeded PRNG, constrained random walk,
                 genetic algorithm over keepers
    neural/      NEURAL engine: tokenizer port, sampling loop, WebGPU worker,
                 download/OPFS/manifest client
  store/         reducer + context, swappable persistence (IndexedDB / memory)
  components/    triage grid, focus deck, family tray, LCD piano roll,
                 generation panel, mutation bay, library, concepts view,
                 hand-rolled hardware controls (knobs, toggles, keys)
tools/quantize/  Python tooling (not shipped) that produces the int8 neural
                 model artifacts and golden tokenizer fixtures
```

Design notes worth knowing before hacking on it:

- `core/` is pure and testable without a browser; all float comparisons use an epsilon, and chromatic pitches decompose to nearest-degree-below + offset so mode swap is total.
- Playback state lives in a singleton engine outside React (`useSyncExternalStore`); the playhead is a single rAF loop mutating an SVG ref, so the grid never re-renders during playback. Motifs are short, so everything is scheduled up front at absolute context times — no lookahead loop.
- Instruments sit behind one adapter interface (`audio/instruments.ts`); live playback and WAV export schedule through the same code, and stop is engineered to be instant even for sampled instruments with long release tails.
- Lineage is stored on each motif as its `source` (parent ids + transform description); families are derived from it, never stored.
- Every UI color is a semantic CSS custom property on `:root[data-theme='day'|'nite']`; Mantine components are skinned as hardware controls against those tokens, with a few controls (knobs, toggles, LCD rolls) hand-rolled.
- Generators never call `Math.random` — seeds live in each motif's `source`.
- In production builds a service worker caches the app shell (network-first); model bytes live in OPFS, never the SW cache.

## Documentation

- [docs/motif-forge-project-brief.md](docs/motif-forge-project-brief.md) — the original spec and source of truth for scope, data model, and validation rules
- [docs/motif-forge-offline-generation-spec.md](docs/motif-forge-offline-generation-spec.md) — the INSTANT/NEURAL offline-generation plan
- [docs/PLAN.md](docs/PLAN.md) — the MVP implementation plan
- [docs/model-notes.md](docs/model-notes.md) — verified facts about the neural model and tokenizer
- [CLAUDE.md](CLAUDE.md) — dense contributor notes on architecture and conventions

## Out of scope

Audio input/transcription, direct Suno API integration (the handoff is manual file upload), multi-user, auth, mobile polish.
