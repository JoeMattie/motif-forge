import { memo, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ActionIcon, Badge, Button, Tooltip } from '@mantine/core'
import { CaretDownIcon, CaretRightIcon, CircleIcon, DiceFiveIcon } from '@phosphor-icons/react'
import { LcdRoll } from '../../LcdRoll'
import { AdvancedPop } from '../AdvancedPop'
import { ClaudePop } from '../ClaudePop'
import { provenanceLabel } from '../bayTypes'
import { useBayFlow } from './BayFlowContext'
import type { OriginFlowNode } from './graph'

const PART_COLOR_CLASSES = ['part-0', 'part-1', 'part-2', 'part-3', 'part-4', 'part-5']

/**
 * The sticky origin cell of the old part rows, now the rank-0 node of each
 * lane: part name + sound dice + collapse caret, the original take's LCD, and
 * the origin-scoped action keys. Collapsed (`mini`) it shows the take that's
 * currently IN THE MIX for this part instead — nothing disappears.
 */
export const OriginNode = memo(function OriginNode({ data }: NodeProps<OriginFlowNode>) {
  const { source, mixId, claudeReady, callbacks } = useBayFlow()
  const {
    part,
    partName,
    instrument,
    isDrums,
    canRollSound,
    mini,
    focused,
    inMix: originInMix,
    advOpen,
    busy,
    selectedTake,
    originNotes,
  } = data

  const swatch = (
    <i
      className={`part-swatch ${isDrums ? 'drums' : PART_COLOR_CLASSES[part % PART_COLOR_CLASSES.length]}`}
    />
  )

  // Collapsed = compact: the origin box shows the take that's currently IN
  // THE MIX for this part. Stable motif objects for the memoized LcdRoll.
  const mixNotes = selectedTake ? selectedTake.notes : originNotes
  const collapsedLcdMotif = useMemo(
    () => ({ ...source, id: mixId, notes: mixNotes }),
    [source, mixId, mixNotes],
  )
  const originLcdMotif = useMemo(
    () => ({
      ...source,
      id: originInMix ? mixId : `origin:${source.id}:${part}`,
      notes: originNotes,
    }),
    [source, originInMix, mixId, part, originNotes],
  )

  return (
    <div
      className={`origin-cell${mini ? ' compact' : ''}${focused ? ' focused' : ''}`}
      onClick={() => callbacks.focusNode(part, null)}
    >
      {/* the head doubles as the node's drag handle — interactive icons inside
          carry `nodrag` so pressing them can't start a drag */}
      <div className="origin-head bay-drag-handle">
        {swatch}
        <span className="origin-name">{partName}</span>
        {canRollSound && (
          <Tooltip label="Roll a random other sound for this part — a new take, straight into the mix (s)">
            <ActionIcon
              size="xs"
              className="sound-dice nodrag"
              aria-label={`Random sound for ${partName}`}
              onClick={(e) => {
                e.stopPropagation()
                callbacks.rollSound(part)
              }}
            >
              <DiceFiveIcon size={10} />
            </ActionIcon>
          </Tooltip>
        )}
        <span className="origin-inst">{instrument}</span>
        <Tooltip
          label={mini ? 'Expand this track' : 'Collapse this track — takes shrink to mini boxes'}
        >
          <ActionIcon
            size="xs"
            className="nodrag"
            aria-label={`${mini ? 'Expand' : 'Collapse'} ${partName}`}
            onClick={(e) => {
              e.stopPropagation()
              callbacks.toggleCollapse(part)
            }}
          >
            {mini ? <CaretRightIcon size={10} /> : <CaretDownIcon size={10} />}
          </ActionIcon>
        </Tooltip>
      </div>
      {mini ? (
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
                  callbacks.applySelection(part, null)
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
                  callbacks.focusNode(part, null)
                  callbacks.mutateGa(part, null)
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
                callbacks.focusNode(part, null)
                callbacks.runMutation(part, null, brief)
              }}
            />
            <AdvancedPop
              variant="button"
              opened={advOpen}
              sourceMode={source.mode}
              isDrums={isDrums}
              baseTake={originNotes}
              onToggle={() => callbacks.toggleAdvanced(part, null)}
              onClose={callbacks.closeAdvanced}
              onApplyTransform={(t) => callbacks.applyPartTransform(part, null, t)}
            />
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})
