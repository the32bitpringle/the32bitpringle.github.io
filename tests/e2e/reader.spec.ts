import { expect, test, type Page } from '@playwright/test'

async function skipCalibration(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip' })
  if (await skip.count()) await skip.click()
}

async function importPlainText(page: Page, text: string, name = 'reader-test.txt') {
  await page.getByRole('button', { name: 'Import (O)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import reading' })
  await dialog.locator('input[type="file"]').nth(2).setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  })
}

async function chooseTheme(page: Page, name: string) {
  await page.getByLabel('Theme').getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
}

test('reader and guide remain keyboard accessible', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
  await expect(page.getByRole('button', { name: 'Reader' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Guide' }).click()
  await expect(page.getByRole('heading', { name: 'Guide', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByPlaceholder('Search features…')).toBeVisible()
})

test('reader imports pasted Markdown and exposes guided ebook sources', async ({ page }) => {
  await page.route('**/api/grouping', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ prefixes: [], suffixes: [], joiners: [], standalone: [], notes: [], languageCode: 'en' }),
  }))
  await page.route('**/api/complexity', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ difficultWords: [] }),
  }))
  await page.goto('/')
  await skipCalibration(page)
  await page.getByRole('button', { name: 'Add reading' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import reading' })
  await expect(dialog.getByRole('button', { name: 'Kindle Cloud Reader' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Libby' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Paste text' }).click()
  await dialog.getByLabel('Title', { exact: true }).fill('Pasted guide')
  await dialog.getByLabel('Format', { exact: true }).selectOption('markdown')
  await dialog.getByLabel('Text', { exact: true }).fill('# Opening\n\nA **clear** passage imported from Markdown.')
  await dialog.getByRole('button', { name: 'Import text' }).click()
  await expect(page.locator('.reader-header strong')).toHaveText('Pasted guide')
  await expect(page.locator('.word-display')).toContainText('clear')
})

test('Word Focus highlights the active word in the document and shares Reader settings', async ({ page }) => {
  await page.route('**/api/tts', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ audioBase64: 'SUQz', timings: [] }),
    })
  })
  await page.goto('/')
  await skipCalibration(page)
  await importPlainText(page, 'Focused reading keeps each word clear and centered.', 'word-focus.txt')
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()

  await expect(page.locator('.word-focus-document')).toContainText('Focused reading keeps each word clear and centered.')
  await expect(page.locator('.word-focus-token.active')).toHaveText('Focused')
  await expect(page.getByLabel('Word Focus controls')).toBeVisible()

  await page.getByLabel('Word Focus controls').getByTitle('Settings').click()
  await chooseTheme(page, 'Sepia')
  await page.getByLabel('Font family').selectOption('Georgia, serif')
  await page.getByLabel('Words per minute').fill('600')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-sepia/)
  await expect(page.locator('.word-focus-document')).toHaveCSS('font-family', 'Georgia, serif')
  await expect(page.locator('.app-shell')).toHaveCSS('--focus-red', '#b43b2d')
  await page.getByLabel('Background', { exact: true }).fill('#123456')
  await page.getByRole('button', { name: 'Reset colors' }).click()
  await expect(page.getByLabel('Background', { exact: true })).toHaveValue('#fbfaf4')
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue('#091717')
  await expect(page.getByLabel('Narration pace')).toBeVisible()
  await page.getByLabel('Ambient audio').selectOption('soft-drums')
  await expect(page.getByLabel('Ambient audio')).toHaveValue('soft-drums')
  await page.getByLabel('Word Focus controls').getByTitle(/Close settings/).click()

  await page.getByLabel('Word Focus controls').getByTitle(/Narration/).click()
  await expect(page.getByLabel('Word Focus controls').getByTitle(/Pause/)).toBeVisible()
  await expect(page.locator('.word-focus-token.active')).toHaveCount(1)
  await expect(page.locator('.word-focus-token.active')).toHaveText('Focused')
})

