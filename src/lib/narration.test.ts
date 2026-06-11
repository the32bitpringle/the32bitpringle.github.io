import { describe, expect, it } from 'vitest'
import {
  buildFallbackNarrationCast,
  resolveNarrationVoice,
  sanitizeNarrationCast,
} from './narration'

const voices = [
  { gender: 'Female', locale: 'en-US', name: 'en-US-AriaNeural' },
  { gender: 'Male', locale: 'en-US', name: 'en-US-GuyNeural' },
  { gender: 'Female', locale: 'en-GB', name: 'en-GB-SoniaNeural' },
]

describe('narration casting', () => {
  it('builds stable local character assignments from recurring names', () => {
    const cast = buildFallbackNarrationCast(
      'Alice waited. Bob asked Alice to stay. Alice replied to Bob.',
      voices,
      'en-US-AriaNeural',
    )
    expect(cast.narratorVoice).toBe('en-US-AriaNeural')
    expect(cast.characters.map((character) => character.name)).toEqual(expect.arrayContaining(['Alice', 'Bob']))
  })

  it('uses attributed character voices and otherwise uses the narrator', () => {
    const cast = {
      narratorVoice: 'en-US-AriaNeural',
      characters: [{ name: 'Alice', aliases: ['Al'], voiceName: 'en-US-GuyNeural' }],
    }
    expect(resolveNarrationVoice('"Stay here," said Alice.', cast)).toEqual({
      character: 'Alice',
      voiceName: 'en-US-GuyNeural',
    })
    expect(resolveNarrationVoice('The rain continued.', cast).character).toBe('Narrator')
  })

  it('rejects AI voice names that are not installed', () => {
    const fallback = buildFallbackNarrationCast('Alice met Alice.', voices, 'en-US-AriaNeural')
    const cast = sanitizeNarrationCast({
      narratorVoice: 'missing',
      characters: [{ name: 'Alice', aliases: [], voiceName: 'missing' }],
    }, voices, fallback)
    expect(cast.narratorVoice).toBe('en-US-AriaNeural')
    expect(cast.characters).toEqual([])
  })
})
