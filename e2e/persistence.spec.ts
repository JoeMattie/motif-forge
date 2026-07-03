import { expect, test } from '@playwright/test'
import { gotoApp, SEED_NAMES } from './helpers'

test('ratings and discards survive a reload (IndexedDB)', async ({ page }) => {
  await gotoApp(page)

  // Ember is auto-selected after seeding
  await page.keyboard.press('5') // rate it, advance to Orbit
  await page.keyboard.press('x') // discard Orbit
  await expect(page.getByRole('button', { name: /^rated 1$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^discarded 1$/i })).toBeVisible()

  await page.reload()
  await page.locator('.motif-card').first().waitFor()

  // No reseed (library is non-empty) and triage state came back from IDB
  await expect(page.locator('.motif-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^rated 1$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^discarded 1$/i })).toBeVisible()

  await page.getByRole('button', { name: /^rated 1$/i }).click()
  await expect(page.locator('.card-name')).toHaveText(SEED_NAMES[0])
})

test('a promoted variant survives a reload as the family face', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('m')
  await page.getByRole('button', { name: /^invert$/i }).click()
  await expect(page.locator('.child-card')).toHaveCount(1)
  await page.locator('.child-card').getByRole('button', { name: /^keep$/i }).click()
  await page.getByRole('button', { name: /close bay/i }).click()

  await page.reload()
  await page.locator('.motif-card').first().waitFor()
  await expect(
    page.locator('.motif-card .card-name', { hasText: 'Ember (stepwise) (inversion)' }),
  ).toBeVisible()
  // still 3 families — the variant lives inside
  await expect(page.locator('.motif-card')).toHaveCount(3)
})

test('tests are isolated: a fresh context reseeds exactly the three samples', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.motif-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /^rated 0$/i })).toBeVisible()
})
