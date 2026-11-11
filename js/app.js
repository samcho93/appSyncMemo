import { COLORS } from './record.js';
import { SyncEngine } from './sync.js';
import { IdbStore } from './store.js';
import { GoogleDrive, AuthError } from './drive.js';
import { getAccessToken, clearToken, signOut, hasValidToken } from './auth.js';
import { collectEvents, localDateKey, toDateKey } from './schedule.js';

const SETTINGS_KEY = 'appsyncmemo.settings';
const COLOR_NAMES = { yellow: '노랑', pink: '분홍', green: '초록', blue: '파랑', purple: '보라', gray: '회색' };
const SAVE_DELAY_MS = 500;
const SYNC_AFTER_EDIT_MS = 2500;
const SYNC_INTERVAL_MS = 60_000;

// ---- 설정 -----------------------------------------------------------------
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* 깨진 값은 무시 */ }
  const settings = { clientId: '', folderId: '', folderName: '', deviceId: '', ...saved };
  if (!settings.deviceId) settings.deviceId = `mobile-${crypto.randomUUID().slice(0, 8)}`;
  return settings;
}

const settings = loadSettings();
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
saveSettings();

const configured = () => Boolean(settings.clientId && settings.folderId);

// ---- 동기화 엔진 ------------------------------------------------------------
const drive = new GoogleDrive({
  getToken: () => getAccessToken(settings.clientId, { interactive: false }),
  folderId: settings.folderId,
});
const engine = new SyncEngine({ drive, store: new IdbStore(), deviceId: settings.deviceId });

let status = { kind: 'idle', detail: '' };
let lastSync = Number(localStorage.getItem('appsyncmemo.lastSync') || 0);
let syncTimer = null;

const STATUS_LABEL = {
  idle: '대기 중', syncing: '동기화 중…', ok: '동기화됨', offline: '오프라인 · 연결되면 자동 동기화',
  auth: 'Google 연결이 필요합니다', error: '동기화 오류', unconfigured: '설정이 필요합니다',
};

function setStatus(kind, detail = '') {
  status = { kind, detail };
  const el = document.getElementById('status');
  if (el) el.outerHTML = statusHtml();
}

function formatTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusHtml() {
  const pending = engine.pendingCount;
  let text = STATUS_LABEL[status.kind] || '';
  if (status.kind === 'ok' && lastSync) text += ` · ${formatTime(lastSync)}`;
  if (status.kind === 'error' && status.detail) text += ` · ${status.detail}`;
  if (pending && status.kind !== 'syncing') text += ` · 올릴 변경 ${pending}건`;
  let action = '';
  if (status.kind === 'auth') action = '<button data-act="reconnect">다시 연결</button>';
  else if (status.kind === 'unconfigured') action = '<button data-act="open-settings">설정</button>';
  else if (status.kind === 'error' || status.kind === 'ok' || status.kind === 'offline') action = '<button data-act="sync-now">새로고침</button>';
  return `<div class="status" id="status"><span class="dot ${status.kind}"></span><span>${esc(text)}</span>${action}</div>`;
}

async function runSync({ interactive = false } = {}) {
  if (!configured()) { setStatus('unconfigured'); return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  setStatus('syncing');
  try {
    if (interactive) await getAccessToken(settings.clientId, { interactive: true });
    await engine.sync();
    lastSync = Date.now();
    localStorage.setItem('appsyncmemo.lastSync', String(lastSync));
    setStatus('ok');
  } catch (err) {
    if (err instanceof AuthError) {
      clearToken();
      setStatus('auth');
    } else {
      setStatus('error', err.message);
    }
  }
}

function scheduleSync(delay = SYNC_AFTER_EDIT_MS) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(), delay);
}

// ---- 공통 도우미 ------------------------------------------------------------
const $app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

let view = { name: 'list' };
function go(next) {
  view = next;
  render();
}

function render() {
  if (view.name === 'editor') renderEditor();
  else if (view.name === 'calendar') renderCalendar();
  else if (view.name === 'settings') renderSettings();
  else renderList();
}

// ---- 목록 -------------------------------------------------------------------
let filter = '';

