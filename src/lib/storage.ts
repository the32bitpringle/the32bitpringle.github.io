import type {
  PassageEmbedding,
  ParsedDocument,
  QueueItem,
  ReaderSettings,
  ReadingSession,
  SemanticPassage,
} from '../types'
import { defaultSettings, mergeSettings } from './settings'

const DB_NAME = 'celere-v2'
const DB_VERSION = 1
const SETTINGS_KEY = 'celere:v2:settings'

type StoreName = 'documents' | 'sessions' | 'queue' | 'passages' | 'embeddings'

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? mergeSettings(JSON.parse(raw) as Partial<ReaderSettings>) : defaultSettings
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: ReaderSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export async function putDocument(document: ParsedDocument) {
  return put('documents', document)
}

export async function getDocument(id: string) {
  return get<ParsedDocument>('documents', id)
}

export async function deleteDocumentData(id: string, hash: string) {
  await Promise.all([
    remove('documents', id),
    remove('sessions', id),
    remove('queue', id),
    remove('passages', hash),
    remove('embeddings', hash),
  ])
}

export async function putSession(session: ReadingSession) {
  return put('sessions', session)
}

export async function getSession(documentId: string) {
  return get<ReadingSession>('sessions', documentId)
}

export async function saveQueueItem(item: QueueItem) {
  await put('queue', item)
  const queue = await getAll<QueueItem>('queue')
  const stale = queue.sort((a, b) => b.savedAt - a.savedAt).slice(6)
  await Promise.all(stale.map((entry) => remove('queue', entry.documentId)))
}

export async function getQueue() {
  return (await getAll<QueueItem>('queue')).sort((a, b) => b.savedAt - a.savedAt)
}

export async function putSemanticIndex(hash: string, passages: SemanticPassage[], embeddings: PassageEmbedding[]) {
  await Promise.all([
    put('passages', { key: hash, value: passages }),
    put('embeddings', { key: hash, value: embeddings }),
  ])
}

export async function getSemanticIndex(hash: string) {
  const [passages, embeddings] = await Promise.all([
    get<{ key: string; value: SemanticPassage[] }>('passages', hash),
    get<{ key: string; value: PassageEmbedding[] }>('embeddings', hash),
  ])
  return passages && embeddings ? { passages: passages.value, embeddings: embeddings.value } : null
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of ['documents', 'sessions', 'queue', 'passages', 'embeddings']) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: store === 'queue' ? 'documentId' : store === 'sessions' ? 'documentId' : store === 'documents' ? 'id' : 'key' })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function put(store: StoreName, value: unknown) {
  const db = await openDb()
  return requestPromise(db.transaction(store, 'readwrite').objectStore(store).put(value))
}

async function get<T>(store: StoreName, key: IDBValidKey) {
  const db = await openDb()
  return requestPromise<T | undefined>(db.transaction(store).objectStore(store).get(key))
}

async function getAll<T>(store: StoreName) {
  const db = await openDb()
  return requestPromise<T[]>(db.transaction(store).objectStore(store).getAll())
}

async function remove(store: StoreName, key: IDBValidKey) {
  const db = await openDb()
  return requestPromise(db.transaction(store, 'readwrite').objectStore(store).delete(key))
}

function requestPromise<T = IDBValidKey | undefined>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
