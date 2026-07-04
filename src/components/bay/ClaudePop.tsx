import { useState } from 'react'
import { Button, Group, Popover, Textarea, Tooltip } from '@mantine/core'

/**
 * The CLAUDE key: pops a small text box asking for a targeted change, then
 * runs an LLM take on this part only. Grayed out without an API key. The
 * popover stays open after Run so it can be fired again with a tweaked brief;
 * `busy` blocks overlapping runs (one take per click).
 */
export function ClaudePop({
  variant,
  ready,
  busy,
  partName,
  onRun,
}: {
  variant: 'chip' | 'button'
  ready: boolean
  busy: boolean
  partName: string
  onRun: (brief: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const run = () => {
    const b = brief.trim()
    if (!b || busy) return
    onRun(b)
  }
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen((o) => !o)
  }
  const tip = ready
    ? `Ask Claude for a targeted change to the ${partName} part — every other part locked`
    : 'Needs your Anthropic API key — set it under KEY in the header'
  return (
    <Popover opened={open} onChange={setOpen} width={280} position="bottom-end" trapFocus>
      <Popover.Target>
        {/* wrapper spans so the tooltip still hovers when the key is disabled */}
        <span className="chip-tip-wrap">
          <Tooltip label={tip}>
            <span className="chip-tip-wrap">
              {variant === 'button' ? (
                <Button size="compact-xs" className="green" disabled={!ready} data-latched={open} onClick={toggle}>
                  Claude
                </Button>
              ) : (
                <button type="button" className="promote-chip" disabled={!ready} onClick={toggle}>
                  Claude
                </button>
              )}
            </span>
          </Tooltip>
        </span>
      </Popover.Target>
      <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
        <Textarea
          rows={2}
          data-autofocus
          placeholder="targeted change — e.g. more syncopation, land phrase ends on the 5th"
          value={brief}
          onChange={(e) => setBrief(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              run()
            }
          }}
        />
        <Group justify="flex-end" mt={6}>
          <Button className="accent" disabled={!brief.trim() || busy} onClick={run}>
            {busy ? 'Running…' : 'Run'}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}
