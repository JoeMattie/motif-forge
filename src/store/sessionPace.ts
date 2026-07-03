/**
 * Session triage telemetry: timestamps of every rate/discard this session
 * (module-level, deliberately not persisted). Drives the focus-mode
 * SESSION PACE / REMAINING readouts.
 */
const events: number[] = []

export function recordTriageAction(): void {
  events.push(Date.now())
}

/** Ratings per minute over a trailing window (0 when idle). */
export function triagePacePerMinute(windowMs = 5 * 60_000): number {
  const now = Date.now()
  const recent = events.filter((t) => now - t <= windowMs)
  if (recent.length < 2) return recent.length
  const spanMin = Math.max(0.5, (now - recent[0]) / 60_000)
  return recent.length / spanMin
}
