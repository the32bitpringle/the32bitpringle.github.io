const status = document.querySelector('#status')
const pageButton = document.querySelector('#send-page')
const selectionButton = document.querySelector('#send-selection')

pageButton.addEventListener('click', () => send('page'))
selectionButton.addEventListener('click', () => send('selection'))

async function send(mode) {
  setBusy(true, mode === 'selection' ? 'Sending selected text…' : 'Finding readable text…')
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CELERE_EXTRACT_AND_SEND', mode })
    if (!result?.ok) throw new Error(result?.error || 'Unable to send text to Celere.')
    status.textContent = `Sent ${result.wordCount} words from ${result.source}.`
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Unable to send text to Celere.'
  } finally {
    setBusy(false)
  }
}

function setBusy(disabled, message) {
  pageButton.disabled = disabled
  selectionButton.disabled = disabled
  if (message) status.textContent = message
}
