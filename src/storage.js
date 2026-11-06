// 最後に開いた曲を、端末の中（IndexedDB）に1曲だけ保存する。
// 保存できない環境（プライベートブラウズなど）では、何もせずに続ける。
const DB_NAME = 'piano-practice-player';
const STORE = 'kv';
const KEY = 'lastSong';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tr = db.transaction(STORE, mode);
        const req = fn(tr.objectStore(STORE));
        tr.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tr.onerror = () => {
          db.close();
          reject(tr.error);
        };
      }),
  );
}

/**
 * @param {{fileName:string, text:string}} rec
 */
export async function saveLastSong(rec) {
  try {
    await run('readwrite', (s) => s.put({ ...rec, savedAt: Date.now() }, KEY));
    // 端末の空きが少ないときに消されにくくする（対応している端末だけ）
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {
    /* 保存できなくても使える */
  }
}

/** @returns {Promise<{fileName:string, text:string, savedAt:number}|null>} */
export async function loadLastSong() {
  try {
    return (await run('readonly', (s) => s.get(KEY))) || null;
  } catch {
    return null;
  }
}
