import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoApp, SEED_NAMES } from './helpers'

const selectedName = (page: Page) => page.locator('.motif-card.selected .card-name')

test('the first motif is selected on load, and arrow keys navigate', async ({ page }) => {
  await gotoApp(page)
  // MOTIFS_ADDED auto-selects the first added motif
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])

  await page.keyboard.press('ArrowRight')
  await expect(selectedName(page)).toHaveText(SEED_NAMES[1])

  await page.keyboard.press('ArrowRight')
  await expect(selectedName(page)).toHaveText(SEED_NAMES[2])

  // Selection clamps at the edges instead of wrapping
  await page.keyboard.press('ArrowRight')
  await expect(selectedName(page)).toHaveText(SEED_NAMES[2])

  await page.keyboard.press('ArrowLeft')
  await expect(selectedName(page)).toHaveText(SEED_NAMES[1])
})

test('rating with 1–5 rates the selected motif and advances', async ({ page }) => {
  await gotoApp(page)
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])
  await page.keyboard.press('4')

  await expect(page.getByRole('button', { name: 'rated (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'unrated (2)', exact: true })).toBeVisible()
  // advanced to the next card
  await expect(selectedName(page)).toHaveText(SEED_NAMES[1])
})

test('x discards (soft) and u restores', async ({ page }) => {
  await gotoApp(page)
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])
  await page.keyboard.press('x')

  await expect(page.locator('.motif-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'discarded (1)', exact: true })).toBeVisible()

  // the discarded card is still there behind the discarded filter (soft delete)
  await page.getByRole('button', { name: 'discarded (1)', exact: true }).click()
  await expect(page.locator('.motif-card.discarded .card-name')).toHaveText(SEED_NAMES[0])

  await page.getByRole('button', { name: 'all (2)', exact: true }).click()
  await page.keyboard.press('u')
  await expect(page.locator('.motif-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'discarded (0)', exact: true })).toBeVisible()
})

test('rated filter shows only rated motifs', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('5')
  await page.getByRole('button', { name: 'rated (1)', exact: true }).click()
  await expect(page.locator('.motif-card')).toHaveCount(1)
  await expect(page.locator('.card-name')).toHaveText(SEED_NAMES[0])
})

test('triage keys are ignored while typing in a text field', async ({ page }) => {
  await gotoApp(page)
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])
  const concept = page.getByRole('textbox', { name: 'concept' })
  await concept.click()
  await concept.pressSequentially('3x')

  await expect(concept).toHaveValue('3x')
  await expect(page.getByRole('button', { name: 'rated (0)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'discarded (0)', exact: true })).toBeVisible()
  await expect(page.locator('.motif-card')).toHaveCount(3)
})

test('clicking a card selects it', async ({ page }) => {
  await gotoApp(page)
  await page.locator('.motif-card', { hasText: SEED_NAMES[2] }).click()
  await expect(selectedName(page)).toHaveText(SEED_NAMES[2])
})
