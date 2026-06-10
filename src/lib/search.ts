import type {
  PassageEmbedding,
  ParsedDocument,
  SemanticPassage,
  SemanticSearchResult,
} from '../types'
import { getSemanticIndex, putSemanticIndex } from './storage'
import { normalizeWord, tokensToText } from './tokenize'

type Extractor = (
  texts: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>

let extractorPromise: Promise<Extractor> | null = null

export function buildSemanticPassages(document: ParsedDocument) {
  const passages: SemanticPassage[] = []
  for (const section of document.sections) {
    const paragraphs = section.paragraphs
    let paragraphCursor = 0
    while (paragraphCursor < paragraphs.length) {
      const startParagraph = paragraphCursor
      const startWord = paragraphs[paragraphCursor].tokenStart
      let endParagraph = paragraphCursor
      let endWord = paragraphs[paragraphCursor].tokenEnd
      while (
        endParagraph + 1 < paragraphs.length &&
        endWord - startWord + 1 < 160
      ) {
        endParagraph += 1
        endWord = paragraphs[endParagraph].tokenEnd
        if (endWord - startWord + 1 >= 220) break
      }
      passages.push({
        id: `${document.hash}:${section.index}:${startParagraph}:${endParagraph}`,
        documentId: document.id,
        sectionTitle: section.title,
        sectionIndex: section.index,
        paragraphStart: startParagraph,
        paragraphEnd: endParagraph,
        wordStart: startWord,
        wordEnd: endWord,
        text: tokensToText(document.tokens.slice(startWord, endWord + 1)),
      })
      if (endParagraph >= paragraphs.length - 1) break
      paragraphCursor = Math.max(startParagraph + 1, endParagraph - 1)
    }
  }
  return passages
}

export async function ensureSemanticIndex(
  document: ParsedDocument,
  onProgress: (completed: number, total: number) => void,
  signal?: AbortSignal,
) {
  const cached = await getSemanticIndex(document.hash)
  if (cached) return cached
  const passages = buildSemanticPassages(document)
  const extractor = await getExtractor()
  const embeddings: PassageEmbedding[] = []
  const batchSize = 8

  for (let index = 0; index < passages.length; index += batchSize) {
    if (signal?.aborted) throw new DOMException('Indexing cancelled.', 'AbortError')
    const batch = passages.slice(index, index + batchSize)
    const output = await extractor(batch.map((passage) => passage.text), {
      pooling: 'mean',
      normalize: true,
    })
    const width = output.dims[output.dims.length - 1] || 384
    const values = Array.from(output.data)
    batch.forEach((passage, batchIndex) => {
      embeddings.push({
        passageId: passage.id,
        documentHash: document.hash,
        vector: values.slice(batchIndex * width, (batchIndex + 1) * width),
      })
    })
    onProgress(Math.min(index + batch.length, passages.length), passages.length)
  }

  await putSemanticIndex(document.hash, passages, embeddings)
  return { passages, embeddings }
}

export async function semanticSearch(
  query: string,
  index: { passages: SemanticPassage[]; embeddings: PassageEmbedding[] },
) {
  const extractor = await getExtractor()
  const output = await extractor(query, { pooling: 'mean', normalize: true })
  const queryVector = Array.from(output.data)
  const terms = tokenizeQuery(query)
  const documentFrequency = getDocumentFrequency(index.passages, terms)

  const ranked = index.passages.map((passage, passageIndex) => {
    const embedding = index.embeddings[passageIndex]
    const semanticScore = embedding ? cosine(queryVector, embedding.vector) : 0
    const lexicalScore = bm25(passage.text, terms, documentFrequency, index.passages.length)
    const score = semanticScore * 0.78 + Math.min(lexicalScore / 6, 1) * 0.22
    return {
      passage,
      semanticScore,
      lexicalScore,
      score,
      confidence: score >= 0.68 ? 'high' : score >= 0.48 ? 'medium' : 'low',
    } satisfies SemanticSearchResult
  }).sort((a, b) => b.score - a.score)

  const diversified: SemanticSearchResult[] = []
  for (const result of ranked.slice(0, 12)) {
    const adjacent = diversified.some((existing) =>
      existing.passage.sectionIndex === result.passage.sectionIndex &&
      Math.abs(existing.passage.paragraphStart - result.passage.paragraphStart) <= 1
    )
    if (!adjacent || diversified.length < 2) diversified.push(result)
    if (diversified.length >= 8) break
  }
  return diversified
}

export function exactSearch(document: ParsedDocument, query: string) {
  const terms = tokenizeQuery(query)
  if (terms.length === 0) return []
  const matches: Array<{ start: number; end: number }> = []
  for (let index = 0; index <= document.tokens.length - terms.length; index += 1) {
    const slice = document.tokens.slice(index, index + terms.length).map((token) => token.normalized)
    if (terms.every((term, termIndex) => slice[termIndex]?.includes(term))) {
      matches.push({ start: index, end: index + terms.length - 1 })
    }
  }
  return matches
}

async function getExtractor() {
  extractorPromise ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
    env.allowLocalModels = false
    const device = 'gpu' in navigator ? 'webgpu' : 'wasm'
    const createPipeline = pipeline as unknown as (
      task: string,
      model: string,
      options: Record<string, unknown>,
    ) => Promise<Extractor>
    return createPipeline(
      'feature-extraction',
      'onnx-community/all-MiniLM-L6-v2-ONNX',
      { device, dtype: 'q8' },
    )
  })
  return extractorPromise
}

function tokenizeQuery(value: string) {
  return value.split(/\s+/).map(normalizeWord).filter((term) => term.length > 1)
}

function cosine(a: number[], b: number[]) {
  let dot = 0
  let aMagnitude = 0
  let bMagnitude = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
    aMagnitude += a[i] ** 2
    bMagnitude += b[i] ** 2
  }
  return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude) || 1)
}

function getDocumentFrequency(passages: SemanticPassage[], terms: string[]) {
  return Object.fromEntries(terms.map((term) => [
    term,
    passages.filter((passage) => tokenizeQuery(passage.text).includes(term)).length,
  ]))
}

function bm25(text: string, terms: string[], df: Record<string, number>, total: number) {
  const words = tokenizeQuery(text)
  const averageLength = 170
  const k1 = 1.2
  const b = 0.75
  return terms.reduce((score, term) => {
    const frequency = words.filter((word) => word === term).length
    if (!frequency) return score
    const idf = Math.log(1 + (total - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5))
    return score + idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * words.length / averageLength)))
  }, 0)
}
