import { useEffect, useRef } from 'react'
import { Button, Kbd, Mark, Tooltip } from '@mantine/core'
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react'
import type { Part, Rating as RatingValue } from '../types'
import type { Family } from '../core/families'
import { engine } from '../audio/engine'
import { recordTriageAction } from '../store/sessionPace'
import { useAppDispatch } from '../store/AppContext'
import { useIsLoading, useIsPlaying } from './hooks/usePlayhead'
import { usePlayOptions } from './hooks/usePlayOptions'
import { LcdRoll } from './LcdRoll'
import { PlayRound } from './hw/PlayRound'
import { RateSquares } from './hw/RateSquares'

const PART_CODES: Record<string, string> = {
  lead: 'LD',
  melody: 'LD',
  harmony: 'HM',
  pad: 'PD',
  bass: 'BS',
  drums: 'DR',
}

export function partCode(p: Part): string {
  return PART_CODES[p.name.toLowerCase()] ?? p.name.slice(0, 2).toUpperCase()
}

interface MotifCardProps {
  family: Family
  selected: boolean
  /** Family tray currently folded out under this card. */
  expanded?: boolean
  onToggleExpand?: () => void
  /** Extra footer row with the concept select + exports (Library). */
  conceptRow?: React.ReactNode
}

/**
 * One triage-grid card = one FAMILY. Shows the family's face (promoted take
 * or origin); variants stay inside the fold-out tray. The stack lip on the
 * top edge is the only grid trace of a family with variants.
 */
export function MotifCard({ family, selected, expanded, onToggleExpand, conceptRow }: MotifCardProps) {
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const face = family.face
  const isPlaying = useIsPlaying(face.id)
  const isLoading = useIsLoading(face.id)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const discarded = family.root.discarded

  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const cls = [
    'motif-card',
    selected ? 'selected' : '',
    isPlaying ? 'playing' : '',
    discarded ? 'discarded' : '',
    expanded ? 'expanded' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={cardRef}
      className={cls}
      onClick={() => {
        dispatch({ type: 'SELECT', id: face.id })
        // Clicking a card that has variants folds its tray out (chip/F toggles it back in).
        if (family.variants.length > 0 && onToggleExpand && !expanded) onToggleExpand()
      }}
    >
      {family.variants.length > 0 && !expanded && <span className="stack-lip" />}
      <div className="card-head">
        <Tooltip label={face.rationale} disabled={face.rationale ? undefined : true}>
          <span className="card-name">{face.name}</span>
        </Tooltip>
        <span className="card-meta">
          {face.bars}B · {face.tempo}
        </span>
      </div>
      <LcdRoll motif={face} muted={discarded} />
      
        <div className="part-legend">
          {face.parts.length > 1 &&
            face.parts.map((p, i) => (
              <Tooltip key={i} label={p.preset ? `${p.name}: ${p.preset.oscillator} synth` : `${p.name} · ${p.instrument}`}>
                <span>
                  <i className={`part-swatch ${p.instrument === 'drums' ? 'drums' : `part-${i}`}`} />
                  {partCode(p)}
                </span>
              </Tooltip>
            ))}
          {face.scaleWarning && (
            <Tooltip label="Contains out-of-scale pitches">
              <span className="chr-chip" style={{ marginLeft: 'auto' }}>
                CHR
              </span>
            </Tooltip>
          )}
        </div>
      
      {discarded ? (
        <div className="card-footer">
          <span className="discard-chip">
            Discarded · <Kbd>u</Kbd> to undo
          </span>
          <span className="spacer" />
          <button
            className="text-btn"
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'MOTIF_RESTORED', id: family.root.id })
            }}
          >
            Restore
          </button>
        </div>
      ) : (
        <div className="card-footer">
          <Tooltip label="Play/stop the promoted take (Space)">
            <PlayRound
              playing={isPlaying}
              loading={isLoading}
              onClick={() => {
                dispatch({ type: 'SELECT', id: face.id })
                engine.toggle(face, playOpts(face))
              }}
            />
          </Tooltip>
          <RateSquares
            rating={face.rating}
            onRate={(r) => {
              dispatch({ type: 'MOTIF_RATED', id: face.id, rating: r as RatingValue })
              recordTriageAction()
            }}
          />
          <span className="spacer" />
          {onToggleExpand && (
            <Tooltip label="Fold the family tray out/in (F) — variants live inside, the pool count never inflates">
              <Button
                size="compact-xs"
                aria-label={`Family ${Math.max(1, family.variants.length)}`}
                data-latched={expanded ?? false}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand()
                }}
                rightSection={
                  expanded ? (
                    <CaretDownIcon size={8} weight="bold" />
                  ) : (
                    <CaretRightIcon size={8} weight="bold" />
                  )
                }
              >
                <span>
                  <Mark className="hk">F</Mark>amily {Math.max(1, family.variants.length)}
                </span>
              </Button>
            </Tooltip>
          )}
        </div>
      )}
      {conceptRow}
    </div>
  )
}
