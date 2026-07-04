import { expect, test } from '@playwright/test'
import { gotoApp, mockGeneration, mockMotif } from './helpers'

test('INSTANT engine generates a batch with the LLM route dead', async ({ page }) => {
  // No mock at all: kill the Anthropic proxy outright to prove the symbolic
  // tier has zero network dependency.
  await page.route('**/api/anthropic/**', (route) => route.abort())
  await gotoApp(page)

  await page.locator('.wb-seg-label', { hasText: 'INSTANT' }).click()
  await page.getByRole('button', { name: 'Generate +5' }).click()

  // 3 seeds + 5 symbolic candidates, no failure notification.
  await expect(page.locator('.motif-card')).toHaveCount(8)
  await expect(page.getByRole('alert')).toContainText('5 added')
  await expect(page.locator('.pending-card')).toHaveCount(0)
})

test('INSTANT with brief text falls back gracefully when the planner returns junk', async ({
  page,
}) => {
  // The mocked proxy answers the planner call with a generation payload —
  // parseInstantPlan returns null and the batch proceeds unplanned.
  await mockGeneration(page, [mockMotif('unused')])
  await gotoApp(page)

  await page.locator('.wb-seg-label', { hasText: 'INSTANT' }).click()
  await page.getByPlaceholder(/Contour, rhythmic character/).fill('sparse and hollow dread')
  await page.getByRole('button', { name: 'Generate +5' }).click()

  await expect(page.locator('.motif-card')).toHaveCount(8)
  await expect(page.getByRole('alert')).toContainText('5 added')
  await expect(page.locator('.pending-card')).toHaveCount(0)
})
