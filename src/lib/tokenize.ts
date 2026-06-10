import type {
  DocumentSection,
  Paragraph,
  ParsedDocument,
  ReadingChunk,
  Sentence,
  SymbolGroupingHints,
  Token,
  WordRole,
} from '../types'

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u
const SENTENCE_END = /[.!?。！？؟।॥]["')\]»”’）】》」』]*$/u
const CLAUSE_END = /[,;:،؛：、，；—–]$/u
const PREFIX_PUNCTUATION = /^[([{'"«“‘¿¡#$@₹€£¥₩]+$/u
const SUFFIX_PUNCTUATION = /^[,.;:!?،؛؟。！？、，；：%)\]}'"»”’°‰）】》」』।॥]+$/u
const VERBS = new Set([
  'am', 'are', 'be', 'became', 'become', 'been', 'being', 'can', 'could', 'did',
  'do', 'does', 'had', 'has', 'have', 'is', 'may', 'might', 'must', 'revealed',
  'said', 'should', 'showed', 'told', 'was', 'were', 'will', 'would',
])

export interface ExtractedDocument {
  format: string
  title: string
  sections: Array<{ title: string; text: string }>
}

export async function createParsedDocument(
  extracted: ExtractedDocument,
  sourceName: string,
  groupingHints?: SymbolGroupingHints,
): Promise<ParsedDocument> {
  const text = extracted.sections.map((section) => section.text).join('\n\n')
  const hash = await sha256(text)
  const language = groupingHints?.languageCode || detectLanguage(text)
  const tokens: Token[] = []
  const sections: DocumentSection[] = []
  let charCursor = 0

  extracted.sections.forEach((sourceSection, sectionIndex) => {
    const sectionStart = tokens.length
    const paragraphs: Paragraph[] = []
    const rawParagraphs = sourceSection.text.split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean)

    rawParagraphs.forEach((paragraphText, paragraphIndex) => {
      const paragraphStart = tokens.length
      const rawTokens = segmentWords(paragraphText, groupingHints, language)
      const paragraphTokens = rawTokens.map((textValue, localIndex) => {
        const normalized = normalizeWord(textValue)
        const charStart = text.indexOf(textValue, charCursor)
        const safeCharStart = charStart >= 0 ? charStart : charCursor
        charCursor = safeCharStart + textValue.length
        const token: Token = {
          id: `${sectionIndex}:${paragraphIndex}:${localIndex}`,
          text: textValue,
          normalized,
          role: classifyRole(normalized, localIndex),
          difficult: isDifficult(textValue, normalized),
          source: {
            sectionIndex,
            paragraphIndex,
            sentenceIndex: 0,
            tokenIndex: tokens.length,
            wordIndex: tokens.length,
            charStart: safeCharStart,
            charEnd: safeCharStart + textValue.length,
          },
        }
        tokens.push(token)
        return token
      })
      const sentences = createSentences(paragraphTokens, sectionIndex, paragraphIndex)
      sentences.forEach((sentence, sentenceIndex) => {
        for (let index = sentence.tokenStart; index <= sentence.tokenEnd; index += 1) {
          if (tokens[index]) tokens[index].source.sentenceIndex = sentenceIndex
        }
      })
      paragraphs.push({
        id: `p:${sectionIndex}:${paragraphIndex}`,
        text: paragraphText,
        index: paragraphIndex,
        tokenStart: paragraphStart,
        tokenEnd: Math.max(tokens.length - 1, paragraphStart),
        sentences,
      })
    })

    sections.push({
      id: `s:${sectionIndex}`,
      title: sourceSection.title || `Section ${sectionIndex + 1}`,
      index: sectionIndex,
      tokenStart: sectionStart,
      tokenEnd: Math.max(tokens.length - 1, sectionStart),
      paragraphs,
    })
  })

  return {
    id: crypto.randomUUID(),
    hash,
    title: extracted.title,
    sourceName,
    format: extracted.format,
    importedAt: Date.now(),
    language,
    text,
    tokens,
    sections,
    groupingHints,
  }
}

export async function regroupDocument(document: ParsedDocument, groupingHints: SymbolGroupingHints) {
  return createParsedDocument({
    format: document.format,
    title: document.title,
    sections: document.sections.map((section) => ({
      title: section.title,
      text: section.paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    })),
  }, document.sourceName, groupingHints)
}

export function applyDifficultWords(document: ParsedDocument, words: string[]) {
  const difficult = new Set(words.map(normalizeWord))
  return {
    ...document,
    tokens: document.tokens.map((token) => ({
      ...token,
      difficult: token.difficult || difficult.has(token.normalized),
    })),
  }
}

export function buildChunks(
  document: ParsedDocument,
  targetSize: number,
  mode: 'skim' | 'deep-focus' | 'study',
): ReadingChunk[] {
  const chunks: ReadingChunk[] = []
  let cursor = 0
  while (cursor < document.tokens.length) {
    const start = cursor
    const first = document.tokens[cursor]
    const chunkTokens: Token[] = []
    while (cursor < document.tokens.length && chunkTokens.length < targetSize) {
      const token = document.tokens[cursor]
      if (
        chunkTokens.length > 0 &&
        (token.source.sectionIndex !== first.source.sectionIndex ||
          token.source.paragraphIndex !== first.source.paragraphIndex)
      ) break
      chunkTokens.push(token)
      cursor += 1
      if (SENTENCE_END.test(token.text)) break
      if (mode !== 'skim' && chunkTokens.length > 1 && CLAUSE_END.test(token.text)) break
    }
    const end = cursor - 1
    chunks.push({
      id: `c:${start}:${end}`,
      text: tokensToText(chunkTokens),
      tokens: chunkTokens,
      startWordIndex: start,
      endWordIndex: end,
      sectionIndex: first.source.sectionIndex,
      paragraphIndex: first.source.paragraphIndex,
      sentenceStart: start === 0 || SENTENCE_END.test(document.tokens[start - 1]?.text ?? ''),
      sentenceEnd: SENTENCE_END.test(document.tokens[end]?.text ?? ''),
      complexity: chunkTokens.reduce((sum, token) => sum + (token.difficult ? 1 : 0), 0),
    })
  }
  return chunks
}

export function buildShortsformChunks(document: ParsedDocument, maxWords = 18): ReadingChunk[] {
  const chunks: ReadingChunk[] = []
  let cursor = 0
  const targetSize = Math.max(8, maxWords)
  while (cursor < document.tokens.length) {
    const start = cursor
    const first = document.tokens[cursor]
    const chunkTokens: Token[] = []
    while (cursor < document.tokens.length && chunkTokens.length < targetSize) {
      const token = document.tokens[cursor]
      if (
        chunkTokens.length > 0 &&
        (token.source.sectionIndex !== first.source.sectionIndex ||
          token.source.paragraphIndex !== first.source.paragraphIndex)
      ) break
      chunkTokens.push(token)
      cursor += 1
      if (SENTENCE_END.test(token.text)) break
      if (chunkTokens.length >= 10 && CLAUSE_END.test(token.text)) break
    }
    const end = cursor - 1
    chunks.push({
      id: `shorts:${start}:${end}`,
      text: tokensToText(chunkTokens),
      tokens: chunkTokens,
      startWordIndex: start,
      endWordIndex: end,
      sectionIndex: first.source.sectionIndex,
      paragraphIndex: first.source.paragraphIndex,
      sentenceStart: start === 0 || SENTENCE_END.test(document.tokens[start - 1]?.text ?? ''),
      sentenceEnd: SENTENCE_END.test(document.tokens[end]?.text ?? ''),
      complexity: chunkTokens.reduce((sum, token) => sum + (token.difficult ? 1 : 0), 0),
    })
  }
  return chunks
}

export function getChunkDelay(chunk: ReadingChunk, wpm: number, clarityPauses: boolean) {
  const base = Math.max(150, (60_000 / Math.max(wpm, 1)) * chunk.tokens.length)
  const clause = CLAUSE_END.test(chunk.text) ? 120 : 0
  const sentence = chunk.sentenceEnd ? 240 : 0
  const difficult = clarityPauses ? chunk.complexity * 160 : 0
  return base + clause + sentence + difficult
}

export function getFocusPointIndex(word: string) {
  const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (!core || (core.length === 1 && CJK.test(core))) return -1
  if (core.length <= 2) return word.indexOf(core)
  if (core.length === 3) return word.indexOf(core) + 1
  return word.indexOf(core) + Math.floor(core.length * 0.35)
}

export function findMeaningfulRewind(chunks: ReadingChunk[], currentIndex: number) {
  let fallback = Math.max(currentIndex - 2, 0)
  for (let index = Math.max(currentIndex - 1, 0); index >= 0; index -= 1) {
    if (chunks[index].sentenceStart || chunks[index].paragraphIndex !== chunks[currentIndex].paragraphIndex) {
      return index
    }
    if (chunks[index].tokens.length > 1) fallback = index
  }
  return fallback
}

export function findChunkForWord(chunks: ReadingChunk[], wordIndex: number) {
  const index = chunks.findIndex((chunk) => wordIndex >= chunk.startWordIndex && wordIndex <= chunk.endWordIndex)
  return index >= 0 ? index : 0
}

export function tokensToText(tokens: Token[]) {
  let text = ''
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1]?.text
    if (index > 0 && shouldAddSpace(previous, token.text)) text += ' '
    text += token.text
  })
  return text
}

