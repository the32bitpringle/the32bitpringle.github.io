import type { ParsedDocument } from '../types'
import { createParsedDocument, type ExtractedDocument } from './tokenize'

export const DOCUMENT_ACCEPT = '.pdf,.epub,.doc,.docx,.txt,.html,.htm'

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
