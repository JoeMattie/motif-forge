import { describe, expect, test } from 'vitest'
import type { PartVariation } from '../src/types'
import type { PartTreeNode } from '../src/core/workbench'
import {
  LANE_GAP,
  ORIGIN_MINI_SIZE,
  ORIGIN_SIZE,
  PENDING_SIZE,
  RANKSEP,
  TAKE_MINI_SIZE,
  layoutBay,
  originNodeId,
  pendingNodeId,
  takeSize,
} from '../src/components/bay/flow/layout'
import { makeNote } from './fixtures'

function makeVariation(partial: Partial<PartVariation> & Pick<PartVariation, 'id'>): PartVariation {
  return {
    sourceMotifId: 'src',
    partIndex: 0,
    parentNodeId: null,
    notes: [makeNote({ pitch: 62, startBeat: 0, part: 0 })],
    provenance: { kind: 'llm', brief: 'test' },
    selected: false,
    hidden: false,
    createdAt: 1,
    ...partial,
  }
}

const node = (id: string, children: PartTreeNode[] = [], hidden = false): PartTreeNode => ({
  variation: makeVariation({ id, hidden }),
  children,
})

const defaults = { showHidden: false, collapsedParts: new Set<number>(), pending: [] }

describe('layoutBay', () => {
  test('origin sits at rank 0 / x=0 and children advance one rank per generation', () => {
    const trees = [[node('a', [node('a1')])]]
    const { positions } = layoutBay({ ...defaults, trees })

    const origin = positions.get(originNodeId(0))!
    const a = positions.get('a')!
    const a1 = positions.get('a1')!
    expect(origin.x).toBe(0)
    expect(origin.w).toBe(ORIGIN_SIZE.w)
    expect(a.x).toBe(ORIGIN_SIZE.w + RANKSEP)
    expect(a.w).toBe(takeSize(1, false).w)
    expect(a1.x).toBe(a.x + a.w + RANKSEP)
    expect(a1.w).toBe(takeSize(2, false).w)
  })

  test('lanes stack vertically with LANE_GAP between them and report laneBottoms', () => {
    const trees = [[node('a')], [node('b')]]
    const { positions, laneBottoms } = layoutBay({ ...defaults, trees })

    const lane0Bottom = Math.max(
      positions.get(originNodeId(0))!.y + positions.get(originNodeId(0))!.h,
      positions.get('a')!.y + positions.get('a')!.h,
    )
    expect(laneBottoms[0]).toBe(lane0Bottom)

    const origin1 = positions.get(originNodeId(1))!
    const b = positions.get('b')!
    expect(Math.min(origin1.y, b.y)).toBe(lane0Bottom + LANE_GAP)
    expect(laneBottoms).toHaveLength(2)
    expect(laneBottoms[1]).toBeGreaterThan(laneBottoms[0])
  })

  test('a hidden node prunes its whole subtree unless showHidden', () => {
    const trees = [[node('a', [node('a1')]), node('b', [node('b1')], true)]]

    const closed = layoutBay({ ...defaults, trees })
    expect(closed.positions.has('a')).toBe(true)
    expect(closed.positions.has('a1')).toBe(true)
    expect(closed.positions.has('b')).toBe(false)
    expect(closed.positions.has('b1')).toBe(false)

    const open = layoutBay({ ...defaults, trees, showHidden: true })
    expect(open.positions.has('b')).toBe(true)
    expect(open.positions.has('b1')).toBe(true)
  })

  test('a collapsed part uses mini sizes for its whole lane', () => {
    const trees = [[node('a', [node('a1')])]]
    const { positions } = layoutBay({ ...defaults, trees, collapsedParts: new Set([0]) })

    expect(positions.get(originNodeId(0))!.w).toBe(ORIGIN_MINI_SIZE.w)
    expect(positions.get('a')!.w).toBe(TAKE_MINI_SIZE.w)
    expect(positions.get('a')!.h).toBe(TAKE_MINI_SIZE.h)
    expect(positions.get('a1')!.w).toBe(TAKE_MINI_SIZE.w)
  })

  test('pending placeholders land under their parent node, or the origin', () => {
    const trees = [[node('a')]]
    const pending = [
      { key: 'k1', part: 0, parentNodeId: 'a' },
      { key: 'k2', part: 0, parentNodeId: null },
      { key: 'k3', part: 0, parentNodeId: 'gone' }, // vanished parent → origin
    ]
    const { positions } = layoutBay({ ...defaults, trees, pending })

    const a = positions.get('a')!
    const p1 = positions.get(pendingNodeId('k1'))!
    const p2 = positions.get(pendingNodeId('k2'))!
    const p3 = positions.get(pendingNodeId('k3'))!
    expect(p1.w).toBe(PENDING_SIZE.w)
    // under `a` = one rank right of it; under origin = rank 1 alongside `a`
    expect(p1.x).toBeGreaterThan(a.x)
    expect(p2.x).toBe(a.x)
    expect(p3.x).toBe(a.x)
  })

  test('pending placeholders only ever join their own part lane', () => {
    const trees = [[node('a')], []]
    const pending = [{ key: 'k', part: 1, parentNodeId: null }]
    const { positions, laneBottoms } = layoutBay({ ...defaults, trees, pending })

    const p = positions.get(pendingNodeId('k'))!
    expect(p.y).toBeGreaterThanOrEqual(laneBottoms[0] + LANE_GAP)
  })
})
