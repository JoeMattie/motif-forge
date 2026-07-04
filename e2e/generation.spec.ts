import { expect, test } from '@playwright/test'
import { gotoApp, mockGeneration, mockGenerationFailure, mockMotif } from './helpers'

test('+5 shows a pending card, then lands validated motifs', async ({ page }) => {
  await mockGeneration(page, [mockMotif('Mock Alpha'), mockMotif('Mock Beta')])
  await gotoApp(page)

  // INSTANT is the default engine — switch to CLAUDE to exercise the LLM path.
  await page.locator('.wb-seg-label', { hasText: 'CLAUDE' }).click()
  await page.getByRole('button', { name: 'Generate +5' }).click()

  // Placeholder pulses in the grid while the batch is in flight, then the
  // two motifs from the mocked response join the three seeds.
  await expect(page.locator('.motif-card')).toHaveCount(5)
  await expect(page.locator('.card-name', { hasText: 'Mock Alpha' })).toBeVisible()
  await expect(page.locator('.card-name', { hasText: 'Mock Beta' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('2 added')
  await expect(page.locator('.pending-card')).toHaveCount(0)
})

test('invalid motifs in the batch are dropped and reported', async ({ page }) => {
  const bad = { name: 'Too Short', notes: [{ pitch: 62, startBeat: 0, durationBeats: 1 }] }
  await mockGeneration(page, [mockMotif('Mock Good'), bad])
  await gotoApp(page)

  // INSTANT is the default engine — switch to CLAUDE to exercise the LLM path.
  await page.locator('.wb-seg-label', { hasText: 'CLAUDE' }).click()
  await page.getByRole('button', { name: 'Generate +5' }).click()

  await expect(page.locator('.motif-card')).toHaveCount(4)
  await expect(page.getByRole('alert')).toContainText('1 added, 1 dropped')
})

test('generated motifs are tagged to the named concept', async ({ page }) => {
  await mockGeneration(page, [mockMotif('Motif Of Concept')])
  await gotoApp(page)

  await page.locator('.wb-seg-label', { hasText: 'CLAUDE' }).click()
  await page.getByPlaceholder(/concept — e\.g\./).fill('event horizon')
  await page.getByRole('button', { name: 'Generate +5' }).click()
  await expect(page.locator('.card-name', { hasText: 'Motif Of Concept' })).toBeVisible()

  // The concepts view groups by tag
  await page.locator('.wb-header').getByRole('tab', { name: /^concepts$/i }).click()
  await expect(page.locator('.concept-summary .cs-title')).toHaveText('event horizon')
  await expect(page.locator('.card-name', { hasText: 'Motif Of Concept' })).toBeVisible()
})

test('an API failure surfaces a message and clears the pending card', async ({ page }) => {
  await mockGenerationFailure(page)
  await gotoApp(page)

  // INSTANT is the default engine — switch to CLAUDE to exercise the LLM path.
  await page.locator('.wb-seg-label', { hasText: 'CLAUDE' }).click()
  await page.getByRole('button', { name: 'Generate +5' }).click()

  await expect(page.getByRole('alert')).toContainText('Generation failed')
  await expect(page.locator('.pending-card')).toHaveCount(0)
  await expect(page.locator('.motif-card')).toHaveCount(3)
})

test('generated cards surface metadata and LCD notes', async ({ page }) => {
  await mockGeneration(page, [mockMotif('Mock Alpha')])
  await gotoApp(page)
  await page.locator('.wb-seg-label', { hasText: 'CLAUDE' }).click()
  await page.getByRole('button', { name: 'Generate +5' }).click()

  const card = page.locator('.motif-card', { hasText: 'Mock Alpha' })
  await expect(card.locator('.card-meta')).toHaveText('4B · 100')
  await expect(card.locator('.lcd rect.roll-note')).toHaveCount(3)
})
