# Motif Forge — Project Brief for Claude Code

## What this is

A small, local-first web app for generating, auditioning, mutating, and exporting short melodic motifs ("hooks" / leitmotifs) as MIDI. The output MIDI files get rendered into short audio stubs and fed into Suno as seed audio, so Suno produces arrangements around melodic material the user authored, instead of regressing to genre-generic output.

The workflow mirrors a lyric-writing process that already works well: generate ~100 candidates at the symbolic level → curate down to 2-3 → iterate/mutate the survivors → export the winners. This app does that for melodies instead of phrases.

**Constraint: no external software dependencies.** Everything happens in the browser — melody generation, playback, mutation, and MIDI export. No DAW required, no Python toolchain, no native binaries. A single web app (a local dev server during development is fine).

## Core concepts

- **Motif**: a short melodic idea, 2–8 bars, monophonic (MVP), represented symbolically as a note list: `{ pitch (MIDI number), startBeat, durationBeats, velocity }[]` plus metadata (key, mode, tempo, time signature, tags, generation lineage).
- **Concept tag**: motifs are attached to song concepts (e.g. "event horizon", "recursive loop", "the duet theme"). This is the leitmotif angle — the library should make it easy to see all variants of one concept and reuse a motif across tracks in transformed forms.
- **Lineage**: every mutation records its parent motif and the transformation applied, so the user can trace how a winner evolved (parallels the lyric refinement chain).

## Feature set (MVP)

