import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { PendingFlowNode } from './graph'

/** Dashed pulsing placeholder for an in-flight Claude take. */
export const PendingNode = memo(function PendingNode({ data }: NodeProps<PendingFlowNode>) {
  return (
    <div className={`tree-node pending${data.mini ? ' mini' : ''}`}>
      {data.mini ? '…' : 'Claude take inbound…'}
      <Handle type="target" position={Position.Left} isConnectable={false} />
    </div>
  )
})
