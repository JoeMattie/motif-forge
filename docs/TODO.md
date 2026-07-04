# TODO — unimplemented plans

Each entry links to a full implementation plan in this folder. None of these have been started (their modules don't exist in `src/` yet). Implemented/superseded plans live in [archive/](archive/).

## [Chords generation: LINE / CHORDS / BOTH voicing switch](chords-voicing-plan.md)

A 3-way voicing switch on the generation panel: `LINE` (today's single-note behavior), `CHORDS` (the motif IS a functional chord progression), `BOTH` (melody + harmonized chord accompaniment part). New `src/generation/symbolic/harmony.ts` (diatonic triads/7ths, T→S→D progressions with cadence), `diatonicStack` in theory.ts, wiring for INSTANT (all 3), GENETIC (LINE + CHORDS stabs), CLAUDE (prompt rules); NEURAL gated off. Key hazard: the ≤8-voice cap when BOTH + rhythm (mitigation: triads-only rule).

## [M6(GPT)3 insights: mood, planner, harmony scaffold, mutation ops](m6gpt3-insights-plan.md)

Four remaining insights from the M6(GPT)3 paper (the fitness GA + drums port already shipped): **A** MOOD/ENERGY knobs (valence/arousal shifting fitness targets, walk register, drum energy — finally uses the unused `Knob`), **B** Claude-as-planner (brief text → JSON `InstantSpec` steering INSTANT, graceful null fallback), **C** chord scaffolding (progression-aware `chordToneRatio` fitness feature, then bass/pad parts scored by inter-track consonance), **D** three new mutation ops (`sort-run`, `repeat-paste`, `note-rest-toggle`). Overlaps with the chords-voicing plan — both create `src/generation/symbolic/harmony.ts`; reconcile before starting either.

## [Noodle panel: MIDI + mic input into the triage pool](noodle-panel-plan.md)

A panel under the generation panel where Joe's own ideas enter the pool: Web MIDI / musical-typing loop-overdub recording and mic transcription (hand-rolled YIN for voice, onset heuristics for beatbox, Spotify Basic Pitch ONNX for instruments), staged in an editable hand-rolled SVG piano roll, committed via ADD TO POOL as `source: { kind: 'recorded' }` families. Five phases, each demoable; zero new runtime npm deps.
