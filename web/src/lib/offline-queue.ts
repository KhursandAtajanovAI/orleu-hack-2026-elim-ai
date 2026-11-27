'use client';
/**
 * Офлайн-очередь (ТЗ 1, P1): фото и жалобы сохраняются локально (IndexedDB) и
 * отправляются при появлении сети. Каждой записи — client_id, поэтому повторная
 * отправка не создаёт дубль (идемпотентность на стороне БД). Используют потоки C и F.
 */
type Job = { id: string; kind: string; payload: Record<string, unknown>; blob?: Blob; createdAt: number };
const DB = 'kaida-offline';
const STORE = 'jobs';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function enqueue(kind: string, payload: Record<string, unknown>, blob?: Blob): Promise<string> {
  const id = crypto.randomUUID();
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, kind, payload: { ...payload, client_id: id }, blob, createdAt: Date.now() } satisfies Job);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  return id;
}

export async function pending(): Promise<Job[]> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result as Job[]);
    r.onerror = () => rej(r.error);
  });
}

async function remove(id: string) {
  const db = await open();
  db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
}

/** Отправить всё накопленное. sender возвращает true, если запись принята сервером. */
export async function flush(sender: (job: Job) => Promise<boolean>): Promise<number> {
  let sent = 0;
  for (const job of await pending()) {
    try {
      if (await sender(job)) { await remove(job.id); sent++; }
    } catch { break; /* сеть снова пропала — попробуем позже */ }
  }
  return sent;
}

export function autoFlush(sender: (job: Job) => Promise<boolean>) {
  const run = () => navigator.onLine && flush(sender);
  window.addEventListener('online', run);
  run();
  return () => window.removeEventListener('online', run);
}
