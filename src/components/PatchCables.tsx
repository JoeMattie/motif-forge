import { useLayoutEffect, useState } from 'react'

export interface CableEndpoint {
  /** Resolved at measure time (refs aren't populated during the first render). */
  getEl: () => HTMLElement | null
  /** Which edge of the element the jack sits on. */
  edge: 'left' | 'right'
  /** Vertical anchor within the element (0 = top, 0.5 = center). */
  vAlign?: number
}

export interface CableSpec {
  from: CableEndpoint
  to: CableEndpoint
  color: string
  dashed?: boolean
}

interface Point {
  x: number
  y: number
}

interface ResolvedCable {
  from: Point
  to: Point
  color: string
  dashed?: boolean
}

/**
 * SVG patch-cable overlay. Measures REAL DOM positions of the jack elements
 * (getBoundingClientRect relative to the container) — nothing is hardcoded.
 * Remeasures on container resize and whenever `deps` change.
 */
export function PatchCables({
  container,
  cables,
  deps,
}: {
  container: React.RefObject<HTMLElement | null>
  cables: CableSpec[]
  deps: unknown[]
}) {
  const [resolved, setResolved] = useState<ResolvedCable[]>([])

  useLayoutEffect(() => {
    const root = container.current
    if (!root) return

    const measure = () => {
      const base = root.getBoundingClientRect()
      const out: ResolvedCable[] = []
      for (const c of cables) {
        const fromEl = c.from.getEl()
        const toEl = c.to.getEl()
        if (!fromEl || !toEl) continue
        const fr = fromEl.getBoundingClientRect()
        const tr = toEl.getBoundingClientRect()
        const pt = (r: DOMRect, e: CableEndpoint): Point => ({
          x: (e.edge === 'left' ? r.left : r.right) - base.left,
          y: r.top + r.height * (e.vAlign ?? 0.5) - base.top,
        })
        out.push({ from: pt(fr, c.from), to: pt(tr, c.to), color: c.color, dashed: c.dashed })
      }
      setResolved(out)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const path = (c: ResolvedCable) => {
    const dx = Math.max(60, Math.min(110, (c.to.x - c.from.x) * 0.45))
    return `M ${c.from.x} ${c.from.y} C ${c.from.x + dx} ${c.from.y}, ${c.to.x - dx} ${c.to.y}, ${c.to.x} ${c.to.y}`
  }

  return (
    <svg className="patch-cables">
      {/* soft shadow twins first, then the cables, then the jacks */}
      {resolved.map((c, i) =>
        c.dashed ? null : (
          <path
            key={`s${i}`}
            d={path(c)}
            fill="none"
            stroke="#1f1e1a"
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.14}
            transform="translate(0 3)"
          />
        ),
      )}
      {resolved.map((c, i) => (
        <path
          key={`c${i}`}
          d={path(c)}
          fill="none"
          stroke={c.color}
          strokeWidth={3}
          strokeLinecap="round"
          opacity={c.dashed ? 0.45 : 0.92}
          strokeDasharray={c.dashed ? '1 8' : undefined}
        />
      ))}
      {resolved.flatMap((c, i) => [
        <g key={`jf${i}`}>
          <circle cx={c.from.x} cy={c.from.y} r={7} fill="#26251f" />
          <circle cx={c.from.x} cy={c.from.y} r={3} fill={c.color} />
        </g>,
        <g key={`jt${i}`} opacity={c.dashed ? 0.5 : 1}>
          <circle cx={c.to.x} cy={c.to.y} r={c.dashed ? 5.5 : 7} fill="#26251f" />
          {!c.dashed && <circle cx={c.to.x} cy={c.to.y} r={3} fill={c.color} />}
        </g>,
      ])}
    </svg>
  )
}
