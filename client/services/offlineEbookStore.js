const DATABASE_NAME = 'book-shelf-offline'
const DATABASE_VERSION = 1
const BOOKS_STORE = 'books'
const FILES_STORE = 'files'
const OPERATIONS_STORE = 'operations'
const ACTIVE_PROFILE_KEY = 'bookShelfOfflineProfile'

let databasePromise = null

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

function openDatabase() {
  if (databasePromise) return databasePromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Offline storage is not supported by this browser'))

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(BOOKS_STORE)) {
        const books = database.createObjectStore(BOOKS_STORE, { keyPath: 'key' })
        books.createIndex('ownerId', 'ownerId', { unique: false })
      }
      if (!database.objectStoreNames.contains(FILES_STORE)) {
        database.createObjectStore(FILES_STORE, { keyPath: 'key' })
      }
      if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
        const operations = database.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' })
        operations.createIndex('ownerId', 'ownerId', { unique: false })
        operations.createIndex('bookKey', 'bookKey', { unique: false })
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onblocked = () => reject(new Error('Offline storage is open in another tab; close it and try again'))
    request.onerror = () => {
      databasePromise = null
      reject(request.error)
    }
  })
  return databasePromise
}

function serializable(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeFileId(fileId) {
  return fileId || ''
}

function makeBookKey(ownerId, libraryItemId, fileId = null) {
  return `${ownerId}:${libraryItemId}:${normalizeFileId(fileId)}`
}

export function setActiveProfile(user) {
  if (!user?.id) return
  localStorage.setItem(
    ACTIVE_PROFILE_KEY,
    JSON.stringify({
      id: user.id,
      username: user.username || ''
    })
  )
}

export function getActiveProfile() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_PROFILE_KEY)) || null
  } catch (error) {
    console.error('Failed to read the offline profile', error)
    return null
  }
}

function resolveOwnerId(ownerId) {
  return ownerId || getActiveProfile()?.id || null
}

export function isSupported() {
  return typeof indexedDB !== 'undefined'
}

export async function cacheBook({ owner, libraryItem, fileId = null, ebookData, coverData = null, coverType = null, annotations = [], progress = null }) {
  if (!owner?.id || !libraryItem?.id || !ebookData) throw new Error('Missing data required to cache this book')
  setActiveProfile(owner)

  const database = await openDatabase()
  const transaction = database.transaction([BOOKS_STORE, FILES_STORE], 'readwrite')
  const key = makeBookKey(owner.id, libraryItem.id, fileId)
  const record = {
    key,
    ownerId: owner.id,
    ownerName: owner.username || '',
    libraryItemId: libraryItem.id,
    fileId: normalizeFileId(fileId),
    libraryItem: serializable(libraryItem),
    coverData,
    coverType,
    annotations: serializable(annotations) || [],
    progress: serializable(progress),
    cachedAt: Date.now(),
    updatedAt: Date.now(),
    size: ebookData.byteLength || ebookData.size || 0
  }
  transaction.objectStore(BOOKS_STORE).put(record)
  transaction.objectStore(FILES_STORE).put({ key, ebookData })
  await transactionComplete(transaction)
  navigator.storage?.persist?.().catch(() => false)
  return record
}

export async function getBook(libraryItemId, fileId = null, ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) return null
  const database = await openDatabase()
  const transaction = database.transaction([BOOKS_STORE, FILES_STORE], 'readonly')
  const key = makeBookKey(resolvedOwnerId, libraryItemId, fileId)
  const [record, file] = await Promise.all([requestResult(transaction.objectStore(BOOKS_STORE).get(key)), requestResult(transaction.objectStore(FILES_STORE).get(key))])
  if (!record || !file) return null
  return { ...record, ebookData: file.ebookData }
}

export async function listBooks(ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) return []
  const database = await openDatabase()
  const transaction = database.transaction(BOOKS_STORE, 'readonly')
  const records = await requestResult(transaction.objectStore(BOOKS_STORE).index('ownerId').getAll(resolvedOwnerId))
  return records.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function pendingOperationCount(libraryItemId, fileId = null, ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) return 0
  const bookKey = makeBookKey(resolvedOwnerId, libraryItemId, fileId)
  const database = await openDatabase()
  const transaction = database.transaction(OPERATIONS_STORE, 'readonly')
  return requestResult(transaction.objectStore(OPERATIONS_STORE).index('bookKey').count(bookKey))
}

export async function removeBook(libraryItemId, fileId = null, ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) return
  const bookKey = makeBookKey(resolvedOwnerId, libraryItemId, fileId)
  if (await pendingOperationCount(libraryItemId, fileId, resolvedOwnerId)) {
    const error = new Error('Reconnect and sync this book before removing its offline copy')
    error.code = 'PENDING_OFFLINE_CHANGES'
    throw error
  }
  const database = await openDatabase()
  const transaction = database.transaction([BOOKS_STORE, FILES_STORE, OPERATIONS_STORE], 'readwrite')
  transaction.objectStore(BOOKS_STORE).delete(bookKey)
  transaction.objectStore(FILES_STORE).delete(bookKey)
  const pendingRequest = transaction.objectStore(OPERATIONS_STORE).index('bookKey').getAllKeys(bookKey)
  pendingRequest.onsuccess = () => pendingRequest.result.forEach((key) => transaction.objectStore(OPERATIONS_STORE).delete(key))
  await transactionComplete(transaction)
}

