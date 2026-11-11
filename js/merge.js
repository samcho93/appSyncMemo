import { serializeRecord } from './record.js';

// last-write-wins. 시각이 같으면 deviceId, 그래도 같으면 직렬화 결과로 정해
// 모든 기기가 같은 승자를 고르게 한다. (데스크탑 main/sync/merge.js와 동일)
export function pickWinner(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? a : b;
  return serializeRecord(a) >= serializeRecord(b) ? a : b;
}
