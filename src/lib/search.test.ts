import { describe, expect, it } from 'vitest'
import { buildSemanticPassages, exactSearch } from './search'
import { createParsedDocument } from './tokenize'

describe('document search preparation', () => {
  it('creates section-aware passages that never cross sections', async () => {
    const document = await createParsedDocument({
      format: 'txt',
      title: 'Story',
      sections: [
        { title: 'Arrival', text: 'Alex arrived at dusk.\n\nHe carried a sealed letter.' },
        { title: 'The reveal', text: 'Alex revealed his secret to Mina.\n\nThe letter named the missing heir.' },
      ],
    }, 'story.txt')
    const passages = buildSemanticPassages(document)
    expect(passages.some((passage) => passage.sectionTitle === 'The reveal')).toBe(true)
    expect(passages.every((passage) => {
      const section = document.sections[passage.sectionIndex]
      return passage.wordStart >= section.tokenStart && passage.wordEnd <= section.tokenEnd
    })).toBe(true)
  })

  it('keeps exact phrase search separate from semantic search', async () => {
    const document = await createParsedDocument({
      format: 'txt',
      title: 'Story',
      sections: [{ title: 'One', text: 'Alex revealed his secret near the station.' }],
    }, 'story.txt')
    const matches = exactSearch(document, 'revealed his secret')
    expect(matches).toHaveLength(1)
    expect(matches[0].end - matches[0].start).toBe(2)
  })

  it('chunks a large book without crossing sections or creating runaway passages', async () => {
    const paragraph = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ')
    const sections = Array.from({ length: 60 }, (_, section) => ({
      title: `Chapter ${section + 1}`,
      text: Array.from({ length: 8 }, (_, paragraphIndex) =>
        `${paragraph} marker${section}-${paragraphIndex}.`,
      ).join('\n\n'),
    }))
    const document = await createParsedDocument({ format: 'txt', title: 'Large book', sections }, 'large.txt')
    const started = performance.now()
    const passages = buildSemanticPassages(document)
    expect(performance.now() - started).toBeLessThan(1500)
    expect(passages.length).toBeGreaterThan(60)
    expect(passages.length).toBeLessThan(600)
    expect(passages.every((passage) => {
      const section = document.sections[passage.sectionIndex]
      return passage.wordStart >= section.tokenStart && passage.wordEnd <= section.tokenEnd
    })).toBe(true)
  })
})
