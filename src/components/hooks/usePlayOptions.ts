import { useCallback } from 'react'
import { useAppStateGetter } from '../../store/AppContext'
import { effectiveTempo } from '../../store/appState'
import type { PlayOptions } from '../../audio/engine'
import type { Motif } from '../../types'

/**
 * Build engine PlayOptions for a motif from the current transport state.
 * Reads state through the stable getter (not a subscription), so the returned
 * callback is referentially stable and memoized cards don't re-render when
 * unrelated state changes.
 */
export function usePlayOptions(): (motif: Motif, extra?: Partial<PlayOptions>) => PlayOptions {
  const getState = useAppStateGetter()
  return useCallback(
    (motif, extra) => {
      const { transport } = getState()
      return {
        tempo: effectiveTempo(transport, motif),
        metronome: transport.metronome,
        drone: transport.drone,
        sound: transport.sound,
        forceSound: transport.forceSound,
        ...extra,
      }
    },
    [getState],
  )
}
