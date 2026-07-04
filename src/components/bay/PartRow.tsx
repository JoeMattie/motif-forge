import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Group, Popover, Textarea, Tooltip } from '@mantine/core'
import { CaretDownIcon, CaretRightIcon, CircleIcon, DiceFiveIcon } from '@phosphor-icons/react'
import type { Motif, Note, PartVariation } from '../../types'
import type { PartTreeNode } from '../../core/workbench'
import type { Transform } from '../../core/transforms'
import { LcdRoll } from '../LcdRoll'
import { AdvancedPop } from './AdvancedPop'

/** Keyboard cursor in the bay: a part row + a node in its tree (null = the origin cell). */
export interface BayFocus {
  part: number
  nodeId: string | null
}

const PART_COLOR_CLASSES = ['part-0', 'part-1', 'part-2', 'part-3', 'part-4', 'part-5']

export function provenanceLabel(v: PartVariation): string {
  if (v.provenance.kind === 'sound') return v.provenance.instrument.toUpperCase()
  if (v.provenance.kind === 'transform') {
    return v.provenance.transform
      .replace('retrograde-inversion', 'R-INV')
      .replace('retrograde', 'RETRO')
      .replace('inversion', 'INVERT')
      .replace('mode swap → ', 'MODE ')
      .toUpperCase()
      .slice(0, 16)
  }
  return v.provenance.kind === 'ga' ? 'EVO' : 'VAR'
}

interface RowCallbacks {
  onFocus: (nodeId: string | null) => void
  /** Select a node into the mix (null = revert this part to the original). */
  onSelect: (node: PartVariation | null) => void
  /** Instant GA mutate from a node (null = from the origin). */
  onMutate: (node: PartVariation | null) => void
  /** Targeted Claude rewrite of this part from a node, with the user's brief. */
  onClaude: (node: PartVariation | null, brief: string) => void
  /** Deterministic transform of a take from the ADV dropdown (null = the origin). */
  onTransform: (node: PartVariation | null, t: Transform) => void
  /** Toggle the ADV dropdown on a take (null = the origin cell). */
  onToggleAdvanced: (nodeId: string | null) => void
  onCloseAdvanced: () => void
  /** Dice: a new take of this part on a random other sound, straight into the mix. */
  onSoundRoll: () => void
}

/**
 * The CLAUDE key: pops a small text box asking for a targeted change, then
 * runs an LLM take on this part only. Grayed out without an API key. The
 * popover stays open after Run so it can be fired again with a tweaked brief;
 * `busy` blocks overlapping runs (one take per click).
 */
