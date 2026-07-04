import { memo, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Tooltip } from '@mantine/core'
import { CircleIcon } from '@phosphor-icons/react'
import { LcdRoll } from '../../LcdRoll'
import { AdvancedPop } from '../AdvancedPop'
import { ClaudePop } from '../ClaudePop'
import { takeBadge, takeName } from '../bayTypes'
import { useBayFlow } from './BayFlowContext'
import type { TakeFlowNode } from './graph'

/** Invisible plumbing so edges have something to attach to. */
const handles = (
  <>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </>
)

/** One take card on the canvas — the old tree NodeCard, verbatim classes. */
export const TakeNode = memo(function TakeNode({ data }: NodeProps<TakeFlowNode>) {
  const { source, mixId, claudeReady, callbacks } = useBayFlow()
  const { part, variation: node, depth, mini, focused, inMix, ghost, advOpen, isDrums, partName, busy } = data

  // Stable object so the memoized LcdRoll skips re-rendering on focus moves.
  const lcdId = inMix ? mixId : `pv:${node.id}`
  const lcdMotif = useMemo(
    () => ({ ...source, id: lcdId, notes: node.notes }),
    [source, lcdId, node.notes],
  )

  const name = takeName(node)
  const badge = takeBadge(node)

  if (mini) {
    return (
      <Tooltip label={`${badge}${inMix ? ' · in mix' : ''}`}>
        <div
          className={`tree-node mini bay-drag-handle${focused ? ' focused' : ''}${inMix ? ' in-mix' : ''}${ghost ? ' ghost' : ''}`}
          onClick={() => callbacks.focusNode(part, node.id)}
        >
          <LcdRoll motif={lcdMotif} height={24} />
          {handles}
        </div>
      </Tooltip>
    )
  }

  const depthCls = `depth-${Math.min(depth, 3)}`
  const lcdHeight = depth === 1 ? 40 : depth === 2 ? 30 : 22

  return (
    <div
      className={`tree-node ${depthCls}${focused ? ' focused' : ''}${inMix ? ' in-mix' : ''}${ghost ? ' ghost' : ''}`}
      onClick={() => callbacks.focusNode(part, node.id)}
    >
      {/* the head doubles as the node's drag handle — interactive chips inside
          carry `nodrag` so pressing them can't start a drag */}
      <div className="node-head bay-drag-handle">
        <Tooltip label="Put this take in the mix — it plays instead of the original (Enter)">
          <button
            type="button"
            className="promote-chip nodrag"
            data-promoted={inMix}
            onClick={(e) => {
              e.stopPropagation()
              callbacks.applySelection(part, node)
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
        <Tooltip label={name}>
          <span className="node-name">{name}</span>
        </Tooltip>
        <span className={`node-badge ${node.provenance.kind}`}>{badge}</span>
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
              callbacks.focusNode(part, node.id)
              callbacks.mutateGa(part, node)
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
            callbacks.focusNode(part, node.id)
            callbacks.runMutation(part, node, brief)
          }}
        />
        <AdvancedPop
          variant="chip"
          opened={advOpen}
          sourceMode={source.mode}
          isDrums={isDrums}
          baseTake={node.notes}
          onToggle={() => callbacks.toggleAdvanced(part, node.id)}
          onClose={callbacks.closeAdvanced}
          onApplyTransform={(t) => callbacks.applyPartTransform(part, node, t)}
        />
      </div>
      {handles}
    </div>
  )
})
