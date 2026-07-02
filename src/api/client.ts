export interface ClaudeResponse {
  text: string
  stopReason: string
}

interface ContentBlock {
  type: string
  text?: string
}

/**
 * Calls go through the Vite dev-server proxy (see vite.config.ts), which
 * forwards to api.anthropic.com and injects x-api-key + anthropic-version.
 * Direct browser calls to the API would fail CORS and expose the key.
 */
const API_URL = '/api/anthropic/v1/messages'

export async function callClaude(prompt: string, maxTokens: number): Promise<ClaudeResponse> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (response.status === 401) {
    throw new Error(
      'API auth failed — put ANTHROPIC_API_KEY=sk-ant-... in .env.local and restart `npm run dev`',
    )
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (body.includes('credit balance is too low')) {
      throw new Error(
        'Your Anthropic account has no API credits — add credits under Plans & Billing at console.anthropic.com',
      )
    }
    throw new Error(`API error ${response.status}: ${body.slice(0, 300)}`)
  }
  const data = (await response.json()) as { content: ContentBlock[]; stop_reason: string }
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  return { text, stopReason: data.stop_reason }
}
