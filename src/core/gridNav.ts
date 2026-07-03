/**
 * Vertical arrow-key movement in a row-major grid.
 *
 * Returns the target index, or null for a no-op. Plain clamping is wrong
 * here: on the last partial row, `index + columns` overflows and clamps to
 * the last card — a sideways jump within the same row. Up/down must either
 * land in another row or not move at all.
 */
export function verticalTarget(
  index: number,
  columns: number,
  length: number,
  dir: 1 | -1,
): number | null {
  if (length === 0 || index < 0 || index >= length) return null
  const cols = Math.max(1, columns)
  const target = index + dir * cols
  if (dir === -1) return target < 0 ? null : target
  if (target < length) return target
  // moving down past the end: land on the last card only if it's on a lower row
  const rowOf = (i: number) => Math.floor(i / cols)
  return rowOf(length - 1) > rowOf(index) ? length - 1 : null
}
