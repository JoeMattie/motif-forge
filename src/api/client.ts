export interface ClaudeResponse {
  text: string
  stopReason: string
}

interface ContentBlock {
  type: string
  text?: string
}

export async function callClaude(prompt: string, maxTokens: number): Promise<ClaudeResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`API error ${response.status}: ${body.slice(0, 300)}`)
  }
  const data = (await response.json()) as { content: ContentBlock[]; stop_reason: string }
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  return { text, stopReason: data.stop_reason }
}
