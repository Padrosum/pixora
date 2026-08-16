import { expect, test } from '@playwright/test'

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('opens the Features and Privacy pages', async ({ page }) => {
  await page.goto('/?page=features')
  await expect(page.getByRole('heading', { name: /A sharper workflow/i })).toBeVisible()
  await page.getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByRole('heading', { name: /Your images stay/i })).toBeVisible()
})

test('switches the interface to Turkish', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Language' }).selectOption('tr')
  await expect(page.getByRole('heading', { name: /Ücretsiz görsel araçları/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Görsel seç/i }).first()).toBeVisible()
})

test('shows crop handles and metadata status after upload', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: onePixelPng })
  await expect(page.getByRole('button', { name: 'Crop' })).toBeVisible()
  await page.getByRole('button', { name: 'Crop' }).click()
  await expect(page.getByTestId('crop-handle-nw')).toBeVisible()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByTestId('metadata-status')).toContainText('Metadata removed')
})