test('Word Focus stays responsive with one active word in a long document', async ({ page }) => {
  const longPassage = Array.from(
    { length: 12000 },
    (_, index) => `reading${index}`,
  ).join(' ')

  await page.goto('/')
  await skipCalibration(page)
  await importPlainText(page, longPassage, 'long-word-focus.txt')
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()
  await expect(page.locator('.word-focus-token')).toHaveCount(960)
  await expect(page.locator('.word-focus-token.active')).toHaveCount(1)

  const dock = page.getByLabel('Word Focus controls')
  await dock.getByTitle('Settings').click()
  await page.getByLabel('Words per minute').fill('1000')
  await dock.getByTitle(/Close settings/).click()

  const activeIndex = () => page.evaluate(() => {
    const tokens = [...document.querySelectorAll('.word-focus-token')]
    return tokens.indexOf(document.querySelector('.word-focus-token.active')!)
  })
  const initialIndex = await activeIndex()
  await dock.getByTitle(/Play/).click()

  await expect.poll(activeIndex, { timeout: 1500 }).toBeGreaterThan(initialIndex + 10)
  await expect(page.locator('.word-focus-token.active')).toHaveCount(1)
})

test('semantic search opens from the keyboard', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await expect(page.getByRole('dialog', { name: 'Semantic document search' })).toBeVisible()
})

test('reader focus mode and custom hotkeys stay directly controllable', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
  const dock = page.getByLabel('Reader controls')
  await dock.getByTitle('Settings').click()
  const settings = page.getByLabel('Reader settings')
  await settings.getByLabel('Focus mode hotkey').press('Shift+F')
  await expect(settings.getByLabel('Focus mode hotkey')).toHaveValue('Shift+F')
  await dock.getByTitle(/Close settings/).click()

  await page.keyboard.press('Shift+F')
  await expect(page.locator('.app-shell')).toHaveClass(/manual-focus-mode/)
  await expect(dock.getByTitle(/Exit focus/)).toBeVisible()
  await expect(dock.getByTitle(/Narration/)).toBeVisible()
  await expect(dock.getByTitle('Settings')).toBeHidden()

  await page.keyboard.press('Shift+F')
  await expect(page.locator('.app-shell')).not.toHaveClass(/manual-focus-mode/)
  await expect(dock.getByTitle('Settings')).toBeVisible()

  await page.reload()
  await dock.getByTitle('Settings').click()
  await expect(page.getByLabel('Focus mode hotkey')).toHaveValue('Shift+F')
})

test('reader dock shortcuts open bounded text view with visible reaction marks', async ({ page }) => {
  const longPassage = Array.from(
    { length: 5000 },
    (_, index) => `word${index}`,
  ).join(' ')

  await page.goto('/')
  await skipCalibration(page)
  await importPlainText(page, longPassage, 'reaction-shortcuts.txt')

  const dock = page.getByLabel('Reader controls')
  await dock.getByTitle(/Mark/).click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('2')
  await page.keyboard.press('v')

  await expect(page.locator('.text-viewer')).toBeVisible()
  await expect(page.getByText(/^Marked:/)).toBeVisible()
  await expect(page.getByText(/^Confused:/)).toBeVisible()
  await expect(page.locator('.reaction-label', { hasText: 'Marked' })).toBeVisible()
  await expect(page.locator('.reaction-label', { hasText: 'Confused' })).toBeVisible()
  await expect(page.locator('.text-viewer-window')).toContainText('Showing words')
  await expect(page.locator('.text-token')).toHaveCount(900)

  await page.locator('.text-viewer').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.text-viewer')).toBeHidden()
  await page.keyboard.press('Shift+/')
  await expect(page.getByRole('dialog').filter({ hasText: 'Keyboard shortcuts' })).toContainText('Import')
  await expect(page.getByRole('dialog').filter({ hasText: 'Keyboard shortcuts' })).toContainText('Locked in')
})