function sortedNotes() {
  const needle = filter.trim().toLowerCase();
  return engine.notes()
    .filter((n) => !needle || n.content.toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function cardsHtml() {
  const notes = sortedNotes();
  if (!notes.length) {
    return `<div class="empty-state">${filter ? '검색 결과가 없습니다' : '메모가 없습니다.<br>아래 + 버튼으로 새 메모를 만드세요.'}</div>`;
  }
  return `<div class="cards">${notes.map((n) => `
    <button class="card" data-color="${n.color}" data-act="open" data-id="${n.id}">
      <div class="text${n.content.trim() ? '' : ' empty'}">${esc(n.content.trim() ? n.content : '빈 메모')}</div>
      <div class="meta">${esc(formatTime(n.updatedAt))}</div>
    </button>`).join('')}</div>`;
}

function renderList() {
  $app.innerHTML = `
    <header class="topbar"><h1>memoSync</h1>
      <button class="icon-btn" data-act="calendar" aria-label="달력">📅</button>
      <button class="icon-btn" data-act="open-settings" aria-label="설정">⚙️</button>
    </header>
    <main>
      ${statusHtml()}
      <input class="search" id="search" type="search" placeholder="메모 검색" value="${esc(filter)}">
      <div id="cards">${cardsHtml()}</div>
    </main>
    <button class="fab" data-act="new" aria-label="새 메모">＋</button>`;
  document.getElementById('search').addEventListener('input', (e) => {
    filter = e.target.value;
    document.getElementById('cards').innerHTML = cardsHtml();
  });
}

// ---- 편집기 -----------------------------------------------------------------
let editor = null; // { id, saveTimer, lastInput }

async function flushEditor() {
  if (!editor) return;
  clearTimeout(editor.saveTimer);
  const area = document.getElementById('editor-text');
  if (area) await engine.edit(editor.id, { content: area.value });
}

function renderEditor() {
  const note = engine.get(view.id);
  if (!note) { go({ name: 'list' }); return; }
  editor = { id: note.id, saveTimer: null, lastInput: 0 };
  $app.innerHTML = `
    <div class="editor" data-color="${note.color}" id="editor-root">
      <header class="topbar tinted">
        <button class="icon-btn" data-act="back" aria-label="뒤로">←</button>
        <h1>메모</h1>
        <button class="icon-btn" data-act="delete" aria-label="삭제">🗑️</button>
      </header>
      <div class="hint">날짜를 적으면 달력에 일정으로 표시됩니다 (예: 3/5 치과, 2027년 3월 5일 회의)</div>
      <textarea id="editor-text" placeholder="메모를 입력하세요" spellcheck="false"></textarea>
      <div class="editor-bar">
        <div class="swatches">${COLORS.map((c) => `
          <button class="swatch${c === note.color ? ' sel' : ''}" data-color="${c}" data-act="color" data-value="${c}" aria-label="${COLOR_NAMES[c]}"></button>`).join('')}
        </div>
      </div>
    </div>`;
  const area = document.getElementById('editor-text');
  area.value = note.content;
  area.addEventListener('input', () => {
    editor.lastInput = Date.now();
    clearTimeout(editor.saveTimer);
    editor.saveTimer = setTimeout(async () => {
      await engine.edit(editor.id, { content: area.value });
      scheduleSync();
    }, SAVE_DELAY_MS);
  });
  if (!note.content) area.focus();
}

// 다른 기기에서 바뀐 내용을 편집 중인 화면에 반영한다. 입력 중이면 건드리지 않는다.
function refreshEditorFromEngine() {
  if (!editor) return;
  const note = engine.get(editor.id);
  if (!note) { toast('이 메모는 다른 기기에서 삭제되었습니다'); go({ name: 'list' }); return; }
  const area = document.getElementById('editor-text');
  if (area && note.content !== area.value && Date.now() - editor.lastInput > 2000) {
    const pos = area.selectionStart;
    area.value = note.content;
    area.setSelectionRange(pos, pos);
  }
  const root = document.getElementById('editor-root');
  if (root && root.dataset.color !== note.color) {
    root.dataset.color = note.color;
    document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s.dataset.value === note.color));
  }
}

// ---- 달력 -------------------------------------------------------------------
const today = new Date();
let cal = { y: today.getFullYear(), m: today.getMonth(), selected: localDateKey(today) };

