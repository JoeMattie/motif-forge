import { useEffect } from 'react'
import type { Motif, Rating } from '../../types'
import { engine } from '../../audio/engine'
import { verticalTarget } from '../../core/gridNav'
import { effectiveTempo } from '../../store/appState'
import { recordTriageAction } from '../../store/sessionPace'
import { useAppDispatch, useAppState } from '../../store/AppContext'

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
  /** F — fold/unfold the selected family's tray. */
  onFold?: (current: Motif) => void
  /** M — open the mutation bay for the selected family. */
  onMutate?: (current: Motif) => void
  /** P — promote the cursor motif as its family's face. */
  onPromote?: (current: Motif) => void
  /** The open family tray, if any: down-arrow on its anchor card descends into
   * it, and arrows/space/rate/discard then operate on the tray members. */
  tray?: { anchorId: string; motifs: Motif[] }
}

/**
 * Global keyboard triage: arrows navigate, space toggles playback,
 * 1-5 rates (+advance), x discards (+advance), u restores last discard,
 * f folds out the family tray, m opens the mutation bay.
 * Selection is app state, not DOM focus.
 */
export function useKeyboardTriage(
  visibleMotifs: Motif[],
  columns: number,
  enabled: boolean,
  handlers: TriageKeyHandlers = {},
): void {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const { onFold, onMutate, onPromote, tray } = handlers

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
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
      const trayIndex =
        tray && state.selectedId && state.selectedId !== tray.anchorId
          ? tray.motifs.findIndex((m) => m.id === state.selectedId)
          : -1
      if (tray && trayIndex >= 0) {
        const trayCurrent = tray.motifs[trayIndex]
        // step over the member that doubles as the grid anchor (promoted face)
        const moveTray = (dir: 1 | -1) => {
          let i = trayIndex + dir
          if (tray.motifs[i]?.id === tray.anchorId) i += dir
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
            recordTriageAction()
            moveTray(1)
            break
          case 'x':
            dispatch({ type: 'MOTIF_DISCARDED', id: trayCurrent.id })
            recordTriageAction()
            break
          case 'u':
            if (state.lastDiscardedId) dispatch({ type: 'MOTIF_RESTORED', id: state.lastDiscardedId })
            break
          case 'f':
            dispatch({ type: 'SELECT', id: tray.anchorId })
            if (onFold) onFold(trayCurrent)
            break
          case 'm':
            if (onMutate) onMutate(trayCurrent)
            break
          case 'p':
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
          // descend into the open tray from its anchor card
          if (tray && current && current.id === tray.anchorId) {
            const first = tray.motifs.find((m) => m.id !== tray.anchorId)
            if (first) {
              dispatch({ type: 'SELECT', id: first.id })
              break
            }
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
            recordTriageAction()
            advance()
          }
          break
        case 'x':
          if (current) {
            dispatch({ type: 'MOTIF_DISCARDED', id: current.id })
            recordTriageAction()
            advance()
          }
          break
        case 'u':
          if (state.lastDiscardedId) {
            dispatch({ type: 'MOTIF_RESTORED', id: state.lastDiscardedId })
          }
          break
        case 'f':
          if (current && onFold) onFold(current)
          break
        case 'm':
          if (current && onMutate) onMutate(current)
          break
        case 'p':
          if (current && onPromote) onPromote(current)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, visibleMotifs, columns, state, dispatch, onFold, onMutate, onPromote, tray])
}
