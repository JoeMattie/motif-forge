import type { PartVariation } from '../../types'

/** Keyboard cursor in the bay: a part row + a node in its tree (null = the origin cell). */
export interface BayFocus {
  part: number
  nodeId: string | null
}

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
