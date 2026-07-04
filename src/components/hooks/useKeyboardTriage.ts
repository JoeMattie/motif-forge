import { useEffect, useRef } from 'react'
import { notifications } from '@mantine/notifications'
import type { Motif, Rating } from '../../types'
import { engine } from '../../audio/engine'
import { verticalTarget } from '../../core/gridNav'
import { getTake, loadClip } from '../../noodle/takeStore'
import { effectiveTempo } from '../../store/appState'
import { useAppDispatch, useAppStateGetter } from '../../store/AppContext'

/** N — load the cursor motif into the Noodle roll for hand-editing, asking
 * first when it would clobber a staged take. */
function loadIntoNoodle(m: Motif): void {
  const staged = getTake()
  if (
    staged.notes.length > 0 &&
    !window.confirm(
      `Load “${m.name}” into Noodle? The staged take (${staged.notes.length} note${staged.notes.length === 1 ? '' : 's'}) will be replaced — UNDO brings it back.`,
    )
  ) {
    return
  }
  loadClip(m)
  notifications.show({ message: `“${m.name}” loaded into Noodle`, color: 'forge' })
}

/**
 * Only text-entry controls count as typing targets. Mantine renders many
 * click-targets as hidden checkbox/radio inputs (SegmentedControl, Rating,
 * Chip, Checkbox) which keep focus after a click — those must NOT swallow
 * triage keys. preventDefault below stops their native key behavior, so
 * arrows/space always mean triage while the grid is active.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

export function isTypingTarget(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true
  if (t instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(t.type)
  return t instanceof HTMLElement && t.isContentEditable
}

export interface TriageKeyHandlers {
  /** F — fold/unfold the selected family's tray. Returns the family root's id
   * when the fold OPENED a walkable tray (it has variants), so the cursor can
   * enter the panel immediately; null otherwise. */
  onFold?: (current: Motif) => string | null
  /** M — open the mutation bay for the selected family. */
  onMutate?: (current: Motif) => void
  /** Enter — toggle the cursor motif as its family's face (USE). */
  onPromote?: (current: Motif) => void
  /** The open family tray, if any: down-arrow on its anchor card descends into
   * it, and arrows/space/rate/discard then operate on the tray members. */
  tray?: { anchorId: string; motifs: Motif[] }
}

/**
 * Global keyboard triage: arrows navigate, space toggles playback,
 * 1-5 rates (+advance), x discards (+advance), u restores last discard,
 * f folds out the family tray, m opens the mutation bay,
 * n loads the cursor motif into the Noodle roll,
 * Enter toggles the cursor motif as its family's face (USE).
 * Selection is app state, not DOM focus.
 *
 * The listener is registered ONCE per `enabled` — everything it needs is read
 * at keydown time (props via a latest-ref, app state via the stable getter),
 * so per-keystroke state changes never tear the listener down and re-add it.
 */