test('Shortsform mirrors the original live caption mode with rights-gated playback', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
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
  await page.route('**/api/shortsform/footage/upload', async (route) => {
    expect(route.request().method()).toBe('POST')
    expect(await route.request().headerValue('content-type')).toContain('multipart/form-data')
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        assetId: '00000000-0000-4000-8000-000000000000',
        previewUrl: '/api/shortsform/footage/00000000-0000-4000-8000-000000000000',
        title: 'uploaded clip',
      }),
    })
  })
  await page.getByLabel('Upload video').setInputFiles({
    name: 'uploaded-clip.m4v',
    mimeType: 'video/x-m4v',
    buffer: Buffer.from('video'),
  })
  await expect(page.locator('.shortsform-status')).toHaveText('Footage ready: uploaded clip')
  await page.getByPlaceholder('https://www.youtube.com/watch?v=…').fill('https://www.youtube.com/watch?v=authorized')
  await expect(page.getByRole('button', { name: 'Use YouTube preview' })).toBeEnabled()
  await page.getByRole('button', { name: 'Use YouTube preview' }).click()
  await expect(page.locator('.shortsform-youtube')).toHaveAttribute('src', /youtube\.com\/embed\/authorized/)
  await expect(page.locator('.shortsform-status')).toContainText('YouTube preview ready')
  await page.route('**/api/shortsform/footage', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'cancelled test request' }), status: 499 })
  })
  await page.getByRole('button', { name: 'Cache compact copy' }).click()
  await expect(page.getByRole('button', { name: 'Cancel caching' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel caching' }).click()
  await expect(page.locator('.shortsform-status')).toHaveText('Footage caching cancelled.')

  await page.getByRole('button', { name: 'Upload file' }).click()
  await page.getByRole('dialog', { name: 'Import reading' }).locator('input[type="file"]').nth(2).setInputFiles({
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

test('Shortsform WPM advances captions while narration is still preparing', async ({ page }) => {
  await page.route('**/api/tts', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ audioBase64: 'SUQz', timings: [] }),
    })
  })
  await page.goto('/')
  await skipCalibration(page)
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Shortsform' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel(/Speed/).fill('600')
  await page.getByRole('button', { name: 'Upload file' }).click()
  await page.getByRole('dialog', { name: 'Import reading' }).locator('input[type="file"]').nth(2).setInputFiles({
    name: 'shortsform-wpm.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('One two three four five six seven eight nine ten.'),
  })
  await page.getByLabel('I own this text or have permission to narrate it.').check()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Play' }).click()

  await expect(page.locator('.shortsform-caption-line .word-already-narrated')).toBeVisible({ timeout: 1000 })
})

test('Shortsform does not stop for hidden Reader sense checks or micro-breaks', async ({ page }) => {
  const passage = Array.from({ length: 120 }, (_, index) => `Sentence ${index}.`).join(' ')
  await page.goto('/')
  await skipCalibration(page)
  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await page.getByLabel('Reading mode').getByRole('button', { name: /^Study\b/ }).click()
  await page.getByLabel('Reader controls').getByTitle(/Close settings/).click()
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Shortsform' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel(/Speed/).fill('1000')
  await page.getByLabel('Edge TTS narration').uncheck()
  await page.getByRole('button', { name: 'Upload file' }).click()
  await page.getByRole('dialog', { name: 'Import reading' }).locator('input[type="file"]').nth(2).setInputFiles({
    name: 'continuous-shortsform.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(passage),
  })
  await page.getByLabel('I own this text or have permission to narrate it.').check()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Play' }).click()

  await page.waitForTimeout(2200)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.locator('.shortsform-caption-meta')).toContainText('Live captions')
})

