import { beforeAll, describe, expect, it } from 'vitest'
import {
  getAccountQueue,
  getAccountSession,
  saveAccountQueueItem,
  putAccountSession,
} from './storage'
import type { QueueItem, ReadingSession } from '../types'

function resetDb() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('celere-v2')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('IndexedDB reset was blocked.'))
  })
}

describe('account-scoped reading storage', () => {
  beforeAll(async () => {
    localStorage.clear()
    await resetDb()
  })

  it('keeps each Clerk account on its own last book', async () => {
    const baseItem: QueueItem = {
      documentId: 'queue-book-a',
      title: 'Book A',
      format: 'txt',
      currentWordIndex: 42,
      mode: 'deep-focus',
      savedAt: 100,
    }

    await saveAccountQueueItem('user-a', baseItem)
    await saveAccountQueueItem('user-b', {
      ...baseItem,
      documentId: 'queue-book-b',
      title: 'Book B',
      currentWordIndex: 7,
      savedAt: 200,
    })

    await expect(getAccountQueue('user-a')).resolves.toMatchObject([
      { documentId: 'queue-book-a', title: 'Book A', currentWordIndex: 42 },
    ])
    await expect(getAccountQueue('user-b')).resolves.toMatchObject([
      { documentId: 'queue-book-b', title: 'Book B', currentWordIndex: 7 },
    ])
  })

  it('keeps each Clerk account on its own reading position for the same book', async () => {
    const baseSession: ReadingSession = {
      documentId: 'session-shared-book',
      currentWordIndex: 12,
      currentChunkIndex: 3,
      mode: 'deep-focus',
      metrics: {
        breaks: 0,
        focusedSeconds: 0,
        lostFocus: 0,
        misunderstood: 0,
        recoveries: 0,
        understood: 0,
      },
      reactions: [],
      bookmarks: [],
      updatedAt: 100,
    }

    await putAccountSession('user-a', baseSession)
    await putAccountSession('user-b', { ...baseSession, currentWordIndex: 99 })

    await expect(getAccountSession('user-a', 'session-shared-book')).resolves.toMatchObject({
      currentWordIndex: 12,
    })
    await expect(getAccountSession('user-b', 'session-shared-book')).resolves.toMatchObject({
      currentWordIndex: 99,
    })
  })
})
