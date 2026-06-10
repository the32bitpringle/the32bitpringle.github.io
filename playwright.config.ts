import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: {
    command: 'npm run build && npm start',
    port: 8787,
    reuseExistingServer: true,
  },
})
