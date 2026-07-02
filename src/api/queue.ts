/**
 * Tiny request queue for LLM calls: batches queue up instead of failing or
 * blocking the UI, with a couple in flight at once (rate-limit friendly,
 * still parallel enough to feel fast).
 */
const MAX_CONCURRENT = 2

let active = 0
const waiting: (() => void)[] = []

export async function enqueue<T>(task: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  active++
  try {
    return await task()
  } finally {
    active--
    waiting.shift()?.()
  }
}
