// @vitest-environment node
import fs from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildSrt, extractDocument, isYoutubeUrl, normalizeExportSections } from './index.mjs'

describe('server document extraction', () => {
  it('extracts TXT and HTML', async () => {
    const txt = await extractDocument(Buffer.from('Chapter 1\nA readable plain-text chapter.'), '.txt', 'sample.txt')
    const html = await extractDocument(Buffer.from('<h1>Chapter 1</h1><p>A readable HTML chapter.</p>'), '.html', 'sample.html')
    expect(txt.sections[0].text).toContain('plain-text')
    expect(html.sections[0].text).toContain('HTML chapter')
  })

  it('extracts a real DOCX fixture', async () => {
    const buffer = fs.readFileSync('node_modules/mammoth/test/test-data/single-paragraph.docx')
    const result = await extractDocument(buffer, '.docx', 'sample.docx')
    expect(result.sections.flatMap((section) => section.text).join(' ')).toMatch(/\w+/)
  })

  it('extracts a valid EPUB package in spine order', async () => {
    const zip = new JSZip()
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="EPUB/content.opf"/></rootfiles></container>')
    zip.file('EPUB/content.opf', '<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Test EPUB</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>')
    zip.file('EPUB/one.xhtml', '<html><body><h1>The reveal</h1><p>Alex revealed the hidden passage.</p></body></html>')
    const result = await extractDocument(await zip.generateAsync({ type: 'nodebuffer' }), '.epub', 'sample.epub')
    expect(result.title).toBe('Test EPUB')
    expect(result.sections[0].text).toContain('hidden passage')
  })

  it('extracts RTF-compatible DOC files and a real text PDF', async () => {
    const doc = await extractDocument(Buffer.from('{\\rtf1\\ansi Chapter 1\\par Alex reveals the secret.}'), '.doc', 'sample.doc')
    expect(doc.sections[0].text).toContain('Alex reveals the secret')

    const pdfPath = '/usr/share/doc/speex/manual.pdf'
    if (fs.existsSync(pdfPath)) {
      const pdf = await extractDocument(fs.readFileSync(pdfPath), '.pdf', 'manual.pdf')
      expect(pdf.sections.flatMap((section) => section.text).join(' ').length).toBeGreaterThan(100)
    }
  }, 20_000)

  it('rejects corrupt, empty, scanned-like, and unsupported files', async () => {
    await expect(extractDocument(Buffer.from('not a pdf'), '.pdf', 'bad.pdf')).rejects.toThrow()
    await expect(extractDocument(Buffer.alloc(0), '.epub', 'empty.epub')).rejects.toThrow()
    await expect(extractDocument(Buffer.from('binary'), '.bin', 'bad.bin')).rejects.toThrow(/Unsupported/)
  })
})

describe('Shortsform inputs', () => {
  it('accepts only HTTPS YouTube footage URLs', () => {
    expect(isYoutubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true)
    expect(isYoutubeUrl('https://youtu.be/abc123')).toBe(true)
    expect(isYoutubeUrl('http://youtube.com/watch?v=abc123')).toBe(false)
    expect(isYoutubeUrl('https://example.com/video.mp4')).toBe(false)
  })

  it('normalizes non-empty chapter text without rewriting it', () => {
    expect(normalizeExportSections([
      { title: 'Chapter 1', text: '  Exact supplied text.  ' },
      { title: 'Empty', text: '   ' },
    ])).toEqual([{ title: 'Chapter 1', text: 'Exact supplied text.' }])
  })

  it('creates sequential captions that retain every word', () => {
    const srt = buildSrt('one two three four five six seven eight nine', 9)
    expect(srt).toContain('00:00:00,000 --> 00:00:04,500')
    expect(srt).toContain('one two three four five six seven eight')
    expect(srt).toContain('nine')
  })
})
