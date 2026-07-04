import type { Mode } from '../../types'

/** Keys a fifth apart, clockwise from 12 o'clock, in the app's spellings. */
const FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'Ab', 'Eb', 'Bb', 'F']
/** Relative minor of each FIFTHS entry — static inner labels, not selectable. */
const MINORS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Fm', 'Cm', 'Gm', 'Dm']

const DEG = 360 / FIFTHS.length

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

/** Donut-wedge path between two radii and two angles (SVG y-down = clockwise). */
function wedgePath(cx: number, cy: number, outer: number, inner: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, outer, a0)
  const [x1, y1] = polar(cx, cy, outer, a1)
  const [x2, y2] = polar(cx, cy, inner, a1)
  const [x3, y3] = polar(cx, cy, inner, a0)
  return `M ${x0} ${y0} A ${outer} ${outer} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 0 0 ${x3} ${y3} Z`
}

interface CircleOfFifthsProps {
  /** Selected tonal center, one of the app's 12 key spellings. */
  value: string
  onChange: (key: string) => void
  /** Dim the dial and ignore input (e.g. while a dice toggle overrides the value). */
  disabled?: boolean
  size?: number
}

/** Hardware key dial: an SVG circle of fifths — major-key wedges select the
 *  tonal center, relative minors sit inside as legends. */
export function CircleOfFifths({ value, onChange, disabled = false, size = 132 }: CircleOfFifthsProps) {
  const c = size / 2
  const outer = c - 2
  const inner = outer * 0.62
  const labelR = (outer + inner) / 2
  const minorR = inner - 9

  return (
    <svg
      className={`cof${disabled ? ' disabled' : ''}`}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the dial IS the control — wedge paths inside are focusable radios
      role="radiogroup"
      aria-label="key"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      {FIFTHS.map((k, i) => {
        const mid = i * DEG - 90 // C at 12 o'clock, fifths clockwise
        const selected = k === value
        const [lx, ly] = polar(c, c, labelR, mid)
        const [mx, my] = polar(c, c, minorR, mid)
        return (
          <g key={k}>
            {/* biome-ignore lint/a11y/useSemanticElements: wedges must be SVG paths — an input can't be a donut sector */}
            <path
              className="cof-wedge"
              d={wedgePath(c, c, outer, inner, mid - DEG / 2, mid + DEG / 2)}
              data-selected={selected}
              role="radio"
              aria-checked={selected}
              aria-label={k}
              tabIndex={disabled ? -1 : 0}
              onClick={() => onChange(k)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onChange(k)
                }
              }}
            />
            <text
              className="cof-major"
              data-selected={selected}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {k}
            </text>
            <text className="cof-minor" x={mx} y={my} textAnchor="middle" dominantBaseline="central">
              {MINORS[i]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Accidental count of each major key: positive = sharps, negative = flats. */
const SIGNATURE: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
}

/* Each mode's distance in fifths from its parent major scale — the signature
   of X <mode> is the signature of that parent (D dorian = C major's, none). */
const MODE_OFFSET: Record<Mode, number> = {
  lydian: 1,
  ionian: 0,
  mixolydian: -1,
  dorian: -2,
  aeolian: -3,
  phrygian: -4,
  locrian: -5,
}

/* Treble-staff y of each accidental (staff lines at y 12/24/36/48/60, a
   diatonic step = 6). Sharps in F–C–G–D–A–E–B order, flats in B–E–A–D–G–C–F. */
const SHARP_Y = [12, 30, 6, 24, 42, 18, 36]
const FLAT_Y = [36, 18, 42, 24, 48, 30, 54]

/** Staff icon showing the signature of the selected key + mode. */
export function KeySignature({ musicKey, mode = 'ionian' }: { musicKey: string; mode?: Mode }) {
  let n = (SIGNATURE[musicKey] ?? 0) + MODE_OFFSET[mode]
  // combos past 7 accidentals notate as their enharmonic twin (C# lydian → 4 flats)
  if (n > 7) n -= 12
  if (n < -7) n += 12
  const ys = n >= 0 ? SHARP_Y.slice(0, n) : FLAT_Y.slice(0, -n)
  const glyph = n >= 0 ? '♯' : '♭'
  const what = n === 0 ? 'no sharps or flats' : `${Math.abs(n)} ${n > 0 ? 'sharp' : 'flat'}${Math.abs(n) === 1 ? '' : 's'}`
  return (
    <svg
      className="keysig"
      role="img"
      aria-label={`${musicKey} ${mode} key signature — ${what}`}
      width={84}
      height={84}
      viewBox="0 -12 84 84"
    >
      {[12, 24, 36, 48, 60].map((y) => (
        <line key={y} x1={2} y1={y} x2={82} y2={y} />
      ))}
      {/* G clef centered on the staff; its curl wraps the G4 line */}
      <text className="keysig-clef" x={13} y={36} textAnchor="middle" dominantBaseline="central">
        {'\u{1D11E}'}
      </text>
      {ys.map((y, i) => (
        <text key={y} x={30 + i * 8} y={y} textAnchor="middle" dominantBaseline="central">
          {glyph}
        </text>
      ))}
    </svg>
  )
}
