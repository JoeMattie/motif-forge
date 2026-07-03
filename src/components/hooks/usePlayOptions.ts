import { useAppState } from '../../store/AppContext'
import { effectiveTempo } from '../../store/appState'
import type { PlayOptions } from '../../audio/engine'
import type { Motif } from '../../types'

/** Build engine PlayOptions for a motif from the current transport state. */
export function usePlayOptions(): (motif: Motif, extra?: Partial<PlayOptions>) => PlayOptions {
  const { transport } = useAppState()
  return (motif, extra) => ({
    tempo: effectiveTempo(transport, motif),
    metronome: transport.metronome,
    drone: transport.drone,
    sound: transport.sound,
    forceSound: transport.forceSound,
    ...extra,
  })
}
