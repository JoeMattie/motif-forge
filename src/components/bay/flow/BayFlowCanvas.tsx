import '@xyflow/react/dist/style.css'
import { useEffect, type RefObject } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type BuiltInEdge,
  type NodeTypes,
} from '@xyflow/react'
import type { NodeRect } from './layout'
import type { BayFlowNode } from './graph'
import { OriginNode } from './OriginNode'
import { PendingNode } from './PendingNode'
import { TakeNode } from './TakeNode'

// v12 requires a stable nodeTypes reference — module scope, never inline.
const nodeTypes: NodeTypes = { origin: OriginNode, take: TakeNode, pending: PendingNode }

/** Screen-space margin a keyboard-focused card keeps from the canvas edges. */
const FOLLOW_PAD = 24

interface CanvasProps {
  nodes: BayFlowNode[]
  edges: BuiltInEdge[]
  /** Identity of the focused node — the follow-pan trigger. */
  focusKey: string
  /** Flow-space rect of the focused node (null when it has no layout slot). */
  focusRect: NodeRect | null
  /** What moved the focus last; only keyboard moves pan the viewport. */
  focusSource: RefObject<'keyboard' | 'pointer'>
  /** Pan/zoom start — the bay closes its ADV dropdown so it can't drift off its anchor. */
  onMoveStart: () => void
}

/** Minimal translation along one axis that brings [pos, pos+size] inside
 * [pad, span-pad] — nearest-edge semantics like scrollIntoView block:'nearest'.
 * Oversized content pins its leading edge instead of oscillating. */
function nearestEdgeDelta(pos: number, size: number, span: number): number {
  if (size + 2 * FOLLOW_PAD >= span) return FOLLOW_PAD - pos
  if (pos < FOLLOW_PAD) return FOLLOW_PAD - pos
  if (pos + size > span - FOLLOW_PAD) return span - FOLLOW_PAD - (pos + size)
  return 0
}

function CanvasInner({ nodes, edges, focusKey, focusRect, focusSource, onMoveStart }: CanvasProps) {
  const flow = useReactFlow()
  const store = useStoreApi()

  // Focus follow (replaces the DOM tree's scrollIntoView): after a KEYBOARD
  // focus move, pan the viewport by the minimal translation that brings the
  // focused card fully into view, at the current zoom, within the ≤180ms
  // no-springy-motion budget. Pointer focus never pans.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusKey is the trigger; the rect and refs are read fresh when it fires
  useEffect(() => {
    if (!focusRect || focusSource.current !== 'keyboard') return
    const { width, height } = store.getState()
    const { x, y, zoom } = flow.getViewport()
    if (width === 0 || height === 0) {
      // canvas not measured yet — fall back to centering the node
      void flow.setCenter(focusRect.x + focusRect.w / 2, focusRect.y + focusRect.h / 2, {
        zoom,
        duration: 150,
      })
      return
    }
    const dx = nearestEdgeDelta(focusRect.x * zoom + x, focusRect.w * zoom, width)
    const dy = nearestEdgeDelta(focusRect.y * zoom + y, focusRect.h * zoom, height)
    if (dx !== 0 || dy !== 0) {
      void flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 150 })
    }
  }, [focusKey])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      disableKeyboardA11y
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      // Space stays "loop mix" — never a pan modifier
      panActivationKeyCode={null}
      panOnScroll
      panOnDrag
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      preventScrolling
      minZoom={0.4}
      maxZoom={1.5}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      onMoveStart={onMoveStart}
      // onlyRenderVisibleElements stays OFF: virtualization would unmount
      // open CLAUDE/ADV popovers mid-edit. It's the perf lever if trees grow.
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  )
}

/** The bay's shared pan/zoom patch-panel canvas — all part lanes on one flow. */
export function BayFlowCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
