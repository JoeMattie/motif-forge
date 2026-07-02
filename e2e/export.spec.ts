import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('the .mid button downloads a well-formed format-0 SMF', async ({ page }) => {
  await gotoApp(page)

  const ember = page.locator('.motif-card', { hasText: 'Ember (stepwise)' })
  const downloadPromise = page.waitForEvent('download')
  await ember.getByRole('button', { name: '.mid' }).click()
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
