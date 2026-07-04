import type { GenerationBrief, Motif, Texture, Voicing } from '../types'
import { beatsPerBar, scalePitchClasses, MODES } from '../core/theory'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const SCHEMA_BLOCK = `{"motifs":[{"name":"short evocative name","parts":[{"name":"lead","instrument":"synth","preset":{"oscillator":"sawtooth","envelope":{"attack":0.01,"decay":0.2,"sustain":0.5,"release":0.3}}},{"name":"pad","instrument":"strings"}],"notes":[{"pitch":62,"startBeat":0,"durationBeats":0.5,"velocity":96,"part":0}],"key":"D","mode":"dorian","bars":4,"timeSig":"4/4","rationale":"one sentence on the contour/intent"}]}`

const INSTRUMENT_LIST = `Available instruments: "synth" (a polysynth you can sound-design), "piano" (sampled grand), "epiano" (sampled electric piano), "marimba", "strings" (sustained ensemble — good for pads), "drums" (percussion).`

function instrumentRules(extra: boolean): string {
  const partsRule = extra
    ? `- Instrumentation: each motif declares 4-6 "parts" — a FULL arrangement with distinct roles (e.g. lead, counter-line, harmony/pad, bass, drums; no two parts doubling the same role) — and each note carries a "part" index. ${INSTRUMENT_LIST} Vary the instrument palette across the batch.`
    : `- Instrumentation: each motif declares 1-4 "parts" and each note carries a "part" index. ${INSTRUMENT_LIST} Choose instruments that serve the intent; a single part is fine for pure melodies.`
  return `${partsRule}
- Synth presets: parts with instrument "synth" may include a "preset" — oscillator one of "sine" | "triangle" | "sawtooth" | "square", plus an ADSR envelope (attack/decay/release in seconds 0-2, sustain 0-1). Design the patch to fit the part's role: e.g. soft sine pads (slow attack, high sustain), plucky square leads (fast attack, low sustain). Omit the preset for a plain default.
- Drum parts use General MIDI drum pitches and are exempt from the scale rule: 36 kick, 38 snare, 39 clap, 42 closed hi-hat, 46 open hi-hat, 41-50 toms, 49 crash, 51 ride. Keep grooves supportive, not busy; velocities shape the groove (accents louder, ghost notes soft).`
}

function textureRule(texture: Texture, extra: boolean): string {
  if (texture === 'lead') {
    return extra
      ? `- Texture: one clear lead line over a fuller backing arrangement (pads, bass, counter-lines). The melodic contour must stay unmistakable on top; never more than 6 simultaneous voices.`
      : `- Texture: primarily a single melodic line (usually 1-2 parts). Occasional dyads or chords for emphasis are welcome (notes may overlap in time), but never more than 4 simultaneous voices, and the melodic contour must stay clear.`
  }
  return extra
    ? `- Texture: freely polyphonic across the full arrangement (up to 6 parts). Chords, sustained pads under moving lines, counterpoint, and interlocking rhythms are all welcome. Never more than 8 simultaneous voices.`
    : `- Texture: freely polyphonic (up to 4 parts). Chords, sustained pads under moving lines, and simple counterpoint are all welcome. Never more than 6 simultaneous voices.`
}

/** CHORDS voicing: the motif IS a chord progression — replaces the texture rule. */
const CHORDS_RULE = `- Texture: each motif IS a chord progression, not a melody. Exactly one non-drum part, named "chords", carrying root-position diatonic triads (occasional 7th chords) — 3-4 simultaneous notes per chord, every chord tone sharing the same startBeat and duration, no inversions or suspensions. Use functional harmony (tonic/subdominant/dominant motion) with an authentic V-I cadence in the final bar. Chord roots between MIDI 48 and 60; 1-2 chords per bar.`

/** BOTH voicing: appended to the texture rule — a harmonized accompaniment part. */
const BOTH_RULE = `- Accompaniment: additionally include one part named "chords" — a root-position diatonic chord accompaniment (triads, occasional 7ths, 1-2 chords per bar, authentic cadence at the end) harmonized so the lead's notes are chord tones of the chord sounding under them. Voice it BELOW the melody, quieter than the lead, and never exceed 8 simultaneous voices across all parts combined.`

/** The texture/voicing rule block: LINE keeps the plain texture rule, CHORDS
 * replaces it (texture is moot without a melody), BOTH appends the
 * accompaniment demand. */
function voicingRules(voicing: Voicing, texture: Texture, extra: boolean): string {
  if (voicing === 'chords') return CHORDS_RULE
  if (voicing === 'both') return `${textureRule(texture, extra)}\n${BOTH_RULE}`
  return textureRule(texture, extra)
}

