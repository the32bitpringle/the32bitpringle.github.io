import { expect, test } from '@playwright/test'

test('reader and guide remain keyboard accessible', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page.getByRole('button', { name: 'Reader' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Guide' }).click()
  await expect(page.getByRole('heading', { name: 'Guide', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByPlaceholder('Search features…')).toBeVisible()
})

test('semantic search opens from the keyboard', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await expect(page.getByRole('dialog', { name: 'Semantic document search' })).toBeVisible()
})

test('reader focus mode and custom hotkeys stay directly controllable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  const dock = page.getByLabel('Reader controls')
  await dock.getByTitle('Settings').click()
  const settings = page.getByLabel('Reader settings')
  await settings.getByLabel('Focus mode hotkey').press('Shift+F')
  await expect(settings.getByLabel('Focus mode hotkey')).toHaveValue('Shift+F')
  await dock.getByTitle('Close').click()

  await page.keyboard.press('Shift+F')
  await expect(page.locator('.app-shell')).toHaveClass(/manual-focus-mode/)
  await expect(dock.getByTitle('Exit focus')).toBeVisible()
  await expect(dock.getByTitle('Narration')).toBeVisible()
  await expect(dock.getByTitle('Settings')).toBeHidden()

  await page.keyboard.press('Shift+F')
  await expect(page.locator('.app-shell')).not.toHaveClass(/manual-focus-mode/)
  await expect(dock.getByTitle('Settings')).toBeVisible()

  await page.reload()
  await dock.getByTitle('Settings').click()
  await expect(page.getByLabel('Focus mode hotkey')).toHaveValue('Shift+F')
})

test('Shortsform mirrors the original live caption mode with rights-gated playback', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Shortsform' }).click()
  await expect(page.getByText('Shortsform mode', { exact: true })).toBeVisible()
  await expect(page.locator('.shortsform-backdrop')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled()

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel(/Speed/)).toBeVisible()
  await expect(page.getByLabel('Caption theme')).toHaveValue('emphasis')
  await expect(page.getByLabel('Caption theme').locator('option')).toHaveCount(7)
  await expect(page.getByLabel('Subtitle case')).toHaveValue('uppercase')
  await expect(page.getByLabel('Upload video')).toBeDisabled()
  await page.getByLabel(/Speed/).fill('420')
  await expect(page.getByLabel(/Speed/)).toHaveValue('420')
  await page.getByLabel(/Subtitle scale/).fill('125')
  await page.getByLabel(/Line length/).fill('7')
  await page.getByLabel('Caption theme').selectOption('karaoke')
  await page.getByLabel('Subtitle case').selectOption('natural')
  await page.getByLabel('Caption alignment').selectOption('left')
  await page.getByLabel(/TTS rate/).fill('1.4')
  await page.getByLabel(/TTS pitch/).fill('0.8')
  await expect(page.getByLabel('Shortsform voice')).toBeEnabled()
  await page.getByLabel('Edge TTS narration').uncheck()
  await page.getByLabel('I own this footage or have permission to download and reuse it.').check()
  await expect(page.getByLabel('Upload video')).toBeEnabled()
  await page.getByPlaceholder('https://www.youtube.com/watch?v=…').fill('https://www.youtube.com/watch?v=authorized')
  await expect(page.getByRole('button', { name: 'Prepare footage' })).toBeEnabled()
  await page.route('**/api/shortsform/footage', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'cancelled test request' }), status: 499 })
  })
  await page.getByRole('button', { name: 'Prepare footage' }).click()
  await expect(page.getByRole('button', { name: 'Cancel preparation' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel preparation' }).click()
  await expect(page.locator('.shortsform-status')).toHaveText('Footage preparation cancelled.')

  await page.getByLabel('Upload file').setInputFiles({
    name: 'shortsform-test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('These live captions advance one word at a time. The second sentence remains in the shared reading timeline.'),
  })
  await page.getByLabel('I own this text or have permission to narrate it.').check()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled()
  await expect(page.locator('.shortsform-captions')).toHaveClass(/subtitle-style-karaoke/)
  await expect(page.locator('.shortsform-captions')).toHaveClass(/subtitle-case-natural/)
  await expect(page.locator('.shortsform-captions')).toHaveClass(/subtitle-align-left/)
  await expect(page.locator('.shortsform-captions')).toHaveAttribute('style', /1.25/)
  await expect(page.locator('.shortsform-caption-line .word').first()).toHaveText(/These/i)
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.shortsform-caption-line .word-being-narrated')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('dark mode and focus auto-hide remain user controlled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await page.getByLabel('Theme').selectOption('dark')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-dark/)

  await page.getByLabel('Context ladder').check()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'focus-test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A clear sentence begins the reading test. Another sentence keeps the reader moving. The final sentence confirms focus mode.'),
  })
  await page.getByLabel('Reader controls').getByTitle('Close').click()
  await page.getByLabel('Reader controls').getByTitle('Play').click()
  await page.waitForTimeout(3200)
  await expect(page.locator('.app-shell')).toHaveClass(/focus-ui-hidden/)
  await expect(page.locator('.word-display')).toBeVisible()
  await expect(page.locator('.progress-track')).toBeVisible()
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(page.getByLabel('Reader controls')).toBeHidden()
  await expect(page.locator('.reader-header')).toBeHidden()
  await expect(page.locator('.context-ladder')).toBeHidden()
  const textBox = await page.locator('.word-display').boundingBox()
  const viewport = page.viewportSize()
  expect(textBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(Math.abs((textBox!.x + textBox!.width / 2) - viewport!.width / 2)).toBeLessThan(40)
  expect(Math.abs((textBox!.y + textBox!.height / 2) - viewport!.height / 2)).toBeLessThan(80)

  await page.keyboard.press('Space')
  await expect(page.locator('.app-shell')).toHaveClass(/focus-ui-hidden/)
  await page.mouse.move(200, 200)
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-ui-hidden/)
})

