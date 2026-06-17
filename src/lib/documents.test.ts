import { describe, expect, it } from 'vitest'
import { importDocument, importText, importWebsite } from './documents'

describe('document text imports', () => {
  it('imports plain text', async () => {
    const document = await importText('A readable pasted paragraph.', 'Pasted sample')
    expect(document.title).toBe('Pasted sample')
    expect(document.format).toBe('txt')
    expect(document.tokens.length).toBeGreaterThan(2)
  })

  it('turns Markdown headings into readable sections', async () => {
    const document = await importText(
      '# First chapter\n\nA **clear** opening paragraph.\n\n## Next chapter\n\nRead [the source](https://example.com).',
      'Markdown sample',
      'markdown',
    )
    expect(document.format).toBe('markdown')
    expect(document.title).toBe('Markdown sample')
    expect(document.sections.map((section) => section.title)).toEqual(['First chapter', 'Next chapter'])
    expect(document.text).not.toContain('**')
    expect(document.text).not.toContain('https://example.com')
  })

  it('imports plain text files in the browser without the extraction API', async () => {
    const file = new File(['A readable text file for Firebase Hosting.'], 'reader-note.txt', { type: 'text/plain' })
    const document = await importDocument(file)

    expect(document.title).toBe('reader note')
    expect(document.format).toBe('txt')
    expect(document.text).toContain('Firebase Hosting')
  })

  it('imports Markdown files in the browser without the extraction API', async () => {
    const file = new File(['# Browser file\n\nA **readable** Markdown upload.'], 'browser-file.md', { type: 'text/markdown' })
    const document = await importDocument(file)

    expect(document.title).toBe('browser file')
    expect(document.format).toBe('markdown')
    expect(document.sections[0].title).toBe('Browser file')
    expect(document.text).toContain('readable Markdown upload')
  })

  it('imports HTML files in the browser without the extraction API', async () => {
    const file = new File([
      '<!doctype html><title>HTML sample</title><main><h1>Ignored heading</h1><p>Readable HTML upload.</p><script>bad()</script></main>',
    ], 'sample.html', { type: 'text/html' })
    const document = await importDocument(file)

    expect(document.title).toBe('HTML sample')
    expect(document.format).toBe('html')
    expect(document.text).toContain('Readable HTML upload')
    expect(document.text).not.toContain('bad()')
  })

  it('explains when website import is missing the extraction API', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('<!doctype html><div id="root"></div>', {
      headers: { 'content-type': 'text/html' },
      status: 200,
    })

    await expect(importWebsite('https://example.com')).rejects.toThrow('Website import needs the Celere extraction API')
    globalThis.fetch = originalFetch
  })
})