test('Shortsform narration completion keeps advancing through phrases', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get: () => 1,
    })
    HTMLMediaElement.prototype.load = function load() {
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
    }
    HTMLMediaElement.prototype.play = async function play() {
      this.dispatchEvent(new Event('play'))
      window.setTimeout(() => this.dispatchEvent(new Event('ended')), 60)
    }
    HTMLMediaElement.prototype.pause = function pause() {}
  })
  let narrationRequests = 0
  await page.route('**/api/tts', async (route) => {
    narrationRequests += 1
    const body = route.request().postDataJSON() as { text: string }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        audioBase64: 'SUQz',
        timings: body.text.split(/\s+/).map((text, index) => ({
          durationMs: 100,
          offsetMs: index * 120,
          text,
        })),
      }),
    })
  })
  const passage = Array.from({ length: 40 }, (_, index) => `Phrase ${index} continues.`).join(' ')
  await page.goto('/')
  await skipCalibration(page)
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Shortsform' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Upload file' }).click()
  await page.getByRole('dialog', { name: 'Import reading' }).locator('input[type="file"]').nth(2).setInputFiles({
    name: 'continuous-narration.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(passage),
  })
  await page.getByLabel('I own this text or have permission to narrate it.').check()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Play' }).click()

  await expect.poll(() => narrationRequests, { timeout: 1500 }).toBeGreaterThan(4)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('dark mode and focus auto-hide remain user controlled', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await chooseTheme(page, 'Dark')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-dark/)

  await page.getByLabel('Context ladder').check()
  await importPlainText(page, 'A clear sentence begins the reading test. Another sentence keeps the reader moving. The final sentence confirms focus mode.', 'focus-test.txt')
  await page.getByLabel('Reader controls').getByTitle(/Close settings/).click()
  await page.waitForTimeout(3200)
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-ui-hidden/)

  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await page.getByLabel('Auto-hide controls').check()
  await expect(page.getByLabel('Auto-hide controls')).toBeChecked()
  await page.getByLabel('Reader controls').getByTitle(/Close settings/).click()
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

  await page.mouse.move(200, 200)
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-ui-hidden/)

  await page.waitForTimeout(3200)
  await expect(page.locator('.app-shell')).toHaveClass(/focus-ui-hidden/)
  await page.keyboard.press('Shift')
  await expect(page.locator('.app-shell')).toHaveClass(/focus-ui-hidden/)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.app-shell')).toHaveClass(/focus-ui-hidden/)
  await page.mouse.move(220, 220)
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-ui-hidden/)

  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()
  await page.waitForTimeout(3200)
  await expect(page.locator('.app-shell')).toHaveClass(/focus-ui-hidden/)
  await expect(page.getByLabel('Word Focus controls')).toBeHidden()
  await page.mouse.wheel(0, 80)
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-ui-hidden/)
})

