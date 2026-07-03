import { AngleSlider } from '@mantine/core'

interface KnobProps {
  label: string
  /** Bold value readout shown next to the label. */
  value: string
  /** Position within the sweep, 0..1. */
  position: number
  /** Called with the new 0..1 position (snapped to a detent). */
  onPosition: (position: number) => void
  /** Number of discrete detents across the sweep. */
  detents: number
  /** Dark (ink) knob or light (surface) knob. */
  variant?: 'dark' | 'light'
}

/** Hardware rotary sweep: 270°, from 7 o'clock (225°) clockwise to 5 o'clock. */
const SWEEP = 270
const START = 225

/**
 * Rotary hardware knob — a restyled Mantine AngleSlider restricted to a 270°
 * sweep of evenly spaced detents (drag or arrow keys to turn).
 */
export function Knob({ label, value, position, onPosition, detents, variant = 'dark' }: KnobProps) {
  const stepDeg = SWEEP / (detents - 1)
  const marks = Array.from({ length: detents }, (_, i) => ({
    value: (START + i * stepDeg) % 360,
  }))
  const angle = (START + Math.max(0, Math.min(1, position)) * SWEEP) % 360

  const onChange = (deg: number) => {
    const rel = (((deg - START) % 360) + 360) % 360
    const index = Math.max(0, Math.min(detents - 1, Math.round(rel / stepDeg)))
    onPosition(detents === 1 ? 0 : index / (detents - 1))
  }

  return (
    <div className="knob-wrap">
      <div className="knob-label">
        {label} <b>{value}</b>
      </div>
      <AngleSlider
        className={`knob-slider ${variant}`}
        aria-label={label}
        size={45}
        thumbSize={22}
        value={angle}
        onChange={onChange}
        marks={marks}
        restrictToMarks
        withLabel={false}
      />
    </div>
  )
}