async function updateBookRecord(libraryItemId, fileId, ownerId, update) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) return null
  const database = await openDatabase()
  const transaction = database.transaction(BOOKS_STORE, 'readwrite')
  const store = transaction.objectStore(BOOKS_STORE)
  const record = await requestResult(store.get(makeBookKey(resolvedOwnerId, libraryItemId, fileId)))
  if (!record) return null
  update(record)
  record.updatedAt = Date.now()
  store.put(record)
  await transactionComplete(transaction)
  return record
}

export function saveAnnotations(libraryItemId, fileId, annotations, ownerId = null) {
  return updateBookRecord(libraryItemId, fileId, ownerId, (record) => {
    record.annotations = serializable(annotations) || []
  })
}

export async function saveProgress(libraryItemId, fileId, progress, { ownerId = null, queue = false } = {}) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) return null
  const database = await openDatabase()
  const stores = queue ? [BOOKS_STORE, OPERATIONS_STORE] : [BOOKS_STORE]
  const transaction = database.transaction(stores, 'readwrite')
  const books = transaction.objectStore(BOOKS_STORE)
  const record = await requestResult(books.get(makeBookKey(resolvedOwnerId, libraryItemId, fileId)))
  if (!record) return null
  const lastUpdate = Date.now()
  const progressPayload = { ...serializable(progress), lastUpdate }
  record.progress = {
    ...(record.progress || {}),
    ...progressPayload,
    libraryItemId
  }
  record.updatedAt = lastUpdate
  books.put(record)
  if (queue) {
    transaction.objectStore(OPERATIONS_STORE).put({
      id: `progress:${record.key}`,
      ownerId: record.ownerId,
      bookKey: record.key,
      libraryItemId,
      fileId: normalizeFileId(fileId),
      type: 'progress',
      payload: progressPayload,
      createdAt: lastUpdate
    })
  }
  await transactionComplete(transaction)
  return record
}

export async function createLocalAnnotation(libraryItemId, fileId, payload, ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) throw new Error('No offline profile is available')
  const operationId = `annotation-create:${randomId()}`
  const createdAt = Date.now()
  const annotation = {
    ...serializable(payload),
    id: `offline-${randomId()}`,
    userId: resolvedOwnerId,
    libraryItemId,
    fileId: normalizeFileId(fileId) || null,
    createdAt,
    updatedAt: createdAt,
    _pending: true,
    _operationId: operationId
  }

  const database = await openDatabase()
  const transaction = database.transaction([BOOKS_STORE, OPERATIONS_STORE], 'readwrite')
  const books = transaction.objectStore(BOOKS_STORE)
  const record = await requestResult(books.get(makeBookKey(resolvedOwnerId, libraryItemId, fileId)))
  if (!record) throw new Error('This book is not available offline')
  record.annotations = [...(record.annotations || []), annotation]
  record.updatedAt = createdAt
  books.put(record)
  transaction.objectStore(OPERATIONS_STORE).put({
    id: operationId,
    ownerId: resolvedOwnerId,
    bookKey: record.key,
    libraryItemId,
    fileId: normalizeFileId(fileId),
    type: 'annotation-create',
    payload: serializable(payload),
    localAnnotationId: annotation.id,
    createdAt
  })
  await transactionComplete(transaction)
  return annotation
}

export async function updateLocalAnnotation(libraryItemId, fileId, annotation, ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) throw new Error('No offline profile is available')
  const database = await openDatabase()
  const transaction = database.transaction([BOOKS_STORE, OPERATIONS_STORE], 'readwrite')
  const books = transaction.objectStore(BOOKS_STORE)
  const record = await requestResult(books.get(makeBookKey(resolvedOwnerId, libraryItemId, fileId)))
  if (!record) throw new Error('This book is not available offline')
  const updatedAt = Date.now()
  const existing = (record.annotations || []).find((item) => item.id === annotation.id)
  if (existing) Object.assign(existing, serializable(annotation), { updatedAt, _pending: true })
  record.updatedAt = updatedAt
  books.put(record)

  const operations = transaction.objectStore(OPERATIONS_STORE)
  if (annotation._operationId) {
    const operation = await requestResult(operations.get(annotation._operationId))
    if (operation) {
      operation.payload.note = annotation.note || ''
      operation.payload.color = annotation.color
      operations.put(operation)
    }
  } else {
    operations.put({
      id: `annotation-update:${annotation.id}`,
      ownerId: resolvedOwnerId,
      bookKey: record.key,
      libraryItemId,
      fileId: normalizeFileId(fileId),
      type: 'annotation-update',
      annotationId: annotation.id,
      payload: { note: annotation.note || '', color: annotation.color },
      createdAt: updatedAt
    })
  }
  await transactionComplete(transaction)
  return annotation
}

