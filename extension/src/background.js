const DEFAULTS = {
  appUrl: 'https://the32bitpringle.github.io/celere-2/',
  minChars: 300,
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CELERE_EXTRACT_AND_SEND') return false
  extractAndSend(message.mode).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to send page to Celere.' }),
  )
  return true
})

async function extractAndSend(mode = 'page') {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) throw new Error('No active page is available.')
  if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    throw new Error('Browser system pages cannot be clipped.')
  }

  const settings = await chrome.storage.sync.get(DEFAULTS)
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/extractor.js'],
  })
  const extracted = await chrome.tabs.sendMessage(tab.id, {
    type: 'CELERE_EXTRACT_TEXT',
    mode,
    minChars: Number(settings.minChars) || DEFAULTS.minChars,
  })

  if (!extracted?.ok || !extracted.text) {
    throw new Error(extracted?.error || 'No readable text was found on this page.')
  }

  const appUrl = normalizeAppUrl(String(settings.appUrl || DEFAULTS.appUrl))
  const appTab = await chrome.tabs.create({ url: appUrl, active: true })
  if (!appTab.id) throw new Error('Celere tab could not be opened.')
  await waitForTabComplete(appTab.id)
  await chrome.scripting.executeScript({
    target: { tabId: appTab.id },
    files: ['src/celere-bridge.js'],
  })
  const delivered = await chrome.tabs.sendMessage(appTab.id, {
    type: 'CELERE_IMPORT_TEXT',
    payload: {
      title: extracted.title,
      text: extracted.text,
      sourceUrl: extracted.url,
    },
  })

  if (!delivered?.ok) throw new Error(delivered?.error || 'Celere did not accept the import.')
  return {
    title: extracted.title,
    wordCount: extracted.wordCount,
    source: extracted.source,
  }
}

function normalizeAppUrl(value) {
  const url = new URL(value || DEFAULTS.appUrl)
  url.hash = ''
  return url.toString()
}

async function waitForTabComplete(tabId) {
  const tab = await chrome.tabs.get(tabId)
  if (tab.status === 'complete') return
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Celere took too long to load.'))
    }, 15000)
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}
