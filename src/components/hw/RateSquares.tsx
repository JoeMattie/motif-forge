import { StarIcon } from '@phosphor-icons/react'
import type { Rating } from '../../types'

interface RateSquaresProps {
  rating: Rating
  onRate: (r: Rating) => void
}

/** Five 9px hardware rating squares — filled squares = current rating. */
export function RateSquares({ rating, onRate }: RateSquaresProps) {
  return (
    <span className="rate-squares" title="Rate (keys 1–5 while selected)">
      {[1, 2, 3, 4, 5].map((r) => (
        <button
          key={r}
          type="button"
          className="rate-sq"
          data-filled={r <= rating}
          aria-label={`rate ${r}`}
          onClick={(e) => {
            e.stopPropagation()
            onRate((r === rating ? 0 : r) as Rating)
          }}
        />
      ))}
    </span>
  )
}

/** Read-only star readout used on tray mini-cards. */
export function Stars({ rating }: { rating: number }) {
  return (
    <span className="tray-stars">
      {[1, 2, 3, 4, 5].map((r) => (
        <StarIcon key={r} size={9} weight="fill" className={r > rating ? 'off' : undefined} />
      ))}
    </span>
  )
}