export async function deleteLocalAnnotation(libraryItemId, fileId, annotation, ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId) throw new Error('No offline profile is available')
  const database = await openDatabase()
  const transaction = database.transaction([BOOKS_STORE, OPERATIONS_STORE], 'readwrite')
  const books = transaction.objectStore(BOOKS_STORE)
  const record = await requestResult(books.get(makeBookKey(resolvedOwnerId, libraryItemId, fileId)))
  if (!record) throw new Error('This book is not available offline')
  record.annotations = (record.annotations || []).filter((item) => item.id !== annotation.id)
  record.updatedAt = Date.now()
  books.put(record)

  const operations = transaction.objectStore(OPERATIONS_STORE)
  if (annotation._operationId) {
    operations.delete(annotation._operationId)
  } else {
    operations.delete(`annotation-update:${annotation.id}`)
    operations.put({
      id: `annotation-delete:${annotation.id}`,
      ownerId: resolvedOwnerId,
      bookKey: record.key,
      libraryItemId,
      fileId: normalizeFileId(fileId),
      type: 'annotation-delete',
      annotationId: annotation.id,
      createdAt: Date.now()
    })
  }
  await transactionComplete(transaction)
}

async function removeOperation(operationId) {
  const database = await openDatabase()
  const transaction = database.transaction(OPERATIONS_STORE, 'readwrite')
  transaction.objectStore(OPERATIONS_STORE).delete(operationId)
  await transactionComplete(transaction)
}

async function reconcileCreatedAnnotation(operation, serverAnnotation) {
  const database = await openDatabase()
  const transaction = database.transaction([BOOKS_STORE, OPERATIONS_STORE], 'readwrite')
  const books = transaction.objectStore(BOOKS_STORE)
  const record = await requestResult(books.get(operation.bookKey))
  if (record) {
    const index = (record.annotations || []).findIndex((annotation) => annotation.id === operation.localAnnotationId)
    if (index >= 0) record.annotations.splice(index, 1, serializable(serverAnnotation))
    record.updatedAt = Date.now()
    books.put(record)
  }
  transaction.objectStore(OPERATIONS_STORE).delete(operation.id)
  await transactionComplete(transaction)
}

async function keepNewerServerProgress(operation, axios) {
  let serverProgress = null
  try {
    serverProgress = await axios.$get(`/api/me/progress/${operation.libraryItemId}`)
  } catch (error) {
    if (error?.response?.status !== 404) throw error
  }
  if (!serverProgress?.lastUpdate || serverProgress.lastUpdate <= (operation.payload.lastUpdate || operation.createdAt)) return false

  await updateBookRecord(operation.libraryItemId, operation.fileId, operation.ownerId, (book) => {
    book.progress = serializable(serverProgress)
  })
  await removeOperation(operation.id)
  return true
}

function shouldDiscardOperation(operation, error) {
  const status = error?.response?.status
  if (operation.type === 'annotation-create') return false
  return status === 400 || status === 404
}

export async function syncPendingOperations(axios, ownerId = null) {
  const resolvedOwnerId = resolveOwnerId(ownerId)
  if (!resolvedOwnerId || !axios || !navigator.onLine) return { synced: 0, pending: 0 }

  const database = await openDatabase()
  const readTransaction = database.transaction(OPERATIONS_STORE, 'readonly')
  const operations = await requestResult(readTransaction.objectStore(OPERATIONS_STORE).index('ownerId').getAll(resolvedOwnerId))
  operations.sort((a, b) => a.createdAt - b.createdAt)
  let synced = 0
  let completed = 0

  for (const operation of operations) {
    try {
      if (operation.type === 'progress') {
        const keptServerProgress = await keepNewerServerProgress(operation, axios)
        if (!keptServerProgress) {
          await axios.$patch(`/api/me/progress/${operation.libraryItemId}`, operation.payload, { progress: false })
          await removeOperation(operation.id)
        }
      } else if (operation.type === 'annotation-create') {
        const annotation = await axios.$post(`/api/me/ebook-annotations/${operation.libraryItemId}`, {
          ...operation.payload,
          fileId: operation.fileId || null
        })
        await reconcileCreatedAnnotation(operation, annotation)
      } else if (operation.type === 'annotation-update') {
        await axios.$patch(`/api/me/ebook-annotations/${operation.libraryItemId}/${operation.annotationId}`, operation.payload)
        await removeOperation(operation.id)
      } else if (operation.type === 'annotation-delete') {
        await axios.$delete(`/api/me/ebook-annotations/${operation.libraryItemId}/${operation.annotationId}`)
        await removeOperation(operation.id)
      }
      synced++
      completed++
    } catch (error) {
      if (shouldDiscardOperation(operation, error)) {
        await removeOperation(operation.id)
        completed++
        continue
      }
      console.error('Offline ebook sync paused', operation.type, error)
      break
    }
  }

  return { synced, pending: Math.max(0, operations.length - completed) }
}
