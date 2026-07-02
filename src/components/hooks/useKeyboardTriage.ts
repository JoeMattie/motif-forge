import { useEffect } from 'react'
import type { Motif, Rating } from '../../types'
import { engine } from '../../audio/engine'
import { effectiveTempo } from '../../store/appState'
import { useAppDispatch, useAppState } from '../../store/AppContext'

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  )
}

/**
 * Global keyboard triage: arrows navigate, space toggles playback,
 * 1-5 rates (+advance), x discards (+advance), u restores last discard.
 * Selection is app state, not DOM focus.
 */
export function useKeyboardTriage(visibleMotifs: Motif[], columns: number, enabled: boolean): void {
  const state = useAppState()
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (visibleMotifs.length === 0) return

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
        case 'ArrowUp':
          e.preventDefault()
          moveTo(index < 0 ? 0 : index - columns)
          break
        case 'ArrowDown':
          e.preventDefault()
          moveTo(index < 0 ? 0 : index + columns)
          break
        case ' ':
          e.preventDefault()
          if (current) {
            engine.toggle(current, {
              tempo: effectiveTempo(state.transport, current),
              metronome: state.transport.metronome,
              drone: state.transport.drone,
              sound: state.transport.sound,
              forceSound: state.transport.forceSound,
            })
          }
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
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, visibleMotifs, columns, state, dispatch])
}
