import { expect, test } from '@playwright/test'

test('reader and guide remain keyboard accessible', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
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
  await page.getByRole('button', { name: 'Skip' }).click()
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
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'word-focus.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Focused reading keeps each word clear and centered.'),
  })
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()

  await expect(page.locator('.word-focus-document')).toContainText('Focused reading keeps each word clear and centered.')
  await expect(page.locator('.word-focus-token.active')).toHaveText('Focused')
  await expect(page.getByLabel('Word Focus controls')).toBeVisible()

  await page.getByLabel('Word Focus controls').getByTitle('Settings').click()
  await page.getByLabel('Theme').selectOption('sepia')
  await page.getByLabel('Words per minute').fill('600')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-sepia/)
  await expect(page.locator('.word-focus-document')).toHaveCSS('font-family', 'Georgia, serif')
  await expect(page.getByLabel('Narration pace')).toBeVisible()
  await page.getByLabel('Ambient audio').selectOption('soft-drums')
  await expect(page.getByLabel('Ambient audio')).toHaveValue('soft-drums')
  await page.getByLabel('Word Focus controls').getByTitle('Close').click()

  await page.getByLabel('Word Focus controls').getByTitle('Narration').click()
  await expect(page.getByLabel('Word Focus controls').getByTitle('Pause')).toBeVisible()
  await expect(page.locator('.word-focus-token.active')).toHaveCount(1)
  await expect(page.locator('.word-focus-token.active')).not.toHaveText('Focused', { timeout: 1500 })
})

test('Word Focus stays responsive with one active word in a long document', async ({ page }) => {
  const longPassage = Array.from(
    { length: 2500 },
    (_, index) => `reading${index}`,
  ).join(' ')

  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'long-word-focus.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(longPassage),
  })
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()
  await expect(page.locator('.word-focus-token')).toHaveCount(2500)
  await expect(page.locator('.word-focus-token.active')).toHaveCount(1)

  const dock = page.getByLabel('Word Focus controls')
  await dock.getByTitle('Settings').click()
  await page.getByLabel('Words per minute').fill('1200')
  await dock.getByTitle('Close').click()

  const activeIndex = () => page.evaluate(() => {
    const tokens = [...document.querySelectorAll('.word-focus-token')]
    return tokens.indexOf(document.querySelector('.word-focus-token.active')!)
  })
  const initialIndex = await activeIndex()
  await dock.getByTitle('Play').click()

  await expect.poll(activeIndex, { timeout: 1000 }).toBeGreaterThan(initialIndex + 2)
  await expect(page.locator('.word-focus-token.active')).toHaveCount(1)
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
  await expect(page.getByRole('button', { name: 'Prepare footage' })).toBeEnabled()
  await page.route('**/api/shortsform/footage', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'cancelled test request' }), status: 499 })
  })
  await page.getByRole('button', { name: 'Prepare footage' }).click()
  await expect(page.getByRole('button', { name: 'Cancel preparation' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel preparation' }).click()
  await expect(page.locator('.shortsform-status')).toHaveText('Footage preparation cancelled.')

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
  await page.getByRole('button', { name: 'Skip' }).click()
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
    buffer: Buffer.from('This complete sentence should be narrated naturally. The next sentence must remain in the same continuous audio passage.'),
  })
  await page.getByLabel('Reader controls').getByTitle('Narration').click()
  await page.waitForTimeout(6200)

  expect(narrationRequests.map((request) => request.text)).toEqual(expect.arrayContaining([
    'This complete sentence should be narrated naturally.',
    'The next sentence must remain in the same continuous audio passage.',
  ]))
  expect(narrationRequests.every((request) => request.rate === '-30%')).toBe(true)
})

test('reader narration highlights phrases without underlining individual words', async ({ page }) => {
  await page.route('**/api/tts', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ audioBase64: 'SUQz', timings: [] }),
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'reader-wpm.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('One two three. Four five six. Seven eight nine.'),
  })
  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await page.getByLabel('Words per minute', { exact: true }).fill('200')
  await page.getByLabel('Reader controls').getByTitle('Close').click()
  await page.getByLabel('Reader controls').getByTitle('Narration').click()

  await expect(page.locator('.display-line.narration-active')).toContainText('One two three.')
  await expect(page.locator('.word-display')).toContainText('Four five six.', { timeout: 1200 })
  await expect(page.locator('.display-line.narration-active')).toHaveCSS('text-decoration-line', 'none')
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
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'fallback.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Browser speech keeps narration available when network audio fails.'),
  })
  await page.getByLabel('Reader controls').getByTitle('Narration').click()
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
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByLabel('Reader controls').getByLabel('Upload').setInputFiles({
    name: 'cast-test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('"Stay here," said Alice. Alice waited for an answer.'),
  })
  await page.getByLabel('Reader controls').getByTitle('Narration').click()
  await expect.poll(() => requestedVoices).toContain('en-US-GuyNeural')
})
