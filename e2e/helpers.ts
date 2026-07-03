import type { Page } from '@playwright/test'

/** Names of the three dev fixtures seeded on first run (src/core/sampleMotifs.ts). */
export const SEED_NAMES = ['Ember (stepwise)', 'Orbit (arpeggiated)', 'Undertow (syncopated)']

/** A minimal motif that passes validation against the default brief (D dorian, 4 bars, 4/4). */
export function mockMotif(name: string): Record<string, unknown> {
  return {
    name,
    rationale: 'mock rationale',
    notes: [
      { pitch: 62, startBeat: 0, durationBeats: 1, velocity: 92 },
      { pitch: 65, startBeat: 1, durationBeats: 1, velocity: 88 },
      { pitch: 69, startBeat: 2, durationBeats: 2, velocity: 96 },
    ],
  }
}

/** Shape of a real /v1/messages response, with the batch fenced like the model returns it. */
function claudeResponse(payload: unknown) {
  return {
    content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` }],
    stop_reason: 'end_turn',
  }
}

/** Intercept the Anthropic proxy route so generation runs offline and key-free. */
export async function mockGeneration(page: Page, motifs: unknown[]): Promise<void> {
  await page.route('**/api/anthropic/v1/messages', (route) =>
    route.fulfill({ json: claudeResponse({ motifs }) }),
  )
}

export async function mockGenerationFailure(page: Page, status = 500): Promise<void> {
  await page.route('**/api/anthropic/v1/messages', (route) =>
    route.fulfill({ status, body: 'mock upstream error' }),
  )
}

/** Load the app and wait for hydration + first-run seeding to settle. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.motif-card').first().waitFor()
}
