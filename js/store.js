// 오프라인용 로컬 캐시. 브라우저에서는 IndexedDB, 테스트에서는 메모리를 쓴다.

export class MemoryStore {
  constructor() {
    this.map = new Map();
  }

  async loadAll() {
    return [...this.map.values()].map((e) => structuredClone(e));
  }

  async save(entry) {
    this.map.set(entry.record.id, structuredClone(entry));
  }

  async remove(id) {
    this.map.delete(id);
  }
}

export class IdbStore {
  constructor(name = 'appsyncmemo') {
    this.name = name;
    this.dbPromise = null;
  }

  _db() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(this.name, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('entries', { keyPath: 'record.id' });
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.dbPromise;
  }

  async _run(mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', mode);
      const request = fn(tx.objectStore('entries'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  loadAll() {
    return this._run('readonly', (s) => s.getAll());
  }

  save(entry) {
    return this._run('readwrite', (s) => s.put(entry));
  }

  remove(id) {
    return this._run('readwrite', (s) => s.delete(id));
  }
}
