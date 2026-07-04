import { forwardRef } from 'react'
import { PlayIcon, StopIcon } from '@phosphor-icons/react'

interface PlayRoundProps {
  playing: boolean
  loading?: boolean
  onClick: () => void
  /** sm=20px (tray minis) · md=22px (transport) · default 26px (cards) · lg=52px · xl=72px (focus master) */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  title?: string
}

const GLYPH_SIZE: Record<string, number> = { sm: 9, md: 10, default: 11, lg: 18, xl: 26 }

/** Round hardware play/stop button — orange with ■ while playing. */
export const PlayRound = forwardRef<HTMLButtonElement, PlayRoundProps>(function PlayRound(
  { playing, loading, onClick, size, title },
  ref,
) {
  const glyph = GLYPH_SIZE[size ?? 'default']
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      className={`play-round${size ? ` ${size}` : ''}`}
      data-playing={playing}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {loading ? (
        '…'
      ) : playing ? (
        <StopIcon size={glyph} />
      ) : (
        <PlayIcon size={glyph} />
      )}
    </button>
  )
})