const SHARED_TAIL_RULES = `- At least 3 notes per motif; velocities 1-127 shaped musically (phrase peaks louder, inner voices softer than the lead).
- Vary rhythm ACROSS the batch: no two motifs with the same rhythmic profile, and avoid runs of straight eighth notes unless the brief asks for them. Mix note lengths, use rests deliberately, syncopate some candidates.
- Land each phrase ending deliberately: on a stable degree (1, 3, 5) for resolution, or an intentionally unstable one if the brief calls for tension.

OUTPUT: raw MINIFIED JSON only, exactly matching this schema — no prose, no markdown fences, no indentation or newlines (whitespace wastes your output budget; a pretty-printed response gets truncated). Your first character must be "{".
${SCHEMA_BLOCK}`

function hardRules(
  brief: Pick<GenerationBrief, 'key' | 'mode' | 'bars' | 'timeSig' | 'allowChromatic'>,
  texture: Texture,
  extra = false,
  voicing: Voicing = 'line',
): string {
  const pcs = scalePitchClasses(brief.key, brief.mode)
  const pcList = pcs.map((pc) => `${pc} (${NOTE_NAMES[pc]})`).join(', ')
  const totalBeats = brief.bars * beatsPerBar(brief.timeSig)
  return `HARD RULES (motifs violating these are discarded by a validator):
${voicingRules(voicing, texture, extra)}
${instrumentRules(extra)}
- Exactly ${brief.bars} bars of ${brief.timeSig}: every note must satisfy startBeat + durationBeats <= ${totalBeats}. Fill the phrase — the last note should end at or near beat ${totalBeats}.
- Pitches are MIDI numbers, integers 36-96. Prefer the melodic register 48-84 (bass voices in polyphony may sit lower).
- ${brief.allowChromatic ? `Mostly use` : `Use ONLY`} pitch classes from ${brief.key} ${brief.mode}: {${pcList}}. A MIDI pitch p is in scale when (p mod 12) is in that set.${brief.allowChromatic ? ' Occasional chromatic passing tones are allowed when expressive.' : ''}
${SHARED_TAIL_RULES}`
}

/** Rules for surprise mode: per-motif key/mode/bars/tempo instead of fixed constraints. */
function surpriseHardRules(): string {
  return `HARD RULES (motifs violating these are discarded by a validator):
${textureRule('poly', false)}
${instrumentRules(false)}
- Each motif declares its own "bars" (2, 4, or 8) and "timeSig" "4/4", plus a "tempo" field (40-220). Every note must satisfy startBeat + durationBeats <= bars × 4, and the phrase should fill its length.
- Pitches are MIDI numbers, integers 36-96. Prefer the melodic register 48-84 (bass voices in polyphony may sit lower).
- Stay mostly within each motif's OWN declared key/mode; chromaticism is welcome when expressive.
${SHARED_TAIL_RULES}`
}

export function buildGenerationPrompt(brief: GenerationBrief, n: number): string {
  return `You are a composer generating short motif candidates ("hooks" / leitmotifs) for a song concept. Compose ${n} distinct motifs.

CONSTRAINT BRIEF:
- Concept: ${brief.concept || '(unnamed)'}
- Key/mode: ${brief.key} ${brief.mode}
- Tempo: ${brief.tempo} BPM
- Length: ${brief.bars} bars of ${brief.timeSig}
- Rhythm part: ${brief.includeRhythm ? 'YES — every motif must include exactly one part with instrument "drums" carrying a groove that supports the melodic material.' : 'only include a "drums" part if the direction below asks for rhythm/percussion.'}
- Direction from the author: ${brief.text || '(none — use your judgment, but make the candidates genuinely diverse in contour and rhythm)'}

Make the ${n} candidates meaningfully different from each other: different contours (arch, descent, zigzag, pedal-tone...), different rhythmic characters, different registers within 48-84.

${hardRules(brief, brief.texture, brief.extraInstruments, brief.voicing)}`
}

/** Free-rein generation: the model picks key, mode, tempo, texture, and instrumentation. */
export function buildSurprisePrompt(n: number): string {
  return `You are a composer with free rein. Compose ${n} short motif candidates ("hooks" / leitmotifs) that will genuinely surprise a songwriter browsing for ideas.

For EACH motif, choose your own: key and mode (any of ${MODES.join(', ')}), tempo (40-220 BPM — include a "tempo" field in the motif JSON), length (2, 4, or 8 bars of 4/4), texture (a bare melody, a chorale, a pad with a moving line, call-and-response, a groove with drums...), and instrumentation. Make the ${n} motifs maximally different from each other in mood, register, rhythm, and instrumentation — as if ${n} different composers wrote them.

${surpriseHardRules()}`
}

export interface MutationOptions {
  lockRhythm?: boolean
  /** Part indices the LLM must copy into every child verbatim (mutation-bay LOCK). */
  lockedParts?: number[]
}