test('background customization is available in settings and accepts YouTube', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
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
  await skipCalibration(page)
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
  await skipCalibration(page)
  await page.getByLabel('Reader controls').getByTitle('Settings').click()

  await page.getByLabel('Reading mode').getByRole('button', { name: /^Study\b/ }).click()
  await page.getByLabel('Words per minute', { exact: true }).fill('510')
  await expect(page.locator('.app-shell')).toHaveCSS('--reader-weight', '400')
  await page.getByLabel(/Words per chunk/).fill('4')
  await page.getByLabel(/Font size/).fill('88')
  await page.getByLabel(/Font weight/).fill('600')
  await page.getByLabel('Font family').selectOption("'Atkinson Hyperlegible', sans-serif")
  await chooseTheme(page, 'Contrast')
  await page.getByLabel('Contrast', { exact: true }).getByRole('button', { name: 'high' }).click()
  await page.getByLabel('Eye anchor', { exact: true }).getByRole('button', { name: 'grid' }).click()
  await page.getByRole('checkbox', { name: 'Eye anchor', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Focus window', exact: true }).check()
  await page.getByLabel('Motion smoothing').check()
  await page.getByLabel('Auto-hide controls').check()
  await page.getByLabel('Buffer heavy words').check()
  await page.getByLabel('Section milestones').uncheck()
  await importPlainText(page, 'A centered phrase confirms the optional eye anchoring grid.', 'anchor-test.txt')

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
  await expect(page.getByLabel('Words per minute', { exact: true })).toHaveValue('510')
  await expect(page.getByLabel(/Words per chunk/)).toHaveValue('4')
  await expect(page.getByLabel(/Font size/)).toHaveValue('88')
  await expect(page.getByLabel(/Font weight/)).toHaveValue('600')
  await expect(page.getByLabel('Theme').getByRole('button', { name: /^Contrast\b/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Contrast', { exact: true }).getByRole('button', { name: 'high' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Eye anchor', { exact: true }).getByRole('button', { name: 'grid' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('checkbox', { name: 'Eye anchor', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Focus window', exact: true })).toBeChecked()
  await expect(page.getByLabel('Motion smoothing')).toBeChecked()
  await expect(page.getByLabel('Auto-hide controls')).toBeChecked()
  await expect(page.getByLabel('Buffer heavy words')).toBeChecked()
  await expect(page.getByLabel('Section milestones')).not.toBeChecked()
})

test('Reader and Word Focus WPM controls change the observed word cadence', async ({ page }) => {
  const words = Array.from({ length: 80 }, (_, index) => `pace${index}`).join(' ')
  await page.goto('/')
  await skipCalibration(page)
  const dock = page.getByLabel('Reader controls')
  await importPlainText(page, words, 'wpm-cadence.txt')
  await dock.getByTitle('Settings').click()
  await page.getByLabel(/Words per chunk/).fill('1')
  await page.getByLabel('Words per minute', { exact: true }).fill('120')
  await dock.getByTitle(/Close settings/).click()

  const displayedWordIndex = async () => {
    const text = (await page.locator('.word-display').innerText()).trim()
    return Number(text.replace('pace', ''))
  }
  await dock.getByTitle(/Play/).click()
  await expect(page.getByText('Landing strip')).toHaveCount(0, { timeout: 6500 })
  await page.waitForTimeout(1150)
  await dock.getByTitle(/Pause/).click()
  const slowReaderIndex = await displayedWordIndex()
  expect(slowReaderIndex).toBeGreaterThanOrEqual(1)
  expect(slowReaderIndex).toBeLessThanOrEqual(3)

  await dock.getByTitle(/Restart/).click()
  await dock.getByTitle('Settings').click()
  await page.getByLabel('Words per minute', { exact: true }).fill('600')
  await dock.getByTitle(/Close settings/).click()
  await dock.getByTitle(/Play/).click()
  await expect(page.getByText('Landing strip')).toHaveCount(0, { timeout: 6500 })
  await page.waitForTimeout(1150)
  await dock.getByTitle(/Pause/).click()
  const fastReaderIndex = await displayedWordIndex()
  expect(fastReaderIndex).toBeGreaterThanOrEqual(8)
  expect(fastReaderIndex).toBeGreaterThan(slowReaderIndex * 3)

  await dock.getByTitle(/Restart/).click()
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()
  const focusDock = page.getByLabel('Word Focus controls')
  await focusDock.getByTitle('Settings').click()
  await page.getByLabel('Words per minute', { exact: true }).fill('120')
  await focusDock.getByTitle(/Close settings/).click()
  await focusDock.getByTitle(/Play/).click()
  await page.waitForTimeout(1150)
  await focusDock.getByTitle(/Pause/).click()
  const slowFocusWord = Number((await page.locator('.word-focus-token.active').innerText()).replace('pace', ''))

  await focusDock.getByTitle(/Restart/).click()
  await focusDock.getByTitle('Settings').click()
  await page.getByLabel('Words per minute', { exact: true }).fill('600')
  await focusDock.getByTitle(/Close settings/).click()
  await focusDock.getByTitle(/Play/).click()
  await page.waitForTimeout(1150)
  await focusDock.getByTitle(/Pause/).click()
  const fastFocusWord = Number((await page.locator('.word-focus-token.active').innerText()).replace('pace', ''))
  expect(slowFocusWord).toBeLessThanOrEqual(3)
  expect(fastFocusWord).toBeGreaterThanOrEqual(8)
  expect(fastFocusWord).toBeGreaterThan(slowFocusWord * 3)
})

test('reader narration requests sentence-sized phrases without visual-timer restarts', async ({ page }) => {
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
      window.setTimeout(() => this.dispatchEvent(new Event('ended')), 50)
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
  await skipCalibration(page)
  await importPlainText(page, 'This complete sentence should be narrated naturally. The next sentence must remain in the same continuous audio passage.', 'narration-test.txt')
  await page.getByLabel('Reader controls').getByTitle(/Narration/).click()
  await page.waitForTimeout(6200)

  expect(narrationRequests.map((request) => request.text)).toEqual(expect.arrayContaining([
    'This complete sentence should be narrated naturally.',
    'The next sentence must remain in the same continuous audio passage.',
  ]))
  expect(narrationRequests.every((request) => request.rate === '-30%')).toBe(true)
})

test('reader narration waits for audio and hides the regular focus point', async ({ page }) => {
  await page.route('**/api/tts', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ audioBase64: 'SUQz', timings: [] }),
    })
  })
  await page.goto('/')
  await skipCalibration(page)
  await importPlainText(page, 'One two three. Four five six. Seven eight nine.', 'reader-wpm.txt')
  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await page.getByLabel('Words per minute', { exact: true }).fill('200')
  await page.getByLabel('Reader controls').getByTitle(/Close settings/).click()
  await page.getByLabel('Reader controls').getByTitle(/Narration/).click()

  await expect(page.locator('.display-line.narration-active')).toContainText('One two three.')
  await expect(page.locator('.word-display')).toContainText('One two three.', { timeout: 1200 })
  await expect(page.locator('.focus-letter')).toHaveCount(0)
  await expect(page.locator('.display-line.narration-active')).toHaveCSS('text-decoration-line', 'none')
})

test('Word Focus follows narration word timings instead of the visual timer', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get: () => 3,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get: () => 1,
      set: () => {},
    })
    HTMLMediaElement.prototype.load = function load() {
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
    }
    HTMLMediaElement.prototype.play = async function play() {
      this.dispatchEvent(new Event('play'))
      this.dispatchEvent(new Event('timeupdate'))
    }
    HTMLMediaElement.prototype.pause = function pause() {}
  })
  await page.route('**/api/tts', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      audioBase64: 'SUQz',
      timings: [
        { durationMs: 300, offsetMs: 0, text: 'One' },
        { durationMs: 300, offsetMs: 500, text: 'two' },
        { durationMs: 300, offsetMs: 1000, text: 'three.' },
      ],
    }),
  }))
  await page.goto('/')
  await skipCalibration(page)
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()
  await importPlainText(page, 'One two three. Four five six.', 'word-focus-narration.txt')
  await page.getByLabel('Word Focus controls').getByTitle(/Narration/).click()

  await expect(page.locator('.word-focus-token.active')).toHaveText('three.')
})

