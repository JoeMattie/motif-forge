import { expect, test } from '@playwright/test'
import { gotoApp, SEED_NAMES } from './helpers'

test('ratings and discards survive a reload (IndexedDB)', async ({ page }) => {
  await gotoApp(page)

  // Ember is auto-selected after seeding
  await page.keyboard.press('5') // rate it, advance to Orbit
  await page.keyboard.press('x') // discard Orbit
  await expect(page.getByRole('button', { name: 'rated (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'discarded (1)', exact: true })).toBeVisible()

  await page.reload()
  await page.locator('.motif-card').first().waitFor()

  // No reseed (library is non-empty) and triage state came back from IDB
  await expect(page.locator('.motif-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'rated (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'discarded (1)', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'rated (1)', exact: true }).click()
  await expect(page.locator('.card-name')).toHaveText(SEED_NAMES[0])
})

test('tests are isolated: a fresh context reseeds exactly the three samples', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.motif-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'rated (0)', exact: true })).toBeVisible()
})
