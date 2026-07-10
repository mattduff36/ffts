export interface WorkshopDraftRecord<T> {
  id: string;
  ownerId: string | null;
  route: string;
  kind: string;
  payload: T;
  updatedAt: number;
  expiresAt: number;
}

interface StoredWorkshopDraftRecord {
  id: string;
  ownerId: string | null;
  route: string;
  kind: string;
  payload: string;
  encrypted: boolean;
  iv: string | null;
  updatedAt: number;
  expiresAt: number;
}

interface SaveWorkshopDraftInput<T> {
  id: string;
  ownerId?: string | null;
  route?: string;
  kind: string;
  payload: T;
  ttlMs?: number;
}

const DB_NAME = 'avs_workshop_task_drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const LOCAL_STORAGE_PREFIX = 'avs_workshop_task_draft:';
const DEFAULT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getBrowserRoute(): string {
  if (typeof window === 'undefined') return '/workshop-tasks';
  return `${window.location.pathname}${window.location.search}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function getIndexedDb(): IDBFactory | null {
  if (typeof window === 'undefined') return null;
  return window.indexedDB || null;
}

function getCrypto(): Crypto | null {
  if (typeof window === 'undefined') return null;
  return window.crypto || null;
}

function openDraftDb(): Promise<IDBDatabase | null> {
  const indexedDb = getIndexedDb();
  if (!indexedDb) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runStoreOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  return openDraftDb().then((db) => {
    if (!db) return undefined;

    return new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = operation(store);

      transaction.oncomplete = () => {
        db.close();
        resolve(request ? request.result : undefined);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  });
}

async function getEncryptionKey(ownerId: string | null): Promise<CryptoKey | null> {
  const crypto = getCrypto();
  if (!crypto?.subtle) return null;

  const material = [
    'avs-workshop-draft-v1',
    ownerId || 'anonymous',
    typeof navigator === 'undefined' ? 'server' : navigator.userAgent,
  ].join(':');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encodePayload(payload: unknown, ownerId: string | null) {
  const serialized = JSON.stringify(payload);
  const crypto = getCrypto();
  const key = await getEncryptionKey(ownerId);

  if (!crypto || !key) {
    return { payload: serialized, encrypted: false, iv: null };
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(serialized)
  );

  return {
    payload: toBase64(new Uint8Array(encrypted)),
    encrypted: true,
    iv: toBase64(iv),
  };
}

async function decodePayload<T>(record: StoredWorkshopDraftRecord): Promise<T | null> {
  if (!record.encrypted) {
    return JSON.parse(record.payload) as T;
  }

  const key = await getEncryptionKey(record.ownerId);
  if (!key || !record.iv) return null;

  const decrypted = await getCrypto()?.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(record.iv)) },
    key,
    toArrayBuffer(fromBase64(record.payload))
  );
  if (!decrypted) return null;

  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

function saveToLocalStorage(record: StoredWorkshopDraftRecord) {
  localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${record.id}`, JSON.stringify(record));
}

function getFromLocalStorage(id: string): StoredWorkshopDraftRecord | null {
  const value = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${id}`);
  if (!value) return null;
  return JSON.parse(value) as StoredWorkshopDraftRecord;
}

export async function saveWorkshopDraft<T>(input: SaveWorkshopDraftInput<T>): Promise<void> {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  const encoded = await encodePayload(input.payload, input.ownerId || null);
  const record: StoredWorkshopDraftRecord = {
    id: input.id,
    ownerId: input.ownerId || null,
    route: input.route || getBrowserRoute(),
    kind: input.kind,
    payload: encoded.payload,
    encrypted: encoded.encrypted,
    iv: encoded.iv,
    updatedAt: now,
    expiresAt: now + (input.ttlMs || DEFAULT_DRAFT_TTL_MS),
  };

  if (!getIndexedDb()) {
    saveToLocalStorage(record);
    return;
  }

  try {
    await runStoreOperation('readwrite', (store) => store.put(record));
  } catch {
    saveToLocalStorage(record);
  }
}

export async function getWorkshopDraft<T>(id: string): Promise<WorkshopDraftRecord<T> | null> {
  if (typeof window === 'undefined') return null;

  let storedRecord: StoredWorkshopDraftRecord | null = null;
  if (!getIndexedDb()) {
    storedRecord = getFromLocalStorage(id);
  } else {
    try {
      storedRecord = (await runStoreOperation<StoredWorkshopDraftRecord>('readonly', (store) => store.get(id))) || null;
    } catch {
      storedRecord = getFromLocalStorage(id);
    }
  }

  if (!storedRecord) return null;
  if (storedRecord.expiresAt <= Date.now()) {
    await deleteWorkshopDraft(id);
    return null;
  }

  const payload = await decodePayload<T>(storedRecord);
  if (!payload) return null;

  return {
    id: storedRecord.id,
    ownerId: storedRecord.ownerId,
    route: storedRecord.route,
    kind: storedRecord.kind,
    payload,
    updatedAt: storedRecord.updatedAt,
    expiresAt: storedRecord.expiresAt,
  };
}

export async function deleteWorkshopDraft(id: string): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    await runStoreOperation('readwrite', (store) => store.delete(id));
  } catch {
    // IndexedDB can be unavailable in private modes; localStorage remains the fallback.
  }
  localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${id}`);
}
