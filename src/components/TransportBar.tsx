import { engine } from '../audio/engine'
import { useAppDispatch, useAppState } from '../store/AppContext'
import type { View } from '../store/appState'

const VIEWS: { id: View; label: string }[] = [
  { id: 'triage', label: 'Triage' },
  { id: 'library', label: 'Library' },
  { id: 'concepts', label: 'Concepts' },
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

      <nav className="views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`btn tab${view === v.id ? ' active' : ''}`}
            onClick={() => {
              engine.stop()
              dispatch({ type: 'SET_VIEW', view: v.id })
            }}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <span className="spacer" />

      {generation.message && (
        <span className="toast" onClick={() => dispatch({ type: 'CLEAR_MESSAGE' })}>
          {generation.message}
        </span>
      )}

      <label className="transport-control">
        <input
          type="checkbox"
          checked={fixed}
          onChange={(e) =>
            dispatch({
              type: 'SET_TRANSPORT',
              transport: { tempoMode: e.target.checked ? 100 : 'motif' },
            })
          }
        />
        fixed tempo
      </label>
      {fixed && (
        <label className="transport-control">
          <input
            type="range"
            min={40}
            max={200}
            value={transport.tempoMode as number}
            onChange={(e) =>
              dispatch({ type: 'SET_TRANSPORT', transport: { tempoMode: Number(e.target.value) } })
            }
          />
          <span className="bpm">{transport.tempoMode} bpm</span>
        </label>
      )}
      <label className="transport-control">
        <input
          type="checkbox"
          checked={transport.metronome}
          onChange={(e) =>
            dispatch({ type: 'SET_TRANSPORT', transport: { metronome: e.target.checked } })
          }
        />
        click
      </label>
      <label className="transport-control">
        <input
          type="checkbox"
          checked={transport.drone}
          onChange={(e) =>
            dispatch({ type: 'SET_TRANSPORT', transport: { drone: e.target.checked } })
          }
        />
        drone
      </label>
    </header>
  )
}
