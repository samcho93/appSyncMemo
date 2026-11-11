import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../js/sync.js';
import { MemoryStore } from '../js/store.js';
import { serializeRecord, parseRecord } from '../js/record.js';

// 폴더 하나를 흉내 내는 가짜 Drive. 같은 이름의 파일이 둘 있을 수도 있다.
class FakeDrive {
  constructor() {
    this.files = new Map();
    this.seq = 0;
    this.clock = 1_000;
  }

  _put(id, name, text) {
    this.seq += 1;
    this.clock += 1;
    const file = { id, name, text, modifiedTime: new Date(this.clock * 1000).toISOString(), md5Checksum: `md5-${this.seq}` };
    this.files.set(id, file);
    return { id, modifiedTime: file.modifiedTime, md5Checksum: file.md5Checksum };
  }

  async list() { return [...this.files.values()].map(({ text, ...meta }) => meta); }
  async read(id) { return this.files.get(id).text; }
  async create(name, text) { return this._put(`f${this.seq + 1}`, name, text); }
  async update(id, text) { return this._put(id, this.files.get(id).name, text); }

  // 데스크탑이 파일을 쓴 것처럼 흉내 낸다.
  desktopWrite(record) {
    const existing = [...this.files.values()].find((f) => f.name === `${record.id}.json`);
    return this._put(existing?.id ?? `d${this.seq + 1}`, `${record.id}.json`, serializeRecord(record));
  }
}

function makeDevice(drive, deviceId, now) {
  return new SyncEngine({ drive, store: new MemoryStore(), deviceId, now });
}

test('새 메모는 {uuid}.json으로 올라가고 데스크탑 형식과 같다', async () => {
  const drive = new FakeDrive();
  const engine = makeDevice(drive, 'phone', () => 5000);
  const note = await engine.create({ color: 'pink', content: '안녕' });
  await engine.sync();

  const [file] = [...drive.files.values()];
  assert.equal(file.name, `${note.id}.json`);
  const parsed = parseRecord(file.text, note.id);
  assert.equal(parsed.content, '안녕');
  assert.equal(parsed.color, 'pink');
  assert.equal(parsed.deviceId, 'phone');
  assert.equal(file.text, serializeRecord(parsed)); // 다시 직렬화해도 바이트가 같다
  assert.equal(engine.pendingCount, 0);
});

test('데스크탑에서 만든 메모를 받아 온다', async () => {
  const drive = new FakeDrive();
  drive.desktopWrite({
    id: '11111111-1111-4111-8111-111111111111', content: '데스크탑 메모', color: 'blue', opacity: 0.6,
    createdAt: 1, updatedAt: 2, deleted: false, deviceId: 'pc',
  });
  const engine = makeDevice(drive, 'phone', () => 9000);
  await engine.sync();
  assert.equal(engine.notes().length, 1);
  assert.equal(engine.notes()[0].content, '데스크탑 메모');
});

test('나중에 고친 쪽이 이긴다 (last-write-wins)', async () => {
  const drive = new FakeDrive();
  let t = 1000;
  const engine = makeDevice(drive, 'phone', () => t);
  const note = await engine.create({ content: 'v1' });
  await engine.sync();

  t = 2000;
  await engine.edit(note.id, { content: 'phone v2' });
  drive.desktopWrite({ ...engine.get(note.id), content: 'pc v3', updatedAt: 3000, deviceId: 'pc' });
  await engine.sync();
  assert.equal(engine.get(note.id).content, 'pc v3');

  t = 4000;
  await engine.edit(note.id, { content: 'phone v4' });
  drive.desktopWrite({ ...engine.get(note.id), content: 'pc old', updatedAt: 3500, deviceId: 'pc' });
  await engine.sync();
  assert.equal(engine.get(note.id).content, 'phone v4');
  assert.equal(parseRecord(await drive.read([...drive.files.keys()][0])).content, 'phone v4');
});

test('모바일에서 고쳐도 데스크탑 전용 필드(글꼴·위치·투명도)를 유지한다', async () => {
  const drive = new FakeDrive();
  const id = '22222222-2222-4222-8222-222222222222';
  drive.desktopWrite({
    id, content: 'a', color: 'green', opacity: 0.4, font: 'Malgun Gothic', fontSize: 18,
    alwaysOnTop: true, x: 10, y: 20, w: 300, h: 200, createdAt: 1, updatedAt: 2, deleted: false, deviceId: 'pc',
  });
  const engine = makeDevice(drive, 'phone', () => 5000);
  await engine.sync();
  await engine.edit(id, { content: 'b' });
  await engine.sync();
  const saved = parseRecord([...drive.files.values()][0].text);
  assert.equal(saved.content, 'b');
  assert.deepEqual(
    [saved.opacity, saved.font, saved.fontSize, saved.alwaysOnTop, saved.x, saved.y, saved.w, saved.h],
    [0.4, 'Malgun Gothic', 18, true, 10, 20, 300, 200],
  );
});