### 1. Generation
- A generation panel where the user writes a **constraint brief**: key/mode, tempo, bar count, contour description, rhythmic character, emotional intent, concept name. Free-text plus a few structured fields.
- On submit, call the Anthropic API (`claude-sonnet-4-6` via `https://api.anthropic.com/v1/messages` — no API key needed in this environment, it's handled) asking for a **batch of N motifs (default 20 per call, allow multiple calls to build up to ~100)** returned as strict JSON: an array of motifs in the note-list format above.
- The system prompt for generation must demand JSON only (no prose, no markdown fences) and should encode music-theory guardrails: stay in the requested scale unless chromaticism is requested, respect the bar length exactly, land phrase endings on stable or intentionally unstable degrees per the brief, vary rhythm across candidates (avoid 20 strings of straight eighths).
- Validate every returned motif (pitches in range, durations sum sanely, notes within bar count); silently drop invalid ones and show a count.

### 2. Audition
- Grid/list of candidate motifs, each with a **play button** and a mini piano-roll thumbnail (SVG or canvas).
- Playback via **Web Audio API** with a deliberately plain, consistent timbre — a simple triangle/sine synth with a touch of decay. The point is judging melodic bones, not sound design. Tone.js is acceptable if loaded from cdnjs; hand-rolled Web Audio is also fine and dependency-free.
- Global tempo control and a metronome/click toggle. Optional simple drone or root-note pad under playback so the user hears the motif against its tonal center.
- Keyboard-first triage: arrow keys to move between candidates, space to play/stop, `1`–`5` or thumbs up/down to rate, `x` to discard. Triaging 100 candidates must be fast.

### 3. Mutation
- Select any motif and request transformations. Two mechanisms:
  - **Deterministic transforms (client-side, instant, no API call)**: inversion, retrograde, retrograde-inversion, transposition, rhythmic augmentation/diminution (×2, ×0.5), mode swap (e.g. dorian→phrygian via scale-degree remapping), octave displacement of selected notes.
  - **LLM mutations (API call)**: "give me 10 variations that keep the first bar intact but resolve differently", "make it more syncopated", "turn this into a call-and-response version of itself" — free-text mutation brief, returns a batch of children in the same JSON format.
- Children appear grouped under their parent with the lineage recorded.

### 4. Library & leitmotif view
- Persistent library of kept motifs using the artifact storage API if built as a Claude artifact, or `IndexedDB` if built as a standalone app (see Tech Notes). Store everything: motifs, ratings, lineage, concept tags.
- A **concept view**: pick a concept tag and see every motif/variant attached to it across tracks — this is the leitmotif management surface. Include a "transform for new track" shortcut that opens the mutation panel pre-filled.

### 5. Export
- **MIDI file export, generated entirely in the browser.** Writing a Standard MIDI File (format 0, single track) is straightforward binary construction — variable-length delta times, note-on/note-off events, tempo meta event. Implement this by hand (~150 lines) rather than pulling a dependency; it's well-specified and stable. Download via Blob + anchor click.
- Export single motif, or batch-export all starred motifs as a zip is out of scope for MVP — sequential downloads are fine.
- Also offer **WAV export** of the plain-synth rendering (OfflineAudioContext → WAV encoding, also hand-rollable) so the user can optionally feed audio directly to Suno without an intermediate DAW pass at all. This matters given the "no external software" constraint: MIDI is for users who want to sound-design stubs elsewhere, WAV makes the app self-sufficient end-to-end.

## Suggested build order

1. Data model + hand-rolled plain synth playback + piano-roll rendering (hardcode 3 sample motifs to develop against).
2. MIDI export + WAV export (verify a downloaded .mid opens correctly; verify WAV plays).
3. Claude API generation with JSON validation.
4. Triage UX (keyboard flow, ratings, discard).
5. Deterministic transforms.
6. LLM mutations + lineage display.
7. Library persistence + concept/leitmotif view.

Each step should leave the app in a working, demoable state.

## Tech notes

- **Stack**: single-page app. React is fine; vanilla JS + a small amount of structure is also fine. Keep the dependency count near zero — the only external anything should be (optionally) Tone.js from cdnjs, and the Anthropic API.
- **No `<form>` tags** if this ends up rendered as a Claude artifact; use onClick handlers.
- **No localStorage/sessionStorage** if built as a Claude artifact — use the artifact storage API (`window.storage`) there, or IndexedDB in a standalone build. Decide once at project start; a thin persistence interface makes this swappable.
- **Anthropic API call shape**:

```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: generationPrompt }]
  })
});
const data = await response.json();
// data.content is an array of blocks; concatenate .text fields, strip any fences, JSON.parse with try/catch
```

- Batch size per API call should stay modest (10–20 motifs) to fit token limits; the UI accumulates batches toward the ~100 target.
- **Motif JSON schema** (what the prompt must demand):

```json
{
  "motifs": [
    {
      "name": "short evocative name",
      "notes": [
        { "pitch": 62, "startBeat": 0, "durationBeats": 0.5, "velocity": 96 }
      ],
      "key": "D", "mode": "dorian", "bars": 4, "timeSig": "4/4",
      "rationale": "one sentence on the contour/intent"
    }
  ]
}
```

- **Validation rules**: pitches 36–96; startBeat + durationBeats ≤ bars × beatsPerBar; ≥ 3 notes; no two notes overlapping (monophonic MVP); all pitches in the requested scale unless the brief allowed chromaticism (warn rather than drop for this one).

## Design intent (keep it light, but deliberate)

Dark, focused, studio-tool aesthetic — closer to a DAW side panel than a SaaS dashboard. Piano-roll thumbnails are the visual anchor; give them room. The triage grid is the screen the user lives in, so optimize it for speed and low visual noise. Playback state should be unmissable (highlighted card, moving playhead line on the thumbnail).

## Explicitly out of scope for MVP

Polyphony/chords, drum patterns, audio input/transcription, Suno API integration (Suno has no public API — the handoff is manual file upload), multi-user anything, authentication, mobile layout polish.

## Success criteria

The user can: describe a motif concept → generate ~100 candidates across a few batches → triage them by ear in under 10 minutes with the keyboard → mutate 2-3 survivors deterministically and via LLM → tag winners to a song concept → download a .mid and a .wav that open/play correctly → later retrieve that concept's motifs and generate transformed variants for the next track.
