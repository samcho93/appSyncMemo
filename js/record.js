// memoSync 데스크탑(main/sync/record.js)과 같은 규칙으로 메모 레코드를 검증·직렬화한다.
// 직렬화 결과가 바이트 단위로 같아야 두 앱이 서로의 파일을 다시 쓰지 않는다.

export const COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'gray'];
export const DEFAULT_COLOR = 'yellow';
export const DEFAULT_OPACITY = 0.85;
export const MIN_OPACITY = 0.15;
export const MAX_CONTENT_LENGTH = 1_000_000;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 40;
const FONT_RE = /^[^"'\\<>;{}()\r\n]{1,100}$/;

export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');
export const MAIN_FILE_RE = new RegExp(`^(${UUID_PATTERN})\\.json$`, 'i');

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export function clampOpacity(value) {
  if (!isFiniteNumber(value)) return DEFAULT_OPACITY;
  return Math.min(1, Math.max(MIN_OPACITY, value));
}

function cleanFont(value) {
  return typeof value === 'string' && FONT_RE.test(value) ? value : undefined;
}

function cleanFontSize(value) {
  if (!isFiniteNumber(value)) return undefined;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}

// 복구할 수 없을 만큼 깨진 입력이면 null
export function normalizeRecord(raw, expectedId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) return null;
  if (expectedId && raw.id.toLowerCase() !== expectedId.toLowerCase()) return null;
  if (!isFiniteNumber(raw.updatedAt)) return null;

  const record = {
    id: raw.id.toLowerCase(),
    content: typeof raw.content === 'string' ? raw.content.slice(0, MAX_CONTENT_LENGTH) : '',
    color: COLORS.includes(raw.color) ? raw.color : DEFAULT_COLOR,
    opacity: clampOpacity(raw.opacity),
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : raw.updatedAt,
    updatedAt: raw.updatedAt,
    deleted: raw.deleted === true,
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
  };
  const font = cleanFont(raw.font);
  const fontSize = cleanFontSize(raw.fontSize);
  if (font) record.font = font;
  if (fontSize) record.fontSize = fontSize;
  if (typeof raw.alwaysOnTop === 'boolean') record.alwaysOnTop = raw.alwaysOnTop;
  for (const key of ['x', 'y', 'w', 'h']) {
    if (isFiniteNumber(raw[key])) record[key] = Math.round(raw[key]);
  }
  return record;
}

export function serializeRecord(record) {
  const ordered = {};
  for (const key of ['id', 'content', 'color', 'opacity', 'font', 'fontSize', 'alwaysOnTop', 'x', 'y', 'w', 'h',
    'createdAt', 'updatedAt', 'deleted', 'deviceId']) {
    if (record[key] !== undefined) ordered[key] = record[key];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function sameRecord(a, b) {
  return serializeRecord(a) === serializeRecord(b);
}

export function parseRecord(text, expectedId) {
  try {
    return normalizeRecord(JSON.parse(text), expectedId);
  } catch {
    return null;
  }
}

export function newId() {
  return globalThis.crypto.randomUUID();
}
