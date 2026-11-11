import {
  COLORS, DEFAULT_COLOR, DEFAULT_OPACITY, MAX_CONTENT_LENGTH, MAIN_FILE_RE,
  parseRecord, serializeRecord, sameRecord, newId,
} from './record.js';
import { pickWinner } from './merge.js';

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 동기화 폴더의 {uuid}.json을 로컬 캐시와 맞춘다. 저장소(Drive)는 drive 어댑터가 맡는다.
//   drive: { list() → [{id,name,modifiedTime,md5Checksum}], read(id) → text,
//            create(name,text) → meta, update(id,text) → meta }
//   store: { loadAll() → entries, save(entry), remove(id) }
// entry = { record, fileId, sig, dirty }  (sig: 마지막으로 본 원격 파일의 md5/수정시각)
export class SyncEngine {
  constructor({ drive, store, deviceId, now = () => Date.now() }) {
    this.drive = drive;
    this.store = store;
    this.deviceId = deviceId;
    this.now = now;
    this.entries = new Map();
    this.listeners = new Set();
    this.running = null;
  }

  async load() {
    for (const entry of await this.store.loadAll()) this.entries.set(entry.record.id, entry);
    for (const [id, entry] of [...this.entries]) {
      // 지워진 지 30일이 지났고 올릴 것도 없으면 캐시에서 정리한다. (원격 파일은 데스크탑이 정리)
      if (entry.record.deleted && !entry.dirty && this.now() - entry.record.updatedAt > TOMBSTONE_TTL_MS) {
        this.entries.delete(id);
        await this.store.remove(id);
      }
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn();
  }

  notes() {
    return [...this.entries.values()].map((e) => e.record).filter((r) => !r.deleted);
  }

  get(id) {
    return this.entries.get(id)?.record ?? null;
  }

  get pendingCount() {
    return [...this.entries.values()].filter((e) => e.dirty).length;
  }

  async create({ color = DEFAULT_COLOR, content = '' } = {}) {
    const now = this.now();
    const record = {
      id: newId(),
      content,
      color: COLORS.includes(color) ? color : DEFAULT_COLOR,
      opacity: DEFAULT_OPACITY,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      deviceId: this.deviceId,
    };
    const entry = { record, fileId: null, sig: null, dirty: true };
    this.entries.set(record.id, entry);
    await this.store.save(entry);
    this._emit();
    return record;
  }

  // 내용·색상만 고친다. 글꼴, 위치 등 데스크탑 전용 필드는 그대로 둬서 되돌려 쓸 때 잃지 않는다.
  async edit(id, patch) {
    const entry = this.entries.get(id);
    if (!entry || entry.record.deleted) return null;
    const next = { ...entry.record };
    if (typeof patch.content === 'string') next.content = patch.content.slice(0, MAX_CONTENT_LENGTH);
    if (COLORS.includes(patch.color)) next.color = patch.color;
    if (sameRecord(next, entry.record)) return entry.record;
    next.updatedAt = Math.max(this.now(), entry.record.updatedAt + 1);
    next.deviceId = this.deviceId;
    entry.record = next;
    entry.dirty = true;
    await this.store.save(entry);
    this._emit();
    return next;
  }

  // 새로 만들고 아무것도 쓰지 않은 메모는 올린 적이 없으면 흔적 없이 버린다.
  async discardIfBlank(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.fileId || entry.record.content.trim()) return false;
    this.entries.delete(id);
    await this.store.remove(id);
    this._emit();
    return true;
  }

  // 파일을 지우지 않고 deleted 표시만 한다. 30일 뒤 데스크탑이 파일을 정리한다.
  async remove(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.record.deleted) return;
    entry.record = {
      ...entry.record,
      deleted: true,
      updatedAt: Math.max(this.now(), entry.record.updatedAt + 1),
      deviceId: this.deviceId,
    };
    entry.dirty = true;
    await this.store.save(entry);
    this._emit();
  }

  sync() {
    if (!this.running) {
      this.running = this._sync().finally(() => { this.running = null; });
    }
    return this.running;
  }

  async _upload(entry) {
    const uploaded = entry.record;
    const text = serializeRecord(uploaded);
    const meta = entry.fileId
      ? await this.drive.update(entry.fileId, text)
      : await this.drive.create(`${uploaded.id}.json`, text);
    entry.fileId = meta.id;
    entry.sig = meta.md5Checksum || meta.modifiedTime;
    // 올리는 사이 또 고쳤다면 dirty를 유지해 다음 동기화에 다시 올린다.
    if (entry.record === uploaded) entry.dirty = false;
    await this.store.save(entry);
  }

  async _sync() {
    const stats = { uploaded: 0, downloaded: 0 };
    const files = await this.drive.list();

    const remote = new Map();
    for (const file of files) {
      const match = MAIN_FILE_RE.exec(file.name);
      if (!match) continue; // 충돌 사본 등은 데스크탑이 병합한다.
      const id = match[1].toLowerCase();
      const prev = remote.get(id);
      if (!prev || file.modifiedTime > prev.modifiedTime) remote.set(id, file);
    }

    let changed = false;
    for (const [id, file] of remote) {
      const entry = this.entries.get(id);
      const sig = file.md5Checksum || file.modifiedTime;
      if (entry && entry.fileId === file.id && entry.sig === sig) {
        if (entry.dirty) { await this._upload(entry); stats.uploaded += 1; }
        continue;
      }
      const incoming = parseRecord(await this.drive.read(file.id), id);
      if (!incoming) continue; // 깨진 파일은 건드리지 않는다.
      stats.downloaded += 1;

      if (!entry) {
        this.entries.set(id, { record: incoming, fileId: file.id, sig, dirty: false });
        await this.store.save(this.entries.get(id));
        changed = true;
        continue;
      }
      entry.fileId = file.id;
      entry.sig = sig;
      if (sameRecord(entry.record, incoming)) {
        entry.dirty = false;
        await this.store.save(entry);
      } else if (pickWinner(entry.record, incoming) === incoming) {
        entry.record = incoming;
        entry.dirty = false;
        await this.store.save(entry);
        changed = true;
      } else {
        await this._upload(entry);
        stats.uploaded += 1;
      }
    }

    // 원격에 없는 메모. 폴더가 통째로 비었다면 클라우드 사고일 수 있어 삭제로 보지 않고 다시 올린다.
    const folderHasNotes = remote.size > 0;
    for (const [id, entry] of [...this.entries]) {
      if (remote.has(id)) continue;
      if (entry.fileId && !entry.dirty && folderHasNotes) {
        this.entries.delete(id);
        await this.store.remove(id);
        changed = true;
      } else {
        entry.fileId = null;
        entry.sig = null;
        await this._upload(entry);
        stats.uploaded += 1;
      }
    }

    if (changed || stats.downloaded || stats.uploaded) this._emit();
    return stats;
  }
}
