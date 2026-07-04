import { readLocalStorageValue, useColorScheme, useLocalStorage } from '@mantine/hooks'

/**
 * Global toggle for explanatory hover tooltips. Persisted per browser;
 * multiple hook instances stay in sync within the tab.
 */
export function useTooltipsEnabled() {
  return useLocalStorage<boolean>({ key: 'motif-forge:tooltips', defaultValue: true })
}

export type ThemePref = 'day' | 'nite' | 'system'

/** Workbench theme: Day (light hardware), Nite (dark), or follow the OS. */
export function useThemePref() {
  return useLocalStorage<ThemePref>({ key: 'motif-forge:theme', defaultValue: 'day' })
}

/** Resolve the preference to the concrete theme driving `:root[data-theme]`. */
export function useResolvedTheme(pref: ThemePref): 'day' | 'nite' {
  const os = useColorScheme()
  return pref === 'system' ? (os === 'dark' ? 'nite' : 'day') : pref
}

const ANTHROPIC_KEY_KEY = 'motif-forge:anthropic-key'

/**
 * User-supplied Anthropic API key, stored only in this browser. When set,
 * the client calls api.anthropic.com directly; when empty, dev builds fall
 * back to the Vite proxy (see src/api/client.ts).
 */
export function useAnthropicKey() {
  return useLocalStorage<string>({ key: ANTHROPIC_KEY_KEY, defaultValue: '' })
}

/** Same value for non-React code — reads through Mantine's serializer. */
export function getAnthropicKey(): string {
  return readLocalStorageValue<string>({ key: ANTHROPIC_KEY_KEY, defaultValue: '' })
}

/* ---------- Noodle panel prefs (motif-forge:noodle-*) ---------- */

/** Snap captured/penciled note starts to the grid. */
export function useNoodleSnap() {
  return useLocalStorage<boolean>({ key: 'motif-forge:noodle-snap', defaultValue: true })
}

/** Grid resolution id ('1/4' | '1/8' | '1/16' | '1/8T' — see noodle/quantize). */
export function useNoodleGrid() {
  return useLocalStorage<string>({ key: 'motif-forge:noodle-grid', defaultValue: '1/16' })
}

/** LOCK: snap incoming pitches into the take's key/mode. */
export function useNoodleLock() {
  return useLocalStorage<boolean>({ key: 'motif-forge:noodle-lock', defaultValue: false })
}

/** Mic transcription mode: hand-rolled YIN, Basic Pitch ONNX, or beatbox DSP. */
export type NoodleMicMode = 'voice' | 'inst' | 'beats'
export function useNoodleMicMode() {
  return useLocalStorage<NoodleMicMode>({
    key: 'motif-forge:noodle-mic-mode',
    defaultValue: 'voice',
  })
}

/** Musical-typing base octave (a…k spans one octave from C<octave>). */
export function useNoodleOctave() {
  return useLocalStorage<number>({ key: 'motif-forge:noodle-octave', defaultValue: 4 })
}

const NOODLE_MIDI_KEY = 'motif-forge:noodle-midi-device'

/** Preferred Web MIDI input device id. */
export function useNoodleMidiDevice() {
  return useLocalStorage<string>({ key: NOODLE_MIDI_KEY, defaultValue: '' })
}

/** Same value for the midiInput singleton (non-React). */
export function getNoodleMidiDevice(): string {
  return readLocalStorageValue<string>({ key: NOODLE_MIDI_KEY, defaultValue: '' })
}

/** Fixed mic latency compensation in ms (input + output chain delay). */
export function useNoodleLatencyMs() {
  return useLocalStorage<number>({ key: 'motif-forge:noodle-latency', defaultValue: 60 })
}

/** Count-in bars before a mic recording window. */
export function useNoodleCountIn() {
  return useLocalStorage<number>({ key: 'motif-forge:noodle-countin', defaultValue: 1 })
}

/** Basic Pitch note sensitivity — the frame threshold, inverted feel:
 * higher = more notes survive. Stored as the raw threshold (0.05–0.95). */
export function useNoodleBpNoteSens() {
  return useLocalStorage<number>({ key: 'motif-forge:noodle-bp-note', defaultValue: 0.3 })
}

/** Basic Pitch split sensitivity — the onset threshold (0.05–0.95). */
export function useNoodleBpSplitSens() {
  return useLocalStorage<number>({ key: 'motif-forge:noodle-bp-split', defaultValue: 0.5 })
}

/** Basic Pitch minimum note length in milliseconds. */
export function useNoodleBpMinLenMs() {
  return useLocalStorage<number>({ key: 'motif-forge:noodle-bp-minlen', defaultValue: 120 })
}

/**
 * Whether Claude-powered features can run: a user-supplied key, or the dev
 * server's proxy fallback. Reactive — flips as soon as the key is saved.
 * `?no-dev-proxy` suppresses the fallback so e2e specs can exercise the
 * keyless production gating on the dev server; the whole branch is compiled
 * out of prod builds (import.meta.env.DEV is statically false there).
 */
export function useClaudeReady(): boolean {
  const [key] = useAnthropicKey()
  if (key.trim() !== '') return true
  return import.meta.env.DEV && !new URLSearchParams(window.location.search).has('no-dev-proxy')
}
