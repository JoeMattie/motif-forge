import { createContext, useContext } from 'react'
import type { Motif, PartVariation } from '../../../types'
import type { Transform } from '../../../core/transforms'

/**
 * Callbacks the bay hands to the canvas's node components. They live in
 * context — NOT in node data — so memoized nodes only re-render when their
 * own plain facts change. The bay keeps the object identity stable across
 * renders (latest-ref pattern), so context consumers don't churn either.
 */
export interface BayFlowCallbacks {
  /** Pointer focus: click on a card (never pans the viewport). */
  focusNode: (part: number, nodeId: string | null) => void
  /** Select a take into the mix (null = revert this part to the original). */
  applySelection: (part: number, node: PartVariation | null) => void
  /** Instant GA mutate from a take (null = from the origin). */
  mutateGa: (part: number, node: PartVariation | null) => void
  /** Targeted Claude rewrite of this part from a take, with the user's brief. */
  runMutation: (part: number, node: PartVariation | null, brief: string) => void
  /** Deterministic transform of a take from the ADV dropdown (null = the origin). */
  applyPartTransform: (part: number, node: PartVariation | null, t: Transform) => void
  /** Dice: a new take of this part on a random other sound, straight into the mix. */
  rollSound: (part: number) => void
  /** Toggle the ADV dropdown on a take (null = the origin cell). */
  toggleAdvanced: (part: number, nodeId: string | null) => void
  closeAdvanced: () => void
  toggleCollapse: (part: number) => void
}

export interface BayFlowContextValue {
  source: Motif
  mixId: string
  /** Whether Claude-powered keys are usable (API key present or dev proxy). */
  claudeReady: boolean
  callbacks: BayFlowCallbacks
}

const BayFlowContext = createContext<BayFlowContextValue | null>(null)

export const BayFlowProvider = BayFlowContext.Provider

export function useBayFlow(): BayFlowContextValue {
  const value = useContext(BayFlowContext)
  if (!value) throw new Error('useBayFlow must be used under BayFlowProvider')
  return value
}