function renderCalendar() {
  const events = collectEvents(engine.notes(), new Date().getFullYear());
  const byDate = new Map();
  for (const ev of events) {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date).push(ev);
  }
  const first = new Date(cal.y, cal.m, 1);
  const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
  const todayKey = localDateKey();
  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push('<div class="day blank"></div>');
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = toDateKey(cal.y, cal.m + 1, d);
    const dayEvents = byDate.get(key) || [];
    const dow = new Date(cal.y, cal.m, d).getDay();
    const classes = ['day', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', key === todayKey ? 'today' : '', key === cal.selected ? 'sel' : '']
      .filter(Boolean).join(' ');
    const dots = dayEvents.slice(0, 4).map((ev) => `<i data-color="${ev.color}"></i>`).join('');
    const more = dayEvents.length > 4 ? `<span class="more">+${dayEvents.length - 4}</span>` : '';
    cells.push(`<button class="${classes}" data-act="pick-day" data-date="${key}"><span>${d}</span><span class="dots">${dots}</span>${more}</button>`);
  }
  const selectedEvents = byDate.get(cal.selected) || [];
  $app.innerHTML = `
    <header class="topbar"><button class="icon-btn" data-act="back" aria-label="뒤로">←</button><h1>달력</h1></header>
    <main>
      <div class="cal-head">
        <button class="icon-btn" data-act="prev-month" aria-label="이전 달">◀</button>
        <strong>${cal.y}년 ${cal.m + 1}월</strong>
        <button class="icon-btn" data-act="next-month" aria-label="다음 달">▶</button>
      </div>
      <div class="grid">${['일', '월', '화', '수', '목', '금', '토'].map((n) => `<div class="dow">${n}</div>`).join('')}${cells.join('')}</div>
      <div class="events">
        <h3>${esc(cal.selected)} 일정 ${selectedEvents.length}건</h3>
        ${selectedEvents.map((ev) => `
          <button class="event" data-color="${ev.color}" data-act="open" data-id="${ev.noteId}">${esc(ev.title)}</button>`).join('')
          || '<div class="kv">이 날의 일정이 없습니다</div>'}
      </div>
    </main>`;
}

// ---- 설정 -------------------------------------------------------------------
let folderResults = [];
let folderBusy = false;

function renderSettings() {
  const origin = location.origin;
  $app.innerHTML = `
    <header class="topbar"><button class="icon-btn" data-act="back" aria-label="뒤로">←</button><h1>설정</h1></header>
    <main>
      ${statusHtml()}
      <section class="panel">
        <h2>1. Google 연결</h2>
        <p>OAuth 클라이언트 ID를 입력하고 Google 계정을 연결합니다. 데스크탑 memoSync가 쓰는 Google Drive 계정과 같아야 합니다.</p>
        <input class="field" id="client-id" placeholder="xxxx.apps.googleusercontent.com" value="${esc(settings.clientId)}" autocapitalize="off" autocomplete="off" spellcheck="false">
        <button class="btn" data-act="save-client">저장하고 연결</button>
        <button class="btn secondary" data-act="sign-out">연결 해제</button>
        <p class="kv">연결 상태: ${hasValidToken() ? '연결됨' : '연결 안 됨 (토큰은 1시간마다 자동 갱신)'}</p>
      </section>
      <section class="panel">
        <h2>2. 동기화 폴더</h2>
        <p>데스크탑 memoSync의 동기화 폴더(Google Drive 안의 폴더)를 고릅니다. 예: <code>memoSync</code></p>
        <p class="kv">현재: ${settings.folderId ? esc(settings.folderName || settings.folderId) : '선택 안 됨'}</p>
        <input class="field" id="folder-query" placeholder="폴더 이름" value="${esc(settings.folderName || 'memoSync')}">
        <button class="btn" data-act="find-folder" ${folderBusy ? 'disabled' : ''}>${folderBusy ? '찾는 중…' : '폴더 찾기'}</button>
        <div id="folder-results">${folderResults.map((f) => `
          <button class="folder-item${f.id === settings.folderId ? ' sel' : ''}" data-act="pick-folder" data-id="${esc(f.id)}" data-name="${esc(f.name)}">
            ${esc(f.name)}<small>수정 ${esc(formatTime(Date.parse(f.modifiedTime)))}</small>
          </button>`).join('')}</div>
      </section>
      <section class="panel">
        <h2>3. 동기화</h2>
        <button class="btn" data-act="sync-now">지금 동기화</button>
        <p class="kv">이 기기 ID: <code>${esc(settings.deviceId)}</code><br>마지막 동기화: ${lastSync ? esc(formatTime(lastSync)) : '없음'} · 메모 ${engine.notes().length}개</p>
      </section>
      <section class="panel">
        <h2>클라이언트 ID 만드는 법</h2>
        <ol>
          <li>Google Cloud Console에서 프로젝트를 만들고 <b>Google Drive API</b>를 사용 설정합니다.</li>
          <li><b>OAuth 동의 화면</b>: 사용자 유형 외부, 게시 상태 <b>테스트</b>, 테스트 사용자에 본인 Google 계정을 추가합니다.</li>
          <li><b>사용자 인증 정보 → OAuth 클라이언트 ID</b>: 유형 <b>웹 애플리케이션</b>, 승인된 JavaScript 원본에 <code>${esc(origin)}</code>을 추가합니다.</li>
          <li>발급된 클라이언트 ID를 위 입력란에 붙여넣습니다.</li>
        </ol>
        <p>"확인되지 않은 앱" 경고가 나오면 <b>고급 → 이동</b>을 누르세요. 본인만 쓰는 앱이라 정상입니다.</p>
      </section>
    </main>`;
}

