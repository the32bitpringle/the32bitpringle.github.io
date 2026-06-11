import type { ParsedDocument } from '../types'
import { createParsedDocument, type ExtractedDocument } from './tokenize'

export const DOCUMENT_ACCEPT = '.pdf,.epub,.md,.markdown,.doc,.docx,.txt,.html,.htm'

export async function importDocument(file: File): Promise<ParsedDocument> {
  const payload = new FormData()
  payload.append('file', file)
  const response = await fetch('/api/extract', { method: 'POST', body: payload })
  const body = (await response.json().catch(() => null)) as (ExtractedDocument & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? 'The document could not be processed.')
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
  const response = await fetch('/api/extract-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const body = (await response.json().catch(() => null)) as (ExtractedDocument & { error?: string; sourceName?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? 'The website could not be imported.')
  const parsed = await createParsedDocument(body, body.sourceName ?? url)
  if (parsed.tokens.length === 0) throw new Error('No readable text was found on this webpage.')
  return parsed
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
