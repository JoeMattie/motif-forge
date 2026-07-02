import type { GenerationBrief, Motif } from '../types'
import { beatsPerBar, scalePitchClasses, MODES } from '../core/theory'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const SCHEMA_BLOCK = `{
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
}`

function hardRules(brief: Pick<GenerationBrief, 'key' | 'mode' | 'bars' | 'timeSig' | 'allowChromatic'>): string {
  const pcs = scalePitchClasses(brief.key, brief.mode)
  const pcList = pcs.map((pc) => `${pc} (${NOTE_NAMES[pc]})`).join(', ')
  const totalBeats = brief.bars * beatsPerBar(brief.timeSig)
  return `HARD RULES (motifs violating these are discarded by a validator):
- Monophonic: no two notes overlap in time. Each note's startBeat + durationBeats must be <= the next note's startBeat.
- Exactly ${brief.bars} bars of ${brief.timeSig}: every note must satisfy startBeat + durationBeats <= ${totalBeats}. Fill the phrase — the last note should end at or near beat ${totalBeats}.
- Pitches are MIDI numbers, integers 36-96. Prefer the melodic register 48-84.
- ${brief.allowChromatic ? `Mostly use` : `Use ONLY`} pitch classes from ${brief.key} ${brief.mode}: {${pcList}}. A MIDI pitch p is in scale when (p mod 12) is in that set.${brief.allowChromatic ? ' Occasional chromatic passing tones are allowed when expressive.' : ''}
- At least 3 notes per motif; velocities 1-127 shaped musically (phrase peaks louder).
- Vary rhythm ACROSS the batch: no two motifs with the same rhythmic profile, and avoid runs of straight eighth notes unless the brief asks for them. Mix note lengths, use rests deliberately, syncopate some candidates.
- Land each phrase ending deliberately: on a stable degree (1, 3, 5) for resolution, or an intentionally unstable one if the brief calls for tension.

OUTPUT: raw JSON only, exactly matching this schema — no prose, no markdown fences. Your first character must be "{".
${SCHEMA_BLOCK}`
}

export function buildGenerationPrompt(brief: GenerationBrief, n: number): string {
  return `You are a melody composer generating short motif candidates ("hooks" / leitmotifs) for a song concept. Compose ${n} distinct monophonic motifs.

CONSTRAINT BRIEF:
- Concept: ${brief.concept || '(unnamed)'}
- Key/mode: ${brief.key} ${brief.mode}
- Tempo: ${brief.tempo} BPM
- Length: ${brief.bars} bars of ${brief.timeSig}
- Direction from the author: ${brief.text || '(none — use your judgment, but make the candidates genuinely diverse in contour and rhythm)'}

Make the ${n} candidates meaningfully different from each other: different contours (arch, descent, zigzag, pedal-tone...), different rhythmic characters, different registers within 48-84.

${hardRules(brief)}`
}

export function buildMutationPrompt(parent: Motif, mutationBrief: string, n: number): string {
  const parentJson = JSON.stringify({
    name: parent.name,
    notes: parent.notes,
    key: parent.key,
    mode: parent.mode,
    bars: parent.bars,
    timeSig: parent.timeSig,
  })
  return `You are a melody composer creating variations of an existing motif. Here is the parent motif:

${parentJson}

MUTATION BRIEF from the author: ${mutationBrief}

Compose ${n} children that follow the mutation brief while remaining recognizably related to the parent. Keep the same key (${parent.key} ${parent.mode}), bars (${parent.bars}) and time signature (${parent.timeSig}) unless the brief explicitly says otherwise. Give each child a name derived from the parent's ("${parent.name}").

${hardRules({ key: parent.key, mode: parent.mode, bars: parent.bars, timeSig: parent.timeSig, allowChromatic: true })}`
}

export const ALL_MODES = MODES