function ClaudePop({
  variant,
  ready,
  busy,
  partName,
  onRun,
}: {
  variant: 'chip' | 'button'
  ready: boolean
  busy: boolean
  partName: string
  onRun: (brief: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const run = () => {
    const b = brief.trim()
    if (!b || busy) return
    onRun(b)
  }
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen((o) => !o)
  }
  const tip = ready
    ? `Ask Claude for a targeted change to the ${partName} part — every other part locked`
    : 'Needs your Anthropic API key — set it under KEY in the header'
  return (
    <Popover opened={open} onChange={setOpen} width={280} position="bottom-end" trapFocus>
      <Popover.Target>
        {/* wrapper spans so the tooltip still hovers when the key is disabled */}
        <span className="chip-tip-wrap">
          <Tooltip label={tip}>
            <span className="chip-tip-wrap">
              {variant === 'button' ? (
                <Button size="compact-xs" className="green" disabled={!ready} data-latched={open} onClick={toggle}>
                  Claude
                </Button>
              ) : (
                <button type="button" className="promote-chip" disabled={!ready} onClick={toggle}>
                  Claude
                </button>
              )}
            </span>
          </Tooltip>
        </span>
      </Popover.Target>
      <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
        <Textarea
          rows={2}
          data-autofocus
          placeholder="targeted change — e.g. more syncopation, land phrase ends on the 5th"
          value={brief}
          onChange={(e) => setBrief(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              run()
            }
          }}
        />
        <Group justify="flex-end" mt={6}>
          <Button className="accent" disabled={!brief.trim() || busy} onClick={run}>
            {busy ? 'Running…' : 'Run'}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}

function NodeCard({
  source,
  node,
  lcdId,
  isFocused,
  inMix,
  ghost,
  isDrums,
  partName,
  claudeReady,
  busy,
  advOpen,
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
  partName: string
  claudeReady: boolean
  /** A Claude run is in flight on this row — blocks overlapping runs. */
  busy: boolean
  /** This node's ADV dropdown is open (controlled by the bay). */
  advOpen: boolean
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
                In mix <CircleIcon size={6} />
              </>
            ) : (
              'Use'
            )}
          </button>
        </Tooltip>
        {(node.provenance.kind === 'transform' || node.provenance.kind === 'sound') && (
          <span className={`node-badge ${node.provenance.kind}`}>{badge}</span>
        )}
      </div>
      <LcdRoll motif={lcdMotif} height={lcdHeight} />
      <div className="node-foot">
        <Tooltip
          label={`Evolve one instant take branching from THIS take — a small ${isDrums ? 'rhythm' : 'in-scale'} edit (m)`}
        >
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
        <ClaudePop
          variant="chip"
          ready={claudeReady}
          busy={busy}
          partName={partName}
          onRun={(brief) => {
            callbacks.onFocus(node.id)
            callbacks.onClaude(node, brief)
          }}
        />
        <AdvancedPop
          variant="chip"
          opened={advOpen}
          sourceMode={source.mode}
          isDrums={isDrums}
          baseTake={node.notes}
          onToggle={() => callbacks.onToggleAdvanced(node.id)}
          onClose={callbacks.onCloseAdvanced}
          onApplyTransform={(t) => callbacks.onTransform(node, t)}
        />
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
  partName,
  claudeReady,
  busy,
  advancedNodeId,
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
  partName: string
  claudeReady: boolean
  busy: boolean
  /** Take whose ADV dropdown is open: undefined = none, null = the origin. */
  advancedNodeId: string | null | undefined
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
              partName={partName}
              claudeReady={claudeReady}
              busy={busy}
              advOpen={advancedNodeId === v.id}
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
              partName={partName}
              claudeReady={claudeReady}
              busy={busy}
              advancedNodeId={advancedNodeId}
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
            {mini ? '…' : 'Claude take inbound…'}
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
  canRollSound,
  advancedNodeId,
  claudeReady,
  busy,
  callbacks,
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
  /** Whether the sound dice applies — false for drum parts and partless motifs. */
  canRollSound: boolean
  /** Take whose ADV dropdown is open: undefined = none, null = the origin. */
  advancedNodeId: string | null | undefined
  /** Whether Claude-powered keys are usable (API key present or dev proxy). */
  claudeReady: boolean
  /** A Claude run is in flight on this row — blocks overlapping runs. */
  busy: boolean
  callbacks: RowCallbacks
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
      <div className="part-row-scroll">
        <div
          ref={originRef}
          className={`origin-cell${collapsed ? ' compact' : ''}${originFocused ? ' focused' : ''}`}
          onClick={() => callbacks.onFocus(null)}
        >
          <div className="origin-head">
            {swatch}
            <span className="origin-name">{partName}</span>
            {canRollSound && (
              <Tooltip label="Roll a random other sound for this part — a new take, straight into the mix (s)">
                <ActionIcon
                  size="xs"
                  className="sound-dice"
                  aria-label={`Random sound for ${partName}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    callbacks.onSoundRoll()
                  }}
                >
                  <DiceFiveIcon size={10} />
                </ActionIcon>
              </Tooltip>
            )}
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
                  <CaretRightIcon size={10} />
                ) : (
                  <CaretDownIcon size={10} />
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
                        In mix <CircleIcon size={6} />
                      </>
                    ) : (
                      'Use'
                    )}
                  </button>
                </Tooltip>
                <span className="spacer" />
                <Tooltip
                  label={`Evolve one instant take of this part — a small ${isDrums ? 'rhythm' : 'in-scale'} edit, fully offline (m)`}
                >
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
                <ClaudePop
                  variant="button"
                  ready={claudeReady}
                  busy={busy}
                  partName={partName}
                  onRun={(brief) => {
                    callbacks.onFocus(null)
                    callbacks.onClaude(null, brief)
                  }}
                />
                <AdvancedPop
                  variant="button"
                  opened={advancedNodeId === null}
                  sourceMode={source.mode}
                  isDrums={isDrums}
                  baseTake={originNotes}
                  onToggle={() => callbacks.onToggleAdvanced(null)}
                  onClose={callbacks.onCloseAdvanced}
                  onApplyTransform={(t) => callbacks.onTransform(null, t)}
                />
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
          partName={partName}
          claudeReady={claudeReady}
          busy={busy}
          advancedNodeId={advancedNodeId}
          mini={collapsed}
          depth={1}
          callbacks={callbacks}
        />
      </div>
    </div>
  )
}
