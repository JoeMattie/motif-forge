import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('INSTANT engine generates a batch with the LLM route dead', async ({ page }) => {
  // No mock at all: kill the Anthropic proxy outright to prove the symbolic
  // tier has zero network dependency.
  await page.route('**/api/anthropic/**', (route) => route.abort())
  await gotoApp(page)

  await page.locator('.gen-title').click()
  await page.locator('.wb-seg-label', { hasText: 'INSTANT' }).click()
  await page.getByRole('button', { name: 'Generate +5' }).click()

  // 3 seeds + 5 symbolic candidates, no failure toast.
  await expect(page.locator('.motif-card')).toHaveCount(8)
  await expect(page.getByRole('button', { name: '5 added' })).toBeVisible()
  await expect(page.locator('.pending-card')).toHaveCount(0)
})
