import { describe, expect, it } from 'vitest'
import { importText } from './documents'

describe('document text imports', () => {
  it('imports plain text', async () => {
    const document = await importText('A readable pasted paragraph.', 'Pasted sample')
    expect(document.title).toBe('Pasted sample')
    expect(document.format).toBe('txt')
    expect(document.tokens.length).toBeGreaterThan(2)
  })

  it('turns Markdown headings into readable sections', async () => {
    const document = await importText(
      '# First chapter\n\nA **clear** opening paragraph.\n\n## Next chapter\n\nRead [the source](https://example.com).',
      'Markdown sample',
      'markdown',
    )
    expect(document.format).toBe('markdown')
    expect(document.title).toBe('Markdown sample')
    expect(document.sections.map((section) => section.title)).toEqual(['First chapter', 'Next chapter'])
    expect(document.text).not.toContain('**')
    expect(document.text).not.toContain('https://example.com')
  })
})
