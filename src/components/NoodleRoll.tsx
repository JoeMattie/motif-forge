import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { Note } from '../types'
import { beatsPerBar, isInScale, pitchName } from '../core/theory'
import { engine } from '../audio/engine'
import {
  clampPitch,
  NOODLE_PITCH_MAX,
  NOODLE_PITCH_MIN,
  quantizeFloor,
  quantizeRound,
  snapPitchToScale,
} from '../noodle/quantize'
import {
  getTake,
  NOODLE_TAKE_ID,
  pushUndo,
  removeNotes,
  setNotes,
  subscribeTake,
  undo,
} from '../noodle/takeStore'
import { getRecorderPositionBeats } from '../noodle/recorder'
import { getMicPositionBeats } from '../noodle/micCapture'

export type NoodleTool = 'pencil' | 'select'

interface NoodleRollProps {
  tool: NoodleTool
  snap: boolean
  /** Grid cell in beats (snap resolution + faint sub-grid lines). */
  grid: number
  /** LOCK: shade in-scale rows and snap penciled/dragged pitches into key. */
  lock: boolean
  height?: number
}

const PPR = 9 // px per semitone row
const ROWS = NOODLE_PITCH_MAX - NOODLE_PITCH_MIN + 1
const EDGE_PX = 6 // resize handle width on note edges
const VEL_H = 42 // velocity lane height
const MIN_PPB = 20
const MAX_PPB = 140

type Gesture =
  | {
      kind: 'move'
      origin: readonly Note[]
      downBeat: number
      downPitch: number
      sel: ReadonlySet<number>
    }
  | { kind: 'resize-right'; index: number; origin: Note }
  | { kind: 'resize-left'; index: number; origin: Note }
  | { kind: 'marquee'; downBeat: number; downPitch: number; add: Set<number> }
  | { kind: 'velocity' }

/** Black-key pitch classes — the untinted rows when LOCK is off (DAW-style). */
const BLACK = new Set([1, 3, 6, 8, 10])

/**
 * The Noodle panel's editable piano roll: an LCD-skinned SVG in fixed
 * pixel-per-beat / pixel-per-row coordinates (fixed viewport with scroll, not
 * auto-fit). Gestures follow the ryohey/signal blueprint: pencil creates with
 * the last-used duration (quantizeFloor), note bodies move, edges resize,
 * empty space marquees in select mode, alt-click deletes; velocity lives in a
 * slim lane docked under the roll. All edits go straight to the take store —
 * one undo snapshot per gesture. The playhead is a rAF-driven line (engine
 * loop position, or the recorder's pass position while capturing).
 */
