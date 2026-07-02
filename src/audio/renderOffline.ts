import type { Motif } from '../types'
import { beatsPerBar } from '../core/theory'
import { createMasterChain, scheduleDrone, scheduleMotif } from './voice'

const SAMPLE_RATE = 44100
const TAIL_SEC = 1.0 // let the last note's decay ring out

/** Render a motif with the same synth graph as live playback. */
export async function renderMotif(
  motif: Motif,
  tempo: number,
  opts: { drone?: boolean } = {},
): Promise<AudioBuffer> {
  const durationSec = (motif.bars * beatsPerBar(motif.timeSig) * 60) / tempo
  const ctx = new OfflineAudioContext(1, Math.ceil((durationSec + TAIL_SEC) * SAMPLE_RATE), SAMPLE_RATE)
  const { input } = createMasterChain(ctx)
  scheduleMotif(ctx, input, motif, tempo, 0)
  if (opts.drone) scheduleDrone(ctx, input, motif.key, durationSec, 0)
  return ctx.startRendering()
}