export function buildMutationPrompt(
  parent: Motif,
  mutationBrief: string,
  n: number,
  opts: MutationOptions = {},
): string {
  const parentJson = JSON.stringify({
    name: parent.name,
    parts: parent.parts,
    notes: parent.notes,
    key: parent.key,
    mode: parent.mode,
    bars: parent.bars,
    timeSig: parent.timeSig,
  })
  const locked = (opts.lockedParts ?? []).filter((i) => i >= 0 && i < parent.parts.length)
  const armed = parent.parts.map((_, i) => i).filter((i) => !locked.includes(i))
  const partName = (i: number) => `"${parent.parts[i]?.name ?? `part ${i}`}" (part ${i})`
  const partLock =
    locked.length > 0 && parent.parts.length > 0
      ? `
PART LOCK (a validator rejects children that break it): the following parts are LOCKED — copy their notes into every child VERBATIM: identical pitch, startBeat, durationBeats, velocity, and part index, with no notes added or removed: ${locked.map(partName).join(', ')}. Keep the parent's "parts" array exactly as given. Only rewrite the notes of the armed parts: ${armed.map(partName).join(', ')}. The children differ from the parent ONLY in the armed parts.`
      : ''
  return `You are a composer creating variations of an existing motif. Here is the parent motif:

${parentJson}

MUTATION BRIEF from the author: ${mutationBrief}

Compose ${n} children that follow the mutation brief while remaining recognizably related to the parent. Keep the same key (${parent.key} ${parent.mode}), bars (${parent.bars}) and time signature (${parent.timeSig}) unless the brief explicitly says otherwise. Match the parent's texture and instrumentation (parts) unless the brief asks for a change. Give each child a name derived from the parent's ("${parent.name}").${partLock}
${
  opts.lockRhythm
    ? `
RHYTHM LOCK (overrides everything else): every child must reproduce the parent's rhythm exactly — the same number of notes with identical startBeat, durationBeats, and part values, in the same order. Change only pitches (and velocities modestly). Do not add or remove notes.`
    : ''
}
${hardRules({ key: parent.key, mode: parent.mode, bars: parent.bars, timeSig: parent.timeSig, allowChromatic: true }, 'poly')}`
}

const PLAN_SCHEMA_BLOCK = `{"valence":0.2,"arousal":0.7,"contourWeights":{"arch":3,"descend":1},"rhythmWeights":{"syncopated":2,"straight":1},"density":"medium","register":"mid","chromaticism":false,"progression":[0,5,3,4]}`

/**
 * Planner prompt (M6(GPT)3-style "LLM as planner"): the model translates the
 * author's free-text brief into a compact steering spec for the offline
 * INSTANT engine — it never writes a single note. When the MOOD/ENERGY knobs
 * are off-center they are FIXED: the model must omit valence/arousal.
 */
export function buildPlanPrompt(brief: GenerationBrief): string {
  const moodFixed =
    brief.mood !== undefined && (brief.mood.valence !== 0 || brief.mood.arousal !== 0.5)
  return `You are a music director translating an author's brief into parameters for an offline melody generator. You do NOT write notes — you only pick steering values.

BRIEF:
- Concept: ${brief.concept || '(unnamed)'}
- Key/mode: ${brief.key} ${brief.mode} (fixed — do not output key or mode)
- Tempo: ${brief.tempo} BPM (fixed)
- Length: ${brief.bars} bars of ${brief.timeSig} (fixed)
- Direction from the author: ${brief.text || '(none)'}

PARAMETERS (all optional — omit any the brief gives you no signal for):
- "valence": number -1..1 — emotional brightness (-1 dark, 1 bright).
- "arousal": number 0..1 — energy (0 calm, 1 driven).${moodFixed ? `\n  NOTE: the author has FIXED valence/arousal on physical knobs — do NOT output "valence" or "arousal"; they would be ignored.` : ''}
- "contourWeights": object — relative weights over melodic contour templates. Legal keys, exactly: "arch", "ascend", "descend", "zigzag", "flat". Positive numbers; higher = more likely.
- "rhythmWeights": object — relative weights over rhythm archetypes. Legal keys, exactly: "straight", "dotted", "syncopated", "sparse".
- "density": drum groove density, one of "sparse" | "medium" | "busy".
- "register": melodic register, one of "low" | "mid" | "high".
- "chromaticism": boolean — whether out-of-scale color is wanted.
- "progression": array of scale-degree integers 0-6 (0 = tonic), one chord per bar, cycled if shorter than ${brief.bars}. Chord quality comes from the mode — just pick degrees, e.g. [0,5,3,4].

OUTPUT: raw MINIFIED JSON only, one object exactly in the shape of this example — no prose, no markdown fences. Your first character must be "{".
${PLAN_SCHEMA_BLOCK}`
}

export const ALL_MODES = MODES