test('reader narration falls back to browser speech when Edge TTS fails', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.speechSynthesis, 'cancel', { configurable: true, value: () => {} })
    Object.defineProperty(window.speechSynthesis, 'speak', {
      configurable: true,
      value: (utterance: SpeechSynthesisUtterance) => {
        queueMicrotask(() => utterance.onstart?.(new Event('start') as SpeechSynthesisEvent))
      },
    })
  })
  await page.route('**/api/tts', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ error: 'simulated Edge TTS failure' }),
      status: 503,
    })
  })
  await page.goto('/')
  await skipCalibration(page)
  await importPlainText(page, 'Browser speech keeps narration available when network audio fails.', 'fallback.txt')
  await page.getByLabel('Reader controls').getByTitle(/Narration/).click()
  await expect(page.getByText('Narrating Narrator with browser voice')).toBeVisible()
})

test('reader narration applies an AI-assigned character voice to attributed dialogue', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get: () => 2,
    })
    HTMLMediaElement.prototype.load = function load() {
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
    }
    HTMLMediaElement.prototype.play = async function play() {
      this.dispatchEvent(new Event('play'))
    }
    HTMLMediaElement.prototype.pause = function pause() {}
  })
  await page.route('**/api/tts/voices', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([
      { display_name: 'Aria', gender: 'Female', locale: 'en-US', name: 'en-US-AriaNeural' },
      { display_name: 'Guy', gender: 'Male', locale: 'en-US', name: 'en-US-GuyNeural' },
    ]),
  }))
  await page.route('**/api/narration-cast', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      narratorVoice: 'en-US-AriaNeural',
      characters: [{ name: 'Alice', aliases: [], voiceName: 'en-US-GuyNeural' }],
    }),
  }))
  const requestedVoices: string[] = []
  await page.route('**/api/tts', async (route) => {
    const body = route.request().postDataJSON() as { text: string; voice: string }
    requestedVoices.push(body.voice)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        audioBase64: 'SUQz',
        timings: body.text.split(/\s+/).map((text, index) => ({
          durationMs: 100,
          offsetMs: index * 120,
          text,
        })),
      }),
    })
  })

  await page.goto('/')
  await skipCalibration(page)
  await importPlainText(page, '"Stay here," said Alice. Alice waited for an answer.', 'cast-test.txt')
  await page.getByLabel('Reader controls').getByTitle(/Narration/).click()
  await expect.poll(() => requestedVoices).toContain('en-US-GuyNeural')
})
