import { useEffect, useMemo, useRef } from 'react'
import { Select, Slider, Tooltip } from '@mantine/core'
import { engine } from '../audio/engine'
import { SOUNDS } from '../audio/instruments'
import type { Motif, Sound } from '../types'
import { beatsPerBar } from '../core/theory'
import { buildFamilies } from '../core/families'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { useIsPlaying } from './hooks/usePlayhead'
import { useSyncExternalStore } from 'react'
import { HardToggle } from './hw/HardToggle'
import { PlayRound } from './hw/PlayRound'

/** Live BAR x.y readout — one rAF loop mutating a ref, no re-renders. */
function BarReadout({ motif }: { motif: Motif }) {
  const ref = useRef<HTMLSpanElement>(null)
  const playing = useIsPlaying(motif.id)
  const bpb = beatsPerBar(motif.timeSig)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const step = () => {
      const beats = engine.getPositionBeats()
      if (ref.current && beats !== null) {
        ref.current.textContent = `BAR ${Math.floor(beats / bpb) + 1}.${Math.floor(beats % bpb) + 1}`
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, bpb])

  return (
    <span ref={ref} className="now-bar">
      BAR 1.1
    </span>
  )
}

export function TransportStrip() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const { transport } = state
  const fixed = transport.tempoMode !== 'motif'

  const playingId = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().playingMotifId,
  )
  const playingMotif = playingId ? state.motifs.get(playingId) : undefined

  // Triage progress counts FAMILIES: a family is done once its face is rated
  // or the family is discarded.
  const progress = useMemo(() => {
    const families = buildFamilies(state.motifs)
    if (families.length === 0) return 0
    const done = families.filter((f) => f.root.discarded || f.face.rating > 0).length
    return Math.round((done / families.length) * 100)
  }, [state.motifs])

  return (
    <footer className="transport-strip module">
      {playingMotif ? (
        <span className="now-playing">
          <PlayRound size="md" playing onClick={() => engine.stop()} title="Stop" />
          <span className="now-name">{playingMotif.name}</span>
          <BarReadout motif={playingMotif} />
        </span>
      ) : (
        <span className="now-playing">
          <span className="micro-dim">stopped</span>
        </span>
      )}
      <span className="divider" />
      <Tooltip label="Playback instrument for partless motifs (sampled sounds load from a CDN on first use)">
        <span className="sound-ctl">
          sound
          <Select
            w={110}
            size="xs"
            value={transport.sound}
            onChange={(v) => v && dispatch({ type: 'SET_TRANSPORT', transport: { sound: v as Sound } })}
            data={SOUNDS.map((s) => ({ value: s.id, label: s.label }))}
          />
        </span>
      </Tooltip>
      <Tooltip label="Ignore each motif's own instrumentation and audition everything through the picked sound">
        <HardToggle
          on={transport.forceSound}
          label="force"
          onChange={(on) => dispatch({ type: 'SET_TRANSPORT', transport: { forceSound: on } })}
        />
      </Tooltip>
      <Tooltip label="Audition everything at one BPM instead of each motif's own tempo — useful for fair side-by-side comparison">
        <HardToggle
          on={fixed}
          label={fixed ? `fixed ${transport.tempoMode}` : 'fixed'}
          onChange={(on) =>
            dispatch({ type: 'SET_TRANSPORT', transport: { tempoMode: on ? 100 : 'motif' } })
          }
        />
      </Tooltip>
      {fixed && (
        <Slider
          w={110}
          size="sm"
          min={40}
          max={200}
          label={null}
          value={transport.tempoMode as number}
          onChange={(v) => dispatch({ type: 'SET_TRANSPORT', transport: { tempoMode: v } })}
        />
      )}
      <Tooltip label="Metronome click during playback (accented on beat 1)">
        <HardToggle
          on={transport.metronome}
          label="click"
          onChange={(on) => dispatch({ type: 'SET_TRANSPORT', transport: { metronome: on } })}
        />
      </Tooltip>
      <Tooltip label="Sustained root note under playback so you hear each motif against its tonal center (included in WAV export)">
        <HardToggle
          on={transport.drone}
          label="drone"
          onChange={(on) => dispatch({ type: 'SET_TRANSPORT', transport: { drone: on } })}
        />
      </Tooltip>
      <span className="spacer" />
      <span>triage progress</span>
      <Tooltip label="Families whose face is rated or discarded, out of all families">
        <span className="progress-bar">
          <div style={{ width: `${progress}%` }} />
        </span>
      </Tooltip>
      <span className="progress-pct">{progress}%</span>
    </footer>
  )
}
