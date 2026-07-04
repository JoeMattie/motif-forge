import { useState } from 'react'
import { Button, NumberInput, Popover, Select, Tooltip } from '@mantine/core'
import type { Mode, Note } from '../../types'
import { MODES } from '../../core/theory'
import type { Transform } from '../../core/transforms'

/**
 * The ADV key: a dropdown of part-scoped deterministic transforms (a popover
 * like the CLAUDE key), anchored to one take. Aug/Dim are omitted on purpose —
 * they change the bar count of one part, which would break the composite's
 * alignment. 8va/8vb shift the whole take. The dropdown stays open so several
 * transforms can be applied in a row — each click adds a sibling take.
 */
export function AdvancedPop({
  variant,
  opened,
  sourceMode,
  isDrums,
  baseTake,
  onToggle,
  onClose,
  onApplyTransform,
}: {
  variant: 'chip' | 'button'
  /** Controlled by the bay so the `a` hotkey and focus moves can drive it. */
  opened: boolean
  sourceMode: Mode
  isDrums: boolean
  /** Notes of the take this dropdown operates on. */
  baseTake: Note[]
  onToggle: () => void
  onClose: () => void
  onApplyTransform: (t: Transform) => void
}) {
  const [transposeBy, setTransposeBy] = useState(2)
  const [targetMode, setTargetMode] = useState<Mode>(
    sourceMode === 'dorian' ? 'phrygian' : 'dorian',
  )

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle()
  }
  const octave = (direction: 1 | -1) =>
    onApplyTransform({
      type: 'octaveDisplace',
      noteIndices: baseTake.map((_, i) => i),
      direction,
    })

  const pitchTip = isDrums ? 'Pitch transforms are disabled on drum parts' : undefined

  return (
    <Popover
      opened={opened}
      onChange={(o) => {
        if (!o) onClose()
      }}
      width={248}
      position="bottom-end"
      trapFocus
      // The bay's window keydown owns the ESC cascade (dropdown → bay). With
      // closeOnEscape on, Mantine also closes us and nulls the bay's
      // `advanced` state before its listener reads it, so the same keypress
      // falls through and closes the whole bay.
      closeOnEscape={false}
    >
      <Popover.Target>
        {/* wrapper spans so the tooltip still hovers around the anchor */}
        <span className="chip-tip-wrap">
          <Tooltip label="Deterministic transforms for this take — instant, offline (a)">
            <span className="chip-tip-wrap">
              {variant === 'button' ? (
                <Button size="compact-xs" data-latched={opened} onClick={toggle}>
                  Adv
                </Button>
              ) : (
                <button
                  type="button"
                  className="promote-chip"
                  data-promoted={opened}
                  onClick={toggle}
                >
                  Adv
                </button>
              )}
            </span>
          </Tooltip>
        </span>
      </Popover.Target>
      <Popover.Dropdown className="advanced-pop" onClick={(e) => e.stopPropagation()}>
        <div className="transform-aux">
          <Tooltip label={pitchTip ?? 'Flip the contour upside down around the first note'}>
            <Button disabled={isDrums} onClick={() => onApplyTransform({ type: 'inversion' })}>
              Invert
            </Button>
          </Tooltip>
          <Tooltip label="Play the take backwards in time">
            <Button onClick={() => onApplyTransform({ type: 'retrograde' })}>Retro</Button>
          </Tooltip>
          <Tooltip label={pitchTip ?? 'Backwards and upside down — the most disguised transform'}>
            <Button
              disabled={isDrums}
              onClick={() => onApplyTransform({ type: 'retrogradeInversion' })}
            >
              R-Inv
            </Button>
          </Tooltip>
        </div>
        <div className="transform-aux">
          <Tooltip label={pitchTip ?? 'Shift every pitch by the chosen number of semitones'}>
            <Button
              disabled={isDrums}
              onClick={() => onApplyTransform({ type: 'transpose', semitones: transposeBy })}
            >
              Transpose
            </Button>
          </Tooltip>
          <NumberInput
            w={62}
            size="xs"
            min={-12}
            max={12}
            value={transposeBy}
            onChange={(v) => setTransposeBy(Number(v) || 0)}
          />
        </div>
        <div className="transform-aux">
          <Tooltip
            label={pitchTip ?? "Keep each note's scale degree but re-spell it in the target mode"}
          >
            <Button disabled={isDrums} onClick={() => onApplyTransform({ type: 'modeSwap', targetMode })}>
              Mode swap
            </Button>
          </Tooltip>
          <Select
            w={110}
            size="xs"
            disabled={isDrums}
            value={targetMode}
            // withinPortal:false — portaled options count as an outside click,
            // which closed this popover before the selection could land.
            comboboxProps={{ withinPortal: false }}
            onChange={(v) => {
              if (!v) return
              setTargetMode(v as Mode)
              onApplyTransform({ type: 'modeSwap', targetMode: v as Mode })
            }}
            data={MODES.filter((m) => m !== sourceMode)}
          />
        </div>
        <div className="transform-aux">
          <Tooltip label={pitchTip ?? 'Shift the whole take up an octave'}>
            <Button disabled={isDrums || baseTake.length === 0} onClick={() => octave(1)}>
              8va ↑
            </Button>
          </Tooltip>
          <Tooltip label={pitchTip ?? 'Shift the whole take down an octave'}>
            <Button disabled={isDrums || baseTake.length === 0} onClick={() => octave(-1)}>
              8vb ↓
            </Button>
          </Tooltip>
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
