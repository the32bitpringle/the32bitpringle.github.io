export function getShortsformAudioPlaybackRate(
  rawDurationMs: number,
  targetDurationMs: number,
  rateMultiplier = 1,
) {
  if (!Number.isFinite(rawDurationMs) || rawDurationMs <= 0 || targetDurationMs <= 0) return 1
  const adjustedTarget = targetDurationMs / Math.max(rateMultiplier, 0.1)
  return Math.min(4, Math.max(0.5, rawDurationMs / adjustedTarget))
}

export interface TtsWordTiming {
  durationMs: number
  offsetMs: number
  text: string
}

export interface AlignedTtsWordTiming extends TtsWordTiming {
  tokenOffset: number
}

export function alignTtsTimings(timings: TtsWordTiming[], tokens: string[]): AlignedTtsWordTiming[] {
  let tokenCursor = 0
  return timings.map((timing, timingIndex) => {
    const boundary = normalizeTimingWord(timing.text)
    let match = -1
    for (let index = tokenCursor; index < tokens.length; index += 1) {
      const token = normalizeTimingWord(tokens[index])
      if (token === boundary || token.includes(boundary) || boundary.includes(token)) {
        match = index
        break
      }
    }
    const tokenOffset = match >= 0
      ? match
      : Math.min(Math.max(tokenCursor, timingIndex), Math.max(tokens.length - 1, 0))
    tokenCursor = Math.min(tokenOffset + 1, tokens.length)
    return { ...timing, tokenOffset }
  })
}

export function getTtsTimingIndex(timings: TtsWordTiming[], currentTimeMs: number) {
  if (!timings.length || currentTimeMs < timings[0].offsetMs) return -1
  let low = 0
  let high = timings.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (timings[middle].offsetMs <= currentTimeMs) low = middle + 1
    else high = middle - 1
  }
  return Math.min(high, timings.length - 1)
}

export function getActiveTtsTimingIndex(timings: TtsWordTiming[], currentTimeMs: number) {
  const index = getTtsTimingIndex(timings, currentTimeMs)
  if (index < 0) return -1
  const timing = timings[index]
  return currentTimeMs <= timing.offsetMs + timing.durationMs ? index : -1
}

export function base64ToAudioBlob(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: 'audio/mpeg' })
}

function normalizeTimingWord(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}
