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

/** Take-card header title: what made this take, in words (truncated by CSS). */
export function takeName(v: PartVariation): string {
  switch (v.provenance.kind) {
    case 'llm':
      return v.provenance.brief
    case 'ga':
      return v.provenance.ops.split('+').join(' · ') || 'evolved'
    case 'transform':
      return v.provenance.transform
    case 'sound':
      return v.provenance.instrument
  }
}

/** Take-card header type badge, colored to match its cable (styles.css .node-badge). */
export function takeBadge(v: PartVariation): string {
  switch (v.provenance.kind) {
    case 'llm':
      return 'CLAUDE'
    case 'ga':
      return 'VAR · EVO'
    case 'sound':
      return 'SOUND'
    case 'transform':
      return provenanceLabel(v)
  }
}
