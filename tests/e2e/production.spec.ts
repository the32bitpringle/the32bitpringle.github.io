import { expect, test, type Page } from '@playwright/test'
import { featureRegistry } from '../../src/config/features'

async function skipCalibration(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip' })
  if (await skip.count()) await skip.click()
}

async function importText(page: Page, text = 'One, two. Hyperparameter calibration improves focus. Another sentence follows.') {
  await page.getByRole('button', { name: 'Import (O)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import reading' })
  await dialog.getByRole('button', { name: 'Paste text' }).click()
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Production verification')
  await dialog.getByRole('textbox', { name: 'Text' }).fill(text)
  await dialog.getByRole('button', { name: 'Import text' }).click()
  await expect(page.locator('.word-display')).toBeVisible()
}

async function openReaderSettings(page: Page) {
  await page.getByLabel('Reader controls').getByTitle('Settings').click()
  await expect(page.getByLabel('Reader settings')).toBeVisible()
  return page.getByLabel('Reader settings')
}

test('production feature guide exposes every implemented feature with operational metadata', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Guide' }).click()

  for (const feature of featureRegistry.filter((item) => item.status === 'implemented')) {
    await page.getByPlaceholder('Search features…').fill(feature.name)
    const card = page.locator('.guide-table article').filter({ hasText: feature.name })
    await expect(card, feature.name).toBeVisible()
    await expect(card).toContainText(feature.location)
    await expect(card).toContainText(feature.activation)
    await expect(card).toContainText(feature.privacy)
    await expect(card).toContainText(feature.disable)
  }
})

test('production settings surface exposes core reader, pacing, word-focus, sensory, audio, privacy, and sensor controls', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
  const settings = await openReaderSettings(page)

  const expectedLabels = [
    'Words per minute',
    'Words per chunk',
    'Font size',
    'Font weight',
    'Word Focus text',
    'Word Focus lines',
    'Font family',
    'Sprint length',
    'Micro-break interval',
    'Micro-break length',
    'Focus window strength',
    'Comma pause',
    'Period pause',
    'Long-word pause',
    'Contrast',
    'Eye anchor',
    'Sensory preset',
    'Background',
    'Text',
    'Image, video, or YouTube URL',
    'Narration voice',
    'Narration pace',
    'Narration pitch',
    'Ambient audio',
    'Volume',
    'Voice commands',
    'Experimental eye-away detection',
  ]

  for (const label of expectedLabels) {
    await expect(settings.getByText(label, { exact: false }).first(), label).toBeVisible()
  }

  for (const theme of ['Light', 'Paper', 'Sepia', 'Dark', 'Calm', 'E-ink', 'Contrast']) {
    await expect(settings.getByRole('button', { name: new RegExp(`^${theme}\\b`) }).first(), theme).toBeVisible()
  }
})

test('production settings values apply and persist across Reader and Word Focus', async ({ page }) => {
  await page.goto('/')
  await skipCalibration(page)
  const settings = await openReaderSettings(page)

  await settings.getByLabel('Words per minute').fill('510')
  await settings.getByLabel(/Font size/).fill('88')
  await settings.getByLabel(/Font weight/).fill('600')
  await settings.getByLabel(/Word Focus text/).fill('55')
  await settings.getByLabel(/Word Focus lines/).fill('170')
  await settings.getByLabel(/Comma pause/).fill('300')
  await settings.getByLabel(/Period pause/).fill('700')
  await settings.getByLabel(/Long-word pause/).fill('260')
  await settings.getByRole('button', { name: 'Calm Muted SwiftRead palette' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/theme-calm/)

  await page.getByLabel('Reader controls').getByTitle('Close settings').click()
  await importText(page)
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Word Focus' }).click()
  await expect(page.locator('.word-focus-document')).toHaveCSS('font-family', '"Times New Roman", serif')
  await expect(page.locator('.word-focus-document')).toHaveCSS('font-weight', '600')
  await expect(page.locator('.word-focus-document')).toHaveCSS('line-height', '82.28px')
  await expect(page.locator('.app-shell')).toHaveCSS('--reader-size', '88px')
  await expect(page.locator('.app-shell')).toHaveCSS('--word-focus-scale', '0.55')
  await expect(page.locator('.app-shell')).toHaveCSS('--word-focus-line-height', '1.7')

  await page.reload()
  const persisted = await openReaderSettings(page)
  await expect(persisted.getByLabel('Words per minute')).toHaveValue('510')
  await expect(persisted.getByLabel(/Word Focus text/)).toHaveValue('55')
  await expect(persisted.getByLabel(/Word Focus lines/)).toHaveValue('170')
  await expect(persisted.getByLabel(/Comma pause/)).toHaveValue('300')
  await expect(persisted.getByLabel(/Period pause/)).toHaveValue('700')
  await expect(persisted.getByLabel(/Long-word pause/)).toHaveValue('260')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-calm/)
})

