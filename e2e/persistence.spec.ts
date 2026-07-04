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

test('a promoted mix and its bay tree survive a reload', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('m')

  // Invert via ADVANCED → tree node; select it and promote the mix
  await page.getByRole('button', { name: /^adv$/i }).click()
  await page.getByRole('button', { name: /^invert$/i }).click()
  await expect(page.locator('.tree-node')).toHaveCount(1)
  await page.locator('.tree-node').getByRole('button', { name: /^use$/i }).click()
  await page.getByRole('button', { name: /promote mix/i }).click()
  await page.getByRole('button', { name: /close bay/i }).click()

  // make the mix the family face from the tray
  await page.keyboard.press('f')
  await page.locator('.family-tray').getByRole('button', { name: /^use$/i }).click()

  await page.reload()
  await page.locator('.motif-card').first().waitFor()
  await expect(
    page.locator('.motif-card .card-name', { hasText: 'Ember (stepwise) mix' }),
  ).toBeVisible()
  // still 3 families — the variant lives inside
  await expect(page.locator('.motif-card')).toHaveCount(3)

  // the bay workspace came back from IDB too. Opening the bay lands on the
  // family face (the mix), whose own workspace is empty — hop up the lineage
  // to the original, where the tree lives, still with the take in the mix.
  await page.locator('.motif-card', { hasText: SEED_NAMES[0] }).click()
  await page.keyboard.press('m')
  await expect(page.locator('.bay')).toBeVisible()
  await page.getByRole('button', { name: /^seed$/i }).click()
  await expect(page.locator('.tree-node')).toHaveCount(1)
  await expect(page.locator('.tree-node.in-mix')).toHaveCount(1)
})

test('tests are isolated: a fresh context reseeds exactly the three samples', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.motif-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /^rated 0$/i })).toBeVisible()
})
