import { useEffect, useRef } from 'react'
import { ActionIcon, Button, Mark, Tooltip } from '@mantine/core'
import {
  ArrowRightIcon,
  CaretUpIcon,
  CircleIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react'
import type { Motif, Rating as RatingValue } from '../types'
import type { Family } from '../core/families'
import { variantBadge } from '../core/families'
import { engine } from '../audio/engine'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { useIsLoading, useIsPlaying } from './hooks/usePlayhead'
import { usePlayOptions } from './hooks/usePlayOptions'
import { LcdRoll } from './LcdRoll'
import { PlayRound } from './hw/PlayRound'
import { RateSquares } from './hw/RateSquares'

function TrayCard({ motif, family, isOrigin }: { motif: Motif; family: Family; isOrigin?: boolean }) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const isPlaying = useIsPlaying(motif.id)
  const isLoading = useIsLoading(motif.id)
  const cardRef = useRef<HTMLDivElement>(null)
  // Keyboard triage can descend into the tray — mark and reveal the cursor.
  const selected = state.selectedId === motif.id && family.face.id !== motif.id
  const promoted = family.face.id === motif.id && (motif.promoted ?? isOrigin)
  const badge = variantBadge(motif)

  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected])

  // Unvaried parts render dimmed so the varied part pops.
  const dimParts = (() => {
    const s = motif.source
    const variedParts =
      s.kind === 'llm-mutation' || s.kind === 'bay-mix' ? s.variedParts : undefined
    if (!variedParts?.length) return undefined
    const varied = new Set(variedParts)
    return new Set(motif.parts.map((_, i) => i).filter((i) => !varied.has(i)))
  })()

  const badgeCls =
    badge.kind === 'transform'
      ? 'transform'
      : badge.parts.some((i) => motif.parts[i]?.instrument === 'drums')
        ? 'var-drums'
        : 'var'

  if (motif.discarded) {
    return (
      <div ref={cardRef} className={`tray-card discarded${selected ? ' selected' : ''}`}>
        <div className="tray-card-head">
          <span className="tray-card-name">{motif.name}</span>
          <span className="tray-badge dim">{badge.label}</span>
        </div>
        <LcdRoll motif={motif} height={52} muted />
        <div className="tray-card-foot">
          <span className="discard-chip">Discarded</span>
          <span className="spacer" />
          <button
            className="text-btn"
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'MOTIF_RESTORED', id: motif.id })
            }}
          >
            Restore
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      className={`tray-card${family.face.id === motif.id ? ' promoted' : ''}${isPlaying ? ' playing' : ''}${selected ? ' selected' : ''}`}
      onClick={() => dispatch({ type: 'SELECT', id: motif.id })}
    >
      <div className="tray-card-head">
        <Tooltip label={motif.rationale} disabled={motif.rationale ? undefined : true}>
          <span className="tray-card-name">{isOrigin ? 'ORIGIN' : motif.name}</span>
        </Tooltip>
        <span className={`tray-badge ${isOrigin ? 'dim' : badgeCls}`}>
          {isOrigin
            ? motif.source.kind === 'generated'
              ? 'GEN'
              : 'SEED'
            : badge.label.replace('TRANSFORM · ', '')}
        </span>
      </div>
      <LcdRoll motif={motif} height={52} dimParts={dimParts} />
      <div className="tray-card-foot">
        <PlayRound
          size="sm"
          playing={isPlaying}
          loading={isLoading}
          onClick={() => {
            dispatch({ type: 'SELECT', id: motif.id })
            engine.toggle(motif, playOpts(motif))
          }}
        />
        <RateSquares
          rating={motif.rating}
          onRate={(r) => dispatch({ type: 'MOTIF_RATED', id: motif.id, rating: r as RatingValue })}
        />
        <span className="spacer" />
        {!promoted && (
          <Tooltip label="Discard this variant">
            <ActionIcon
              aria-label="Discard this variant"
              onClick={(e) => {
                e.stopPropagation()
                dispatch({ type: 'MOTIF_DISCARDED', id: motif.id })
              }}
            >
              <XIcon size={10} weight="bold" />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label="Make this take the family's face — what the grid shows, plays, and exports">
          <button
            className="promote-chip"
            aria-label={family.face.id === motif.id ? 'Promoted' : 'Promote'}
            data-promoted={family.face.id === motif.id}
            onClick={(e) => {
              e.stopPropagation()
              dispatch({
                type: 'MOTIF_PROMOTED',
                id: motif.id,
                familyIds: family.members.map((m) => m.id),
              })
            }}
          >
            {family.face.id === motif.id ? (
              <>
                Promoted <CircleIcon size={6} weight="fill" />
              </>
            ) : (
              <>
                <Mark className="hk">P</Mark>romote
              </>
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

/** Full-width fold-out tray under a family card's row. */
export function FamilyTray({ family, onFold }: { family: Family; onFold: () => void }) {
  const dispatch = useAppDispatch()
  const openBay = () => dispatch({ type: 'SET_MUTATION_TARGET', id: family.face.id })

  return (
    <div className="family-tray">
      <div className="family-tray-head">
        <span className="family-tray-title">FAMILY — {family.root.name}</span>
        <span className="family-tray-meta">
          {family.variants.length} variant{family.variants.length === 1 ? '' : 's'} · best{' '}
          {'★'.repeat(Math.max(1, family.bestRating))} · promoted take is what triage plays &amp;
          exports
        </span>
        <span className="spacer" />
        <Tooltip label="Open the workspace: per-part mutation trees, transforms, LLM takes (M)">
          <Button
            aria-label="Open mutation bay"
            onClick={openBay}
            rightSection={<ArrowRightIcon size={10} weight="bold" />}
          >
            {/* single span: the Button label is a flex container, which would
                collapse the whitespace between bare text nodes */}
            <span>
              OPEN <Mark className="hk">M</Mark>UTATION BAY
            </span>
          </Button>
        </Tooltip>
        <Button
          aria-label="Fold"
          onClick={onFold}
          leftSection={<CaretUpIcon size={10} weight="bold" />}
        >
          <Mark className="hk">F</Mark>OLD
        </Button>
      </div>
      <div className="family-tray-strip">
        <TrayCard motif={family.root} family={family} isOrigin />
        <span className="tray-arrow">
          <ArrowRightIcon size={12} />
        </span>
        {family.variants.map((v) => (
          <TrayCard key={v.id} motif={v} family={family} />
        ))}
        <button className="tray-slot-new" onClick={openBay}>
          <span className="plus">
            <PlusIcon size={14} weight="bold" />
          </span>
          <span className="lbl">
            New
            <br />
            variation
          </span>
        </button>
      </div>
    </div>
  )
}
