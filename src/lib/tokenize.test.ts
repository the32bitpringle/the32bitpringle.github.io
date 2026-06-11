import { describe, expect, it } from 'vitest'
import {
  buildChunks,
  buildNarrationPassages,
  buildShortsformChunks,
  createParsedDocument,
  findMeaningfulRewind,
  getChunkDelay,
  getFocusPointIndex,
} from './tokenize'

async function fixture() {
  return createParsedDocument({
    format: 'txt',
    title: 'Test book',
    sections: [
      {
        title: 'Chapter 1',
        text: 'Alex waited quietly. Then Alex revealed the hidden map to Mira.\n\nMira understood the secret.',
      },
      {
        title: 'Chapter 2',
        text: 'A technical hyperparameter required recalibration.',
      },
    ],
  }, 'test.txt')
}

describe('document tokenization', () => {
  it('preserves source positions and section boundaries', async () => {
    const document = await fixture()
    expect(document.sections).toHaveLength(2)
    expect(document.tokens[0].source.sectionIndex).toBe(0)
    expect(document.sections[1].tokenStart).toBeGreaterThan(document.sections[0].tokenStart)
    expect(document.sections[0].paragraphs[0].sentences).toHaveLength(2)
  })

  it('groups chunks without crossing paragraphs', async () => {
    const document = await fixture()
    const chunks = buildChunks(document, 5, 'deep-focus')
    expect(chunks.every((chunk) =>
      chunk.tokens.every((token) => token.source.paragraphIndex === chunk.paragraphIndex),
    )).toBe(true)
  })

  it('builds natural Shortsform narration phrases instead of word-sized chunks', async () => {
    const document = await fixture()
    const chunks = buildShortsformChunks(document)
    expect(chunks[0].text).toBe('Alex waited quietly.')
    expect(chunks[1].tokens.length).toBeGreaterThan(2)
    expect(chunks.every((chunk) =>
      chunk.tokens.every((token) => token.source.paragraphIndex === chunk.paragraphIndex),
    )).toBe(true)
  })

  it('builds multi-sentence narration passages without crossing sections', async () => {
    const document = await fixture()
    const passages = buildNarrationPassages(document, 40)
    expect(passages[0].text).toContain('Alex waited quietly. Then Alex revealed the hidden map to Mira.')
    expect(passages[0].text).toContain('Mira understood the secret.')
    expect(passages).toHaveLength(2)
    expect(passages.every((passage) =>
      passage.tokens.every((token) => token.source.sectionIndex === passage.sectionIndex),
    )).toBe(true)
  })

  it('returns a sentence-aware rewind point', async () => {
    const chunks = buildChunks(await fixture(), 2, 'deep-focus')
    const target = findMeaningfulRewind(chunks, Math.min(4, chunks.length - 1))
    expect(target).toBeLessThanOrEqual(4)
    expect(chunks[target].sentenceStart || target === 0).toBe(true)
  })

  it('adds clarity delay for difficult words', async () => {
    const document = await fixture()
    const chunk = buildChunks(document, 5, 'skim').find((item) => item.complexity > 0)!
    expect(getChunkDelay(chunk, 300, true)).toBeGreaterThan(getChunkDelay(chunk, 300, false))
  })

  it('uses the selected WPM exactly when clarity pauses are off', async () => {
    const document = await fixture()
    const chunk = buildChunks(document, 5, 'skim')[0]
    expect(getChunkDelay(chunk, 300, false)).toBe(chunk.tokens.length * 200)
    expect(getChunkDelay(buildChunks(document, 1, 'study')[0], 1000, false)).toBe(60)
  })

  it('selects a stable focus point and disables it for single CJK characters', () => {
    expect(getFocusPointIndex('reading')).toBe(2)
    expect(getFocusPointIndex('読')).toBe(-1)
  })

  it('attaches multilingual punctuation to the preceding word', async () => {
    const document = await createParsedDocument({
      format: 'txt',
      title: 'Languages',
      sections: [{
        title: 'Mixed',
        text: 'Anyways, he left. ثم قال، نعم؟ 彼は言った。 नमस्ते।',
      }],
    }, 'languages.txt')
    expect(document.tokens.map((token) => token.text)).toEqual(expect.arrayContaining([
      'Anyways,',
      'left.',
      'قال،',
      'نعم؟',
      '言',
      'っ',
      'た。',
      'नमस्ते।',
    ]))
    expect(document.tokens).not.toContainEqual(expect.objectContaining({ text: ',' }))
    expect(document.language).toBe('ja')
  })

  it('uses AI punctuation hints without grouping ordinary words', async () => {
    const document = await createParsedDocument({
      format: 'txt',
      title: 'Phrases',
      sections: [{ title: 'One', text: 'He crossed the bridge / river boundary.' }],
    }, 'phrases.txt', {
      prefixes: [],
      suffixes: [],
      joiners: ['/'],
      standalone: [],
      notes: [],
      languageCode: 'en',
    })
    expect(document.tokens.map((token) => token.text)).toContain('bridge/river')
    expect(document.tokens.map((token) => token.text)).toContain('He')
    expect(document.tokens.map((token) => token.text)).toContain('crossed')
  })

  it('detects Chinese explicitly and attaches Chinese punctuation', async () => {
    const document = await createParsedDocument({
      format: 'txt',
      title: '中文',
      sections: [{ title: '第一章', text: '无论如何，他离开了。然后问：“真的吗？”' }],
    }, 'chinese.txt')
    expect(document.language).toBe('zh')
    expect(document.tokens.map((token) => token.text)).toEqual(expect.arrayContaining(['如何，', '了。', '问：', '吗？”']))
    expect(document.tokens.some((token) => /^[，。：？！]$/u.test(token.text))).toBe(false)
  })
})
