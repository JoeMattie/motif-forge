/**
 * Web MIDI singleton (subscribe/getSnapshot, like the audio engine). Feature-
 * gated: Safari has no Web MIDI, and the whole device row hides when
 * unsupported. Access is requested lazily the first time the Noodle panel
 * wants devices; note-on/off events fan out to subscribed listeners
 * regardless of which input sent them — the selected-device filter applies
 * here so listeners stay simple.
 */

export interface MidiDevice {
  id: string
  name: string
}

export interface MidiSnapshot {
  supported: boolean
  status: 'idle' | 'requesting' | 'ready' | 'denied'
  devices: MidiDevice[]
  selectedId: string | null
}

export interface NoodleNoteEvent {
  type: 'on' | 'off'
  pitch: number
  velocity: number // 1-127 (offs carry 0)
}

const supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator

let snapshot: MidiSnapshot = {
  supported,
  status: 'idle',
  devices: [],
  selectedId: null,
}
const listeners = new Set<() => void>()
const noteListeners = new Set<(e: NoodleNoteEvent) => void>()

let access: MIDIAccess | null = null

function set(patch: Partial<MidiSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

export function subscribeMidi(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getMidiSnapshot(): MidiSnapshot {
  return snapshot
}

function refreshDevices(): void {
  if (!access) return
  const devices: MidiDevice[] = []
  access.inputs.forEach((input) => {
    devices.push({ id: input.id, name: input.name ?? input.id })
  })
  // Selection falls back to the first device when the chosen one unplugs.
  const selectedId =
    snapshot.selectedId && devices.some((d) => d.id === snapshot.selectedId)
      ? snapshot.selectedId
      : (devices[0]?.id ?? null)
  set({ devices, selectedId })
  attachInputs()
}

function onMidiMessage(this: MIDIInput, e: MIDIMessageEvent): void {
  if (snapshot.selectedId !== null && this.id !== snapshot.selectedId) return
  const data = e.data
  if (!data || data.length < 3) return
  const status = data[0] & 0xf0
  const pitch = data[1]
  const velocity = data[2]
  if (status === 0x90 && velocity > 0) {
    for (const l of noteListeners) l({ type: 'on', pitch, velocity })
  } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    for (const l of noteListeners) l({ type: 'off', pitch, velocity: 0 })
  }
}

function attachInputs(): void {
  if (!access) return
  access.inputs.forEach((input) => {
    input.onmidimessage = onMidiMessage
  })
}

/** Request access on first use (idempotent). No sysex — plain note input. */
export async function ensureMidiAccess(preferredId?: string): Promise<void> {
  if (!supported || access || snapshot.status === 'requesting') return
  set({ status: 'requesting', selectedId: preferredId || snapshot.selectedId })
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
    access.onstatechange = () => refreshDevices()
    set({ status: 'ready' })
    refreshDevices()
  } catch {
    set({ status: 'denied' })
  }
}

export function selectMidiDevice(id: string | null): void {
  set({ selectedId: id })
}

/** Live note events from the selected device. Returns the unsubscribe. */
export function onMidiNote(cb: (e: NoodleNoteEvent) => void): () => void {
  noteListeners.add(cb)
  return () => noteListeners.delete(cb)
}
