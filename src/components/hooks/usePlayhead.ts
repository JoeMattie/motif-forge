import { useEffect, useRef, useSyncExternalStore } from 'react'
import { engine } from '../../audio/engine'

export function useIsPlaying(motifId: string): boolean {
  return useSyncExternalStore(engine.subscribe, () => engine.getSnapshot().playingMotifId === motifId)
}

/** True while this motif's instrument samples are still loading before playback. */
export function useIsLoading(motifId: string): boolean {
  return useSyncExternalStore(engine.subscribe, () => {
    const s = engine.getSnapshot()
    return s.playingMotifId === motifId && s.loading
  })
}

/**
 * Drives an SVG playhead line via a ref while this motif is playing.
 * One rAF loop on the playing card only; no React state per frame.
 */
export function usePlayhead(motifId: string): {
  isPlaying: boolean
  playheadRef: React.RefObject<SVGLineElement>
} {
  const isPlaying = useIsPlaying(motifId)
  const playheadRef = useRef<SVGLineElement>(null)

  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const step = () => {
      const beats = engine.getPositionBeats()
      if (playheadRef.current && beats !== null) {
        playheadRef.current.setAttribute('transform', `translate(${beats} 0)`)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  return { isPlaying, playheadRef }
}
