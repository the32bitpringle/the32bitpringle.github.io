import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const browser = await chromium.launch()
try {
  await verifyExtractor()
  await verifyBridge()
  console.log('Celere Web Clipper verification passed.')
} finally {
  await browser.close()
}

async function verifyExtractor() {
  const page = await browser.newPage()
  await installChromeRuntimeMock(page, '__extractorListener')
  await page.setContent(`
    <html>
      <head><title>Ignored chrome</title><meta property="og:title" content="Readable Article"></head>
      <body>
        <nav>Home Pricing Account</nav>
        <article>
          <h1>Readable Article</h1>
          <p>This article contains enough readable prose for the extension to extract the useful content.</p>
          <p>It keeps paragraphs together, ignores the navigation, and returns clean text for Celere.</p>
        </article>
      </body>
    </html>
  `)
  await page.addScriptTag({ path: path.join(root, 'src/extractor.js') })
  const result = await page.evaluate(() => new Promise((resolve) => {
    window.__extractorListener({ type: 'CELERE_EXTRACT_TEXT', mode: 'page', minChars: 80 }, {}, resolve)
  }))
  assert(result.ok, result.error || 'Extractor did not return ok.')
  assert(result.title === 'Readable Article', 'Extractor should use metadata title.')
  assert(result.text.includes('useful content'), 'Extractor should include article body.')
  assert(!result.text.includes('Pricing Account'), 'Extractor should ignore navigation text.')
  await page.close()
}

async function verifyBridge() {
  const page = await browser.newPage()
  await installChromeRuntimeMock(page, '__bridgeListener')
  await page.setContent(`
    <button aria-label="Import (O)">Import</button>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        document.body.insertAdjacentHTML('beforeend', \`
          <section role="dialog" aria-label="Import reading">
            <button>Paste text</button>
            <input aria-label="Title" />
            <select aria-label="Format"><option value="text">Plain text</option><option value="markdown">Markdown</option></select>
            <textarea aria-label="Text"></textarea>
            <button id="submit">Import text</button>
          </section>
        \`)
        document.querySelector('#submit').addEventListener('click', () => {
          document.body.dataset.imported = 'true'
        })
      })
    </script>
  `)
  await page.addScriptTag({ path: path.join(root, 'src/celere-bridge.js') })
  const result = await page.evaluate(() => new Promise((resolve) => {
    window.__bridgeListener({
      type: 'CELERE_IMPORT_TEXT',
      payload: {
        title: 'Imported Page',
        text: 'A readable passage sent from a webpage.',
        sourceUrl: 'https://example.com/article',
      },
    }, {}, resolve)
  }))
  assert(result.ok, result.error || 'Bridge did not return ok.')
  const imported = await page.evaluate(() => ({
    title: document.querySelector('input[aria-label="Title"]').value,
    text: document.querySelector('textarea[aria-label="Text"]').value,
    submitted: document.body.dataset.imported,
  }))
  assert(imported.title === 'Imported Page', 'Bridge should fill the import title.')
  assert(imported.text.includes('Source: https://example.com/article'), 'Bridge should append the source URL.')
  assert(imported.submitted === 'true', 'Bridge should submit the import dialog.')
  await page.close()
}

async function installChromeRuntimeMock(page, listenerName) {
  await page.evaluate((name) => {
    window.chrome = {
      runtime: {
        onMessage: {
          addListener(listener) {
            window[name] = listener
          },
        },
      },
    }
  }, listenerName)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
