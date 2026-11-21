const DB = "dai-asha-outbox";
const encoder = new TextEncoder();

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("queues");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store<T>(action: (storage: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode) {
  const db = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("queues", mode);
      const request = action(tx.objectStore("queues"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || request.error);
    });
  } finally {
    db.close();
  }
}

type Stored = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };

export async function saveOutbox<T>(id: string, items: T[]) {
  if (!items.length) {
    await store(storage => storage.delete(id), "readwrite");
    return;
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(id) },
    key, encoder.encode(JSON.stringify(items)));
  await store(storage => storage.put({ key, iv, ciphertext } satisfies Stored, id), "readwrite");
}

export async function loadOutbox<T>(id: string, legacyId: string): Promise<T[]> {
  const saved = await store<Stored | undefined>(storage => storage.get(id), "readonly");
  if (saved) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: saved.iv, additionalData: encoder.encode(id) },
      saved.key, saved.ciphertext);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const legacyKey = "dai-asha-outbox:" + legacyId;
  const previous = localStorage.getItem(legacyKey);
  if (!previous) return [];
  const items = JSON.parse(previous);
  if (!Array.isArray(items)) throw new Error("Invalid saved outbox");
  await saveOutbox(id, items);
  localStorage.removeItem(legacyKey);
  return items;
}
