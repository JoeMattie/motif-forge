import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoApp, openBay } from './helpers'

/** Widths below the ~13" MacBook the layout was designed on. The generate
 * panel's columns wrap under 1320px; the header and toolbars wrap wherever
 * they run out of room. */
const NARROW_WIDTHS = [1280, 1100, 900, 800]

/** Assert nothing rendered extends past the viewport's horizontal edges —
 * clipped buttons and off-screen panels both fail this. */
async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const offenders: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        const cls = el.getAttribute('class')?.split(/\s+/).slice(0, 3).join('.') ?? ''
        offenders.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`)
      }
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders }
  })
  expect(result.offenders, `${where} @ ${result.vw}px`).toEqual([])
  expect(result.scrollWidth, `${where} @ ${result.vw}px document width`).toBeLessThanOrEqual(
    result.vw + 1,
  )
}

for (const width of NARROW_WIDTHS) {
  test(`triage grid + generate panel fit a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await gotoApp(page)
    await expectNoHorizontalOverflow(page, 'triage grid')

    // The action keys must stay reachable, not just unclipped.
    await expect(page.getByRole('button', { name: 'Generate +5' })).toBeInViewport()

    // Collapsed strip wraps its summary + keys instead of overflowing.
    await page.getByRole('button', { name: /^Generate$/ }).first().click()
    await expectNoHorizontalOverflow(page, 'collapsed strip')
  })
}

test('focus deck, library, concepts, and the bay fit an 800px window', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 })
  await gotoApp(page)

  await page.locator('.wb-header .wb-seg-label', { hasText: 'focus' }).click()
  await expect(page.locator('.focus-lcd')).toBeVisible()
  await expectNoHorizontalOverflow(page, 'focus deck')

  await openBay(page)
  await expectNoHorizontalOverflow(page, 'mutation bay')
  await page.keyboard.press('Escape')

  await page.getByRole('tab', { name: 'LIBRARY' }).click()
  await expectNoHorizontalOverflow(page, 'library')

  await page.getByRole('tab', { name: 'CONCEPTS' }).click()
  await expectNoHorizontalOverflow(page, 'concepts')
})
