// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  buildSrt,
  cleanupStaleFootageParts,
  findCachedFootage,
  extractDocument,
  findMediaFile,
  isYoutubeUrl,
  normalizeYoutubeUrl,
  normalizeExportSections,
  youtubeFormatSelector,
  youtubePreviewSection,
} from './index.mjs'

describe('server document extraction', () => {
  it('extracts TXT and HTML', async () => {
    const txt = await extractDocument(Buffer.from('Chapter 1\nA readable plain-text chapter.'), '.txt', 'sample.txt')
    const html = await extractDocument(Buffer.from('<h1>Chapter 1</h1><p>A readable HTML chapter.</p>'), '.html', 'sample.html')
    expect(txt.sections[0].text).toContain('plain-text')
    expect(html.sections[0].text).toContain('HTML chapter')
  })

  it('extracts Markdown without formatting syntax', async () => {
    const markdown = await extractDocument(
      Buffer.from('# Chapter 1\n\nA **readable** [Markdown passage](https://example.com).'),
      '.md',
      'sample.md',
    )
    expect(markdown.format).toBe('markdown')
    expect(markdown.sections[0].text).toContain('readable Markdown passage')
    expect(markdown.sections[0].text).not.toContain('https://example.com')
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
    expect(normalizeYoutubeUrl('https://youtube.com/shorts/abc123?feature=share')).toBe('https://www.youtube.com/watch?v=abc123')
    expect(normalizeYoutubeUrl('https://youtu.be/abc123?t=10')).toBe('https://www.youtube.com/watch?v=abc123')
    expect(isYoutubeUrl('http://youtube.com/watch?v=abc123')).toBe(false)
    expect(isYoutubeUrl('https://example.com/video.mp4')).toBe(false)
  })

  it('prefers a compact browser-compatible YouTube background clip', () => {
    expect(youtubeFormatSelector).toContain('height<=360')
    expect(youtubeFormatSelector).toContain('vcodec^=avc1')
    expect(youtubeFormatSelector).not.toContain('+ba')
    expect(youtubePreviewSection).toBe('*0-600')
  })

  it('finds every accepted uploaded video extension', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'celere-footage-'))
    try {
      const videoPath = path.join(directory, 'source.m4v')
      fs.writeFileSync(videoPath, 'video')
      expect(findMediaFile(directory)).toBe(videoPath)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reuses completed YouTube footage from the local cache', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'celere-cache-'))
    try {
      const assetId = '00000000-0000-4000-8000-000000000000'
      const assetDirectory = path.join(directory, assetId)
      fs.mkdirSync(assetDirectory)
      fs.writeFileSync(path.join(assetDirectory, 'source.mp4'), 'video')
      fs.writeFileSync(path.join(assetDirectory, 'meta.json'), JSON.stringify({
        sourceUrl: 'https://www.youtube.com/watch?v=cached',
        title: 'Cached clip',
      }))
      expect(findCachedFootage('https://www.youtube.com/watch?v=cached', directory)).toEqual({
        assetId,
        title: 'Cached clip',
      })
      expect(findCachedFootage('https://www.youtube.com/watch?v=missing', directory)).toBeNull()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('cleans up only stale incomplete footage fragments', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'celere-parts-'))
    try {
      const staleDirectory = path.join(directory, 'stale')
      const recentDirectory = path.join(directory, 'recent')
      fs.mkdirSync(staleDirectory)
      fs.mkdirSync(recentDirectory)
      const stalePart = path.join(staleDirectory, 'source.mp4.part')
      const recentPart = path.join(recentDirectory, 'source.mp4.part')
      fs.writeFileSync(stalePart, 'stale')
      fs.writeFileSync(recentPart, 'recent')
      const now = Date.now()
      fs.utimesSync(stalePart, new Date(now - 2 * 60 * 60_000), new Date(now - 2 * 60 * 60_000))

      expect(cleanupStaleFootageParts(directory, now)).toBe(1)
      expect(fs.existsSync(stalePart)).toBe(false)
      expect(fs.existsSync(recentPart)).toBe(true)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
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
