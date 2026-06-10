import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto')
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}
