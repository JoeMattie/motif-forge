/**
 * Live technical step lines for in-flight generation batches (batchId → step),
 * shown inside the generation progress bar. A singleton outside React, like
 * the audio engine: reporters mutate freely from async generation code and
 * GenProgress subscribes via useSyncExternalStore.
 */
let steps: Readonly<Record<string, string>> = {}
const listeners = new Set<() => void>()

const emit = () => {
  for (const l of listeners) l()
}

export function reportStep(batchId: string, step: string): void {
  steps = { ...steps, [batchId]: step }
  emit()
}

export function clearStep(batchId: string): void {
  if (!(batchId in steps)) return
  const next = { ...steps }
  delete next[batchId]
  steps = next
  emit()
}

export function subscribeSteps(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSteps(): Readonly<Record<string, string>> {
  return steps
}
