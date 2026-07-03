import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { ActionIcon, Badge, Button, Tooltip } from '@mantine/core'
import { CaretDownIcon, CaretRightIcon, CircleIcon } from '@phosphor-icons/react'
import type { Motif, Note, PartVariation } from '../../types'
import type { PartTreeNode } from '../../core/workbench'
import { LcdRoll } from '../LcdRoll'

/** Keyboard cursor in the bay: a part row + a node in its tree (null = the origin cell). */
export interface BayFocus {
  part: number
  nodeId: string | null
}

const PART_COLOR_CLASSES = ['part-0', 'part-1', 'part-2', 'part-3', 'part-4', 'part-5']

export function provenanceLabel(v: PartVariation): string {
  if (v.provenance.kind === 'transform') {
    return v.provenance.transform
      .replace('retrograde-inversion', 'R-INV')
      .replace('retrograde', 'RETRO')
      .replace('inversion', 'INVERT')
      .replace('mode swap → ', 'MODE ')
      .toUpperCase()
      .slice(0, 16)
  }
  return 'VAR'
}

interface RowCallbacks {
  onFocus: (nodeId: string | null) => void
  /** Select a node into the mix (null = revert this part to the original). */
  onSelect: (node: PartVariation | null) => void
  /** One-click LLM mutate from a node (null = from the origin). */
  onMutate: (node: PartVariation | null) => void
}

