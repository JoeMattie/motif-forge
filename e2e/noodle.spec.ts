import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

/**
 * The deterministic Noodle path: open the panel, pencil notes into the roll,
 * commit with ADD TO POOL, and see a fresh family card in the triage grid.
 * Mic/MIDI hardware paths are manual — Joe tests those himself.
 */

async function openNoodle(page: import('@playwright/test').Page): Promise<void> {
  // GENERATE and NOODLE share one tabbed dock — switching tabs swaps the
  // generate module out, so the roll never sits under a floating panel.
  await page.getByRole('tab', { name: /^noodle/i }).click()
  await expect(page.locator('.noodle-roll')).toBeVisible()
}

test('noodle tab opens the panel; clicking it again folds to the strip', async ({ page }) => {
  await gotoApp(page)
  // GENERATE is the default tab — the noodle panel is hidden until switched.
  await expect(page.locator('.noodle-roll')).toBeHidden()
  await openNoodle(page)
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(0)
  // Clicking the active tab folds the dock to the summary strip; the commit
  // key is disabled while the take is empty.
  await page.getByRole('tab', { name: /^noodle/i }).click()
  const strip = page.locator('.noodle-strip')
  await expect(strip).toBeVisible()
  await expect(strip.getByRole('button', { name: /add to pool/i })).toBeDisabled()
})

test('pencil notes, then ADD TO POOL creates a recorded family card', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.motif-card')).toHaveCount(3)
  await openNoodle(page)

  // Pencil two notes onto the roll (click = create with last-used duration).
  const svg = page.locator('.noodle-svg')
  const box = (await svg.boundingBox())!
  await svg.click({ position: { x: 30, y: box.height / 2 } })
  await svg.click({ position: { x: Math.min(box.width - 10, 200), y: box.height / 2 - 45 } })
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(2)

  const panel = page.locator('.noodle-panel')
  await panel.getByRole('button', { name: /add to pool/i }).click()
  await expect(page.locator('.motif-card')).toHaveCount(4)
  await expect(page.locator('.card-name', { hasText: /^Noodle / })).toBeVisible()

  // The panel keeps the take staged so variants can be committed.
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(2)
})

test('undo and clear work on penciled notes', async ({ page }) => {
  await gotoApp(page)
  await openNoodle(page)
  const svg = page.locator('.noodle-svg')
  const box = (await svg.boundingBox())!
  await svg.click({ position: { x: 40, y: box.height / 2 } })
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(1)

  const panel = page.locator('.noodle-panel')
  await panel.getByRole('button', { name: /^undo$/i }).click()
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(0)

  await svg.click({ position: { x: 40, y: box.height / 2 } })
  await svg.click({ position: { x: 120, y: box.height / 2 } })
  await panel.getByRole('button', { name: /^clear$/i }).click()
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(0)
  await panel.getByRole('button', { name: /^undo$/i }).click()
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(2)
})
