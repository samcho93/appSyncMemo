// 메모 한 줄에 적은 날짜를 일정으로 읽는다. (데스크탑 main/schedule.js와 같은 규칙)

const MAX_TITLE_LENGTH = 80;
const DEFAULT_TITLE = '일정';

const FORMATS = [
  { re: /(?<!\d)(\d{4}|\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/, year: 1, month: 2, day: 3 },
  { re: /(?<![\d.])(\d{4})\s*([-./])\s*(\d{1,2})\s*\2\s*(\d{1,2})(?!\d)\.?/, year: 1, month: 3, day: 4 },
  { re: /(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/, month: 1, day: 2 },
  { re: /^(\s*(?:[-*•·▶□☐■]\s*)?)(\d{1,2})[-./](\d{1,2})일?\.?(?=[\s,:(]|$)/, prefix: 1, month: 2, day: 3 },
];

const SEPARATOR_RE = /^\s*---/;
const LEADING_BULLET_RE = /^[\s\-*•·▶□☐■,:;~–]+/;
const TRAILING_PUNCT_RE = /[\s,:;~–-]+$/;
const WEEKDAY_RE = /^\s*(?:\([월화수목금토일](?:요일)?\)|[월화수목금토일]요일)/;

export function toDateKey(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function localDateKey(now = new Date()) {
  return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function cleanTitle(before, after) {
  const rest = after.replace(WEEKDAY_RE, '');
  const title = `${before} ${rest}`
    .replace(LEADING_BULLET_RE, '')
    .replace(TRAILING_PUNCT_RE, '')
    .replace(/\s+/g, ' ');
  return (title || DEFAULT_TITLE).slice(0, MAX_TITLE_LENGTH);
}

export function parseLine(line, currentYear) {
  if (SEPARATOR_RE.test(line)) return null;
  for (const format of FORMATS) {
    const match = format.re.exec(line);
    if (!match) continue;
    let year = format.year ? Number(match[format.year]) : currentYear;
    if (format.year && match[format.year].length === 2) year += 2000;
    const date = toDateKey(year, Number(match[format.month]), Number(match[format.day]));
    if (!date) return null;
    const before = line.slice(0, match.index);
    const after = line.slice(match.index + match[0].length);
    return { date, title: cleanTitle(before, after) };
  }
  return null;
}

export function parseSchedules(text, currentYear) {
  return text.split(/\r?\n/).map((line) => parseLine(line, currentYear)).filter(Boolean);
}

export function collectEvents(notes, currentYear) {
  const sorted = [...notes].sort((a, b) => a.createdAt - b.createdAt);
  return sorted.flatMap((note) => parseSchedules(note.content, currentYear).map((schedule) => ({
    ...schedule,
    noteId: note.id,
    color: note.color,
  })));
}
