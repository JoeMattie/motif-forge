import { expect, test } from '@playwright/test'
import { gotoApp, mockMotif } from './helpers'

const STORAGE_KEY = 'motif-forge:anthropic-key'
const FAKE_KEY = 'sk-ant-e2e-fake-key'

test('a stored key sends generation straight to api.anthropic.com', async ({ page }) => {
  // Mantine's useLocalStorage JSON-stringifies values — seed it the same way.
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, JSON.stringify(v)),
    [STORAGE_KEY, FAKE_KEY] as const,
  )

  let directHeaders: Record<string, string> | null = null
  await page.route('**/api.anthropic.com/v1/messages', (route) => {
    directHeaders = route.request().headers()
    return route.fulfill({
      json: {
        content: [{ type: 'text', text: JSON.stringify({ motifs: [mockMotif('Direct Call')] }) }],
        stop_reason: 'end_turn',
      },
    })
  })

  await gotoApp(page)
  await page.locator('.gen-title').click()
  await page.locator('.wb-seg-label', { hasText: 'CLAUDE' }).click()
  await page.getByRole('button', { name: 'Generate +5' }).click()

  await expect(page.locator('.card-name', { hasText: 'Direct Call' })).toBeVisible()
  expect(directHeaders?.['x-api-key']).toBe(FAKE_KEY)
  expect(directHeaders?.['anthropic-version']).toBe('2023-06-01')
  expect(directHeaders?.['anthropic-dangerous-direct-browser-access']).toBe('true')
})

test('the KEY modal saves and clears the key, latching the header button', async ({ page }) => {
  await gotoApp(page)
  const keyButton = page.locator('.wb-header').getByRole('button', { name: /^key$/i })
  await expect(keyButton).toHaveAttribute('data-latched', 'false')

  await keyButton.click()
  await page.getByLabel('Anthropic API key').fill(FAKE_KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await expect(keyButton).toHaveAttribute('data-latched', 'true')

  await keyButton.click()
  await page.getByRole('button', { name: 'Clear key' }).click()
  await expect(keyButton).toHaveAttribute('data-latched', 'false')
})
