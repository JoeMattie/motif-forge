# Chords generation: 3-way LINE / CHORDS / BOTH voicing switch

## Context

Every engine today emits single-note melodic lines (INSTANT/GENETIC by construction, NEURAL/CLAUDE by prompting). Joe wants a control to generate **chords** wherever an engine can support it, with real music-theory progression logic. Decisions made with him:

- **3-way switch**: `LINE` (today's behavior) / `CHORDS` (the motif IS a chord progression, no melody) / `BOTH` (melody + a harmonized chord accompaniment part).
- **Vocabulary**: diatonic triads + occasional seeded 7ths; functional progressions (tonic/subdominant/dominant pools, authentic-ish cadence at the end). No inversions/sus; simple root-position voicing with octave placement to avoid mud.
- **Per engine**: INSTANT gets all 3 modes; GENETIC gets LINE + CHORDS (chord stabs on the evolved rhythm genome — BOTH doesn't fit a partless single-genome riff); CLAUDE gets all 3 via prompt rules; NEURAL is gated off (the MIDI model can't be steered to chords; tooltip explains).

The data model already supports this end-to-end: polyphonic notes, `MAX_VOICES = 8` sweep-line cap ([validate.ts:147-159](src/core/validate.ts#L147-L159)), `MAX_PARTS = 6`. Only generation logic is monophonic. The `includeRhythm` drums branch ([symbolic/index.ts:118-133](src/generation/symbolic/index.ts#L118-L133)) is the established pattern for a derived second part.

## Implementation

### 1. Types — `src/types.ts`

- `export type Voicing = 'line' | 'chords' | 'both'` next to `Texture` (line 67).
- Add required `voicing: Voicing` to `GenerationBrief` (lines 99-112). Only 4 construction sites (GenerationPanel `buildBrief` + one test brief each in `tests/evolve.test.ts`, `tests/symbolic.test.ts`, `tests/geneticRiff.test.ts`), so required is safe.
- `MotifSource`: add optional `voicing?: 'chords' | 'both'` to the `'symbolic'`, `'ga'`, and `'genetic'` kinds — offline reproduction is (seed, brief) and the brief isn't stored, so voicing must ride on the source. Optional-absent = line → old IDB records and seeds untouched, no migration.

### 2. Theory helper — `src/core/theory.ts`

`diatonicStack(rootDegreeIdx: number, size: 3 | 4, key: string, mode: Mode): number[]` — degree-index space (octave*7+degree, the idiom in walk.ts/pitch.ts): stack `+0, +2, +4 (+6 for 7th)` through `degreeToPitch` with `chromaticOffset: 0`. In-scale by construction in all 7 modes; chord quality (maj/min/dim) falls out of the mode. Pure, framework-free.

### 3. New module — `src/generation/symbolic/harmony.ts` (modeled on `drums.ts`: pure, returns partless `Note[]`, caller stamps part index, mulberry32 `Rng` injected, never `Math.random`)

- **Function pools** (root degrees): tonic `[0, 5]` (I, vi), subdominant `[3, 1]` (IV, ii), dominant `[4, 6]` (V, vii°). Doc-comment that functional labels loosen in non-ionian modes — accepted; degree stacking keeps everything diatonic regardless.
- `progression(bars, timeSig, rng)` → segments `{ rootDegree, seventh, startBeat, durationBeats }[]`: seeded harmonic rhythm (per-bar; per-half-bar option for 4+ bars), starts tonic (I-weighted), walks T→S→D cycles with no-immediate-repeat, final two segments forced D→I cadence. Sevenths ~15% seeded chance, ~35% on V.
- `chordVoicing(rootDegree, seventh, key, mode, { ceiling?, maxVoices })` → root-position stack via `diatonicStack`, root placed ~MIDI 48–60, whole stack dropped an octave if it breaches `ceiling`, all tones clamped in 36–96.
- `chordProgressionNotes(params, rng): Note[]` — CHORDS mode: per segment emit the voicing; seeded restrike pattern (sustain / re-hit / off-beat stabs) so it isn't all whole-note pads; velocities ~80–95, downbeat accents.
- `harmonizeLine(melody, params, rng): Note[]` — BOTH mode: same seeded segmentation; per segment score candidate chords from the active function pool (+ I always) by duration-weighted chord-tone coverage of the melody notes sounding in it (`pitchToDegree`), seeded tie-break, cadence override at the end; `ceiling` set below the segment's lowest melody pitch.

### 4. INSTANT — `src/generation/symbolic/index.ts`

- **CHORDS bypasses the GA** (fitness is melodic — interval features from consecutive sorted notes would be corrupted by vertical stacks; evolving a melody just to discard it is waste): loop like `generateGeneticBatch`, per-motif `mulberry32(childSeed(seed, i))` → `chordProgressionNotes`, part `{ name: 'chords', instrument: 'synth' }`, optional kit part when `includeRhythm` (density from `densityOf` over the chord onsets, seed `childSeed(seed, 0x2000 + i)`). Source `{ kind: 'symbolic', …, recipe: roman-numeral progression, voicing: 'chords' }`, no fitness. Name e.g. `Prog ${hex4(cs)}`.
- **BOTH**: today's GA run untouched; per survivor derive the chord part exactly like the drums branch — `harmonizeLine(ind.notes, ind.ctx, mulberry32(childSeed(seed, 0x3000 + rank)))`, parts `[lead, chords(, kit)]`, notes stamped/merged/sorted; `voicing: 'both'` on the source, progression numerals in the rationale.
- **Voice-cap rule (the one real hazard — offline engines bypass `validateBatch` via `toResult`)**: BOTH + rhythm worst case = melody 1 + chord 4 + drum coincidence 4 = 9 > 8. Rule: when a melody part AND a drums part are both present, pass `maxVoices: 3` (triads only) → 1+3+4 = 8. CHORDS+rhythm (no melody) may keep 4-note 7ths. Assert in tests.
- **Seed compat holds by construction**: LINE draws nothing new; chords use separate `childSeed` streams, so a given seed's lead line is bit-identical whether the switch is on or off, and old briefs can never carry `voicing !== 'line'`. `generateSymbolicSurprise` stays unchanged (surprise remains a line walk).

### 5. Keeper hygiene — `src/generation/symbolic/genetic.ts`

Extend `melodicLine` (line 48): prefer the first part that is neither drums nor named `'chords'`; when only a chords part exists (a CHORDS-mode keeper), reduce to the top voice per onset (group by startBeat, keep max pitch) so keeper crossover / fitness never see vertical stacks.

### 6. GENETIC — `src/generation/genetic/index.ts`

Branch after `evolveRhythm` (the genome decides WHEN, untouched):
- `'line'`: today's `assignPitches` path, zero new RNG draws → old seeds reproduce.
- `'chords'`: skip `assignPitches`; roll a per-bar progression from `harmony.ts` on the same per-motif rng (safe — line path never reaches these draws) and emit each onset as the bar's chord tones voiced low (roots ~45–57, `maxVoices` 3, seeded 7th on accents → ≤4 simultaneity, no cross-step overlap since `durationBeats = stepDur`). Accent/base velocities reuse existing constants. Riffs stay partless (`parts: []`). Source gains `voicing: 'chords'`.
- `'both'` never reaches this engine (UI gates it; clamp defensively to `'line'`).

### 7. CLAUDE — `src/api/prompts.ts`

Thread `brief.voicing` through `buildGenerationPrompt`/`hardRules`:
- `'line'`: unchanged (`textureRule`).
- `'chords'`: replace the texture rule — "the motif IS a chord progression, one part named 'chords', root-position diatonic triads (occasional 7ths), 3–4 simultaneous notes, functional harmony with an authentic cadence in the final bar, roots MIDI 48–60, 1–2 chords per bar". Don't emit the lead/poly rule (moot).
- `'both'`: keep `textureRule` and append: an accompaniment part named 'chords' harmonized so lead notes are chord tones, voiced below the melody, cadence at the end.
- `buildSurprisePrompt`/`buildMutationPrompt` untouched.

### 8. NEURAL — gated off

`buildNeuralJobs` only prompts channel/patch header rows — no lever for chords. Disable the switch for neural with a tooltip ("The on-device model composes freely — it can't be steered to chords. Use INSTANT or CLAUDE."). `buildBrief` coerces `voicing: 'line'` when engine is neural.

### 9. UI — `src/components/GenerationPanel.tsx`

- `const [voicing, setVoicing] = useState<Voicing>('line')` near line 300; add to `resetBrief`.
- Control: a `gen-ctl` ("voicing" label + `DiceToggle`) with a `SegmentedControl` LINE / CHORDS / BOTH — the workbench idiom (`wb-seg`), placed at the top of the parts column; Tooltips per mode.
- Gating: whole control disabled when `engine === 'neural'`; the BOTH item disabled when `engine === 'genetic'`; a `useEffect` (mirroring the claude-fallback pattern at lines 279-281) snaps voicing back to `'line'` when an engine switch makes it illegal. When `voicing === 'chords'`, disable the `lead` chip (texture moot) with a tooltip; `rhythm`/`extra` stay live.
- Dice: add `'voicing'` to `DiceParam` + `NO_DICE`; `buildBrief` rolls from the engine-legal set and writes back, always clamping (neural→line, genetic both→line).
- `buildBrief` returns `voicing`; collapsed `partsSummary` reflects `CHORDS` / `LINE+CHORDS` (`?` when diced), keeping `+RHYTHM`/`+XTRA` suffixes.

## Tests (gate: `npm test`, `npm run build`, `npm run lint` — no e2e/self-driving per project memory)

- `tests/theory.test.ts`: `diatonicStack` — C ionian I=C-E-G, ii=D-F-A, vii°=B-D-F; 7th tone correct; every tone `isInScale` across all 7 modes; octave arithmetic.
- New `tests/harmony.test.ts` (model: `tests/drums.test.ts`): seed determinism; progression starts tonic and ends D→I; all pitches 36–96 and in-scale; `maxVoices: 3` never emits 4 tones; `harmonizeLine` over a C-E-G arpeggio picks I; velocities below the lead's range.
- `tests/evolve.test.ts` / `tests/symbolic.test.ts`: clone the includeRhythm two-part block (evolve.test.ts:100-134) for `'both'` (lead+chords parts, chords below the lead, **sweep-line ≤8 voices with rhythm on**) and `'chords'` (single chords part, ≥3 simultaneous tones per segment). **Seed-compat regression**: same seed, `'line'` vs `'both'` → identical lead notes.
- `tests/geneticRiff.test.ts`: chords riff — `parts` still `[]`, 3–4 in-scale pitches per onset, seed-deterministic; existing line-mode determinism tests confirm the untouched path.
- `tests/prompts.test.ts` (light, if a prompts test file fits): chords rule present iff voicing ≠ 'line'.

## Sequencing

types.ts + theory helper (+tests) → harmony.ts (+tests) → symbolic/index.ts + genetic.ts melodicLine (+tests) → genetic/index.ts (+tests) → prompts.ts → GenerationPanel.tsx → full `npm test` + `npm run build` + `npm run lint`.

## Risks

- **Voice cap** is the main one (offline engines self-guarantee validity) — mitigated by the maxVoices-3 rule, must be test-asserted.
- **Seed compat** — safe by construction: new RNG draws only on paths old briefs can never take.
- **Keeper pollution** — CHORDS motifs rated ≥3 feed the keeper GA; handled by the `melodicLine` top-voice reduction.
- **Low-register mud** in dark modes — root window 48–60 + ceiling octave-drop keeps thirds above ~C3; acceptable without inversions.

## Follow-ups (out of scope, noted)

- Surprise mode rolling a random voicing.
- Post-hoc `harmonizeLine` over NEURAL output (works technically, blurs engine identity).
- A per-part "Harmonize" transform in the Mutation Bay's ADV menu.
