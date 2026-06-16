(() => {
  if (window.__celereExtractorInstalled) return
  window.__celereExtractorInstalled = true

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'CELERE_EXTRACT_TEXT') return false
    try {
      sendResponse({ ok: true, ...extractReadableText(message) })
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to extract readable text.' })
    }
    return false
  })

  function extractReadableText({ mode = 'page', minChars = 300 } = {}) {
    const selected = normalizeText(String(window.getSelection?.() ?? ''))
    if (mode === 'selection') {
      if (selected.length < minChars) throw new Error('Select a longer passage before sending to Celere.')
      return buildResult(selected, 'selection')
    }
    if (selected.length >= minChars) return buildResult(selected, 'selection')

    const roots = uniqueElements([
      ...document.querySelectorAll('article, main, [role="main"], .article, .post, .entry-content, .content'),
      document.body,
    ].filter(Boolean))
    const best = roots
      .map((root) => ({ root, blocks: collectBlocks(root), score: scoreRoot(root) }))
      .filter((candidate) => candidate.blocks.length)
      .sort((a, b) => b.score - a.score)[0]

    const text = normalizeText((best?.blocks ?? collectBlocks(document.body))
      .map((block) => normalizeText(block.innerText || block.textContent || ''))
      .filter(Boolean)
      .filter(uniqueText())
      .join('\n\n'))

    if (text.length < minChars) throw new Error('No readable article-length text was found on this page.')
    return buildResult(text, 'page')
  }

  function buildResult(text, source) {
    const title = normalizeText(
      document.querySelector('meta[property="og:title"]')?.content ||
      document.querySelector('h1')?.textContent ||
      document.title ||
      'Web page',
    ).slice(0, 180)
    return {
      title,
      text: text.slice(0, 1_000_000),
      url: location.href,
      source,
      charCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    }
  }

  function collectBlocks(root) {
    return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre'))
      .filter((element) => !isChrome(element) && isVisible(element))
      .filter((element) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        return text.length >= 24 || /^h[1-6]$/i.test(element.tagName)
      })
  }

  function scoreRoot(root) {
    const blocks = collectBlocks(root)
    const textLength = blocks.reduce((sum, block) => sum + normalizeText(block.innerText || '').length, 0)
    const punctuation = blocks.reduce((sum, block) => sum + ((block.innerText || '').match(/[.!?。！？]/g) || []).length, 0)
    const linkLength = Array.from(root.querySelectorAll('a')).reduce((sum, link) => sum + normalizeText(link.innerText || '').length, 0)
    const linkPenalty = textLength ? (linkLength / textLength) * 1200 : 0
    return textLength + punctuation * 35 - linkPenalty - chromePenalty(root)
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    if (element.closest('[hidden], [aria-hidden="true"]')) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function isChrome(element) {
    return Boolean(element.closest('nav, aside, footer, header, form, button, script, style, noscript, svg, canvas, [role="navigation"], [role="banner"], [role="contentinfo"], [class*="cookie"], [id*="cookie"], [class*="comment"], [id*="comment"]'))
  }

  function chromePenalty(root) {
    const value = `${root.id || ''} ${root.className || ''}`.toLowerCase()
    return /(nav|menu|sidebar|footer|header|promo|ad|cookie|comment)/.test(value) ? 2000 : 0
  }

  function normalizeText(value) {
    return value
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements))
  }

  function uniqueText() {
    const seen = new Set()
    return (text) => {
      const key = text.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }
  }
})()
