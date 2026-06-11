import type {
  AiQuiz,
  AiSearchAnswer,
  NarrationCast,
  SemanticSearchResult,
  SymbolGroupingHints,
} from '../types'

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !payload) throw new Error(payload?.error ?? 'AI request failed.')
  return payload
}

export function createQuiz(context: string, mode: string, title: string, signal?: AbortSignal) {
  return postJson<AiQuiz>('/api/quiz', { context, mode, title }, signal)
}

export function answerSemanticQuestion(
  query: string,
  results: SemanticSearchResult[],
  signal?: AbortSignal,
) {
  return postJson<AiSearchAnswer>('/api/search-answer', {
    query,
    passages: results.slice(0, 8).map((result, index) => ({
      resultNumber: index + 1,
      sectionTitle: result.passage.sectionTitle,
      paragraphStart: result.passage.paragraphStart,
      text: result.passage.text,
    })),
  }, signal)
}

export function summarizeContext(context: string, kind: 'break' | 'who-what-where', signal?: AbortSignal) {
  return postJson<{ summary: string }>('/api/context', { context, kind }, signal)
}

export function analyzeSymbolGrouping(sample: string, title: string, signal?: AbortSignal) {
  return postJson<SymbolGroupingHints>('/api/grouping', { sample, title }, signal)
}

export function classifyComplexity(sample: string, signal?: AbortSignal) {
  return postJson<{ difficultWords: string[] }>('/api/complexity', { sample }, signal)
}

export function analyzeNarrationCast(
  sample: string,
  title: string,
  voices: Array<{ gender?: string; locale?: string; name: string }>,
  signal?: AbortSignal,
) {
  return postJson<NarrationCast>('/api/narration-cast', {
    sample,
    title,
    voices: voices.slice(0, 40),
  }, signal)
}
