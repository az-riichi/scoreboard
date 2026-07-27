import { browser } from '$app/environment';
import type { PublicDataSnapshot } from './types';

const DB_NAME = 'azrm-scoreboard-public';
const DB_VERSION = 1;
const META_STORE = 'meta';
const SNAPSHOT_STORE = 'snapshots';
const META_KEY = 'scoreboard';
const CACHE_SCHEMA_VERSION = 1;
const SYNC_LOCK_NAME = 'azrm-scoreboard-public-sync';

type CacheMeta = {
  key: typeof META_KEY;
  schema_version: number;
  revision: string;
  snapshot_key: string;
  last_checked_at: number;
};

type CachedData = {
  meta: CacheMeta;
  snapshot: PublicDataSnapshot;
};

type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

let databasePromise: Promise<IDBDatabase> | null = null;
let memorySnapshot: PublicDataSnapshot | null = null;
let syncPromise: Promise<PublicDataSnapshot> | null = null;
let updatesChannel: BroadcastChannel | null = null;

function isSnapshot(value: unknown): value is PublicDataSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<PublicDataSnapshot>;
  return (
    snapshot.schema_version === CACHE_SCHEMA_VERSION &&
    !!snapshot.revision &&
    /^\d+$/.test(String(snapshot.revision.revision ?? '')) &&
    Array.isArray(snapshot.seasons) &&
    Array.isArray(snapshot.casual_events) &&
    Array.isArray(snapshot.players) &&
    Array.isArray(snapshot.rulesets) &&
    Array.isArray(snapshot.matches) &&
    Array.isArray(snapshot.match_results) &&
    Array.isArray(snapshot.adjustments)
  );
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the public data cache.'));
    request.onblocked = () => reject(new Error('The public data cache upgrade is blocked by another tab.'));
  }).catch((cause) => {
    databasePromise = null;
    throw cause;
  });

  databasePromise = opening;
  return opening;
}

async function readCachedData(): Promise<CachedData | null> {
  if (!browser || typeof indexedDB === 'undefined') return null;

  try {
    const database = await openDatabase();
    const transaction = database.transaction([META_STORE, SNAPSHOT_STORE], 'readonly');
    const meta = (await requestValue(
      transaction.objectStore(META_STORE).get(META_KEY)
    )) as CacheMeta | undefined;

    if (
      !meta ||
      meta.schema_version !== CACHE_SCHEMA_VERSION ||
      !meta.snapshot_key ||
      !/^\d+$/.test(String(meta.revision ?? ''))
    ) {
      return null;
    }

    const snapshot = await requestValue(
      transaction.objectStore(SNAPSHOT_STORE).get(meta.snapshot_key)
    );
    await transactionDone(transaction);

    if (!isSnapshot(snapshot) || String(snapshot.revision.revision) !== String(meta.revision)) {
      return null;
    }

    return { meta, snapshot };
  } catch {
    return null;
  }
}

async function saveSnapshot(snapshot: PublicDataSnapshot, checkedAt: number): Promise<void> {
  if (!browser || typeof indexedDB === 'undefined') return;

  const database = await openDatabase();
  const snapshotKey = `${CACHE_SCHEMA_VERSION}:${snapshot.revision.revision}`;
  const transaction = database.transaction([META_STORE, SNAPSHOT_STORE], 'readwrite');
  const metaStore = transaction.objectStore(META_STORE);
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const previous = (await requestValue(metaStore.get(META_KEY))) as CacheMeta | undefined;

  snapshotStore.put(snapshot, snapshotKey);
  metaStore.put({
    key: META_KEY,
    schema_version: CACHE_SCHEMA_VERSION,
    revision: String(snapshot.revision.revision),
    snapshot_key: snapshotKey,
    last_checked_at: checkedAt
  } satisfies CacheMeta);

  if (previous?.snapshot_key && previous.snapshot_key !== snapshotKey) {
    snapshotStore.delete(previous.snapshot_key);
  }

  await transactionDone(transaction);
}