export function useKeyboardTriage(
  visibleMotifs: Motif[],
  columns: number,
  enabled: boolean,
  handlers: TriageKeyHandlers = {},
): void {
  const getState = useAppStateGetter()
  const dispatch = useAppDispatch()

  const latest = useRef({ visibleMotifs, columns, handlers })
  useEffect(() => {
    latest.current = { visibleMotifs, columns, handlers }
  })
  // Whether the cursor sits INSIDE the open tray. Needed because the family's
  // face appears both as the grid anchor and as a tray card under the same
  // motif id — this flag decides which of the two the arrows should serve.
  const inTray = useRef(false)

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      // Modals (e.g. ABOUT) trap focus, so their keys land inside the dialog —
      // don't triage behind them. (The bay's Drawer instead disables `enabled`.)
      if (e.target instanceof HTMLElement && e.target.closest('[role="dialog"]')) return
      const { visibleMotifs, columns, handlers } = latest.current
      const { onFold, onMutate, onPromote, tray } = handlers
      const state = getState()
      if (visibleMotifs.length === 0) return

      const playCurrent = (m: Motif) =>
        engine.toggle(m, {
          tempo: effectiveTempo(state.transport, m),
          metronome: state.transport.metronome,
          drone: state.transport.drone,
          sound: state.transport.sound,
          forceSound: state.transport.forceSound,
        })

      // ---- inside the open family tray: arrows walk the mini-cards ----
      const trayIndex = !tray || !state.selectedId
        ? -1
        : state.selectedId !== tray.anchorId
          ? tray.motifs.findIndex((m) => m.id === state.selectedId)
          : inTray.current
            ? tray.motifs.findIndex((m) => m.id === tray.anchorId)
            : -1
      inTray.current = trayIndex >= 0
      if (tray && trayIndex >= 0) {
        const trayCurrent = tray.motifs[trayIndex]
        // the walk includes the member that doubles as the grid anchor (the
        // in-use face) — its tray copy carries the focus bar like any other
        const moveTray = (dir: 1 | -1) => {
          const i = trayIndex + dir
          if (i >= 0 && i < tray.motifs.length) {
            dispatch({ type: 'SELECT', id: tray.motifs[i].id })
          }
        }
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault()
            moveTray(-1)
            break
          case 'ArrowRight':
            e.preventDefault()
            moveTray(1)
            break
          case 'ArrowUp':
          case 'ArrowDown':
            // back up to the anchor card in the grid
            e.preventDefault()
            inTray.current = false
            dispatch({ type: 'SELECT', id: tray.anchorId })
            break
          case ' ':
            e.preventDefault()
            playCurrent(trayCurrent)
            break
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
            dispatch({ type: 'MOTIF_RATED', id: trayCurrent.id, rating: Number(e.key) as Rating })
            moveTray(1)
            break
          case 'x':
            dispatch({ type: 'MOTIF_DISCARDED', id: trayCurrent.id })
            break
          case 'u':
            if (state.lastDiscardedId) dispatch({ type: 'MOTIF_RESTORED', id: state.lastDiscardedId })
            break
          case 'f':
            inTray.current = false
            dispatch({ type: 'SELECT', id: tray.anchorId })
            if (onFold) onFold(trayCurrent)
            break
          case 'm':
            if (onMutate) onMutate(trayCurrent)
            break
          case 'n':
            loadIntoNoodle(trayCurrent)
            break
          case 'Enter':
            // preventDefault so a still-focused button doesn't also re-click
            e.preventDefault()
            if (onPromote) onPromote(trayCurrent)
            break
          default:
            break
        }
        return
      }

      const index = state.selectedId
        ? visibleMotifs.findIndex((m) => m.id === state.selectedId)
        : -1
      const current = index >= 0 ? visibleMotifs[index] : null

      const moveTo = (i: number) => {
        const clamped = Math.max(0, Math.min(visibleMotifs.length - 1, i))
        dispatch({ type: 'SELECT', id: visibleMotifs[clamped].id })
      }
      const advance = () => {
        if (index < visibleMotifs.length - 1) moveTo(index + 1)
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          moveTo(index < 0 ? 0 : index - 1)
          break
        case 'ArrowRight':
          e.preventDefault()
          moveTo(index < 0 ? 0 : index + 1)
          break
        case 'ArrowUp': {
          e.preventDefault()
          if (index < 0) {
            moveTo(0)
            break
          }
          const up = verticalTarget(index, columns, visibleMotifs.length, -1)
          if (up !== null) moveTo(up)
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          // descend into the open tray from its anchor card, onto its FIRST
          // member (the origin) — even when that's the anchor's own copy
          if (tray && current && current.id === tray.anchorId && tray.motifs.length > 1) {
            inTray.current = true
            dispatch({ type: 'SELECT', id: tray.motifs[0].id })
            break
          }
          if (index < 0) {
            moveTo(0)
            break
          }
          const down = verticalTarget(index, columns, visibleMotifs.length, 1)
          if (down !== null) moveTo(down)
          break
        }
        case ' ':
          e.preventDefault()
          if (current) playCurrent(current)
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          if (current) {
            dispatch({ type: 'MOTIF_RATED', id: current.id, rating: Number(e.key) as Rating })
            advance()
          }
          break
        case 'x':
          if (current) {
            dispatch({ type: 'MOTIF_DISCARDED', id: current.id })
            advance()
          }
          break
        case 'u':
          if (state.lastDiscardedId) {
            dispatch({ type: 'MOTIF_RESTORED', id: state.lastDiscardedId })
          }
          break
        case 'f': {
          if (!current || !onFold) break
          // opening a walkable tray moves the cursor inside it right away,
          // onto its first card (the origin)
          const openedRoot = onFold(current)
          if (openedRoot) {
            inTray.current = true
            dispatch({ type: 'SELECT', id: openedRoot })
          }
          break
        }
        case 'm':
          if (current && onMutate) onMutate(current)
          break
        case 'n':
          if (current) loadIntoNoodle(current)
          break
        case 'Enter':
          e.preventDefault()
          if (current && onPromote) onPromote(current)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, getState, dispatch])
}
