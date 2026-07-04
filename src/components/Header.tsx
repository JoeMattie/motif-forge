import { Button, SegmentedControl, Tabs, Tooltip } from '@mantine/core'
import { InfoIcon, KeyIcon, MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { engine } from '../audio/engine'
import { useAppDispatch, useAppState } from '../store/AppContext'
import type { TriageMode, View } from '../store/appState'
import { useAnthropicKey, useThemePref, useTooltipsEnabled, type ThemePref } from '../uiPrefs'
import { AboutModal } from './AboutModal'
import { ApiKeyModal } from './ApiKeyModal'
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
  const [apiKey] = useAnthropicKey()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const bayOpen = state.mutationTargetId !== null

  const subLabel = bayOpen ? 'MUTATION BAY · MF–01 · POLY' : SUB_LABELS[state.view]

  return (
    <header className="wb-header">
      <span className="brand">MOTIF–FORGE</span>
      <Tooltip label="About Motif Forge — what it does, how it works, what it's built from">
        <Button leftSection={<InfoIcon size={11} />} onClick={() => setAboutOpen(true)}>
          Info
        </Button>
      </Tooltip>
      <AboutModal opened={aboutOpen} onClose={() => setAboutOpen(false)} />
      <Tooltip
        label={
          apiKey
            ? 'Anthropic API key is set for this browser — click to change or clear it'
            : 'Set your Anthropic API key to use the CLAUDE engine and LLM mutations'
        }
      >
        <Button
          data-latched={Boolean(apiKey)}
          leftSection={<KeyIcon size={11} />}
          onClick={() => setKeyOpen(true)}
        >
          Key
        </Button>
      </Tooltip>
      <ApiKeyModal opened={keyOpen} onClose={() => setKeyOpen(false)} />
      <span className="brand-sub">{subLabel}</span>
      <span className="spacer" />

      {state.view === 'triage' && !bayOpen && (
        <>
          <Tooltip label="Grid scans the whole pool; Focus triages one motif at a time with auto-advance">
            <div className="header-seg-group">
              <span className="knob-label">view</span>
              <SegmentedControl
                value={state.triageMode}
                onChange={(m) => dispatch({ type: 'SET_TRIAGE_MODE', mode: m as TriageMode })}
                data={['grid', 'focus']}
              />
            </div>
          </Tooltip>
          <span className="header-divider" />
        </>
      )}

      <Tabs
        value={bayOpen ? 'mutate' : state.view}
        onChange={(v) => {
          if (!v || v === 'mutate') return
          engine.stop()
          dispatch({ type: 'SET_VIEW', view: v as View })
        }}
      >
        <Tabs.List>
          {VIEWS.map((v) => (
            <Tabs.Tab key={v.value} value={v.value}>
              {v.label}
            </Tabs.Tab>
          ))}
          {bayOpen && <Tabs.Tab value="mutate">Mutate</Tabs.Tab>}
        </Tabs.List>
      </Tabs>

      <span className="header-divider" />
      <Tooltip label="Panel theme: Day (light hardware), Nite (after hours), or follow the OS">
        <SegmentedControl
          value={themePref}
          onChange={(v) => setThemePref(v as ThemePref)}
          data={THEME_OPTIONS.map((t) => ({
            value: t.value,
            label: <t.icon aria-label={t.label} size={13} />,
          }))}
        />
      </Tooltip>
      <Tooltip label="Explanatory hover tooltips like this one, everywhere in the app">
        <HardToggle on={tooltipsEnabled} label="hints" onChange={setTooltipsEnabled} />
      </Tooltip>
    </header>
  )
}