export function normalizeWord(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function segmentWords(text: string, hints?: SymbolGroupingHints, language = 'und') {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(language === 'und' ? undefined : language, { granularity: 'word' })
    const segments = Array.from(segmenter.segment(text), ({ segment, isWordLike }) => ({ segment, isWordLike }))
    const values: string[] = []
    let prefix = ''
    for (const item of segments) {
      if (!item.segment.trim()) continue
      if (!item.isWordLike && PREFIX_PUNCTUATION.test(item.segment)) {
        prefix += item.segment
      } else if (!item.isWordLike && values.length > 0 && SUFFIX_PUNCTUATION.test(item.segment)) {
        values[values.length - 1] += item.segment
      } else {
        values.push(`${prefix}${item.segment}`)
        prefix = ''
      }
    }
    return applyGroupingHints(values, hints)
  }
  return applyGroupingHints(groupFallbackSegments(text), hints)
}

function applyGroupingHints(values: string[], hints?: SymbolGroupingHints) {
  if (!hints) return values
  const output: string[] = []
  let prefix = ''
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (hints.prefixes.includes(value)) {
      prefix += value
      continue
    }
    if (hints.suffixes.includes(value) && output.length) {
      output[output.length - 1] += value
      continue
    }
    if (hints.joiners.includes(value) && output.length && values[index + 1]) {
      output[output.length - 1] += `${value}${values[index + 1]}`
      index += 1
      continue
    }
    output.push(`${prefix}${value}`)
    prefix = ''
  }
  if (prefix) output.push(prefix)
  return output
}

