(() => {
  if (window.__celereBridgeInstalled) return
  window.__celereBridgeInstalled = true

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'CELERE_IMPORT_TEXT') return false
    importIntoCelere(message.payload).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Celere import failed.' }),
    )
    return true
  })

  async function importIntoCelere(payload) {
    const title = String(payload?.title || 'Web page').slice(0, 180)
    const sourceUrl = String(payload?.sourceUrl || '')
    const text = String(payload?.text || '').trim()
    if (text.length < 20) throw new Error('The extracted text was too short to import.')

    await clickImport()
    const dialog = await waitFor(() => document.querySelector('[role="dialog"][aria-label="Import reading"]'), 5000)
    const pasteButton = findButton(dialog, 'Paste text')
    if (pasteButton) pasteButton.click()

    const titleInput = await waitFor(() => dialog.querySelector('input[aria-label="Title"]'), 3000)
    const textArea = await waitFor(() => dialog.querySelector('textarea[aria-label="Text"]'), 3000)
    const formatSelect = dialog.querySelector('select[aria-label="Format"]')

    setValue(titleInput, title)
    if (formatSelect) setValue(formatSelect, 'text')
    setValue(textArea, sourceUrl ? `${text}\n\nSource: ${sourceUrl}` : text)

    const submit = findButton(dialog, 'Import text')
    if (!submit) throw new Error('Celere import button was not found.')
    submit.click()
  }

  async function clickImport() {
    const importButton = await waitFor(
      () => document.querySelector('button[aria-label="Import (O)"], button[title="Import (O)"]'),
      8000,
    )
    importButton.click()
  }

  function findButton(root, text) {
    return Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === text)
  }

  function setValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function waitFor(find, timeoutMs) {
    const start = performance.now()
    return new Promise((resolve, reject) => {
      const tick = () => {
        const value = find()
        if (value) {
          resolve(value)
          return
        }
        if (performance.now() - start > timeoutMs) {
          reject(new Error('Timed out waiting for Celere.'))
          return
        }
        requestAnimationFrame(tick)
      }
      tick()
    })
  }
})()
