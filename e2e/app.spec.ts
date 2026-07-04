import { expect, test } from '@playwright/test'
import { gotoApp, SEED_NAMES } from './helpers'

test('loads and seeds the three sample motifs on first run', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.motif-card')).toHaveCount(3)
  for (const name of SEED_NAMES) {
    await expect(page.locator('.card-name', { hasText: name })).toBeVisible()
  }
})

test('filter keys report family counts', async ({ page }) => {
  await gotoApp(page)
  await expect(page.getByRole('button', { name: /^all 3$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^unrated 3$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^rated 0$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^discarded 0$/i })).toBeVisible()
})

test('cards show bars and tempo metadata', async ({ page }) => {
  await gotoApp(page)
  const ember = page.locator('.motif-card', { hasText: 'Ember (stepwise)' })
  await expect(ember.locator('.card-meta')).toHaveText('2B · 96')
})

test('LCD piano-roll thumbnails render one rect per note', async ({ page }) => {
  await gotoApp(page)
  const ember = page.locator('.motif-card', { hasText: 'Ember (stepwise)' })
  // Ember has 8 notes (sampleMotifs.ts)
  await expect(ember.locator('.lcd rect.roll-note')).toHaveCount(8)
})

test('view pills move between triage, library, and concepts', async ({ page }) => {
  await gotoApp(page)
  const header = page.locator('.wb-header')
  await header.getByRole('tab', { name: /^library$/i }).click()
  await expect(page.locator('.lib-toolbar')).toBeVisible()
  await expect(page.locator('.filter-row')).toHaveCount(0)
  await header.getByRole('tab', { name: /^triage$/i }).click()
  await expect(page.locator('.filter-row')).toBeVisible()
})

test('theme toggle swaps the Day/Nite panel tokens', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
  await page.locator('.wb-header .wb-seg-label:has([aria-label="Nite theme"])').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nite')
  await page.reload()
  await page.locator('.motif-card').first().waitFor()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nite')
})

test('GRID/FOCUS switch enters focus triage with the large LCD', async ({ page }) => {
  await gotoApp(page)
  await page.locator('.wb-header .wb-seg-label', { hasText: 'focus' }).click()
  await expect(page.locator('.focus-lcd')).toBeVisible()
  // Ember is auto-selected on load, so the deck opens on it
  await expect(page.locator('.focus-lcd-title')).toHaveText('Ember (stepwise)')
  await expect(page.locator('.queue-card.current')).toHaveCount(1)
  await page.locator('.wb-header .wb-seg-label', { hasText: 'grid' }).click()
  await expect(page.locator('.motif-grid')).toBeVisible()
})
