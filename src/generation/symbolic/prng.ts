/**
 * Seedable PRNG + sampling helpers for the Tier-1 symbolic generation tier.
 * Everything downstream must draw randomness from an Rng (never Math.random)
 * so a stored seed reproduces a motif exactly.
 */

export type Rng = () => number // uniform [0, 1)

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Derive an independent per-item seed from a batch seed. */
export function childSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ (index + 1), 0x9e3779b9) ^ (seed >>> 16)) >>> 0
}

/** Integer in [lo, hi], inclusive on both ends. */
export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]
}

/** Weighted choice; entries with non-positive weight are never picked. */
export function pickWeighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  let total = 0
  for (const [, w] of entries) total += Math.max(0, w)
  let roll = rng() * total
  for (const [value, w] of entries) {
    roll -= Math.max(0, w)
    if (roll < 0) return value
  }
  return entries[entries.length - 1][0]
}