export function NoodleRoll({ tool, snap, grid, lock, height = 264 }: NoodleRollProps) {
  const take = useSyncExternalStore(subscribeTake, getTake)
  const bpb = beatsPerBar(take.timeSig)
  const totalBeats = take.bars * bpb

  const [zoomPpb, setZoomPpb] = useState(56)
  const [containerW, setContainerW] = useState(0)
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set())
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  )
  const gesture = useRef<Gesture | null>(null)
  const lastDuration = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rollRef = useRef<SVGSVGElement>(null)

  // Never let the take render narrower than the panel — the zoom level is a
  // floor, not the truth, so coordinate math always matches the drawn width.
  const ppb = Math.max(zoomPpb, containerW > 0 ? containerW / totalBeats : 0)
  const width = totalBeats * ppb
  const rollH = ROWS * PPR

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    setContainerW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Selection indices go stale whenever the note list changes length under us.
  useEffect(() => {
    setSelection((sel) => {
      const next = new Set([...sel].filter((i) => i < take.notes.length))
      return next.size === sel.size ? sel : next
    })
  }, [take.notes.length])

  // Center the viewport around the material (or middle C) on mount.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const pitches = getTake().notes.map((n) => n.pitch)
    const mid =
      pitches.length > 0 ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 62
    el.scrollTop = Math.max(0, (NOODLE_PITCH_MAX - mid) * PPR - el.clientHeight / 2)
  }, [])

  const toBeatPitch = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = rollRef.current!.getBoundingClientRect()
      const beat = Math.max(0, Math.min(totalBeats, (e.clientX - rect.left) / ppb))
      const rowF = (e.clientY - rect.top) / PPR
      const pitch = clampPitch(NOODLE_PITCH_MAX - Math.floor(rowF))
      return { beat, pitch, x: e.clientX - rect.left, y: e.clientY - rect.top }
    },
    [ppb, totalBeats],
  )

  const hitNote = useCallback(
    (beat: number, pitch: number): { index: number; zone: 'left' | 'right' | 'body' } | null => {
      const notes = getTake().notes
      const edgeBeats = EDGE_PX / ppb
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i]
        if (n.pitch !== pitch) continue
        const end = n.startBeat + n.durationBeats
        if (beat < n.startBeat - edgeBeats || beat > end + edgeBeats) continue
        if (beat >= n.startBeat && beat <= end) {
          if (end - beat <= edgeBeats && n.durationBeats > 2 * edgeBeats)
            return { index: i, zone: 'right' }
          if (beat - n.startBeat <= edgeBeats && n.durationBeats > 2 * edgeBeats)
            return { index: i, zone: 'left' }
          return { index: i, zone: 'body' }
        }
      }
      return null
    },
    [ppb],
  )

  const snapPitch = useCallback(
    (pitch: number) => (lock && !take.drums ? snapPitchToScale(pitch, take.key, take.mode) : pitch),
    [lock, take.drums, take.key, take.mode],
  )

  const onRollPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrollRef.current?.parentElement?.focus()
    const { beat, pitch } = toBeatPitch(e)
    const hit = hitNote(beat, pitch)

    if (hit && e.altKey) {
      removeNotes(new Set([hit.index]))
      setSelection(new Set())
      gesture.current = null
      return
    }

    if (hit) {
      let sel: Set<number>
      if (e.shiftKey) {
        sel = new Set(selection)
        sel.add(hit.index)
      } else if (e.metaKey || e.ctrlKey) {
        sel = new Set(selection)
        if (sel.has(hit.index)) sel.delete(hit.index)
        else sel.add(hit.index)
      } else {
        sel = selection.has(hit.index) ? new Set(selection) : new Set([hit.index])
      }
      setSelection(sel)
      if ((e.metaKey || e.ctrlKey) && !sel.has(hit.index)) {
        gesture.current = null
        return
      }
      pushUndo()
      const origin = getTake().notes
      if (hit.zone === 'right') {
        gesture.current = { kind: 'resize-right', index: hit.index, origin: origin[hit.index] }
      } else if (hit.zone === 'left') {
        gesture.current = { kind: 'resize-left', index: hit.index, origin: origin[hit.index] }
      } else {
        gesture.current = { kind: 'move', origin, downBeat: beat, downPitch: pitch, sel }
      }
      return
    }

    if (tool === 'select') {
      const { x, y } = toBeatPitch(e)
      gesture.current = {
        kind: 'marquee',
        downBeat: beat,
        downPitch: pitch,
        add: e.shiftKey ? new Set(selection) : new Set(),
      }
      setMarquee({ x0: x, y0: y, x1: x, y1: y })
      if (!e.shiftKey) setSelection(new Set())
      return
    }

    // Pencil on empty: create with the last-used duration (floor-snapped —
    // the signal rule for melodic creation).
    pushUndo()
    const start = snap ? quantizeFloor(beat, grid) : beat
    const duration = Math.min(
      Math.max(snap ? grid : 0.1, lastDuration.current),
      Math.max(0.1, totalBeats - start),
    )
    const note: Note = {
      pitch: snapPitch(pitch),
      startBeat: start,
      durationBeats: duration,
      velocity: 96,
      part: 0,
    }
    const notes = [...getTake().notes, note]
    setNotes(notes)
    const index = notes.length - 1
    setSelection(new Set([index]))
    gesture.current = { kind: 'resize-right', index, origin: note }
  }

  const onRollPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g) return
    const { beat, pitch, x, y } = toBeatPitch(e)

    if (g.kind === 'move') {
      const dBeatRaw = beat - g.downBeat
      const dPitch = pitch - g.downPitch
      const notes = g.origin.map((n, i) => {
        if (!g.sel.has(i)) return n
        let start = n.startBeat + dBeatRaw
        if (snap) start = quantizeRound(start, grid)
        start = Math.max(0, Math.min(totalBeats - n.durationBeats, start))
        return { ...n, startBeat: start, pitch: clampPitch(snapPitch(n.pitch + dPitch)) }
      })
      setNotes(notes)
      return
    }
    if (g.kind === 'resize-right') {
      const min = snap ? grid : 0.1
      let dur = beat - g.origin.startBeat
      if (snap) dur = quantizeRound(dur, grid)
      dur = Math.max(min, Math.min(totalBeats - g.origin.startBeat, dur))
      lastDuration.current = dur
      setNotes(getTake().notes.map((n, i) => (i === g.index ? { ...n, durationBeats: dur } : n)))
      return
    }
    if (g.kind === 'resize-left') {
      const end = g.origin.startBeat + g.origin.durationBeats
      const min = snap ? grid : 0.1
      let start = snap ? quantizeFloor(beat, grid) : beat
      start = Math.max(0, Math.min(end - min, start))
      setNotes(
        getTake().notes.map((n, i) =>
          i === g.index ? { ...n, startBeat: start, durationBeats: end - start } : n,
        ),
      )
      return
    }
    if (g.kind === 'marquee') {
      const x0 = Math.min(x, g.downBeat * ppb)
      const x1 = Math.max(x, g.downBeat * ppb)
      const y0 = Math.min(y, (NOODLE_PITCH_MAX - g.downPitch) * PPR)
      const y1 = Math.max(y, (NOODLE_PITCH_MAX - g.downPitch + 1) * PPR)
      setMarquee({ x0, y0, x1, y1 })
      const b0 = x0 / ppb
      const b1 = x1 / ppb
      const pHi = NOODLE_PITCH_MAX - Math.floor(y0 / PPR)
      const pLo = NOODLE_PITCH_MAX - Math.floor(y1 / PPR)
      const sel = new Set(g.add)
      getTake().notes.forEach((n, i) => {
        if (
          n.startBeat < b1 &&
          n.startBeat + n.durationBeats > b0 &&
          n.pitch >= pLo &&
          n.pitch <= pHi
        ) {
          sel.add(i)
        }
      })
      setSelection(sel)
    }
  }

  const endGesture = () => {
    gesture.current = null
    setMarquee(null)
  }

  // ---- velocity lane ----
  const paintVelocity = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const beat = ((e.clientX - rect.left) / rect.width) * totalBeats
    const velocity = Math.max(1, Math.min(127, Math.round((1 - (e.clientY - rect.top) / rect.height) * 127)))
    const notes = getTake().notes
    // Nearest note start within half a grid cell; selected notes edit together.
    let best = -1
    let bestDist = Math.max(grid, 0.25)
    notes.forEach((n, i) => {
      const d = Math.abs(n.startBeat - beat)
      if (d < bestDist) {
        best = i
        bestDist = d
      }
    })
    if (best < 0) return
    const targets = selection.has(best) ? selection : new Set([best])
    setNotes(notes.map((n, i) => (targets.has(i) ? { ...n, velocity } : n)))
  }

  const onVelPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pushUndo()
    gesture.current = { kind: 'velocity' }
    paintVelocity(e)
  }

  // ---- keyboard (scoped to the focused roll, not a window listener) ----
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'x') {
      if (selection.size > 0) {
        e.preventDefault()
        removeNotes(new Set(selection))
        setSelection(new Set())
      }
    } else if (e.key === 'Escape') {
      setSelection(new Set())
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault()
      undo()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      setSelection(new Set(getTake().notes.map((_, i) => i)))
    }
  }

  // Touchpad-aware zoom: pinch (ctrl+wheel) zooms horizontally around the cursor.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left + el.scrollLeft
      setZoomPpb((prev) => {
        const next = Math.max(MIN_PPB, Math.min(MAX_PPB, prev * Math.exp(-e.deltaY * 0.01)))
        const beatAtCursor = cursorX / prev
        requestAnimationFrame(() => {
          el.scrollLeft = beatAtCursor * next - (e.clientX - rect.left)
        })
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- playhead: engine loop position, or the recorder pass while capturing ----
  const playheadRef = useRef<SVGLineElement>(null)
  const playing = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().playingMotifId === NOODLE_TAKE_ID,
  )
  useEffect(() => {
    let raf = 0
    const step = () => {
      const beats = playing
        ? engine.getPositionBeats()
        : (getRecorderPositionBeats() ?? getMicPositionBeats())
      const line = playheadRef.current
      if (line) {
        if (beats !== null) {
          line.setAttribute('visibility', 'visible')
          line.setAttribute('transform', `translate(${beats * ppb} 0)`)
        } else {
          line.setAttribute('visibility', 'hidden')
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, ppb])

  // ---- static geometry ----
  const rowShades = useMemo(() => {
    const rects: { y: number; cls: string }[] = []
    for (let p = NOODLE_PITCH_MIN; p <= NOODLE_PITCH_MAX; p++) {
      const y = (NOODLE_PITCH_MAX - p) * PPR
      if (lock && !take.drums) {
        if (isInScale(p, take.key, take.mode)) rects.push({ y, cls: 'noodle-row-inscale' })
      } else if (BLACK.has(((p % 12) + 12) % 12)) {
        rects.push({ y, cls: 'noodle-row-black' })
      }
    }
    return rects
  }, [lock, take.drums, take.key, take.mode])

  const gridLines = useMemo(() => {
    const lines: { x: number; cls: string }[] = []
    for (let b = grid; b < totalBeats - 1e-6; b += grid) {
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6
      const isBar = isBeat && Math.round(b) % bpb === 0
      lines.push({
        x: b * ppb,
        cls: isBar ? 'roll-barline' : isBeat ? 'roll-beatline' : 'noodle-subgrid',
      })
    }
    return lines
  }, [grid, totalBeats, bpb, ppb])

  const octaveLabels = useMemo(() => {
    const labels: { y: number; text: string }[] = []
    for (let p = NOODLE_PITCH_MIN; p <= NOODLE_PITCH_MAX; p++) {
      if (p % 12 === 0) {
        labels.push({ y: (NOODLE_PITCH_MAX - p) * PPR, text: pitchName(p) })
      }
    }
    return labels
  }, [])

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the roll is a keyboard-editable surface — Delete/Escape/⌘Z act on the selection
    <div className="noodle-roll-shell" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="noodle-roll lcd" style={{ height }} ref={scrollRef}>
        <div className="noodle-roll-inner" style={{ width, minWidth: '100%' }}>
          <svg
            ref={rollRef}
            role="img"
            aria-label="Noodle take editor"
            width="100%"
            height={rollH}
            className={`noodle-svg tool-${tool}`}
            onPointerDown={onRollPointerDown}
            onPointerMove={onRollPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            {rowShades.map((r) => (
              <rect key={r.y} x={0} y={r.y} width="100%" height={PPR} className={r.cls} />
            ))}
            {octaveLabels.map((l) => (
              <g key={l.y}>
                <line x1={0} x2="100%" y1={l.y + PPR} y2={l.y + PPR} className="noodle-octave" />
                <text x={3} y={l.y + PPR - 2} className="noodle-octave-label">
                  {l.text}
                </text>
              </g>
            ))}
            {gridLines.map((l) => (
              <line key={l.x} x1={l.x} x2={l.x} y1={0} y2={rollH} className={l.cls} />
            ))}
            {take.notes.map((n, i) => {
              const out = !take.drums && !isInScale(n.pitch, take.key, take.mode)
              const cls = [
                'roll-note',
                take.drums ? 'drums' : '',
                out ? 'chromatic' : '',
                selection.has(i) ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <rect
                  key={i}
                  x={n.startBeat * ppb}
                  y={(NOODLE_PITCH_MAX - n.pitch) * PPR + 0.5}
                  width={Math.max(2, n.durationBeats * ppb)}
                  height={PPR - 1}
                  rx={1.5}
                  className={cls}
                  opacity={0.55 + (n.velocity / 127) * 0.45}
                />
              )
            })}
            {marquee && (
              <rect
                x={marquee.x0}
                y={marquee.y0}
                width={marquee.x1 - marquee.x0}
                height={marquee.y1 - marquee.y0}
                className="noodle-marquee"
              />
            )}
            <line
              ref={playheadRef}
              x1={0}
              x2={0}
              y1={0}
              y2={rollH}
              visibility="hidden"
              className="roll-playhead"
            />
          </svg>
          <svg
            role="img"
            aria-label="Velocity lane"
            width="100%"
            height={VEL_H}
            className="noodle-vel"
            onPointerDown={onVelPointerDown}
            onPointerMove={(e) => {
              if (gesture.current?.kind === 'velocity') paintVelocity(e)
            }}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            <line x1={0} x2="100%" y1={0.5} y2={0.5} className="noodle-vel-top" />
            {take.notes.map((n, i) => (
              <rect
                key={i}
                x={n.startBeat * ppb - 1.5}
                y={VEL_H * (1 - n.velocity / 127)}
                width={3}
                height={VEL_H * (n.velocity / 127)}
                className={`noodle-vel-bar${selection.has(i) ? ' selected' : ''}`}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  )
}
