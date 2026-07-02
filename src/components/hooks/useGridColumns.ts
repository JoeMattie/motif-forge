import { useEffect, useRef, useState } from 'react'

/** Number of columns in a CSS grid, tracked via ResizeObserver. */
export function useGridColumns(): {
  gridRef: React.RefObject<HTMLDivElement>
  columns: number
} {
  const gridRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      setColumns(Math.max(1, cols))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { gridRef, columns }
}