test('삭제는 deleted 표시로 올라가고 파일은 남는다', async () => {
  const drive = new FakeDrive();
  const engine = makeDevice(drive, 'phone', () => 5000);
  const note = await engine.create({ content: 'x' });
  await engine.sync();
  await engine.remove(note.id);
  await engine.sync();
  assert.equal(drive.files.size, 1);
  assert.equal(parseRecord([...drive.files.values()][0].text).deleted, true);
  assert.equal(engine.notes().length, 0);
});

test('데스크탑이 삭제 표시한 메모는 목록에서 사라진다', async () => {
  const drive = new FakeDrive();
  const engine = makeDevice(drive, 'phone', () => 5000);
  const note = await engine.create({ content: 'x' });
  await engine.sync();
  drive.desktopWrite({ ...engine.get(note.id), deleted: true, updatedAt: 9000, deviceId: 'pc' });
  await engine.sync();
  assert.equal(engine.notes().length, 0);
});

test('원격에서 파일이 지워졌고 올릴 것이 없으면 로컬에서도 지운다', async () => {
  const drive = new FakeDrive();
  const engine = makeDevice(drive, 'phone', () => 5000);
  const a = await engine.create({ content: 'a' });
  const b = await engine.create({ content: 'b' });
  await engine.sync();
  const fileOfA = [...drive.files.values()].find((f) => f.name === `${a.id}.json`);
  drive.files.delete(fileOfA.id);
  await engine.sync();
  assert.deepEqual(engine.notes().map((n) => n.id), [b.id]);
});

test('폴더가 통째로 비면 삭제로 보지 않고 다시 올린다', async () => {
  const drive = new FakeDrive();
  const engine = makeDevice(drive, 'phone', () => 5000);
  await engine.create({ content: 'a' });
  await engine.create({ content: 'b' });
  await engine.sync();
  drive.files.clear();
  await engine.sync();
  assert.equal(engine.notes().length, 2);
  assert.equal(drive.files.size, 2);
});

test('올리지 못한 편집은 원격 파일이 사라져도 되살려 올린다', async () => {
  const drive = new FakeDrive();
  const engine = makeDevice(drive, 'phone', () => 5000);
  const a = await engine.create({ content: 'a' });
  const b = await engine.create({ content: 'b' });
  await engine.sync();
  const fileOfA = [...drive.files.values()].find((f) => f.name === `${a.id}.json`);
  drive.files.delete(fileOfA.id);
  await engine.edit(a.id, { content: 'a edited' });
  await engine.sync();
  assert.equal(engine.get(a.id).content, 'a edited');
  assert.ok([...drive.files.values()].some((f) => f.name === `${a.id}.json`));
  assert.ok(engine.get(b.id));
});

test('충돌 사본·깨진 파일은 건드리지 않는다', async () => {
  const drive = new FakeDrive();
  const id = '33333333-3333-4333-8333-333333333333';
  drive._put('x1', `${id} (충돌 사본).json`, '{}');
  drive._put('x2', `${id}.json`, '{ 깨짐');
  drive._put('x3', 'notes.txt', 'hello');
  const engine = makeDevice(drive, 'phone', () => 5000);
  await engine.sync();
  assert.equal(engine.notes().length, 0);
  assert.equal(drive.files.size, 3);
});

test('로컬 캐시에서 다시 불러와도 상태가 유지된다', async () => {
  const drive = new FakeDrive();
  const store = new MemoryStore();
  const first = new SyncEngine({ drive, store, deviceId: 'phone', now: () => 5000 });
  const note = await first.create({ content: '오프라인 작성' }); // 아직 sync 안 함
  const second = new SyncEngine({ drive, store, deviceId: 'phone', now: () => 6000 });
  await second.load();
  assert.equal(second.get(note.id).content, '오프라인 작성');
  assert.equal(second.pendingCount, 1);
  await second.sync();
  assert.equal(second.pendingCount, 0);
  assert.equal(drive.files.size, 1);
});

test('동기화 중에 또 고치면 다음 동기화에 다시 올린다', async () => {
  const drive = new FakeDrive();
  let t = 1000;
  const engine = makeDevice(drive, 'phone', () => t);
  const note = await engine.create({ content: 'v1' });
  const realCreate = drive.create.bind(drive);
  drive.create = async (name, text) => {
    t = 2000;
    await engine.edit(note.id, { content: 'v2' }); // 업로드 도중 편집
    return realCreate(name, text);
  };
  await engine.sync();
  assert.equal(engine.pendingCount, 1);
  drive.create = realCreate;
  await engine.sync();
  assert.equal(engine.pendingCount, 0);
  assert.equal(parseRecord([...drive.files.values()][0].text).content, 'v2');
});