test('production voice commands use browser SpeechRecognition without storing audio', async ({ page }) => {
  await page.addInitScript(() => {
    class MockRecognition {
      continuous = false
      interimResults = false
      lang = ''
      onstart: (() => void) | null = null
      onresult: ((event: unknown) => void) | null = null
      onerror: (() => void) | null = null
      start() {
        ;(window as typeof window & { __recognition?: MockRecognition }).__recognition = this
        this.onstart?.()
      }
      stop() {}
    }
    ;(window as typeof window & {
      SpeechRecognition?: typeof MockRecognition
      __dispatchSpeech?: (transcript: string) => void
      __recognition?: MockRecognition
    }).SpeechRecognition = MockRecognition
    ;(window as typeof window & { __dispatchSpeech?: (transcript: string) => void }).__dispatchSpeech = (transcript: string) => {
      const recognition = (window as typeof window & { __recognition?: MockRecognition }).__recognition
      recognition?.onresult?.({ results: [[{ transcript }]] })
    }
  })

  await page.goto('/')
  await skipCalibration(page)
  await importText(page, 'Voice commands advance this reading. The next sentence is available.')
  const settings = await openReaderSettings(page)
  await settings.getByLabel('Voice commands').check()
  await expect(settings).toContainText('Voice: Listening')

  await page.evaluate(() => (window as typeof window & { __dispatchSpeech: (transcript: string) => void }).__dispatchSpeech('settings'))
  await expect(settings).toBeHidden()
  await page.evaluate(() => (window as typeof window & { __dispatchSpeech: (transcript: string) => void }).__dispatchSpeech('guide'))
  await expect(page.getByRole('heading', { name: 'Guide', exact: true })).toBeVisible()
})

test('production eye tracking requests camera access, reports runtime status, and stops tracks when disabled', async ({ page }) => {
  await page.addInitScript(() => {
    let stopped = false
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const stream = canvas.captureStream(5)
    const tracks = stream.getTracks()
    for (const track of tracks) {
      const stop = track.stop.bind(track)
      track.stop = () => {
        stopped = true
        stop()
      }
    }
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => stream,
      },
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async function play() {
        Object.defineProperty(this, 'readyState', { configurable: true, value: 4 })
      },
    })
    ;(window as typeof window & { __eyeTrackStopped?: () => boolean }).__eyeTrackStopped = () => stopped
  })

  await page.goto('/')
  await skipCalibration(page)
  const settings = await openReaderSettings(page)
  await settings.getByLabel('Experimental eye-away detection').check()
  await expect(settings).toContainText(/Eye tracking: (Loading local face model|Local face model unavailable|Active; iris landmarks stay local)/)
  await expect(page.locator('.camera-probe')).toBeVisible()

  await settings.getByLabel('Experimental eye-away detection').uncheck()
  await expect(settings).toContainText('Eye tracking: Off')
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __eyeTrackStopped: () => boolean }).__eyeTrackStopped())).toBe(true)
})
