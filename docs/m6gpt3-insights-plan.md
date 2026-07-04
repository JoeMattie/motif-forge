# M6(GPT)3 insights → Motif Forge (mood, planner, harmony, mutation ops)

## Context

Joe asked to compare our Claude engine against M6(GPT)3 Composer ([demo](https://jpocwiar.github.io/M6-GPT3-Composer-Demo/), [arXiv 2409.12638](https://arxiv.org/abs/2409.12638), IEEE ICMEW 2025). The comparison: M6 uses the LLM as **planner only** (JSON spec: sections, scales, chord progressions, valence ⟨−1,1⟩/arousal ⟨0,1⟩, instruments/styles) with symbolic renderers writing every note; our Claude engine has the LLM **write raw notes** (~2k tokens/motif). Our uncommitted INSTANT-tier work already ports the paper's melodic core (`fitness.ts` Gaussian fitness, `evolve.ts` tournament GA, `drums.ts` probability tables + Markov fills — all cite the arXiv id). Their eval (symbolic renderers ≈99% scale/groove consistency vs ≈92% for transformer note-writers) validates the INSTANT default flip.

Joe approved incorporating all four remaining insights: **A** mood conditioning, **B** Claude-as-planner bridge, **C** chord scaffolding + multi-part INSTANT, **D** new mutation ops.

## Phase 0 — Type plumbing (`src/types.ts`)

- `GenerationBrief` += `mood?: { valence: number; arousal: number }` (valence −1..1, arousal 0..1; absent = neutral).
- New `InstantSpec` interface in `types.ts` (persisted data): `{ valence?, arousal?, contourWeights?: Partial<Record<string, number>>, rhythmWeights?, density?: 'sparse'|'medium'|'busy', register?: 'low'|'mid'|'high', progression?: number[], plannedBy?: 'claude' }`. String-keyed weight maps keep `types.ts` dependency-free.
- `MotifSource` kinds `'symbolic'` and `'ga'` += `spec?: InstantSpec` — the single reproducibility carrier for A/B/C. **No IDB migration**: `source` round-trips opaquely; old records just lack `spec`.

## Phase 1 — D: new mutation ops (`src/generation/symbolic/genetic.ts`)

Extend `MutationOp` (+ export the type) with three ops and add `applyOp` cases:
- **`sort-run`** — sort the pitches of a random 3–6-note slice asc/desc onto the same onsets (timings untouched; permutation ⇒ always in-scale). No-op under 3 notes.
- **`repeat-paste`** — copy one bar's fully-contained notes over another bar (**replace, not overlay** — overlay would balloon note counts/voices over 24 generations). No-op if source bar empty or result < 3 notes; needs `ctx.bars ≥ 2`.
- **`note-rest-toggle`** — coin flip: delete a note (only when `length > 3`, validation's floor) or split a ≥0.5-beat note into two (tail at half-duration, velocity −8). Splitting never adds simultaneity.

Weights: `OP_WEIGHTS` += `['sort-run',10], ['repeat-paste',14], ['note-rest-toggle',12]`; `DRUM_OP_WEIGHTS` += repeat-paste + note-rest-toggle only (sorting GM percussion pitches is meaningless). Flows into `evolve.ts` and the bay's MUTATE automatically.

**Breaks two tests in `tests/symbolic.test.ts`**: the mutant note-count-preservation assertion (~line 167) → rewrite as invariants (≥3 notes, bounded growth, in-scale, in-bars, seed-deterministic); the drum-op whitelist (~line 209) → add the two new ops, relax pitch-multiset equality to subset. Op-weight changes orphan exact reproduction of old GA seeds — accepted precedent (CLAUDE.md documents the same for GENETIC constant retunes); note in commit message.

## Phase 2 — A: mood conditioning

**New `src/generation/symbolic/mood.ts`** (pure, no RNG): `Mood`, `NEUTRAL_MOOD = {valence: 0, arousal: 0.5}`, and
- `moodTargets(mood, base = DEFAULT_TARGETS): TargetTable` — per-feature `μ' = μ + v·V + a·(A−0.5)·2`, σ/w untouched, clamped. Paper's mapping: uniquePitchesPerBar ↑V↑A, dissonantRatio ↓A, pitchRange ↑V↑A, pitchSd ↑A, restRatio ↓V↓A, notesPerBar ↑A, rhythmicVariety ↓V↑A, offBeatRatio ↑A, stepwiseRatio ↓V (bigger intervals), repetitionScore ↑A, tonalAnchor ↓A. **Hard invariant: `moodTargets(NEUTRAL_MOOD)` deep-equals `DEFAULT_TARGETS`** — centered knobs are bit-identical to today.
- `moodRange(mood)` — shifts walk register (`DEFAULT_RANGE` 53–86 in `walk.ts`) by `round(3·V + 4·(A−0.5)·2)`, clamped 36–96 (realizes the paper's "average pitch ↑V↑A").
- `moodDensity(arousal): DrumDensity | null` (null = defer to `densityOf`).

**`evolve.ts`**: `evolvePopulation(..., opts, tuning: EvolveTuning = {})` where `EvolveTuning = { targets?, range?, contourWeights?, rhythmWeights? }`; `make()` scores with `tuning.targets ?? DEFAULT_TARGETS`; `fresh()` passes range/weights into `randomWalkNotes` (`WalkParams.range` already exists; contour/rhythm picks become `pickWeighted`).

**`drums.ts`**: `DrumParams` += `energy?: number` (default 0.5 ⇒ byte-identical output, protects `tests/drums.test.ts`): scales open-hat probability ×(0.6+0.8·e), ghost-snare chance ×(0.5+e), velocity bases +round((e−0.5)·14), fillSteps→4 when e>0.75.

**`index.ts`**: `generateSymbolicBatch(brief, n, keepers, seed, spec?: InstantSpec)`; resolve mood as `spec ?? brief.mood ?? neutral`; thread `moodTargets`/`moodRange` through tuning; drums get `density: spec?.density ?? moodDensity(a) ?? densityOf(...)` + `energy`; stamp non-empty `spec` onto both source variants.

**UI (`GenerationPanel.tsx`)**: two `Knob`s (the unused `src/components/hw/Knob.tsx` — API `{label, value, position 0..1, onPosition, detents}` fits; its CSS hooks already exist) rendered in the engine column when `engine === 'instant'`, 5 detents each: MOOD (DARK→BRIGHT, position ↔ (valence+1)/2) and ENERGY (CALM→DRIVEN, ↔ arousal), with workbench Tooltips. Reset in `resetBrief()`; `buildBrief()` always includes `mood` (neutral is inert); summary strip appends `· MOOD x/y` only when touched. Update CLAUDE.md's "Knob — currently unused" note.

## Phase 3 — B: Claude-as-planner bridge

- **`src/api/prompts.ts`** += `buildPlanPrompt(brief)`: brief text + key/mode/tempo/bars → demand raw minified JSON `{"valence":…,"arousal":…,"contourWeights":{…},"rhythmWeights":{…},"density":…,"register":…,"chromaticism":…,"progression":[0,5,3,4]}` with legal enum names and ranges spelled out (house prompt style). When knobs are touched, states valence/arousal are FIXED and must not be output.
- **New `src/generation/symbolic/plan.ts`** (pure): `parseInstantPlan(raw, bars): InstantSpec | null` — clamps ranges, whitelists contour/rhythm keys against `CONTOURS`/`RHYTHMS`, validates density, clamps progression degrees to int 0–6 and cycles to `bars`, drops unknowns, null on garbage.
- **New `src/api/plan.ts`**: `planInstantSpec(brief, onStep)` — `callClaude(buildPlanPrompt(brief), 500)`, `extractJson`, `parseInstantPlan`; whole body try/catch → `null` (no key / network / parse failure ⇒ today's behavior, silently).
- **`GenerationPanel.tsx`** INSTANT branch: when `brief.text` non-empty && `claudeReady`, the queued closure awaits `planInstantSpec` first (runs inside `queueBatch`'s existing `enqueue`/placeholder/onStep machinery — the planner narrates on the LCD strip and correctly occupies an API slot), merges: **manually-touched knobs beat the plan's valence/arousal**; plan still contributes weights/density/register/progression; stamps `plannedBy: 'claude'`. Merged spec goes into `generateSymbolicBatch` ⇒ `source.spec`, so planned batches replay without re-calling Claude.
- Copy updates: `briefApplies` becomes `engine === 'claude' || (engine === 'instant' && claudeReady)`; fix the disabled-textarea tooltip ("Only the CLAUDE composer reads free-text direction") and `gen-brief-preview` gating. `chromaticism` is parsed but ignored in v1 (walk is diatonic by design — document).
- e2e: the mocked proxy payload makes `parseInstantPlan` return null ⇒ defaults; add an `e2e/instant.spec.ts` case typing brief text on INSTANT to pin the graceful fallback.

## Phase 4 — C: chord scaffolding + multi-part INSTANT (internally phased C1→C3)

**New `src/generation/symbolic/harmony.ts`**:
- `PROGRESSIONS` (small degree-based pool: `[0,5,3,4]`, `[0,3,4,4]`, `[0,4,5,3]`, `[0,6,2,4]`, …; mode supplies quality — triads stacked in-mode thirds), `progressionFor(bars, rng)`, `chordAtBeat`, `chordPitchClasses(degree, key, mode)` via `scalePitchClasses`/mode intervals.
- `bassNotes(progression, {bars,timeSig,key,mode,energy}, rng)` — roots on downbeats, fifth/octave on back halves, register clamped 36–55 (≥36 is validation's non-drum floor).
- `padNotes(progression, …)` — one sustained 3-voice triad per bar, nearest-inversion voice leading, register 55–74, velocity ~55, deterministic.
- `crossPartScore(a, b, totalBeats)` — the paper's inter-track dissonance: 16th-grid sampling, pairwise intervals mod 12 scored consonant{0,3,4,8,9}=+8, perfect{5,7}=+15, dissonant{1,2,10,11}=−20, tritone{6}=−30, rest-in-either=+10; returns `tanh(mean/10)`.

**`fitness.ts`**: `FitnessContext` += `progression?`; new feature `chordToneRatio` (`{mu: 0.72, sigma: 0.2, w: 1.0}` in `DEFAULT_TARGETS`) = share of strong-beat onsets whose pc ∈ current chord; `extractFeatures` returns `number | null` per feature and **`fitnessScore` skips null features and their weight** ⇒ scores without a progression are bit-identical to today.

**C1 (fitness only)**: `EvolveContext` += `progression?` (structurally satisfies `FitnessContext`); `generateSymbolicBatch` draws `spec?.progression ?? progressionFor(bars, rng)` from the main rng stream before evolution; always stored in `source.spec`. Ships alone — audibly more chord-anchored lines, no new parts.

**C2 (bass)**: gated on the **EXTRA chip** (enable it for INSTANT in `noTextures`; tooltip: chord scaffold — bass + pad following a seeded progression). Per survivor generate 3 bass takes from `childSeed(seed, 0x3000+rank)+k`, keep the `crossPartScore`-max one. Parts `[lead synth, bass synth (triangle preset), …kit]` — **lead must stay part 0** (`melodicLine` picks first non-drum part; bay/crossover depend on it).

**C3 (defer freely)**: pad part (`strings`), planner-picked progression consumption (B already parses it), pad cross-scoring. Full layout lead+bass+pad+kit = 4 parts ≤ `MAX_PARTS` 6; ≤5 sustained voices < the 8-voice cap. INSTANT bypasses `validateBatch` (`toResult`) so these invariants must hold by construction.

## Ordering

0 types → 1 D (self-contained, stabilizes the op set) → 2 A (neutral-identity keeps everything green) → 3 B (reuses spec/mood plumbing; fails → null → status quo) → 4 C1→C2→C3 (most surface). Each phase leaves the app working and demoable.

## Verification

- `tests/symbolic.test.ts`: rewrite the two broken assertions; per-op tests (sort-run monotone+permutation-only; repeat-paste in-bars + dest == shifted source; note-rest-toggle ≥3 notes, no added simultaneity; all seed-deterministic; drum mode excludes sort-run, pitch set ⊆ input).
- New `tests/mood.test.ts`: **`moodTargets(NEUTRAL_MOOD)` ≡ `DEFAULT_TARGETS`** (load-bearing), monotone μ shifts spot-checks, clamping, `drumNotes` without `energy` byte-identical, batch with `{valence:1,arousal:1}` deterministic per seed and ≠ neutral batch, `source.spec` round-trip.
- New `tests/plan.test.ts` (pure, no network): `parseInstantPlan` clamping/whitelisting/null cases; `buildPlanPrompt` contains schema, enums, fixed-mood clause.
- New `tests/harmony.test.ts`: `chordPitchClasses` hand-checks (D dorian deg 0 = {2,5,9}), bass pitches ∈ chord ∧ ≥36, pad ≤8-voice with busy lead, `crossPartScore` extremes (unison>0, tritone<0), determinism.
- `tests/fitness.test.ts`: chordToneRatio hand-check + regression that no-progression scores are unchanged. `tests/evolve.test.ts`: mood-tuned + progression runs still return n distinct survivors.
- Gates: `npm test`, `npm run build` (strict-TS ripple from `number | null` features — consumers are `fitnessScore` + tests only), `npm run lint` all clean. Manual: knobs at INSTANT, brief text → planner narration on the LCD strip, EXTRA → bass/pad parts audible and exporting to MIDI channels correctly. (Per memory: Joe tests the app himself — no self-driving Chrome.)

## Conflict recap

1. Two `symbolic.test.ts` assertions break under D (rewrites specified). 2. Op-weight/rng-stream changes orphan exact re-runs of old GA seeds — accepted precedent, commit-note it. 3. `TargetTable` is a total Record — adding `chordToneRatio` compiles everywhere once `DEFAULT_TARGETS` has it; null-skip keeps old scores stable. 4. INSTANT bypasses `validateBatch` — honor pitch≥36 / ≤8 voices / ≤6 parts by construction. 5. Lead stays part index 0 in all layouts. 6. GenerationPanel copy (`briefApplies`, `PARTLESS_CHIP_HINT`, `partsSummary`, tooltips) encodes "offline engines ignore text/textures" in several places — update all in phases 3–4. 7. Update CLAUDE.md (Knob no longer unused; INSTANT reads brief text via planner; EXTRA gates the chord scaffold).
