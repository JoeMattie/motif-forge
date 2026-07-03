import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('the focus-mode .MID key downloads a well-formed format-0 SMF', async ({ page }) => {
  await gotoApp(page)

  // Ember is auto-selected; focus mode exports the current deck motif.
  await page.locator('.wb-header .wb-seg-label', { hasText: 'focus' }).click()
  await expect(page.locator('.focus-lcd-title')).toHaveText('Ember (stepwise)')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('.focus-controls').getByRole('button', { name: '.MID' }).click()
  const download = await downloadPromise

  // name slug + key/mode + motif tempo (transport defaults to per-motif tempo)
  expect(download.suggestedFilename()).toBe('ember-stepwise_D-dorian_96bpm.mid')

  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('MThd')
  // format 0, one track, 480 TPQN
  expect(bytes.readUInt16BE(8)).toBe(0)
  expect(bytes.readUInt16BE(10)).toBe(1)
  expect(bytes.readUInt16BE(12)).toBe(480)
  expect(bytes.subarray(14, 18).toString('latin1')).toBe('MTrk')
})

test('library EXPORT ALL and per-family .MID download promoted takes', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('5') // rate Ember so it clears the library's ★3 gate

  await page.locator('.wb-header').getByRole('button', { name: /^library$/i }).click()
  await expect(page.locator('.motif-card')).toHaveCount(1)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('.card-concept-row').getByRole('button', { name: '.MID' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('ember-stepwise_D-dorian_96bpm.mid')
})
