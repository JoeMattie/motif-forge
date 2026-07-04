import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

/**
 * The deterministic Noodle path: open the panel, pencil notes into the roll,
 * commit with ADD TO POOL, and see a fresh family card in the triage grid.
 * Mic/MIDI hardware paths are manual — Joe tests those himself.
 */

async function openNoodle(page: import('@playwright/test').Page): Promise<void> {
  // The gen panel docks sticky over the scrolling view and, when expanded at
  // this viewport width, floats over the roll's upper rows — swallowing
  // pencil clicks. Collapse it to its strip first, like a user would.
  await page.getByRole('button', { name: /^Generate$/ }).first().click()
  await page.getByRole('button', { name: /^noodle$/i }).click()
  await expect(page.locator('.noodle-roll')).toBeVisible()
}

test('panel opens collapsed with an empty take', async ({ page }) => {
  await gotoApp(page)
  const strip = page.locator('.noodle-strip')
  await expect(strip).toBeVisible()
  await expect(strip.getByRole('button', { name: /add to pool/i })).toBeDisabled()
  await openNoodle(page)
  await expect(page.locator('.noodle-svg rect.roll-note')).toHaveCount(0)
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
