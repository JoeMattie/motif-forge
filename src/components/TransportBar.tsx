import { Button, Checkbox, SegmentedControl, Select, Slider, Tooltip } from '@mantine/core'
import { engine } from '../audio/engine'
import { SOUNDS } from '../audio/instruments'
import type { Sound } from '../types'
import { useAppDispatch, useAppState } from '../store/AppContext'
import type { View } from '../store/appState'

const VIEWS: { value: View; label: string }[] = [
  { value: 'triage', label: 'Triage' },
  { value: 'library', label: 'Library' },
  { value: 'concepts', label: 'Concepts' },
]

export function TransportBar() {
  const { transport, view, generation } = useAppState()
  const dispatch = useAppDispatch()
  const fixed = transport.tempoMode !== 'motif'

  return (
    <header className="transport-bar">
      <span className="logo">
        Motif<b>Forge</b>
      </span>

      <SegmentedControl
        size="xs"
        value={view}
        onChange={(v) => {
          engine.stop()
          dispatch({ type: 'SET_VIEW', view: v as View })
        }}
        data={VIEWS}
      />

      <span className="spacer" />

      {generation.message && (
        <Tooltip label="Dismiss">
          <Button variant="light" color="forge" onClick={() => dispatch({ type: 'CLEAR_MESSAGE' })}>
            {generation.message}
          </Button>
        </Tooltip>
      )}

      <Tooltip label="Playback instrument (sampled sounds load from a CDN on first use)">
        <label className="transport-control">
          sound
          <Select
            w={130}
            value={transport.sound}
            onChange={(v) =>
              v && dispatch({ type: 'SET_TRANSPORT', transport: { sound: v as Sound } })
            }
            data={SOUNDS.map((s) => ({ value: s.id, label: s.label }))}
          />
        </label>
      </Tooltip>
      <Tooltip label="Ignore each motif's own instrumentation and audition everything through the picked sound">
        <Checkbox
          label="force"
          checked={transport.forceSound}
          onChange={(e) =>
            dispatch({ type: 'SET_TRANSPORT', transport: { forceSound: e.currentTarget.checked } })
          }
        />
      </Tooltip>
      <Tooltip label="Audition everything at one BPM instead of each motif's own tempo — useful for fair side-by-side comparison">
        <Checkbox
          label="fixed tempo"
          checked={fixed}
          onChange={(e) =>
            dispatch({
              type: 'SET_TRANSPORT',
              transport: { tempoMode: e.currentTarget.checked ? 100 : 'motif' },
            })
          }
        />
      </Tooltip>
      {fixed && (
        <span className="transport-control">
          <Slider
            w={120}
            min={40}
            max={200}
            label={null}
            value={transport.tempoMode as number}
            onChange={(v) => dispatch({ type: 'SET_TRANSPORT', transport: { tempoMode: v } })}
          />
          <span className="bpm">{transport.tempoMode} bpm</span>
        </span>
      )}
      <Tooltip label="Metronome click during playback (accented on beat 1)">
        <Checkbox
          label="click"
          checked={transport.metronome}
          onChange={(e) =>
            dispatch({ type: 'SET_TRANSPORT', transport: { metronome: e.currentTarget.checked } })
          }
        />
      </Tooltip>
      <Tooltip label="Sustained root note under playback so you hear each motif against its tonal center (included in WAV export)">
        <Checkbox
          label="drone"
          checked={transport.drone}
          onChange={(e) =>
            dispatch({ type: 'SET_TRANSPORT', transport: { drone: e.currentTarget.checked } })
          }
        />
      </Tooltip>
    </header>
  )
}
