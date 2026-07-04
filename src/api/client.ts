import { getAnthropicKey } from '../uiPrefs'

export interface ClaudeResponse {
  text: string
  stopReason: string
}

interface ContentBlock {
  type: string
  text?: string
}

/**
 * With a user-supplied key (KEY button in the header, stored in this browser's
 * localStorage) calls go straight to api.anthropic.com — Anthropic allows CORS
 * when the request opts in via `anthropic-dangerous-direct-browser-access`.
 * Without a key, dev builds fall back to the Vite dev-server proxy (see
 * vite.config.ts), which injects credentials from .env.local server-side.
 */
const DIRECT_URL = 'https://api.anthropic.com/v1/messages'
const PROXY_URL = '/api/anthropic/v1/messages'

function resolveRequest(): { url: string; headers: Record<string, string> } {
  const key = getAnthropicKey()
  if (key) {
    return {
      url: DIRECT_URL,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    }
  }
  if (import.meta.env.DEV) {
    return { url: PROXY_URL, headers: { 'Content-Type': 'application/json' } }
  }
  throw new Error('No API key set — click KEY in the header and paste your Anthropic API key (sk-ant-...)')
}

export async function callClaude(prompt: string, maxTokens: number): Promise<ClaudeResponse> {
  const { url, headers } = resolveRequest()
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (response.status === 401) {
    throw new Error(
      'API auth failed — check the key under KEY in the header (or, in dev without a key, ANTHROPIC_API_KEY in .env.local)',
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
