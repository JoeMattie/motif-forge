import { Tooltip } from '@mantine/core'
import { engine } from '../audio/engine'
import { useAppDispatch, useAppState } from '../store/AppContext'
import type { TriageMode, View } from '../store/appState'
import { useThemePref, useTooltipsEnabled, type ThemePref } from '../uiPrefs'
import { HardToggle } from './hw/HardToggle'

const VIEWS: { value: View; label: string }[] = [
  { value: 'triage', label: 'Triage' },
  { value: 'library', label: 'Library' },
  { value: 'concepts', label: 'Concepts' },
]

const SUB_LABELS: Record<View, string> = {
  triage: 'TRIAGE DECK · MF–01',
  library: 'KEEPER SHELF · MF–01',
  concepts: 'LEITMOTIF DESK · MF–01',
}

const THEME_LABELS: { value: ThemePref; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'nite', label: 'Nite' },
  { value: 'system', label: 'Sys' },
]

export function Header() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [themePref, setThemePref] = useThemePref()
  const [tooltipsEnabled, setTooltipsEnabled] = useTooltipsEnabled()
  const bayOpen = state.mutationTargetId !== null

  const subLabel = bayOpen ? 'MUTATION BAY · MF–01 · POLY' : SUB_LABELS[state.view]

  return (
    <header className="wb-header">
      <span className="brand">MOTIF–FORGE</span>
      <span className="brand-sub">{subLabel}</span>
      <span className="spacer" />

      {state.generation.message && (
        <Tooltip label="Dismiss">
          <button className="toast" onClick={() => dispatch({ type: 'CLEAR_MESSAGE' })}>
            {state.generation.message}
          </button>
        </Tooltip>
      )}

      <div className="view-pills">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            className="hw-key"
            data-latched={state.view === v.value && !bayOpen}
            onClick={() => {
              engine.stop()
              dispatch({ type: 'SET_VIEW', view: v.value })
            }}
          >
            {v.label}
          </button>
        ))}
        {bayOpen && (
          <button className="hw-key" data-latched={true}>
            Mutate
          </button>
        )}
      </div>

      {state.view === 'triage' && !bayOpen && (
        <>
          <span className="header-divider" />
          <Tooltip label="Grid scans the whole pool; Focus triages one motif at a time with auto-advance">
            <div className="seg">
              {(['grid', 'focus'] as TriageMode[]).map((m) => (
                <button
                  key={m}
                  className="seg-item"
                  data-latched={state.triageMode === m}
                  onClick={() => dispatch({ type: 'SET_TRIAGE_MODE', mode: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </Tooltip>
        </>
      )}

      <span className="header-divider" />
      <Tooltip label="Panel theme: Day (light hardware), Nite (after hours), or follow the OS">
        <div className="seg">
          {THEME_LABELS.map((t) => (
            <button
              key={t.value}
              className="seg-item"
              data-latched={themePref === t.value}
              onClick={() => setThemePref(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Tooltip>
      <Tooltip label="Explanatory hover tooltips like this one, everywhere in the app">
        <HardToggle on={tooltipsEnabled} label="hints" onChange={setTooltipsEnabled} />
      </Tooltip>
    </header>
  )
}