// ---- 이벤트 처리 ------------------------------------------------------------
const actions = {
  'open-settings': () => go({ name: 'settings' }),
  calendar: () => go({ name: 'calendar' }),
  open: (el) => go({ name: 'editor', id: el.dataset.id }),
  'sync-now': () => runSync({ interactive: !hasValidToken() }),
  reconnect: () => runSync({ interactive: true }),
  'prev-month': () => { cal.m -= 1; if (cal.m < 0) { cal.m = 11; cal.y -= 1; } renderCalendar(); },
  'next-month': () => { cal.m += 1; if (cal.m > 11) { cal.m = 0; cal.y += 1; } renderCalendar(); },
  'pick-day': (el) => { cal.selected = el.dataset.date; renderCalendar(); },

  async new() {
    const note = await engine.create();
    go({ name: 'editor', id: note.id });
  },

  async back() {
    await flushEditor();
    if (editor) await engine.discardIfBlank(editor.id);
    editor = null;
    go({ name: 'list' });
    scheduleSync(300);
  },

  async color(el) {
    const note = await engine.edit(editor.id, { color: el.dataset.value });
    if (note) scheduleSync();
  },

  async delete() {
    if (!confirm('이 메모를 삭제할까요? 모든 기기에서 삭제됩니다.')) return;
    clearTimeout(editor.saveTimer);
    const id = editor.id;
    editor = null;
    if (!(await engine.discardIfBlank(id))) await engine.remove(id);
    go({ name: 'list' });
    toast('삭제했습니다');
    scheduleSync(300);
  },

  async 'save-client'() {
    const value = document.getElementById('client-id').value.trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value)) { toast('클라이언트 ID 형식이 올바르지 않습니다'); return; }
    if (value !== settings.clientId) { clearToken(); settings.clientId = value; saveSettings(); }
    try {
      await getAccessToken(settings.clientId, { interactive: true });
      toast('Google에 연결했습니다');
      renderSettings();
      if (configured()) runSync();
    } catch (err) {
      toast(err.message);
    }
  },

  'sign-out'() {
    signOut();
    setStatus('auth');
    renderSettings();
    toast('연결을 해제했습니다');
  },

  async 'find-folder'() {
    const query = document.getElementById('folder-query').value.trim();
    if (!query) return;
    if (!settings.clientId) { toast('먼저 클라이언트 ID를 저장하세요'); return; }
    folderBusy = true;
    renderSettings();
    try {
      await getAccessToken(settings.clientId, { interactive: true });
      folderResults = await drive.searchFolders(query);
      if (!folderResults.length) toast('해당 이름의 폴더가 없습니다');
    } catch (err) {
      toast(err.message);
    } finally {
      folderBusy = false;
      renderSettings();
    }
  },

  async 'pick-folder'(el) {
    if (el.dataset.id !== settings.folderId) {
      // 폴더를 바꾸면 이 기기의 캐시는 새 폴더와 합쳐진다. (데스크탑과 같은 동작)
      settings.folderId = el.dataset.id;
      settings.folderName = el.dataset.name;
      saveSettings();
      drive.folderId = settings.folderId;
    }
    renderSettings();
    toast(`“${settings.folderName}” 폴더로 동기화합니다`);
    runSync();
  },
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  Promise.resolve(actions[el.dataset.act](el)).catch((err) => toast(err.message));
});

engine.onChange(() => {
  if (view.name === 'list') {
    const cards = document.getElementById('cards');
    if (cards) cards.innerHTML = cardsHtml();
    const el = document.getElementById('status');
    if (el) el.outerHTML = statusHtml();
  } else if (view.name === 'editor') refreshEditorFromEngine();
  else if (view.name === 'calendar') renderCalendar();
});

// ---- 시작 -------------------------------------------------------------------
window.addEventListener('online', () => runSync());
window.addEventListener('offline', () => setStatus('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushEditor().then(() => (configured() && navigator.onLine ? engine.sync().catch(() => {}) : null));
  else runSync();
});
setInterval(() => { if (!document.hidden && configured()) runSync(); }, SYNC_INTERVAL_MS);

(async function boot() {
  await engine.load();
  if (!configured()) {
    setStatus('unconfigured');
    go({ name: 'settings' });
    return;
  }
  setStatus(navigator.onLine ? 'idle' : 'offline');
  render();
  runSync();
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
