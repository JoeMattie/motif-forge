import { expect, test } from '@playwright/test'
import { gotoApp, mockGeneration, mockGenerationFailure, mockMotif } from './helpers'

test('Generate 5 shows a pending card, then lands validated motifs', async ({ page }) => {
  await mockGeneration(page, [mockMotif('Mock Alpha'), mockMotif('Mock Beta')])
  await gotoApp(page)

  await page.getByRole('button', { name: 'Generate 5' }).click()

  // Placeholder pulses in the grid while the batch is in flight, then the
  // two motifs from the mocked response join the three seeds.
  await expect(page.locator('.motif-card')).toHaveCount(5)
  await expect(page.locator('.card-name', { hasText: 'Mock Alpha' })).toBeVisible()
  await expect(page.locator('.card-name', { hasText: 'Mock Beta' })).toBeVisible()
  await expect(page.getByRole('button', { name: '2 added' })).toBeVisible()
  await expect(page.locator('.pending-card')).toHaveCount(0)
})

test('invalid motifs in the batch are dropped and reported', async ({ page }) => {
  const bad = { name: 'Too Short', notes: [{ pitch: 62, startBeat: 0, durationBeats: 1 }] }
  await mockGeneration(page, [mockMotif('Mock Good'), bad])
  await gotoApp(page)

  await page.getByRole('button', { name: 'Generate 5' }).click()

  await expect(page.locator('.motif-card')).toHaveCount(4)
  await expect(page.getByRole('button', { name: '1 added, 1 dropped' })).toBeVisible()
})

test('generated motifs are tagged to the named concept', async ({ page }) => {
  await mockGeneration(page, [mockMotif('Motif Of Concept')])
  await gotoApp(page)

  await page.getByRole('textbox', { name: 'concept' }).fill('event horizon')
  await page.getByRole('button', { name: 'Generate 5' }).click()
  await expect(page.locator('.card-name', { hasText: 'Motif Of Concept' })).toBeVisible()

  // The concepts view groups by tag
  await page.locator('.transport-bar').getByText('Concepts', { exact: true }).click()
  await expect(page.getByText('event horizon')).toBeVisible()
  await expect(page.locator('.card-name', { hasText: 'Motif Of Concept' })).toBeVisible()
})

test('an API failure surfaces a message and clears the pending card', async ({ page }) => {
  await mockGenerationFailure(page)
  await gotoApp(page)

  await page.getByRole('button', { name: 'Generate 5' }).click()

  await expect(page.getByRole('button', { name: /Generation failed/ })).toBeVisible()
  await expect(page.locator('.pending-card')).toHaveCount(0)
  await expect(page.locator('.motif-card')).toHaveCount(3)
})

test('generated cards surface the model rationale and lineage-fresh state', async ({ page }) => {
  await mockGeneration(page, [mockMotif('Mock Alpha')])
  await gotoApp(page)
  await page.getByRole('button', { name: 'Generate 5' }).click()

  const card = page.locator('.motif-card', { hasText: 'Mock Alpha' })
  await expect(card.locator('.card-meta')).toHaveText('D dorian · 4b · 100bpm')
  await expect(card.locator('svg.piano-roll rect.roll-note')).toHaveCount(3)
})
