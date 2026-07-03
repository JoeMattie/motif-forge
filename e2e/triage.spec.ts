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

  await expect(page.getByRole('button', { name: /^rated 1$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^unrated 2$/i })).toBeVisible()
  // advanced to the next card
  await expect(selectedName(page)).toHaveText(SEED_NAMES[1])
})

test('x discards (soft) and u restores', async ({ page }) => {
  await gotoApp(page)
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])
  await page.keyboard.press('x')

  await expect(page.locator('.motif-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^discarded 1$/i })).toBeVisible()

  // the discarded card is still there behind the discarded filter (soft delete)
  await page.getByRole('button', { name: /^discarded 1$/i }).click()
  await expect(page.locator('.motif-card.discarded .card-name')).toHaveText(SEED_NAMES[0])

  await page.getByRole('button', { name: /^all 2$/i }).click()
  await page.keyboard.press('u')
  await expect(page.locator('.motif-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /^discarded 0$/i })).toBeVisible()
})

test('rated filter shows only rated families', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('5')
  await page.getByRole('button', { name: /^rated 1$/i }).click()
  await expect(page.locator('.motif-card')).toHaveCount(1)
  await expect(page.locator('.card-name')).toHaveText(SEED_NAMES[0])
})

test('triage keys are ignored while typing in a text field', async ({ page }) => {
  await gotoApp(page)
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])
  // the concept field lives inside the expanded generation module
  await page.getByRole('button', { name: /^generate$/i }).click()
  const concept = page.getByPlaceholder(/concept — e\.g\./)
  await concept.click()
  await concept.pressSequentially('3x')

  await expect(concept).toHaveValue('3x')
  await expect(page.getByRole('button', { name: /^rated 0$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^discarded 0$/i })).toBeVisible()
  await expect(page.locator('.motif-card')).toHaveCount(3)
})

test('clicking a card selects it', async ({ page }) => {
  await gotoApp(page)
  await page.locator('.motif-card', { hasText: SEED_NAMES[2] }).click()
  await expect(selectedName(page)).toHaveText(SEED_NAMES[2])
})

test('f folds out the family tray and the fold key closes it', async ({ page }) => {
  await gotoApp(page)
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])
  await page.keyboard.press('f')

  const tray = page.locator('.family-tray')
  await expect(tray).toBeVisible()
  await expect(tray.locator('.family-tray-title')).toHaveText(`FAMILY — ${SEED_NAMES[0]}`)
  // origin mini-card + the dashed new-variation slot
  await expect(tray.locator('.tray-card')).toHaveCount(1)
  await expect(tray.locator('.tray-slot-new')).toBeVisible()

  await tray.getByRole('button', { name: /fold/i }).click()
  await expect(page.locator('.family-tray')).toHaveCount(0)
})

test('selecting a different family card folds the open tray back in', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('f')
  await expect(page.locator('.family-tray')).toBeVisible()

  // keyboard navigation to another family collapses it…
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.family-tray')).toHaveCount(0)

  // …and so does clicking another card
  await page.locator('.motif-card', { hasText: SEED_NAMES[1] }).click()
  await page.keyboard.press('f')
  await expect(page.locator('.family-tray')).toBeVisible()
  await page.locator('.motif-card', { hasText: SEED_NAMES[2] }).click()
  await expect(page.locator('.family-tray')).toHaveCount(0)
})

test('m opens the mutation bay; a transform lands in the tray, not the grid', async ({ page }) => {
  await gotoApp(page)
  await expect(selectedName(page)).toHaveText(SEED_NAMES[0])
  await page.keyboard.press('m')

  await expect(page.locator('.bay')).toBeVisible()
  await expect(page.locator('.wb-header')).toContainText(/mutation bay/i)

  // deterministic transform: instant client-side child
  await page.getByRole('button', { name: /^invert$/i }).click()
  await expect(page.locator('.child-card')).toHaveCount(1)
  await expect(page.locator('.child-card .child-badge')).toContainText(/invert/i)

  // close the bay: the grid still shows 3 family cards (encapsulation) with a stack lip
  await page.getByRole('button', { name: /close bay/i }).click()
  await expect(page.locator('.motif-card')).toHaveCount(3)
  const ember = page.locator('.motif-card', { hasText: SEED_NAMES[0] })
  await expect(ember.locator('.stack-lip')).toBeVisible()
  await expect(ember.locator('.family-chip')).toContainText('1')
})

test('clicking a card with variants folds its tray out', async ({ page }) => {
  await gotoApp(page)
  // give Ember a variant so it has a tray worth opening
  await page.keyboard.press('m')
  await page.getByRole('button', { name: /^invert$/i }).click()
  await expect(page.locator('.child-card')).toHaveCount(1)
  await page.getByRole('button', { name: /close bay/i }).click()

  await page.locator('.motif-card', { hasText: SEED_NAMES[0] }).click()
  await expect(page.locator('.family-tray')).toBeVisible()

  // clicking a variant-less card collapses it without opening a new one
  await page.locator('.motif-card', { hasText: SEED_NAMES[1] }).click()
  await expect(page.locator('.family-tray')).toHaveCount(0)
})

test('down arrow descends into the open tray; up returns to the anchor', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('m')
  await page.getByRole('button', { name: /^invert$/i }).click()
  await expect(page.locator('.child-card')).toHaveCount(1)
  await page.getByRole('button', { name: /close bay/i }).click()

  await page.locator('.motif-card', { hasText: SEED_NAMES[0] }).click() // opens the tray
  await expect(page.locator('.family-tray')).toBeVisible()

  // descend: the origin IS the anchor card, so the cursor lands on the first variant
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.tray-card.selected')).toHaveCount(1)
  await expect(page.locator('.tray-card.selected .tray-card-name')).toContainText('inversion')

  // up climbs back out to the anchor card
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.tray-card.selected')).toHaveCount(0)
  await expect(page.locator('.motif-card.selected .card-name')).toHaveText(SEED_NAMES[0])
})

test('in the mutation bay, space plays the source and Escape closes the bay', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('m')
  await expect(page.locator('.bay')).toBeVisible()

  await page.keyboard.press(' ')
  await expect(page.locator('.transport-strip .now-name')).toHaveText(SEED_NAMES[0])
  await page.keyboard.press(' ')
  await expect(page.locator('.transport-strip .now-name')).toHaveCount(0)

  // space while typing in the brief stays in the textarea
  const brief = page.getByPlaceholder(/reharmonize darker/)
  await brief.click()
  await brief.pressSequentially('a b')
  await expect(brief).toHaveValue('a b')
  await expect(page.locator('.transport-strip .now-name')).toHaveCount(0)

  // first ESC blurs the field, second closes the bay
  await page.keyboard.press('Escape')
  await expect(page.locator('.bay')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.bay')).toHaveCount(0)
  await expect(page.locator('.motif-grid')).toBeVisible()
})

test('promoting a tray variant makes it the family face in the grid', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('m')
  await page.getByRole('button', { name: /^invert$/i }).click()
  await expect(page.locator('.child-card')).toHaveCount(1)
  await page.getByRole('button', { name: /close bay/i }).click()

  await page.keyboard.press('f')
  const tray = page.locator('.family-tray')
  await expect(tray.locator('.tray-card')).toHaveCount(2)
  await tray.getByRole('button', { name: /^promote$/i }).click()

  // the grid card now faces the promoted variant
  await expect(
    page.locator('.motif-card .card-name', { hasText: 'Ember (stepwise) (inversion)' }),
  ).toBeVisible()
  await expect(tray.locator('.promote-chip[data-promoted="true"]')).toBeVisible()
})