function createSentences(tokens: Token[], sectionIndex: number, paragraphIndex: number): Sentence[] {
  if (tokens.length === 0) return []
  const sentences: Sentence[] = []
  let start = tokens[0].source.wordIndex
  let buffer: Token[] = []
  tokens.forEach((token, index) => {
    buffer.push(token)
    if (SENTENCE_END.test(token.text) || index === tokens.length - 1) {
      sentences.push({
        id: `sentence:${sectionIndex}:${paragraphIndex}:${sentences.length}`,
        text: tokensToText(buffer),
        tokenStart: start,
        tokenEnd: token.source.wordIndex,
      })
      start = token.source.wordIndex + 1
      buffer = []
    }
  })
  return sentences
}

function classifyRole(normalized: string, index: number): WordRole {
  if (VERBS.has(normalized) || /(?:ed|ing)$/.test(normalized)) return 'verb'
  if (index === 0) return 'subject'
  if (normalized.length >= 8) return 'key'
  return 'normal'
}

function isDifficult(raw: string, normalized: string) {
  return normalized.length >= 9 || /\d/.test(raw) || /[A-Z]{2,}/.test(raw) || /[/_:]/.test(raw)
}

function shouldAddSpace(previous: string | undefined, next: string) {
  if (!previous || CJK.test(previous) || CJK.test(next)) return false
  if (SUFFIX_PUNCTUATION.test(next)) return false
  if (PREFIX_PUNCTUATION.test(previous)) return false
  return true
}

function groupFallbackSegments(text: string) {
  const raw = text.match(/[\p{L}\p{N}\p{M}]+|[^\s]/gu) ?? []
  const values: string[] = []
  let prefix = ''
  for (const value of raw) {
    if (PREFIX_PUNCTUATION.test(value)) prefix += value
    else if (SUFFIX_PUNCTUATION.test(value) && values.length) values[values.length - 1] += value
    else {
      values.push(`${prefix}${value}`)
      prefix = ''
    }
  }
  if (prefix) values.push(prefix)
  return values
}

function detectLanguage(text: string) {
  const sample = text.slice(0, 20_000)
  const scores: Array<[string, RegExp]> = [
    ['ja', /[\u3040-\u30ff]/u],
    ['ko', /[\uac00-\ud7af]/u],
    ['zh', /[\u3400-\u9fff]/u],
    ['ar', /[\u0600-\u06ff]/u],
    ['he', /[\u0590-\u05ff]/u],
    ['hi', /[\u0900-\u097f]/u],
    ['th', /[\u0e00-\u0e7f]/u],
    ['ru', /[\u0400-\u04ff]/u],
    ['el', /[\u0370-\u03ff]/u],
  ]
  return scores.find(([, expression]) => expression.test(sample))?.[0] ?? 'und'
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
