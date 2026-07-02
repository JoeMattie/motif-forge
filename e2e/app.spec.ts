import { expect, test } from '@playwright/test'
import { gotoApp, SEED_NAMES } from './helpers'

test('loads and seeds the three sample motifs on first run', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.motif-card')).toHaveCount(3)
  for (const name of SEED_NAMES) {
    await expect(page.locator('.card-name', { hasText: name })).toBeVisible()
  }
})

test('filter chips report triage counts', async ({ page }) => {
  await gotoApp(page)
  await expect(page.getByRole('button', { name: 'all (3)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'unrated (3)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'rated (0)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'discarded (0)', exact: true })).toBeVisible()
})

test('cards show key, mode, bars, and tempo metadata', async ({ page }) => {
  await gotoApp(page)
  const ember = page.locator('.motif-card', { hasText: 'Ember (stepwise)' })
  await expect(ember.locator('.card-meta')).toHaveText('D dorian · 2b · 96bpm')
})

test('piano-roll thumbnails render one rect per note', async ({ page }) => {
  await gotoApp(page)
  const ember = page.locator('.motif-card', { hasText: 'Ember (stepwise)' })
  // Ember has 8 notes (sampleMotifs.ts)
  await expect(ember.locator('svg.piano-roll rect.roll-note')).toHaveCount(8)
})

test('view switcher moves between triage, library, and concepts', async ({ page }) => {
  await gotoApp(page)
  const transportBar = page.locator('.transport-bar')
  await transportBar.getByText('Library', { exact: true }).click()
  await expect(page.locator('.triage')).toHaveCount(0)
  await transportBar.getByText('Triage', { exact: true }).click()
  await expect(page.locator('.triage')).toBeVisible()
})
