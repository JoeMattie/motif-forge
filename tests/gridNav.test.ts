import { describe, expect, test } from 'vitest'
import { verticalTarget } from '../src/core/gridNav'

// 7 cards, 3 columns:
//   0 1 2
//   3 4 5
//   6
describe('verticalTarget', () => {
  test('down moves one row within bounds', () => {
    expect(verticalTarget(0, 3, 7, 1)).toBe(3)
    expect(verticalTarget(3, 3, 7, 1)).toBe(6)
  })

  test('down overflowing lands on the last card only if it is on a lower row', () => {
    expect(verticalTarget(4, 3, 7, 1)).toBe(6)
    expect(verticalTarget(5, 3, 7, 1)).toBe(6)
  })

  test('down from the last row is a no-op, not a sideways jump', () => {
    expect(verticalTarget(6, 3, 7, 1)).toBeNull()
    // 6 cards, 3 columns: full last row
    expect(verticalTarget(4, 3, 6, 1)).toBeNull()
    expect(verticalTarget(5, 3, 6, 1)).toBeNull()
  })

  test('up moves one row, no-op on the top row', () => {
    expect(verticalTarget(4, 3, 7, -1)).toBe(1)
    expect(verticalTarget(6, 3, 7, -1)).toBe(3)
    expect(verticalTarget(0, 3, 7, -1)).toBeNull()
    expect(verticalTarget(2, 3, 7, -1)).toBeNull()
  })

  test('single row: up and down never move', () => {
    expect(verticalTarget(1, 4, 3, 1)).toBeNull()
    expect(verticalTarget(1, 4, 3, -1)).toBeNull()
  })

  test('single column behaves as a list', () => {
    expect(verticalTarget(0, 1, 3, 1)).toBe(1)
    expect(verticalTarget(2, 1, 3, 1)).toBeNull()
    expect(verticalTarget(2, 1, 3, -1)).toBe(1)
    expect(verticalTarget(0, 1, 3, -1)).toBeNull()
  })

  test('degenerate inputs', () => {
    expect(verticalTarget(0, 3, 0, 1)).toBeNull()
    expect(verticalTarget(-1, 3, 7, 1)).toBeNull()
    expect(verticalTarget(7, 3, 7, 1)).toBeNull()
    expect(verticalTarget(0, 0, 4, 1)).toBe(1) // columns clamped to ≥1
  })
})
