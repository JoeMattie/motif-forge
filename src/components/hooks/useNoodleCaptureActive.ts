import { useSyncExternalStore } from 'react'
import { getRecorderSnapshot, subscribeRecorder } from '../../noodle/recorder'
import { getMicSnapshot, subscribeMic } from '../../noodle/micCapture'

/**
 * True while the Noodle panel is capturing (MIDI/typing armed or recording,
 * or a mic window is open). The triage keyboard listener is disabled for the
 * duration — musical typing owns the letters, same mechanism as the Mutation
 * Bay drawer disabling triage keys while it's open.
 */
export function useNoodleCaptureActive(): boolean {
  const recording = useSyncExternalStore(
    subscribeRecorder,
    () => getRecorderSnapshot().state !== 'idle',
  )
  const mic = useSyncExternalStore(subscribeMic, () => getMicSnapshot().state !== 'idle')
  return recording || mic
}