async function saveCheckedAt(cached: CachedData, checkedAt: number): Promise<void> {
  if (!browser || typeof indexedDB === 'undefined') return;

  try {
    const database = await openDatabase();
    const transaction = database.transaction(META_STORE, 'readwrite');
    transaction.objectStore(META_STORE).put({
      ...cached.meta,
      last_checked_at: checkedAt
    } satisfies CacheMeta);
    await transactionDone(transaction);
  } catch {
    // The snapshot remains usable when private mode or quota policy blocks a
    // metadata-only write.
  }
}

function announceRevision(revision: string) {
  if (!browser || typeof BroadcastChannel === 'undefined') return;
  updatesChannel ??= new BroadcastChannel('azrm-scoreboard-public-data');
  updatesChannel.postMessage({ revision });
}

function listenForOtherTabs() {
  if (!browser || typeof BroadcastChannel === 'undefined' || updatesChannel) return;
  updatesChannel = new BroadcastChannel('azrm-scoreboard-public-data');
  updatesChannel.onmessage = (event) => {
    const announced = String(event.data?.revision ?? '');
    if (memorySnapshot && announced && announced !== String(memorySnapshot.revision.revision)) {
      memorySnapshot = null;
    }
  };
}

async function fetchSnapshot(cached: CachedData | null): Promise<PublicDataSnapshot> {
  const revision = cached?.meta.revision ?? null;
  const endpoint = revision
    ? `/api/public-data?revision=${encodeURIComponent(revision)}`
    : '/api/public-data';
  const headers = new Headers({ accept: 'application/json' });
  if (revision) headers.set('if-none-match', `"scoreboard-${revision}"`);

  const response = await fetch(endpoint, {
    method: 'GET',
    headers,
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const checkedAt = Date.now();

  if (response.status === 304) {
    if (!cached) return fetchSnapshot(null);
    await saveCheckedAt(cached, checkedAt);
    return cached.snapshot;
  }

  if (!response.ok) {
    throw new Error(`Public data refresh failed (${response.status}).`);
  }

  const next: unknown = await response.json();
  if (!isSnapshot(next)) throw new Error('The public data response has an unsupported format.');

  try {
    await saveSnapshot(next, checkedAt);
  } catch {
    // IndexedDB can be unavailable in private browsing. Keep the successfully
    // downloaded snapshot in memory for the rest of this document.
  }
  announceRevision(String(next.revision.revision));
  return next;
}

async function synchronize(startedAt: number): Promise<PublicDataSnapshot> {
  const stored = await readCachedData();
  const cached =
    stored ??
    (memorySnapshot
      ? {
          meta: {
            key: META_KEY,
            schema_version: CACHE_SCHEMA_VERSION,
            revision: String(memorySnapshot.revision.revision),
            snapshot_key: `${CACHE_SCHEMA_VERSION}:${memorySnapshot.revision.revision}`,
            last_checked_at: 0
          },
          snapshot: memorySnapshot
        }
      : null);
  if (cached?.meta.last_checked_at && cached.meta.last_checked_at >= startedAt) {
    return cached.snapshot;
  }

  try {
    return await fetchSnapshot(cached);
  } catch (cause) {
    if (cached) return cached.snapshot;
    throw cause;
  }
}

async function synchronizeWithTabLock(startedAt: number): Promise<PublicDataSnapshot> {
  const lockManager = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  if (!lockManager) return synchronize(startedAt);
  return lockManager.request(SYNC_LOCK_NAME, () => synchronize(startedAt));
}

export async function getPublicSnapshot(options: { check?: boolean } = {}): Promise<PublicDataSnapshot> {
  if (!browser) throw new Error('Public data is only available in the browser.');
  listenForOtherTabs();

  const shouldCheck = options.check !== false;
  if (!shouldCheck) {
    if (memorySnapshot) return memorySnapshot;
    const cached = await readCachedData();
    if (cached) {
      memorySnapshot = cached.snapshot;
      return cached.snapshot;
    }
  }

  if (!syncPromise) {
    const startedAt = Date.now();
    syncPromise = synchronizeWithTabLock(startedAt)
      .then((snapshot) => {
        memorySnapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        syncPromise = null;
      });
  }

  return syncPromise;
}
