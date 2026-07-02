export class ParseError extends Error {}

/** Strip markdown fences, fall back to first-{...last-} extraction, JSON.parse. */
export function extractJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  if (fence) t = fence[1]
  if (!t.startsWith('{') && !t.startsWith('[')) {
    const first = t.indexOf('{')
    const last = t.lastIndexOf('}')
    if (first === -1 || last <= first) throw new ParseError('no JSON object found in response')
    t = t.slice(first, last + 1)
  }
  try {
    return JSON.parse(t)
  } catch (e) {
    throw new ParseError(`invalid JSON: ${(e as Error).message}`)
  }
}
