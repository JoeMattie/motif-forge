import { ActionIcon, Button, SegmentedControl, Tooltip } from '@mantine/core'
import { InfoIcon, MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { engine } from '../audio/engine'
import { useAppDispatch, useAppState } from '../store/AppContext'
import type { TriageMode, View } from '../store/appState'
import { useThemePref, useTooltipsEnabled, type ThemePref } from '../uiPrefs'
import { AboutModal } from './AboutModal'
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

const THEME_OPTIONS: { value: ThemePref; label: string; icon: typeof SunIcon }[] = [
  { value: 'day', label: 'Day theme', icon: SunIcon },
  { value: 'nite', label: 'Nite theme', icon: MoonIcon },
  { value: 'system', label: 'Follow system theme', icon: MonitorIcon },
]

export function Header() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [themePref, setThemePref] = useThemePref()
  const [tooltipsEnabled, setTooltipsEnabled] = useTooltipsEnabled()
  const [aboutOpen, setAboutOpen] = useState(false)
  const bayOpen = state.mutationTargetId !== null

  const subLabel = bayOpen ? 'MUTATION BAY · MF–01 · POLY' : SUB_LABELS[state.view]

  return (
    <header className="wb-header">
      <span className="brand">MOTIF–FORGE</span>
      <Tooltip label="About Motif Forge — what it does, how it works, what it's built from">
        <ActionIcon aria-label="About Motif Forge" onClick={() => setAboutOpen(true)}>
          <InfoIcon size={14} />
        </ActionIcon>
      </Tooltip>
      <AboutModal opened={aboutOpen} onClose={() => setAboutOpen(false)} />
      <span className="brand-sub">{subLabel}</span>
      <span className="spacer" />

      {state.generation.message && (
        <Tooltip label="Dismiss">
          <button type="button" className="toast" onClick={() => dispatch({ type: 'CLEAR_MESSAGE' })}>
            {state.generation.message}
          </button>
        </Tooltip>
      )}

      {state.view === 'triage' && !bayOpen && (
        <>
          <Tooltip label="Grid scans the whole pool; Focus triages one motif at a time with auto-advance">
            <SegmentedControl
              value={state.triageMode}
              onChange={(m) => dispatch({ type: 'SET_TRIAGE_MODE', mode: m as TriageMode })}
              data={['grid', 'focus']}
            />
          </Tooltip>
          <span className="header-divider" />
        </>
      )}

      <div className="view-pills">
        {VIEWS.map((v) => (
          <Button
            key={v.value}
            data-latched={state.view === v.value && !bayOpen}
            onClick={() => {
              engine.stop()
              dispatch({ type: 'SET_VIEW', view: v.value })
            }}
          >
            {v.label}
          </Button>
        ))}
        {bayOpen && <Button data-latched={true}>Mutate</Button>}
      </div>

      <span className="header-divider" />
      <Tooltip label="Panel theme: Day (light hardware), Nite (after hours), or follow the OS">
        <SegmentedControl
          value={themePref}
          onChange={(v) => setThemePref(v as ThemePref)}
          data={THEME_OPTIONS.map((t) => ({
            value: t.value,
            label: <t.icon aria-label={t.label} size={13} weight={themePref === t.value ? 'fill' : 'regular'} />,
          }))}
        />
      </Tooltip>
      <Tooltip label="Explanatory hover tooltips like this one, everywhere in the app">
        <HardToggle on={tooltipsEnabled} label="hints" onChange={setTooltipsEnabled} />
      </Tooltip>
    </header>
  )
}
