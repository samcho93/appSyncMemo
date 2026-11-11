import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseSchedules, collectEvents } from '../js/schedule.js';
import { normalizeRecord, serializeRecord } from '../js/record.js';

test('여러 날짜 형식을 읽는다', () => {
  assert.deepEqual(parseLine('2027년 3월 5일 치과', 2026), { date: '2027-03-05', title: '치과' });
  assert.deepEqual(parseLine('27년 3월 5일 치과', 2026), { date: '2027-03-05', title: '치과' });
  assert.deepEqual(parseLine('2027-03-05 치과', 2026), { date: '2027-03-05', title: '치과' });
  assert.deepEqual(parseLine('2027.3.5 치과', 2026), { date: '2027-03-05', title: '치과' });
  assert.deepEqual(parseLine('3월 5일 치과', 2026), { date: '2026-03-05', title: '치과' });
  assert.deepEqual(parseLine('3/5 치과', 2026), { date: '2026-03-05', title: '치과' });
});

test('월일 숫자 형식은 줄 맨 앞에서만, 없는 날짜와 구분선은 무시한다', () => {
  assert.equal(parseLine('버전 1.5 배포', 2026), null);
  assert.equal(parseLine('2월 30일 점검', 2026), null);
  assert.equal(parseLine('2025년 2월 29일 점검', 2026), null);
  assert.equal(parseLine('--- 충돌 사본에서 병합됨 (2026-11-05 10:00 UTC) ---', 2026), null);
});

test('요일 표기와 글머리표를 제목에서 걷어 낸다', () => {
  assert.equal(parseLine('- 3월 5일(수) 회의', 2026).title, '회의');
  assert.equal(parseLine('3월 5일', 2026).title, '일정');
});

test('메모 색상과 순서를 유지해 일정을 모은다', () => {
  const notes = [
    { id: 'b', createdAt: 2, color: 'blue', content: '3/6 B' },
    { id: 'a', createdAt: 1, color: 'pink', content: '메모\n3/5 A\n3/7 A2' },
  ];
  const events = collectEvents(notes, 2026);
  assert.deepEqual(events.map((e) => [e.noteId, e.date, e.color]), [
    ['a', '2026-03-05', 'pink'], ['a', '2026-03-07', 'pink'], ['b', '2026-03-06', 'blue'],
  ]);
  assert.equal(parseSchedules('', 2026).length, 0);
});

test('레코드 정규화·직렬화가 데스크탑 형식(키 순서, 들여쓰기)과 같다', () => {
  const record = normalizeRecord({
    id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', content: 'hi', color: 'nope', opacity: 5,
    createdAt: 1, updatedAt: 2, deleted: false, deviceId: 'd', extra: 'dropped',
  });
  assert.equal(record.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(record.color, 'yellow');
  assert.equal(record.opacity, 1);
  assert.equal(serializeRecord(record), [
    '{',
    '  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",',
    '  "content": "hi",',
    '  "color": "yellow",',
    '  "opacity": 1,',
    '  "createdAt": 1,',
    '  "updatedAt": 2,',
    '  "deleted": false,',
    '  "deviceId": "d"',
    '}',
    '',
  ].join('\n'));
  assert.equal(normalizeRecord({ id: 'not-a-uuid', updatedAt: 1 }), null);
});
