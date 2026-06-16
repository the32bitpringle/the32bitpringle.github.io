const appUrl = document.querySelector('#app-url')
const minChars = document.querySelector('#min-chars')
const save = document.querySelector('#save')
const status = document.querySelector('#status')

const DEFAULTS = {
  appUrl: 'https://the32bitpringle.github.io/celere-2/',
  minChars: 300,
}

chrome.storage.sync.get(DEFAULTS).then((settings) => {
  appUrl.value = settings.appUrl
  minChars.value = settings.minChars
})

save.addEventListener('click', async () => {
  try {
    const url = new URL(appUrl.value)
    const minimum = Math.max(100, Math.min(5000, Number(minChars.value) || DEFAULTS.minChars))
    await chrome.storage.sync.set({ appUrl: url.toString(), minChars: minimum })
    status.textContent = 'Saved.'
  } catch {
    status.textContent = 'Enter a valid Celere app URL.'
  }
})