test('background customization is available in settings and accepts YouTube', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  const dock = page.getByLabel('Reader controls')
  await expect(dock.getByTitle('Background')).toHaveCount(0)
  await dock.getByTitle('Settings').click()
  const settings = page.getByLabel('Reader settings')
  await settings.getByLabel('Image, video, or YouTube URL').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await settings.getByRole('button', { name: 'Apply URL' }).click()
  await expect(page.locator('iframe.background-media')).toHaveAttribute('src', /enablejsapi=1/)
  await settings.getByLabel('Pause background video').check()
  await settings.getByLabel('Loop background video').uncheck()
  await settings.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.locator('iframe.background-media')).toHaveCount(0)
})

test('mobile dock, reduced motion, privacy defaults, and guide remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  const dock = page.getByLabel('Reader controls')
  await expect(dock).toBeVisible()
  await expect(dock.getByTitle('Background')).toHaveCount(0)
  await dock.getByTitle('Settings').click()
  await expect(page.getByLabel('Voice commands')).not.toBeChecked()
  await expect(page.getByLabel('Experimental eye-away detection')).not.toBeChecked()
  await expect(page.getByText(/Camera frames remain local/)).toBeVisible()
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Guide' }).click()
  await expect(page.getByRole('heading', { name: 'Guide', exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('Search features…')).toBeVisible()
})

test('settings controls persist their values and visual modes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByTitle('Settings').click()

  await page.getByLabel('Reading mode').selectOption('study')
  await page.getByLabel('Words per minute', { exact: true }).fill('515')
  await expect(page.locator('.app-shell')).toHaveCSS('--reader-weight', '400')
  await page.getByLabel(/Words per chunk/).fill('4')
  await page.getByLabel(/Font size/).fill('88')
  await page.getByLabel(/Font weight/).fill('600')
  await page.getByLabel('Font family').selectOption("'Atkinson Hyperlegible', sans-serif")
  await page.getByLabel('Theme').selectOption('high-contrast')
  await page.getByLabel('Contrast', { exact: true }).selectOption('high')
  await page.getByLabel('Eye anchor style', { exact: true }).selectOption('grid')
  await page.getByLabel('Eye anchor', { exact: true }).check()
  await page.getByRole('checkbox', { name: 'Focus window', exact: true }).check()
  await page.getByLabel('Motion smoothing').check()
  await page.getByLabel('Buffer heavy words').check()
  await page.getByLabel('Section milestones').uncheck()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'anchor-test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A centered phrase confirms the optional eye anchoring grid.'),
  })

  await expect(page.locator('.app-shell')).toHaveClass(/theme-high-contrast/)
  await expect(page.locator('.app-shell')).toHaveClass(/contrast-high/)
  await expect(page.locator('.app-shell')).toHaveClass(/eye-anchor-grid/)
  await expect(page.locator('.eye-anchor-overlay')).toBeVisible()
  await expect(page.locator('.eye-anchor-overlay .anchor-line')).toHaveCount(6)
  await expect(page.locator('.app-shell')).toHaveClass(/focus-window/)
  await expect(page.locator('.app-shell')).toHaveClass(/motion-smooth/)
  await expect(page.locator('.app-shell')).toHaveCSS('--reader-size', '88px')
  await expect(page.locator('.app-shell')).toHaveCSS('--reader-weight', '600')

  await page.reload()
  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await expect(page.getByLabel('Words per minute', { exact: true })).toHaveValue('515')
  await expect(page.getByLabel(/Words per chunk/)).toHaveValue('4')
  await expect(page.getByLabel(/Font size/)).toHaveValue('88')
  await expect(page.getByLabel(/Font weight/)).toHaveValue('600')
  await expect(page.getByLabel('Theme')).toHaveValue('high-contrast')
  await expect(page.getByLabel('Contrast', { exact: true })).toHaveValue('high')
  await expect(page.getByLabel('Eye anchor style', { exact: true })).toHaveValue('grid')
  await expect(page.getByLabel('Eye anchor', { exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Focus window', exact: true })).toBeChecked()
  await expect(page.getByLabel('Motion smoothing')).toBeChecked()
  await expect(page.getByLabel('Buffer heavy words')).toBeChecked()
  await expect(page.getByLabel('Section milestones')).not.toBeChecked()
})

test('reader narration requests natural Edge TTS phrases without restarting for every visual chunk', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get: () => 4,
    })
    HTMLMediaElement.prototype.load = function load() {
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
    }
    HTMLMediaElement.prototype.play = async function play() {
      this.dispatchEvent(new Event('play'))
    }
    HTMLMediaElement.prototype.pause = function pause() {}
  })
  const narrationRequests: Array<{ rate: string; text: string }> = []
  await page.route('**/api/tts', async (route) => {
    const body = route.request().postDataJSON() as { rate: string; text: string }
    narrationRequests.push(body)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        audioBase64: 'SUQz',
        timings: body.text.split(/\s+/).map((text, index) => ({
          durationMs: 120,
          offsetMs: index * 180,
          text,
        })),
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'narration-test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('This complete sentence should be narrated naturally instead of restarting after every displayed chunk.'),
  })
  await page.getByLabel('Reader controls').getByTitle('Narration').click()
  await page.getByLabel('Reader controls').getByTitle('Play').click()
  await page.waitForTimeout(6200)

  expect(narrationRequests).toHaveLength(1)
  expect(narrationRequests[0]).toMatchObject({
    rate: '-30%',
    text: 'This complete sentence should be narrated naturally instead of restarting after every displayed chunk.',
  })
})