function NodeCard({
  source,
  node,
  lcdId,
  isFocused,
  inMix,
  ghost,
  isDrums,
  mini,
  depth,
  callbacks,
}: {
  source: Motif
  node: PartVariation
  lcdId: string
  isFocused: boolean
  inMix: boolean
  ghost: boolean
  isDrums: boolean
  /** Collapsed row: tiny box with just the mini roll. */
  mini: boolean
  /** Generation: 1 = mutation of the origin. Each generation renders smaller. */
  depth: number
  callbacks: RowCallbacks
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isFocused) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [isFocused])

  // Stable object so the memoized LcdRoll skips re-rendering on focus moves.
  const lcdMotif = useMemo(
    () => ({ ...source, id: lcdId, notes: node.notes }),
    [source, lcdId, node.notes],
  )

  const badge = provenanceLabel(node)
  const badgeCls =
    node.provenance.kind === 'transform' ? 'transform' : isDrums ? 'var-drums' : 'var'

  if (mini) {
    return (
      <Tooltip label={`${badge}${inMix ? ' · in mix' : ''}`}>
        <div
          ref={ref}
          className={`tree-node mini${isFocused ? ' focused' : ''}${inMix ? ' in-mix' : ''}${ghost ? ' ghost' : ''}`}
          onClick={() => callbacks.onFocus(node.id)}
        >
          <LcdRoll motif={lcdMotif} height={24} />
        </div>
      </Tooltip>
    )
  }

  const depthCls = `depth-${Math.min(depth, 3)}`
  const lcdHeight = depth === 1 ? 40 : depth === 2 ? 30 : 22

  return (
    <div
      ref={ref}
      className={`tree-node ${depthCls}${isFocused ? ' focused' : ''}${inMix ? ' in-mix' : ''}${ghost ? ' ghost' : ''}`}
      onClick={() => callbacks.onFocus(node.id)}
    >
      <div className="node-head">
        <span className={`node-badge ${badgeCls}`}>{badge}</span>
        {inMix && <CircleIcon size={7} weight="fill" color="var(--accent)" />}
      </div>
      <LcdRoll motif={lcdMotif} height={lcdHeight} />
      <div className="node-foot">
        <Tooltip label="Put this take in the mix — it plays instead of the original (Enter)">
          <button
            type="button"
            className="promote-chip"
            data-promoted={inMix}
            onClick={(e) => {
              e.stopPropagation()
              callbacks.onSelect(node)
            }}
          >
            {inMix ? (
              <>
                In mix <CircleIcon size={6} weight="fill" />
              </>
            ) : (
              'Use'
            )}
          </button>
        </Tooltip>
        <span className="spacer" />
        <Tooltip label="Generate 5 LLM takes branching from THIS take (m)">
          <button
            type="button"
            className="promote-chip"
            onClick={(e) => {
              e.stopPropagation()
              callbacks.onFocus(node.id)
              callbacks.onMutate(node)
            }}
          >
            Mutate
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

function TreeColumn({
  source,
  nodes,
  parentId,
  selectedId,
  focus,
  showHidden,
  pendingParents,
  mixId,
  isDrums,
  mini,
  depth,
  callbacks,
}: {
  source: Motif
  nodes: PartTreeNode[]
  parentId: string | null
  selectedId: string | null
  focus: BayFocus | null
  showHidden: boolean
  pendingParents: (string | null)[]
  mixId: string
  isDrums: boolean
  mini: boolean
  depth: number
  callbacks: RowCallbacks
}) {
  const visible = nodes.filter((n) => showHidden || !n.variation.hidden)
  const pendingHere = pendingParents.filter((p) => p === parentId).length
  if (visible.length === 0 && pendingHere === 0) return null
  return (
    <div className="tree-children">
      {visible.map((n) => {
        const v = n.variation
        const inMix = v.id === selectedId
        return (
          <div className="tree-node-wrap" key={v.id}>
            <NodeCard
              source={source}
              node={v}
              lcdId={inMix ? mixId : `pv:${v.id}`}
              isFocused={focus?.nodeId === v.id}
              inMix={inMix}
              ghost={v.hidden}
              isDrums={isDrums}
              mini={mini}
              depth={depth}
              callbacks={callbacks}
            />
            <TreeColumn
              source={source}
              nodes={n.children}
              parentId={v.id}
              selectedId={selectedId}
              focus={focus}
              showHidden={showHidden}
              pendingParents={pendingParents}
              mixId={mixId}
              isDrums={isDrums}
              mini={mini}
              depth={depth + 1}
              callbacks={callbacks}
            />
          </div>
        )
      })}
      {Array.from({ length: pendingHere }, (_, i) => (
        <div className="tree-node-wrap" key={`pending-${i}`}>
          <div className={`tree-node pending${mini ? ' mini' : ''}`}>
            {mini ? '5…' : '5 takes inbound…'}
          </div>
        </div>
      ))}
    </div>
  )
}

export function PartRow({
  source,
  partIndex,
  partName,
  instrument,
  isDrums,
  roots,
  originNotes,
  selectedId,
  selectedTake,
  focus,
  showHidden,
  pendingParents,
  mixId,
  collapsed,
  onToggleCollapse,
  advancedOpen,
  onToggleAdvanced,
  callbacks,
  children,
}: {
  source: Motif
  partIndex: number
  partName: string
  instrument: string
  isDrums: boolean
  roots: PartTreeNode[]
  originNotes: Note[]
  /** The selected variation for this part, or null (= the original plays). */
  selectedId: string | null
  selectedTake: PartVariation | null
  /** Bay focus when it's on this row, else null. */
  focus: BayFocus | null
  showHidden: boolean
  /** parentNodeId of each in-flight mutation batch on this row (null = from origin). */
  pendingParents: (string | null)[]
  mixId: string
  /** Collapsed = a slim strip; the LCD and tree are hidden. */
  collapsed: boolean
  onToggleCollapse: () => void
  advancedOpen: boolean
  onToggleAdvanced: () => void
  callbacks: RowCallbacks
  /** The advanced panel, rendered full-width above the row when open. */
  children?: ReactNode
}) {
  const originFocused = focus !== null && focus.nodeId === null
  const originInMix = selectedId === null
  const originRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (originFocused) originRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [originFocused])

  const swatch = (
    <i
      className={`part-swatch ${isDrums ? 'drums' : PART_COLOR_CLASSES[partIndex % PART_COLOR_CLASSES.length]}`}
    />
  )

  // Collapsed = compact: the origin box shows the take that's currently IN
  // THE MIX for this part, and the children shrink to tiny boxes that keep
  // their miniature rolls. Nothing disappears; everything stays navigable.
  const mixNotes = selectedTake ? selectedTake.notes : originNotes
  // Stable motif objects for the memoized LcdRoll (focus moves re-render the
  // row; the rolls themselves shouldn't rebuild).
  const collapsedLcdMotif = useMemo(
    () => ({ ...source, id: mixId, notes: mixNotes }),
    [source, mixId, mixNotes],
  )
  const originLcdMotif = useMemo(
    () => ({
      ...source,
      id: originInMix ? mixId : `origin:${source.id}:${partIndex}`,
      notes: originNotes,
    }),
    [source, originInMix, mixId, partIndex, originNotes],
  )

  return (
    <div className={`module part-row${collapsed ? ' compact' : ''}`}>
      {children}
      <div className="part-row-scroll">
        <div
          ref={originRef}
          className={`origin-cell${collapsed ? ' compact' : ''}${originFocused ? ' focused' : ''}`}
          onClick={() => callbacks.onFocus(null)}
        >
          <div className="origin-head">
            {swatch}
            <span className="origin-name">{partName}</span>
            <span className="origin-inst">{instrument}</span>
            <Tooltip
              label={collapsed ? 'Expand this track' : 'Collapse this track — takes shrink to mini boxes'}
            >
              <ActionIcon
                size="xs"
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${partName}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleCollapse()
                }}
              >
                {collapsed ? (
                  <CaretRightIcon size={10} weight="bold" />
                ) : (
                  <CaretDownIcon size={10} weight="bold" />
                )}
              </ActionIcon>
            </Tooltip>
          </div>
          {collapsed ? (
            <>
              {/* the currently selected version — what the mix plays for this part */}
              <LcdRoll motif={collapsedLcdMotif} height={28} />
              <Badge
                size="sm"
                radius="sm"
                variant="outline"
                className={`mix-chip${selectedTake ? ' swapped' : ''}${isDrums ? ' drums' : ''}`}
              >
                {selectedTake ? provenanceLabel(selectedTake) : 'original'}
              </Badge>
            </>
          ) : (
            <>
              <LcdRoll motif={originLcdMotif} height={52} />
              <div className="node-foot">
                <Tooltip label="Play the original — clears this part's selected take (Enter)">
                  <button
                    type="button"
                    className="promote-chip"
                    data-promoted={originInMix}
                    onClick={(e) => {
                      e.stopPropagation()
                      callbacks.onSelect(null)
                    }}
                  >
                    {originInMix ? (
                      <>
                        In mix <CircleIcon size={6} weight="fill" />
                      </>
                    ) : (
                      'Use'
                    )}
                  </button>
                </Tooltip>
                <span className="spacer" />
                <Tooltip label="Generate 5 LLM takes on this part only — every other part is locked (m)">
                  <Button
                    className="accent"
                    size="compact-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      callbacks.onFocus(null)
                      callbacks.onMutate(null)
                    }}
                  >
                    Mutate
                  </Button>
                </Tooltip>
                <Tooltip label="Deterministic transforms + a custom mutation brief for this part (a)">
                  <Button
                    size="compact-xs"
                    data-latched={advancedOpen}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleAdvanced()
                    }}
                  >
                    Adv
                  </Button>
                </Tooltip>
              </div>
            </>
          )}
        </div>
        <TreeColumn
          source={source}
          nodes={roots}
          parentId={null}
          selectedId={selectedId}
          focus={focus}
          showHidden={showHidden}
          pendingParents={pendingParents}
          mixId={mixId}
          isDrums={isDrums}
          mini={collapsed}
          depth={1}
          callbacks={callbacks}
        />
      </div>
    </div>
  )
}
