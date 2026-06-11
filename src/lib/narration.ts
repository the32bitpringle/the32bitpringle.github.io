import type { NarrationCast } from '../types'

export interface NarrationVoice {
  gender?: string
  locale?: string
  name: string
}

const SPEECH_VERBS = 'said|asked|answered|replied|called|cried|murmured|shouted|whispered|yelled'
const NAME_STOPWORDS = new Set([
  'A', 'An', 'And', 'As', 'At', 'But', 'Chapter', 'For', 'He', 'Her', 'His', 'I',
  'If', 'In', 'It', 'Its', 'No', 'Not', 'Of', 'On', 'Or', 'She', 'So', 'That',
  'The', 'Their', 'Then', 'They', 'This', 'To', 'We', 'What', 'When', 'Where',
  'Who', 'Why', 'With', 'You',
])

export function buildFallbackNarrationCast(
  text: string,
  voices: NarrationVoice[],
  preferredVoice: string,
): NarrationCast {
  const usable = preferredVoices(voices, preferredVoice)
  const narratorVoice = usable[0]?.name || preferredVoice
  const counts = new Map<string, number>()
  for (const match of text.matchAll(/\b([A-Z][\p{L}'’-]{1,30})\b/gu)) {
    const name = match[1]
    if (!NAME_STOPWORDS.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const names = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name]) => name)
  const characterVoices = usable.slice(1).length ? usable.slice(1) : usable
  return {
    narratorVoice,
    characters: names.map((name, index) => ({
      aliases: [],
      name,
      voiceName: characterVoices[index % Math.max(characterVoices.length, 1)]?.name || narratorVoice,
    })),
  }
}

export function sanitizeNarrationCast(
  value: NarrationCast,
  voices: NarrationVoice[],
  fallback: NarrationCast,
): NarrationCast {
  const voiceNames = new Set(voices.map((voice) => voice.name))
  return {
    narratorVoice: voiceNames.has(value?.narratorVoice) ? value.narratorVoice : fallback.narratorVoice,
    characters: Array.isArray(value?.characters)
      ? value.characters.slice(0, 12).flatMap((character) => {
          const name = String(character?.name ?? '').trim().slice(0, 80)
          const voiceName = String(character?.voiceName ?? '')
          if (!name || !voiceNames.has(voiceName)) return []
          return [{
            name,
            voiceName,
            aliases: Array.isArray(character.aliases)
              ? character.aliases.map((alias) => String(alias).trim().slice(0, 80)).filter(Boolean).slice(0, 6)
              : [],
          }]
        })
      : fallback.characters,
  }
}

export function resolveNarrationVoice(text: string, cast: NarrationCast) {
  for (const character of cast.characters) {
    for (const label of [character.name, ...character.aliases]) {
      const escaped = escapeRegExp(label)
      if (
        new RegExp(`\\b${escaped}\\b[^.!?]{0,45}\\b(?:${SPEECH_VERBS})\\b`, 'iu').test(text) ||
        new RegExp(`\\b(?:${SPEECH_VERBS})\\b[^.!?]{0,24}\\b${escaped}\\b`, 'iu').test(text)
      ) return { character: character.name, voiceName: character.voiceName }
    }
  }
  return { character: 'Narrator', voiceName: cast.narratorVoice }
}

function preferredVoices(voices: NarrationVoice[], preferredVoice: string) {
  const preferred = voices.find((voice) => voice.name === preferredVoice)
  const locale = preferred?.locale?.split('-')[0] || 'en'
  const matching = voices.filter((voice) => voice.locale?.startsWith(locale))
  const pool = matching.length >= 2 ? matching : voices
  return preferred ? [preferred, ...pool.filter((voice) => voice.name !== preferred.name)] : pool
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
