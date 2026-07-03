import { forwardRef } from 'react'

interface HardToggleProps {
  on: boolean
  label?: React.ReactNode
  onChange: (on: boolean) => void
  /** Track color when on: default ink, 'accent' orange, 'yellow'. */
  color?: 'ink' | 'accent' | 'yellow'
  disabled?: boolean
}

/** 22×12 hardware toggle switch with a micro-label. */
export const HardToggle = forwardRef<HTMLButtonElement, HardToggleProps>(function HardToggle(
  { on, label, onChange, color = 'ink', disabled },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`htoggle${color !== 'ink' ? ` ${color}` : ''}`}
      data-on={on}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
    >
      <span className="htoggle-track">
        <span className="htoggle-thumb" />
      </span>
      {label}
    </button>
  )
})
