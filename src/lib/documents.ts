import type { ParsedDocument } from '../types'
import { apiUrl } from './api'
import { createParsedDocument, type ExtractedDocument } from './tokenize'

export const DOCUMENT_ACCEPT = '.pdf,.epub,.md,.markdown,.doc,.docx,.txt,.html,.htm'

export async function importDocument(file: File): Promise<ParsedDocument> {
  const local = await importBrowserReadableFile(file)
  if (local) return local

  const payload = new FormData()
  payload.append('file', file)
  const response = await fetch(apiUrl('/api/extract'), { method: 'POST', body: payload })
  const body = (await response.json().catch(() => null)) as (ExtractedDocument & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? serverExtractionMessage())
  const parsed = await createParsedDocument(body, file.name)
  if (parsed.tokens.length === 0) throw new Error('No readable text was found in this file.')
  return parsed
}

export async function importText(
  text: string,
  title: string,
  format: 'text' | 'markdown' = 'text',
): Promise<ParsedDocument> {
  const normalizedTitle = title.trim() || 'Pasted text'
  const normalizedText = text.trim()
  if (!normalizedText) throw new Error('Paste some text before importing.')
  const extracted = format === 'markdown'
    ? markdownDocument(normalizedText, normalizedTitle)
    : {
        format: 'txt',
        title: normalizedTitle,
        sections: [{ title: 'Section 1', text: normalizedText }],
      }
  const parsed = await createParsedDocument(extracted, normalizedTitle)
  if (parsed.tokens.length === 0) throw new Error('No readable text was found in the pasted content.')
  return parsed
}

export async function importWebsite(url: string): Promise<ParsedDocument> {
  const response = await fetch(apiUrl('/api/extract-url'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const body = (await response.json().catch(() => null)) as (ExtractedDocument & { error?: string; sourceName?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? serverExtractionMessage('Website import'))
  const parsed = await createParsedDocument(body, body.sourceName ?? url)
  if (parsed.tokens.length === 0) throw new Error('No readable text was found on this webpage.')
  return parsed
}

async function importBrowserReadableFile(file: File) {
  const extension = fileExtension(file.name)
  if (!['.txt', '.md', '.markdown', '.html', '.htm'].includes(extension)) return null

  const source = await readFileText(file)
  const title = readableTitle(file.name)
  const extracted = extension === '.html' || extension === '.htm'
    ? htmlDocument(source, title)
    : extension === '.txt'
      ? textDocument(source, title)
      : markdownDocument(source, title)
  const parsed = await createParsedDocument(extracted, file.name)
  if (parsed.tokens.length === 0) throw new Error('No readable text was found in this file.')
  return parsed
}

function readFileText(file: File) {
  if (typeof file.text === 'function') return file.text()

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsText(file)
  })
}

function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.[^.]+$/)
  return match?.[0] ?? ''
}

function readableTitle(name: string) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Imported document'
}

function textDocument(text: string, fallbackTitle: string): ExtractedDocument {
  return { format: 'txt', title: fallbackTitle, sections: splitSections(normalizeText(text)) }
}

function htmlDocument(source: string, fallbackTitle: string): ExtractedDocument {
  const normalizedSource = /<(?:!doctype|html)\b/i.test(source)
    ? source
    : `<html><body>${source}</body></html>`
  const doc = new DOMParser().parseFromString(normalizedSource, 'text/html')
  doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove())
  const title = doc.querySelector('title')?.textContent?.trim() || fallbackTitle
  const text = normalizeText(doc.body?.textContent ?? doc.documentElement?.textContent ?? '')
  return { format: 'html', title, sections: splitSections(text) }
}

function normalizeText(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitSections(text: string) {
  const paragraphs = text.split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean)
  if (paragraphs.length === 0) return [{ title: 'Section 1', text }]
  const sections: Array<{ title: string; text: string }> = []
  for (let index = 0; index < paragraphs.length; index += 12) {
    sections.push({
      title: sections.length === 0 ? 'Section 1' : `Section ${sections.length + 1}`,
      text: paragraphs.slice(index, index + 12).join('\n\n'),
    })
  }
  return sections
}

function serverExtractionMessage(prefix = 'Document import') {
  return `${prefix} needs the Celere extraction API. On the hosted Firebase app, use Paste text or upload TXT, Markdown, or HTML files.`
}

function markdownDocument(markdown: string, fallbackTitle: string): ExtractedDocument {
  const sections: Array<{ title: string; text: string }> = []
  let sectionTitle = 'Section 1'
  let lines: string[] = []

  const flush = () => {
    const text = markdownToText(lines.join('\n'))
    if (text) sections.push({ title: sectionTitle, text })
    lines = []
  }

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    if (!heading) {
      lines.push(line)
      continue
    }
    flush()
    sectionTitle = markdownInlineToText(heading[1]) || `Section ${sections.length + 1}`
  }
  flush()
  if (sections.length === 0) sections.push({ title: 'Section 1', text: markdownToText(markdown) })
  return { format: 'markdown', title: fallbackTitle, sections }
}

function markdownToText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```\w*\s*|\s*```$/g, ''))
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .split(/\r?\n/)
    .map(markdownInlineToText)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function markdownInlineToText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/[*_~`]+/g, '')
    .trim()
}
