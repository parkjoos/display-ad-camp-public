// 관리 페이지 /admin (docs/04-admin.md, R-7 · R-13 · R-15 · R-31 · R-32 · R-37)
import { h, replace } from '../ui/dom.js';
import { api, verifyPin, pinStore, onPinNeeded, readState, writeState, watchState, ApiError, setServerMode } from './api.js';
import { getSession, pinHint, serverDownHint } from '../ui/session.js';
import { validateGame, SCORE_TYPES, emptyState } from '../core/validate.js';
import { suggestCategoryId } from '../core/random.js';
import { loadScoreboardDefaults } from '../core/data.js';
import { resumeLabel, localIso } from '../core/state.js';
import { withLog } from '../core/scoreboard.js';
import { createScoreboardScreen } from '../ui/scoreboard.js';
import { create as createPointsTable } from '../ui/points-table.js';
import { questionEditor, bulkAdd, pastePage, needsSetup } from './editor.js';
import { archivePage } from './archive.js';
import { imagesPage } from './images.js';
import { loadAssetUrls, assetUrl } from '../core/assets.js';
import { guideBody } from '../ui/guide.js';
import { reportDisconnect, flushBeacons } from '../ui/beacon.js';

const root = document.getElementById('admin');
export const A = {
  view: { page: 'home' },
  appGames: [],
  games: {}, // id → { revision, data, errors, warnings }
  saved: new Set(),
  online: true,
  state: null,
  server: false, // 서버 모드 (R-36) — 안내 문구만 다르다
};

// ── 공통 UI ───────────────────────────────────────────
const toastBox = h('div.toasts');
document.body.append(toastBox);
export function toast(msg) {
  const t = h('div.toast', msg);
  toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

export function dialog({ title, message, buttons, body }) {
  return new Promise((resolve) => {
    const layer = h('div.overlay');
    const done = (v) => { layer.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    layer.append(h('div.dialog', h('h2', title), message && h('p', message), body,
      h('div.dialog-actions', buttons.map((b) => h(`button.btn${b.primary ? '.primary' : ''}${b.danger ? '.danger.fill' : ''}`, { onclick: () => done(b.value) }, b.label)))));
    document.body.append(layer);
  });
}
export const confirmBox = ({ title, message, ok = '확인', danger = false }) =>
  dialog({ title, message, buttons: [{ label: '취소', value: false }, { label: ok, value: true, primary: !danger, danger }] }).then((v) => v === true);

export function errorList(errors = [], warnings = []) {
  return h('ul.error-list', errors.map((e) => h('li', h('b', e.code), e.message)), warnings.map((w) => h('li.warn', h('b', w.code), w.message)));
}

// ── PIN (2-1) ─────────────────────────────────────────
function pinScreen(message = '') {
  const input = h('input.input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', placeholder: '••••••' });
  const err = h('div.field-error', message);
  const submit = async () => {
    const pin = input.value.trim();
    if (!/^\d{6}$/.test(pin)) { err.textContent = '6자리 숫자를 입력하세요'; return; }
    const problem = await verifyPin(pin);
    if (problem) { err.textContent = problem; input.value = ''; input.focus(); return; }
    boot();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  replace(root, h('div.a-pin', h('div.panel',
    h('h1', '⚙ 관리 페이지'),
    h('p', { style: { color: 'var(--text-dim)' } }, `${pinHint(A.server)} (진행자 화면과 같은 PIN)`),
    input, err, h('button.btn.primary', { onclick: submit }, '들어가기'))));
  setTimeout(() => input.focus(), 50);
}

// PIN 이 바뀌면(서버 재시작) 편집 중인 화면은 둔 채 창으로 다시 묻는다
onPinNeeded(async (message) => {
  pinStore.clear();
  const input = h('input.input', { type: 'password', inputmode: 'numeric', maxlength: 6, placeholder: '••••••', style: { fontSize: '28px', letterSpacing: '0.3em', textAlign: 'center' } });
  const err = h('div.field-error');
  for (;;) {
    setTimeout(() => input.focus(), 50);
    const v = await dialog({ title: 'PIN 다시 입력', message, body: h('div', input, err), buttons: [{ label: '취소', value: false }, { label: '확인', value: true, primary: true }] });
    if (!v) return false;
    const problem = await verifyPin(input.value.trim());
    if (!problem) return true;
    err.textContent = problem;
    input.value = '';
  }
});

// ── 데이터 ───────────────────────────────────────────
export async function loadAppGames() {
  const res = await fetch('/data/app.json', { cache: 'no-store' });
  const app = await res.json();
  A.appGames = app.games ?? [];
}

export async function loadGame(id) {
  const g = await api.game(id);
  A.games[id] = g;
  return g;
}

/** 게임 데이터 바꾸고 바로 저장 — 저장 1번 = 파일 1번 쓰기 */
export async function saveGame(id, mutate, { message = '저장했습니다', quiet = false } = {}) {
  if (!A.online) { toast(serverDownHint(A.server)); return false; }
  const g = A.games[id];
  const next = structuredClone(g.data);
  const r0 = mutate(next);
  if (r0 === false) return false;
  const v = validateGame(next, { fileId: id });
  if (v.errors.length) {
    await dialog({ title: '저장할 수 없습니다 — 검증 오류', body: errorList(v.errors), buttons: [{ label: '닫기', value: true, primary: true }] });
    return false;
  }
  try {
    const r = await api.saveGame(id, next, g.revision);
    g.data = next; g.revision = r.revision; g.errors = []; g.warnings = r.warnings ?? [];
    A.saved.add(`data/games/${id}.json`);
    if (!quiet) {
      const count = next.categories.reduce((n, c) => n + (c.questions?.length ?? 0), 0);
      toast(`${message}${SCORE_TYPES.includes(next.type) || count ? ` (문제 ${count}개)` : ''}`);
    }
    return true;
  } catch (e) {
    if (e.status === 409) {
      const v2 = await dialog({ title: '파일이 다른 곳에서 바뀌었습니다', message: '다시 불러온 뒤 편집하세요 (다른 창에서 저장 · 백업 올리기)', buttons: [{ label: '닫기', value: false }, { label: '다시 불러오기', value: true, primary: true }] });
      if (v2) { await loadGame(id); render(); }
    } else if (e.status === 422) {
      await dialog({ title: '저장할 수 없습니다 — 검증 오류', body: errorList(e.body.errors, e.body.warnings), buttons: [{ label: '닫기', value: true, primary: true }] });
    } else {
      toast(e.message);
      if (e.status === 0) setOnline(false);
    }
    return false;
  }
}

/** 진행 중 게임이 쓰는지 (삭제 막기, docs/04-admin.md 3-4 · 5-2) */
export async function inUse(gameId) {
  try { A.state = await readState(); } catch { return { categories: new Set(), questions: new Set() }; }
  const s = A.state.sessions?.[gameId]?.data;
  const categories = new Set();
  const questions = new Set();
  if (s && !s.empty && s.status === 'active') {
    for (const p of s.picks ?? []) { categories.add(p.categoryId); for (const q of p.questionIds ?? []) questions.add(q); }
    for (const q of s.tiebreak?.used ?? []) questions.add(q);
  }
  return { categories, questions };
}

/** why: 'health'(5초 서버 확인) · 'request'(관리 요청) — "서버 연결 안 됨" 이 뜨는 순간 서버 로그에 비콘 (R-66) */
function setOnline(v, why = 'request') {
  if (A.online === v && document.querySelector('.a-status')) return;
  if (A.online && !v) reportDisconnect('admin', why);
  else if (!A.online && v) flushBeacons();
  A.online = v;
  document.body.classList.toggle('a-offline', !v); // 저장 · 초기화 버튼 막기 (admin.css)
  document.querySelector('.a-status')?.replaceWith(statusEl());
}
const statusEl = () => h(`span.a-status${A.online ? '' : '.off'}`, A.online ? `● 저장 가능 (${location.host})` : `○ 서버 연결 안 됨 (읽기 전용) — ${A.server ? '인터넷 연결을 확인하세요' : 'start.command 로 서버를 켜세요'}`);

// 서버가 꺼지면 저장하려 하기 전에 알 수 있게 5초마다 확인 (I-2)
let heartbeat = null;
function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(async () => {
    try {
      const r = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
      setOnline(r.ok, 'health');
    } catch { setOnline(false, 'health'); }
  }, 5000);
}

// ── 화면 전환 ─────────────────────────────────────────
export function go(view) { A.view = view; render(); window.scrollTo(0, 0); }

function crumbs() {
  const v = A.view;
  const items = [['⚙ 관리', { page: 'home' }]];
  const g = v.gameId && A.games[v.gameId]?.data;
  if (g) items.push([`${g.icon ?? ''} ${g.title}`, { page: 'game', gameId: v.gameId }]);
  if (v.categoryId && g) {
    const c = g.categories.find((x) => x.id === v.categoryId);
    if (c && v.page !== 'category') items.push([`${c.icon ?? ''} ${c.name}`, { page: 'questions', gameId: v.gameId, categoryId: v.categoryId }]);
  }
  const names = { category: v.isNew ? '카테고리 추가' : '카테고리 편집', qedit: v.questionId ? '문제 편집' : '문제 추가', bulk: '여러 장 한 번에 추가', paste: '표 붙여넣기', backups: '백업 목록', check: '전체 검증', images: '안 쓰는 이미지 정리', score: '점수 입력', reset: '상태 초기화', archive: '백업 내려받기 · 올리기', guide: '진행자 설명서' };
  if (names[v.page]) items.push([names[v.page], null]);
  return h('div.crumbs', items.map(([label, to], i) => [i > 0 && h('span', { style: { color: 'var(--text-dim)' } }, '›'), to ? h('button', { onclick: () => go(to) }, label) : h('span', label)]));
}

async function lock() {
  pinStore.clear();
  pinScreen('잠갔습니다 — 다시 쓰려면 PIN 을 입력하세요');
}

let pageCleanup = null;
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  pageCleanup?.();
  pageCleanup = null;
  const body = h('div');
  replace(root, h('div.a-top', crumbs(), statusEl(),
    h('button.btn.small', { onclick: () => go({ page: 'guide' }) }, '📖 설명서'),
    h('button.btn.small', { onclick: lock }, '🔒 잠그기')), body);
  try {
    const v = A.view;
    let cleanup = null;
    if (v.page === 'home') await homePage(body);
    else if (v.page === 'game') await gamePage(body, v.gameId);
    else if (v.page === 'category') await categoryPage(body, v);
    else if (v.page === 'questions') await questionsPage(body, v);
    else if (v.page === 'qedit') cleanup = await questionEditor(body, v);
    else if (v.page === 'bulk') cleanup = await bulkAdd(body, v);
    else if (v.page === 'paste') await pastePage(body, v);
    else if (v.page === 'backups') await backupsPage(body, v);
    else if (v.page === 'check') await checkPage(body);
    else if (v.page === 'images') cleanup = await imagesPage(body);
    else if (v.page === 'score') cleanup = await scorePage(body);
    else if (v.page === 'reset') await resetPage(body);
    else if (v.page === 'archive') await archivePage(body);
    else if (v.page === 'guide') guidePage(body);
    // 그리는 사이 다른 화면으로 넘어갔으면 (go 를 또 부름) 이 화면은 버린다
    if (seq !== renderSeq) { cleanup?.(); return; }
    pageCleanup = cleanup;
    // 설명서는 서버를 부르지 않으므로 연결 상태를 알 수 없다 (3-12)
    if (A.online === false && v.page !== 'guide') setOnline(true);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e instanceof ApiError && e.status === 0) setOnline(false);
    replace(body, h('div.a-msg.err', e.message ?? String(e)));
  }
}
export { render };

// ── 관리 홈 (3-1) ─────────────────────────────────────
async function homePage(body) {
  await loadAppGames();
  await Promise.all(A.appGames.map((id) => loadGame(id).catch(() => null)));
  const cards = A.appGames.map((id) => {
    const g = A.games[id];
    if (!g) return h('div.a-card', h('div.t', '⚠', id), h('div.err-badge', '데이터 파일이 없습니다 (E08)'));
    const d = g.data;
    const cats = d?.categories ?? [];
    const qs = cats.reduce((n, c) => n + (c.questions?.length ?? 0), 0);
    const status = g.errors?.length ? h('span.err-badge', `✕ 오류 ${g.errors.length}`) : g.warnings?.length ? h('span.warn-badge', `⚠ 경고 ${g.warnings.length}`) : h('span.ok-badge', '✔');
    return h('button.a-card', { onclick: () => go({ page: 'game', gameId: id }) },
      h('div.t', h('span.emoji', d?.icon ?? '🎮'), d?.title ?? id),
      h('div.m', `${d?.type ?? '?'} · ${d?.type === 'roulette' ? '주제' : '카테고리'} ${cats.length}${d?.type === 'roulette' && !qs ? '' : ` · 문제 ${qs}`}`),
      status);
  });
  replace(body,
    h('div.a-section', h('h2', '게임'), h('div.a-grid', cards),
      h('div.small-note', '새 게임 추가는 관리 기능이 아닙니다 (D-10 — 필요해지면 저장소에서 직접).')),
    await publicSection(),
    h('div.a-section',
      h('h2', '도구'),
      h('div.a-row',
        h('button.btn.primary', { onclick: () => go({ page: 'score' }) }, '🏆 점수 입력'),
        h('button.btn', { onclick: () => go({ page: 'reset' }) }, '🧹 상태 초기화'),
        h('button.btn', { onclick: () => go({ page: 'backups', gameId: A.appGames[0] }) }, '↺ 백업 목록'),
        h('button.btn', { onclick: () => go({ page: 'check' }) }, '✔ 전체 검증'),
        h('button.btn', { onclick: () => go({ page: 'images' }) }, '🗑 안 쓰는 이미지 정리'))),
    h('div.a-section',
      h('h2', '데이터 보관 (R-37)'),
      h('div.a-msg.info', A.server
        ? '저장한 내용은 이 서버에 바로 남습니다 — 모두가 같은 내용을 봅니다 (커밋 · 푸시 필요 없음). 노트북으로 옮기거나 보관하려면 백업을 내려받으세요.'
        : '노트북 모드 — 저장한 내용은 이 노트북에만 있습니다. 서버로 옮기려면 백업을 내려받아 서버 관리 페이지에서 올리세요.'),
      h('div.a-row', h('button.btn', { onclick: () => go({ page: 'archive' }) }, '💾 백업 내려받기 · 올리기'))));
}

// ── 공개 모드 /play (3-16, R-96) — 누구나 PIN 없이 게임을 해 보는 페이지를 켜고 끈다 ──
async function publicSection() {
  const box = h('div.a-section');
  const url = `${location.origin}/play`;
  const paint = (on) => replace(box,
    h('h2', '🌐 공개 모드'),
    h(`div.a-msg.${on ? 'ok' : 'info'}`, on
      ? `켜짐 — 누구나 ${url} 에서 PIN 없이 게임을 해 볼 수 있습니다 (정답 · 사진 포함, 점수는 남지 않음)`
      : `꺼짐 — ${url} 는 "지금은 공개하지 않습니다" 만 보여 줍니다`),
    h('div.a-row',
      h(`button.btn${on ? '' : '.primary'}`, { onclick: () => toggle(!on) }, on ? '공개 모드 끄기' : '공개 모드 켜기'),
      on && h('a.btn', { href: '/play', target: '_blank', rel: 'noopener' }, '↗ /play 열기')),
    h('div.small-note', '숨긴 카테고리 · 문제와 진행자 메모는 나오지 않습니다. 게임 화면(/) · 진행자 화면 · 관리 페이지는 켜도 PIN 그대로입니다.'));
  async function toggle(on) {
    if (on && !(await confirmBox({ title: '공개 모드 켜기', message: `켜면 ${url} 에서 누구나 PIN 없이 숨기지 않은 모든 문제의 정답과 사진을 볼 수 있습니다.\n\n사람 사진처럼 밖에 공개하면 안 되는 문제는 먼저 숨기세요.`, ok: '켜기' }))) return;
    try {
      paint((await api.setPublicMode(on)).on);
      toast(on ? '공개 모드를 켰습니다' : '공개 모드를 껐습니다');
    } catch (e) {
      toast(e.message);
      if (e.status === 0) setOnline(false);
    }
  }
  // 읽지 못해도 관리 홈은 그린다
  try { paint((await api.publicMode()).on); } catch (e) { replace(box, h('h2', '🌐 공개 모드'), h('div.a-msg.err', e.message)); }
  return box;
}

// ── 진행자 설명서 (3-12, R-38) — 진행자 화면 [❓ 설명서] 와 같은 내용 + 관리 페이지 구역 ──
function guidePage(body) {
  replace(body, h('div.a-section',
    h('h2', '📖 진행자 설명서'),
    h('div.small-note', '진행자 화면 맨 위 [❓ 설명서] 와 같은 내용에 관리 페이지 항목을 더했습니다.'),
    guideBody({ server: A.server, admin: true })));
}

// ── 게임 편집 (3-2) ───────────────────────────────────
async function gamePage(body, id) {
  const g = A.games[id] ?? await loadGame(id);
  if (!g.data) { replace(body, h('div.a-section', h('h2', '데이터 오류'), errorList(g.errors))); return; }
  const d = g.data;
  const scoring = SCORE_TYPES.includes(d.type);
  // 팀당 대표 (릴레이, R-62) · 인당 문제 (R-64) — 사진 게임만. 데이터에 없으면 2명 · 1문제
  const f = { title: d.title, icon: d.icon ?? '🎮', description: d.description ?? '', rules: (d.rules ?? []).join('\n'), defaults: { rounds: 3, questionsPerRound: 5, questionOrder: 'random', ...(d.type === 'photo' ? { relay: 2, perRep: 1 } : {}), ...(d.defaults ?? {}) } };
  const num = (key, lo, hi) => h('input.input', { type: 'number', min: lo, max: hi, value: f.defaults[key], style: { width: '6em' }, oninput: (e) => { f.defaults[key] = Number(e.target.value); } });
  const info = h('div.a-section',
    h('h2', '기본 정보'),
    h('div.a-form',
      h('label', '게임 이름'), h('input.input', { value: f.title, maxlength: 20, oninput: (e) => { f.title = e.target.value; } }),
      h('label', '아이콘'), h('input.input', { value: f.icon, style: { width: '5em' }, oninput: (e) => { f.icon = e.target.value.trim(); } }),
      h('label', '설명'), h('input.input', { value: f.description, maxlength: 60, oninput: (e) => { f.description = e.target.value; } }),
      h('label', '규칙 문구'), h('textarea.input', { style: { minHeight: '90px', fontFamily: 'inherit' }, oninput: (e) => { f.rules = e.target.value; } }, f.rules),
      h('div.hint', '한 줄에 하나 (최대 6줄, 각 40자)'),
      scoring && [h('label', '진행 기본값'), h('div.a-row', '라운드 ', num('rounds', 1, 20), ' 라운드당 문제 ', num('questionsPerRound', 1, 20), ' 순서 ',
        h('select.input', { onchange: (e) => { f.defaults.questionOrder = e.target.value; } }, h('option', { value: 'random', selected: f.defaults.questionOrder === 'random' ? true : undefined }, '랜덤'), h('option', { value: 'fixed', selected: f.defaults.questionOrder === 'fixed' ? true : undefined }, '작성 순서')),
        d.type === 'photo' && [' 팀당 대표 ', num('relay', 0, 6), h('span.small-note', '팀마다 이만큼 함께 나와 맞힌 사람은 빠지고, 대표가 모두 빠진 순서로 등수 — 라운드당 문제만큼 뽑고 순위가 정해지면 라운드 끝 (남은 문제는 돌려놓음, R-95). 0 = 끔 (정답 수 방식)'),
          ' 인당 문제 ', num('perRep', 1, 5), h('span.small-note', '한 사람이 이만큼 맞히면 빠짐 — 팀은 대표 × 인당 문제만큼 맞히면 끝. 맞힌 사람은 진행자 화면 · 게임 화면 점수 띠에서 팀 · 대표를 눌러 기록 (R-94)')])],
      // 줄줄이 말해요는 문제 순서만 — 주제 안 [다음 문제] (R-45)
      !scoring && [h('label', '진행 기본값'), h('div.a-row', '문제 순서 ',
        h('select.input', { onchange: (e) => { f.defaults.questionOrder = e.target.value; } }, h('option', { value: 'random', selected: f.defaults.questionOrder === 'random' ? true : undefined }, '랜덤'), h('option', { value: 'fixed', selected: f.defaults.questionOrder === 'fixed' ? true : undefined }, '작성 순서')),
        h('span.small-note', '주제 안 [다음 문제] 순서 — 진행자 화면에서는 골라 낼 수도 있음. 라운드 · 추첨 옵션은 없음 (D-7)'))]),
    h('div.a-row', h('button.btn.primary', {
      onclick: () => saveGame(id, (x) => {
        x.title = f.title.trim(); x.icon = f.icon || '🎮'; x.description = f.description.trim();
        x.rules = f.rules.split('\n').map((s) => s.trim()).filter(Boolean);
        if (scoring) x.defaults = { ...f.defaults };
        else x.defaults = { questionOrder: f.defaults.questionOrder };
      }).then(() => render()),
    }, '기본 정보 저장')));

  const used = await inUse(id);
  const cats = d.categories.map((c, i) => {
    const count = c.questions?.length ?? 0;
    return h('tr', { class: c.disabled ? 'hidden' : '' },
      h('td', h('span.order-btns', h('button', { onclick: () => moveCategory(id, i, -1) }, '▲'), h('button', { onclick: () => moveCategory(id, i, 1) }, '▼'))),
      h('td', h('span.emoji', c.icon ?? '❓'), ' ', h('b', c.name), h('div.small-note', c.id)),
      h('td', scoring ? `문제 ${count}개` : `예시 ${c.examples?.length ?? 0} · 문제 ${count}`),
      h('td', c.disabled ? '숨김' : '보임'),
      h('td', h('div.a-row',
        h('button.btn.small', { onclick: () => go({ page: 'category', gameId: id, categoryId: c.id }) }, '편집'),
        // 줄줄이 말해요 주제도 문제를 둘 수 있다 (R-44) — 선택이라 강조하지 않음
        h(`button.btn.small${scoring ? '.primary' : ''}`, { onclick: () => go({ page: 'questions', gameId: id, categoryId: c.id }) }, '문제 관리'),
        h('button.btn.small', { onclick: () => saveGame(id, (x) => { const t = x.categories.find((k) => k.id === c.id); t.disabled = !t.disabled; }, { message: c.disabled ? '보이게 했습니다' : '숨겼습니다' }).then(render) }, c.disabled ? '보이기' : '숨기기'),
        h('button.btn.small.danger', { onclick: () => deleteCategory(id, c, used) }, '삭제'))));
  });
  replace(body, info,
    h('div.a-section',
      h('h2', scoring ? '카테고리' : '주제 (카테고리)'),
      h('table.a-table', h('tr', h('th', '순서'), h('th', '이름'), h('th', scoring ? '문제' : '예시 · 문제'), h('th', '상태'), h('th', '')), cats),
      h('div.a-row',
        h('button.btn.primary', { onclick: () => go({ page: 'category', gameId: id, isNew: true }) }, '+ 카테고리 추가'),
        !scoring && h('button.btn', { onclick: () => go({ page: 'paste', gameId: id }) }, '표 붙여넣기'))),
    h('div.a-section', h('h2', '백업'), h('div.a-row', h('button.btn', { onclick: () => go({ page: 'backups', gameId: id }) }, '↺ 이 게임 백업 목록'))));
}

function moveCategory(id, i, d) {
  const n = A.games[id].data.categories.length;
  if (i + d < 0 || i + d >= n) return;
  saveGame(id, (x) => { const c = x.categories; [c[i], c[i + d]] = [c[i + d], c[i]]; }, { message: '순서를 바꿨습니다' }).then(render);
}

async function deleteCategory(id, c, used) {
  if (used.categories.has(c.id)) {
    const v = await dialog({ title: '삭제할 수 없습니다', message: '진행 중인 게임에서 사용 중입니다 — 숨기기만 할 수 있습니다', buttons: [{ label: '닫기', value: null }, { label: '숨기기', value: 'hide', primary: true }] });
    if (v === 'hide') await saveGame(id, (x) => { x.categories.find((k) => k.id === c.id).disabled = true; }, { message: '숨겼습니다' });
    render();
    return;
  }
  const count = c.questions?.length ?? 0;
  if (count) {
    const v = await dialog({ title: '카테고리 삭제', message: `문제 ${count}개가 함께 삭제됩니다. 숨기기를 권장합니다.\n(이미지 파일은 지우지 않습니다)`, buttons: [{ label: '취소', value: null }, { label: '숨기기', value: 'hide', primary: true }, { label: '삭제', value: 'delete', danger: true }] });
    if (v === 'hide') await saveGame(id, (x) => { x.categories.find((k) => k.id === c.id).disabled = true; }, { message: '숨겼습니다' });
    if (v === 'delete') await saveGame(id, (x) => { x.categories = x.categories.filter((k) => k.id !== c.id); }, { message: '삭제했습니다' });
  } else if (await confirmBox({ title: '카테고리 삭제', message: `'${c.name}' 을(를) 삭제할까요?`, ok: '삭제', danger: true })) {
    await saveGame(id, (x) => { x.categories = x.categories.filter((k) => k.id !== c.id); }, { message: '삭제했습니다' });
  }
  render();
}

// ── 카테고리 추가 · 편집 (3-3) ────────────────────────
const EMOJIS = ['🧸', '🔍', '🔎', '🎬', '💬', '🍪', '🍿', '🧑', '🏷️', '🖼️', '🎵', '🎤', '🌱', '📚', '🖍️', '🗼', '📜', '🔤', '🍜', '🍕', '🎮', '⚽', '🐶', '🌸', '🚗', '✈️', '🏕️', '🎨', '📺', '🎭', '❓', '⭐'];

export function emojiPicker(current, onPick) {
  const box = h('div.emoji-pick', EMOJIS.map((e) => h(`button${e === current ? '.on' : ''}`, {
    type: 'button',
    onclick: (ev) => {
      box.querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
      ev.currentTarget.classList.add('on');
      onPick(e);
    },
  }, e)));
  return box;
}

async function categoryPage(body, v) {
  const g = A.games[v.gameId] ?? await loadGame(v.gameId);
  const d = g.data;
  const type = d.type;
  const scoring = SCORE_TYPES.includes(type);
  const existing = v.isNew ? null : d.categories.find((c) => c.id === v.categoryId);
  const taken = new Set(d.categories.map((c) => c.id));
  // 저장된 카테고리는 기본값 필드를 생략하므로 (02-data-schema 2-2) 빈 값을 먼저 채운다
  const blank = { name: '', icon: '❓', description: '', prompt: '', defaultEffect: 'none', rule: '', examples: [], disabled: false };
  const f = existing
    ? { ...blank, ...structuredClone(existing) }
    : { ...blank, id: suggestCategoryId(taken), ...(scoring ? { questions: [] } : {}) };
  const err = h('div.field-error');
  const iconInput = h('input.input', { value: f.icon, style: { width: '5em' }, oninput: (e) => { f.icon = e.target.value.trim(); } });
  const examplesInput = h('input.input', { placeholder: '예시를 쓰고 Enter', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { f.examples.push(e.target.value.trim()); e.target.value = ''; drawExamples(); } } });
  const exampleChips = h('div.a-row');
  const drawExamples = () => replace(exampleChips, f.examples.map((x, i) => h('span.chip', x, ' ', h('button.link', { onclick: () => { f.examples.splice(i, 1); drawExamples(); } }, '✕'))));
  drawExamples();
  const save = async () => {
    if (!f.name.trim()) { err.textContent = '이름을 입력하세요'; return; }
    if (d.categories.some((c) => c.name.trim() === f.name.trim() && c.id !== existing?.id)) { err.textContent = '같은 이름의 카테고리가 있습니다'; return; }
    if (v.isNew && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id) || f.id.length > 32)) { err.textContent = 'id 는 영문 소문자 · 숫자 · 하이픈 (2~32자)'; return; }
    if (v.isNew && taken.has(f.id)) { err.textContent = '같은 id 가 이미 있습니다'; return; }
    const ok = await saveGame(v.gameId, (x) => {
      const out = { ...f, name: f.name.trim() };
      if (!scoring) { delete out.prompt; delete out.defaultEffect; delete out.questions; }
      else { delete out.rule; delete out.examples; if (type !== 'photo') delete out.defaultEffect; }
      if (v.isNew) x.categories.push(out);
      // 문제는 문제 관리에서만 바꾼다 — 카테고리 저장은 그대로 둠 (줄줄이 말해요 주제도, R-44)
      else x.categories = x.categories.map((c) => (c.id !== existing.id ? c : c.questions ? { ...out, questions: c.questions } : out));
    }, { message: v.isNew ? '카테고리를 추가했습니다' : '저장했습니다' });
    if (!ok) return;
    if (v.isNew && scoring) {
      if (await confirmBox({ title: '카테고리 추가', message: '문제 관리로 바로 갈까요?', ok: '문제 관리' })) { go({ page: 'questions', gameId: v.gameId, categoryId: f.id }); return; }
    }
    go({ page: 'game', gameId: v.gameId });
  };
  replace(body, h('div.a-section',
    h('h2', v.isNew ? '카테고리 추가' : `카테고리 편집 — ${existing.name}`),
    h('div.a-form',
      h('label', '이름'), h('input.input', { value: f.name, maxlength: 16, oninput: (e) => { f.name = e.target.value; } }),
      h('label', 'id'), v.isNew ? h('input.input', { value: f.id, oninput: (e) => { f.id = e.target.value.trim(); } }) : h('code', f.id),
      h('div.hint', v.isNew ? '영문 소문자 · 숫자 · 하이픈. 추가한 뒤에는 바꿀 수 없습니다 (이미지 폴더 · 문제 id 가 묶임). 무작위 id 를 그대로 써도 됩니다' : '바꿀 수 없습니다'),
      h('label', '아이콘'), h('div', h('div.a-row', iconInput), emojiPicker(f.icon, (e) => { f.icon = e; iconInput.value = e; })),
      h('label', '설명'), h('input.input', { value: f.description ?? '', maxlength: 40, oninput: (e) => { f.description = e.target.value; } }),
      scoring && [h('label', '질문 문구'), h('input.input', { value: f.prompt ?? '', maxlength: 30, placeholder: '예: 이 장면의 명대사는?', oninput: (e) => { f.prompt = e.target.value; } })],
      type === 'photo' && [h('label', '기본 연출'), h('select.input', { onchange: (e) => { f.defaultEffect = e.target.value; } },
        [['none', '원본'], ['zoom', '확대'], ['mask', '가림']].map(([val, l]) => h('option', { value: val, selected: (f.defaultEffect ?? 'none') === val ? true : undefined }, l)))],
      !scoring && [h('label', '규칙 문구'), h('input.input', { value: f.rule ?? '', maxlength: 60, oninput: (e) => { f.rule = e.target.value; } }),
        h('label', '예시'), h('div', examplesInput, exampleChips), h('div.hint', '진행자 참고용 (최대 20개, 각 20자). 게임 화면에는 진행자 [예시 표시] 로 표시')],
      h('label', '숨김'), h('label', h('input', { type: 'checkbox', checked: f.disabled ? true : undefined, onchange: (e) => { f.disabled = e.target.checked; } }), ' 숨기면 게임 홈 · 룰렛에 안 나옴 (데이터는 유지)')),
    err,
    h('div.a-row', h('button.btn', { onclick: () => go({ page: 'game', gameId: v.gameId }) }, '취소'), h('button.btn.primary', { onclick: save }, '저장'))));
}

// ── 문제 목록 (3-5) ───────────────────────────────────
/** 썸네일 — 확대 문제는 확대 지점 점, 가림 문제는 상자 테두리 */
function thumb(q) {
  if (!q.image) return h('span.emoji', { style: { fontSize: '22px' } }, q.emojis ?? '');
  const wrap = h('span.a-thumbwrap', h('img', { src: assetUrl(q.image), loading: 'lazy', alt: '' }));
  if (q.effect === 'zoom') wrap.append(h('span.dot', { style: { left: `${q.focus?.[0] ?? 50}%`, top: `${q.focus?.[1] ?? 50}%` } }));
  if (q.effect === 'mask') for (const [x, y, w, hh] of q.masks ?? []) wrap.append(h('span.mb', { style: { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${hh}%` } }));
  return wrap;
}

/** 문제 목록 연출 열 — 정답 이미지 · 글자 숨기기 · 정답 영상 (R-39 · R-41 · R-61) */
const answerLabel = (q) => (q.answerImage ? (q.hideAnswerText ? ' + 정답 이미지만' : ' + 정답 이미지') : q.hideAnswerText ? ' · 정답 글자 숨김' : '')
  + (q.answerClip ? ' + 🎬 영상' : '');

async function questionsPage(body, v) {
  const g = A.games[v.gameId] ?? await loadGame(v.gameId);
  const d = g.data;
  const cat = d.categories.find((c) => c.id === v.categoryId);
  if (!cat) { go({ page: 'game', gameId: v.gameId }); return; }
  if (d.type === 'roulette') { await chainQuestionsPage(body, v, cat); return; }
  const qpr = d.defaults?.questionsPerRound ?? 5;
  const used = await inUse(v.gameId);
  let search = '';
  const tableBox = h('div');
  const active = () => cat.questions.filter((q) => !q.disabled).length;
  const draw = () => {
    const list = cat.questions.filter((q) => !search || q.answer.includes(search) || q.id.includes(search));
    replace(tableBox, h('table.a-table',
      h('tr', h('th', ''), h('th', '썸네일'), h('th', 'id'), h('th', '정답'), h('th', '연출'), h('th', '힌트 · 메모'), h('th', '상태'), h('th', '')),
      list.map((q) => {
        const i = cat.questions.indexOf(q);
        const effect = d.type === 'photo'
          ? (q.effect === 'zoom' ? `확대 ×${q.zoom} · ${q.steps ?? 3}단계` : q.effect === 'mask' ? (needsSetup(q) ? '가림' : `가림 ${q.masks?.length ?? 0}개`) : '원본') + answerLabel(q)
          : (q.image ? '이미지' : q.reveal === 'sequential' ? '순차' : '-') + answerLabel(q);
        return h(`tr${q.disabled ? '.hidden' : ''}`,
          h('td', h('span.order-btns', h('button', { onclick: () => moveQ(i, -1) }, '▲'), h('button', { onclick: () => moveQ(i, 1) }, '▼'))),
          h('td', thumb(q)), h('td', h('code', q.id)), h('td', h('b', q.answer)), h('td', effect, needsSetup(q) && h('div.warn-badge', '⚠ 설정 필요')),
          h('td', q.hint ? '💡' : '', q.note ? ' 📝' : ''),
          h('td', h('button.btn.small', { onclick: () => toggle(q) }, q.disabled ? '숨김' : '사용')),
          h('td', h('div.a-row', h('button.btn.small', { onclick: () => go({ page: 'qedit', gameId: v.gameId, categoryId: cat.id, questionId: q.id }) }, '편집'),
            h('button.btn.small.danger', { onclick: () => del(q) }, '삭제'))));
      })));
  };
  const moveQ = (i, dd) => {
    if (i + dd < 0 || i + dd >= cat.questions.length) return;
    saveGame(v.gameId, (x) => { const qs = x.categories.find((c) => c.id === cat.id).questions; [qs[i], qs[i + dd]] = [qs[i + dd], qs[i]]; }, { message: '순서를 바꿨습니다' }).then(render);
  };
  const toggle = (q) => saveGame(v.gameId, (x) => { const t = x.categories.find((c) => c.id === cat.id).questions.find((k) => k.id === q.id); t.disabled = !t.disabled; }, { message: q.disabled ? '사용으로 바꿨습니다' : '숨겼습니다' }).then(render);
  const del = async (q) => {
    if (used.questions.has(q.id)) { toast('진행 중인 게임에서 사용 중입니다 — 숨기기만 할 수 있습니다'); return; }
    if (!(await confirmBox({ title: '문제 삭제', message: `'${q.answer}' 문제를 삭제할까요? (이미지 파일은 남겨 둡니다)`, ok: '삭제', danger: true }))) return;
    await saveGame(v.gameId, (x) => { const c = x.categories.find((k) => k.id === cat.id); c.questions = c.questions.filter((k) => k.id !== q.id); }, { message: '삭제했습니다' });
    render();
  };
  const n = active();
  // 릴레이 (R-62) — 한 라운드에 (팀 수 − 1) × 대표 수가 있어야 쓴다. 관리 페이지는 행사 기준 3팀으로 센다
  // 인당 문제 (R-64) 는 최소 수에 곱하지 않는다 — 순위가 다 정해지는 수(full)는 안내만
  const relay = d.type === 'photo' ? (d.defaults?.relay ?? 2) : 0;
  const per = relay > 0 ? (d.defaults?.perRep ?? 1) : 1;
  const need = relay > 0 ? 2 * relay : qpr;
  const full = need * per;
  const rounds = (n / need).toFixed(1);
  const notice = relay > 0
    ? (n < need ? h('div.a-msg.warn', `3팀 × 대표 ${relay}명이면 한 라운드에 ${need}문제가 필요합니다 — 이대로는 이 카테고리를 쓰지 않습니다 (R-62)`)
      : n < full ? h('div.a-msg.info', `인당 ${per}문제면 순위가 다 정해지려면 ${full}문제 — 그 전에 문제가 떨어지면 거기서 라운드가 끝나고 맞힌 수로 등수 (R-64)`)
      : n < full + 2 ? h('div.a-msg.info', `정답자 없는 문제가 나오면 모자랄 수 있습니다 — ${full + 2}개 이상 권장 (R-62)`) : null)
    : n < qpr
      ? h('div.a-msg.warn', `한 라운드 분량이 안 됩니다 — 뽑히면 있는 문제만 출제 (W10)`)
      : n < qpr * 2 ? h('div.a-msg.info', '같은 카테고리가 다시 나오면 문제가 모자랄 수 있습니다 (W10)') : null;
  draw();
  replace(body, h('div.a-section',
    h('h2', `${cat.icon ?? ''} ${cat.name} — 문제`),
    h('div', `문제 ${n}개 (숨김 ${cat.questions.length - n}개 제외) · ${relay > 0 ? `3팀 × 대표 ${relay}명${per > 1 ? ` × 인당 ${per}문제` : ''} 기준 라운드마다 최소 ${need}문제` : `라운드당 ${qpr}문제 기준`} ${rounds}라운드 분량`),
    notice,
    h('div.a-row',
      h('button.btn.primary', { onclick: () => go({ page: 'qedit', gameId: v.gameId, categoryId: cat.id }) }, '+ 문제 추가'),
      d.type === 'photo' && h('button.btn', { onclick: () => go({ page: 'bulk', gameId: v.gameId, categoryId: cat.id }) }, '여러 장 한 번에 추가'),
      d.type === 'emoji' && h('button.btn', { onclick: () => go({ page: 'paste', gameId: v.gameId }) }, '표 붙여넣기'),
      h('input.input', { placeholder: '정답 검색', oninput: (e) => { search = e.target.value.trim(); draw(); } })),
    tableBox));
}

// ── 줄줄이 말해요 문제 목록 (3-5, R-44) — 문제 글자 · 정답 후보 ──
async function chainQuestionsPage(body, v, cat) {
  cat.questions = cat.questions ?? [];
  const used = await inUse(v.gameId);
  let search = '';
  const tableBox = h('div');
  const where = (x) => x.categories.find((c) => c.id === cat.id).questions;
  const draw = () => {
    const list = cat.questions.filter((q) => !search || q.prompt?.includes(search) || q.id.includes(search) || (q.answers ?? []).some((a) => a.includes(search)));
    replace(tableBox, cat.questions.length === 0 ? h('div.small-note', '아직 문제가 없습니다 — 문제 없이도 주제 카드로 진행됩니다') : h('table.a-table',
      h('tr', h('th', ''), h('th', 'id'), h('th', '문제'), h('th', '정답 후보'), h('th', '메모'), h('th', '상태'), h('th', '')),
      list.map((q) => {
        const i = cat.questions.indexOf(q);
        const answers = q.answers ?? [];
        return h(`tr${q.disabled ? '.hidden' : ''}`,
          h('td', h('span.order-btns', h('button', { onclick: () => moveQ(i, -1) }, '▲'), h('button', { onclick: () => moveQ(i, 1) }, '▼'))),
          h('td', h('code', q.id)), h('td', h('b', { style: { fontSize: '20px' } }, q.prompt)),
          h('td', h('b', `${answers.length}개`), h('span.small-note', ` — ${answers.slice(0, 6).join(' · ')}${answers.length > 6 ? ' …' : ''}`)),
          h('td', q.note ? '📝' : ''),
          h('td', h('button.btn.small', { onclick: () => toggle(q) }, q.disabled ? '숨김' : '사용')),
          h('td', h('div.a-row', h('button.btn.small', { onclick: () => go({ page: 'qedit', gameId: v.gameId, categoryId: cat.id, questionId: q.id }) }, '편집'),
            h('button.btn.small.danger', { onclick: () => del(q) }, '삭제'))));
      })));
  };
  const moveQ = (i, dd) => {
    if (i + dd < 0 || i + dd >= cat.questions.length) return;
    saveGame(v.gameId, (x) => { const qs = where(x); [qs[i], qs[i + dd]] = [qs[i + dd], qs[i]]; }, { message: '순서를 바꿨습니다' }).then(render);
  };
  const toggle = (q) => saveGame(v.gameId, (x) => { const t = where(x).find((k) => k.id === q.id); t.disabled = !t.disabled; }, { message: q.disabled ? '사용으로 바꿨습니다' : '숨겼습니다' }).then(render);
  const del = async (q) => {
    if (used.questions.has(q.id)) { toast('진행 중인 게임에서 사용 중입니다 — 숨기기만 할 수 있습니다'); return; }
    if (!(await confirmBox({ title: '문제 삭제', message: `'${q.prompt}' 문제를 삭제할까요?`, ok: '삭제', danger: true }))) return;
    await saveGame(v.gameId, (x) => { const c = x.categories.find((k) => k.id === cat.id); c.questions = c.questions.filter((k) => k.id !== q.id); }, { message: '삭제했습니다' });
    render();
  };
  const n = cat.questions.filter((q) => !q.disabled).length;
  draw();
  replace(body, h('div.a-section',
    h('h2', `${cat.icon ?? ''} ${cat.name} — 문제`),
    h('div', `문제 ${n}개 (숨김 ${cat.questions.length - n}개 제외) · 게임 화면엔 문제 글자, 진행자 화면엔 정답 후보 — [다음 문제] 는 진행 기본값의 문제 순서대로, 진행자 화면에서 골라 낼 수도 있습니다. 이 목록 순서 = 작성 순서`),
    h('div.a-row',
      h('button.btn.primary', { onclick: () => go({ page: 'qedit', gameId: v.gameId, categoryId: cat.id }) }, '+ 문제 추가'),
      h('input.input', { placeholder: '문제 · 정답 후보 검색', oninput: (e) => { search = e.target.value.trim(); draw(); } })),
    tableBox));
}

// ── 백업 (5-3) ────────────────────────────────────────
async function backupsPage(body, v) {
  if (!A.appGames.length) await loadAppGames();
  const id = v.gameId ?? A.appGames[0];
  const list = await api.backups(id);
  const roulette = A.games[id]?.data?.type === 'roulette';
  replace(body, h('div.a-section',
    h('h2', '백업 목록'),
    h('div.a-row', A.appGames.map((gid) => h(`button.btn.small${gid === id ? '.primary' : ''}`, { onclick: () => go({ page: 'backups', gameId: gid }) }, A.games[gid]?.data?.title ?? gid))),
    list.length === 0 ? h('div.small-note', '백업이 없습니다 (저장할 때마다 직전 내용을 남깁니다, 게임별 최근 20개)')
      : h('table.a-table', h('tr', h('th', '저장 시각'), h('th', roulette ? '주제' : '카테고리'), h('th', '문제'), h('th', '')),
        list.map((b) => h('tr', h('td', b.savedAt), h('td', b.categories ?? '?'), h('td', b.questions ?? '?'),
          h('td', h('button.btn.small', {
            onclick: async () => {
              if (!(await confirmBox({ title: '백업 복원', message: `${b.savedAt} 시점으로 복원할까요?\n(지금 내용도 먼저 백업하므로 되돌릴 수 있습니다)`, ok: '복원' }))) return;
              try { await api.restore(b.file); await loadGame(id); toast('복원했습니다'); A.saved.add(`data/games/${id}.json`); render(); } catch (e) { toast(e.message); }
            },
          }, '이 시점으로 복원')))))));
}

// ── 전체 검증 ─────────────────────────────────────────
async function checkPage(body) {
  replace(body, h('div.a-section', h('div.small-note', '검사 중…')));
  const res = await api.check();
  replace(body, ...res.games.map((g) => h('div.a-section',
    h('h2', A.games[g.id]?.data?.title ?? g.id, ' ', h('code.small-note', g.id), ' ', g.errors.length ? h('span.err-badge', `✕ 오류 ${g.errors.length}`) : h('span.ok-badge', '✔ 오류 없음'), g.warnings.length ? h('span.warn-badge', ` · 경고 ${g.warnings.length}`) : ''),
    (g.errors.length || g.warnings.length) ? errorList(g.errors, g.warnings) : null,
    g.missingImages.length ? h('div.a-msg.err', `없는 이미지 ${g.missingImages.length}개 (W02): `, g.missingImages.map((m) => `${m.question} → ${m.path}`).join(', ')) : null,
    g.unusedImages.length ? h('div.a-msg.info', `사용 안 하는 이미지 ${g.unusedImages.length}개 (W08 — 자동으로 지우지 않음): `, g.unusedImages.join(', '), ' ',
      h('button.btn.small', { onclick: () => go({ page: 'images' }) }, '🗑 하나씩 보며 정리')) : null)));
}

// ── 점수 입력 (R-25) ──────────────────────────────────
async function scorePage(body) {
  if (!A.appGames.length) await loadAppGames();
  for (const id of A.appGames) if (!A.games[id]) await loadGame(id).catch(() => null);
  const gamesRuntime = Object.fromEntries(A.appGames.filter((id) => A.games[id]?.data).map((id) => [id, { id, game: validateGame(A.games[id].data, { fileId: id }).game }]));
  const sbDefaults = await loadScoreboardDefaults(gamesRuntime);
  const defaults = sbDefaults.rounds ?? [];
  let st = await readState();
  let sbRev = st.scoreboard?.revision ?? null;
  let sb = st.scoreboard?.data ?? emptyState.scoreboard();
  const teams = () => st.settings?.data?.teams ?? [];
  let screen = null;
  let mode = 'input';

  // 저장은 한 번에 하나씩 — 빠르게 여러 칸을 입력해도 리비전이 꼬이지 않게 마지막 값을 이어서 쓴다
  let writing = false;
  let again = false;
  let pending = null; // 저장하는 동안 온 상태 파일 변경 알림 (아래 refresh)
  let saves = 0; // 저장한 횟수 — 다시 읽는 사이에 저장했으면 읽은 것이 옛것이다
  async function flush() {
    if (writing) { again = true; return; }
    writing = true;
    try {
      do {
        again = false;
        saves++;
        try {
          sbRev = (await writeState('scoreboard', sb, sbRev)).revision;
        } catch (e) {
          if (e.status === 409) {
            toast('다른 창에서 바뀐 내용을 불러왔습니다 — 다시 입력하세요');
            sbRev = e.body.revision;
            sb = e.body.data ?? emptyState.scoreboard();
            again = false;
            screen?.update();
          } else toast(e.message);
        }
      } while (again);
    } finally {
      writing = false;
      // 저장하는 동안 온 알림 — 리비전이 이제 내 것과 같으면(내가 저장한 것) 건너뛴다
      const p = pending;
      pending = null;
      if (p?.some((info) => info.name !== 'scoreboard' || info.revision !== sbRev)) refresh();
    }
  }
  const setState = (next) => {
    // 종합 점수 추이 기록 (R-58) — 게임 창과 같은 규칙
    sb = { ...withLog(sb, next, { defaults, teamCount: teams().length, at: localIso() }), version: 1, updatedAt: new Date().toISOString() };
    screen?.update();
    flush();
  };

  const holder = h('div');
  const tabs = h('div.a-row');
  const env = {
    teams,
    rounds: () => (Array.isArray(sb.rounds) ? sb.rounds : defaults),
    defaults: () => defaults,
    errors: () => sbDefaults.errors ?? [],
    state: () => sb,
    setState,
    games: () => Object.values(gamesRuntime).map((g) => ({ id: g.id, title: g.game.title, categories: g.game.categories })),
    toast,
    confirm: (opts) => confirmBox(opts),
    go: (m) => { mode = m; screen.setMode(m); },
    points: () => show('points'),
    gameTitle: (id) => gamesRuntime[id]?.game.title ?? id,
  };
  // 배점표 화면은 게임 창 것을 그대로 — 필요한 것만 게임 창(app)처럼 맞춰 준다
  const pointsApp = {
    rounds: env.rounds,
    teamCount: () => teams().length,
    get scoreboard() { return sb; },
    data: { scoreboard: { rounds: defaults, errors: sbDefaults.errors ?? [] } },
    setScoreboard: setState,
    confirm: env.confirm,
    go: () => show('board'),
  };
  let kind = 'board';
  function show(k) {
    kind = k;
    screen?.destroy?.();
    if (k === 'points') screen = createPointsTable(pointsApp);
    else { mode = 'input'; screen = createScoreboardScreen(env, mode); }
    replace(holder, screen.el);
    replace(tabs, [['board', '🏆 종합 점수판'], ['points', '🏅 배점표']].map(([key, label]) => h(`button.btn.small${key === kind ? '.primary' : ''}`, { onclick: () => show(key) }, label)));
  }
  show('board');
  replace(body, h('div.a-msg.info', '게임 창의 종합 점수판 · 배점표와 같은 데이터입니다. 여기서 입력하면 게임 창에도 바로 반영됩니다.'), tabs, holder);
  const onKey = (e) => {
    if (document.querySelector('.overlay')) return;
    if (isTypingTarget(e.target)) { screen.onInputKey?.(e); return; }
    if (screen.onKey(e)) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  // 다른 창(게임 창)이 바꾼 것 따라가기 — 점수판 · 팀 설정이 바뀌었다는 알림이 올 때만 다시 읽는다 (R-55 —
  // 3초마다 다시 읽으면 Upstash 시간당 약 9,600 명령). 내가 저장하는 중에 온 알림은 저장이 끝난 뒤에 본다
  async function refresh() {
    try {
      const at = saves;
      const s2 = await readState();
      if (writing) { (pending ??= []).push({ name: 'resync' }); return; }
      if (saves !== at) { refresh(); return; } // 읽는 사이에 저장이 끝남 — 옛 점수판으로 덮어쓰지 않게 다시
      let changed = false;
      if (s2.scoreboard?.revision && s2.scoreboard.revision !== sbRev) { sbRev = s2.scoreboard.revision; sb = s2.scoreboard.data ?? emptyState.scoreboard(); changed = true; }
      if (JSON.stringify(s2.settings?.data?.teams) !== JSON.stringify(teams())) changed = true;
      st = s2;
      if (changed) screen.update();
    } catch { /* 서버 끊김 */ }
  }
  const stopWatch = watchState({
    onChange(info) {
      if (info.name !== 'scoreboard' && info.name !== 'settings') return; // 진행 기록 · 화면 위치는 이 화면과 상관없음
      if (info.name === 'scoreboard' && info.revision === sbRev) return; // 내가 방금 저장한 것
      if (writing) { (pending ??= []).push(info); return; }
      refresh();
    },
    onResync() {
      if (writing) (pending ??= []).push({ name: 'resync' }); else refresh();
    },
  });
  return () => { document.removeEventListener('keydown', onKey); stopWatch(); screen?.destroy?.(); };
}

const isTypingTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

// ── 상태 초기화 (3-10, R-32) ──────────────────────────
async function resetPage(body) {
  if (!A.appGames.length) await loadAppGames();
  for (const id of A.appGames) if (!A.games[id]) await loadGame(id).catch(() => null);
  const st = await readState();
  const T = [
    ['sessions', '진행 기록', 'state/sessions/<게임>.json', '진행 · 완료 기록 없음 — 게임 홈은 [게임 시작]'],
    ['scores', '종합 점수판 입력값', 'state/scoreboard.json 입력값', '모든 칸 빈칸 (배점 · 라운드 설정은 그대로)'],
    ['scoreboardConfig', '배점 · 라운드 설정', 'state/scoreboard.json 변경분', 'data/scoreboard.json 기본값으로'],
    ['teams', '팀 설정', 'state/settings.json 팀', '팀 미설정 (이름 · 색 · 수)'],
    ['gameOptions', '게임 옵션 · 카테고리 제외', 'state/settings.json 게임별', '데이터 기본값, 제외 없음'],
    ['display', '표시 설정', 'state/settings.json 제목 · 부제', 'data/app.json 값'],
    ['route', '마지막 화면 위치', 'state/route.json', '비움'],
  ];
  const sel = new Set();
  const games = new Set(A.appGames);
  const boxes = {};
  const gameBoxes = {};
  // 팀 설정을 고르면 진행 기록 · 점수판 입력값도 함께 — 그때 자동으로 고른 것은 팀 설정을 풀면 같이 푼다
  const LINKED = ['sessions', 'scores'];
  const autoAdded = new Set();
  const toggle = (k, on) => {
    if (on) sel.add(k); else sel.delete(k);
    if (k === 'teams' && on) for (const x of LINKED) if (!sel.has(x)) { sel.add(x); autoAdded.add(x); }
    if (k === 'teams' && !on) { for (const x of autoAdded) sel.delete(x); autoAdded.clear(); }
    sync();
  };
  const sync = () => {
    for (const [k] of T) { boxes[k].checked = sel.has(k); boxes[k].disabled = sel.has('teams') && LINKED.includes(k); }
    for (const id of A.appGames) { gameBoxes[id].checked = sel.has('teams') || games.has(id); gameBoxes[id].disabled = !sel.has('sessions') || sel.has('teams'); }
  };
  const active = Object.entries(st.sessions ?? {})
    .filter(([, v]) => v?.data && !v.data.empty && v.data.status === 'active')
    .map(([id, v]) => ({ id, label: resumeLabel(v.data, { title: A.games[id]?.data?.title ?? id }) }));
  const grid = h('div.reset-grid', T.map(([k, label, file, effect]) => {
    boxes[k] = h('input', { type: 'checkbox', onchange: (e) => toggle(k, e.target.checked) });
    return [h('label', boxes[k], ' ', h('b', label)), h('span.small-note', file), h('span', effect)];
  }));
  const gameRow = h('div.a-row', h('span.small-note', '진행 기록 대상 게임:'), A.appGames.map((id) => {
    gameBoxes[id] = h('input', { type: 'checkbox', checked: true, onchange: (e) => { if (e.target.checked) games.add(id); else games.delete(id); } });
    return h('label', gameBoxes[id], ' ', A.games[id]?.data?.title ?? id);
  }));
  const preset = (keys) => { sel.clear(); autoAdded.clear(); keys.forEach((k) => sel.add(k)); for (const id of A.appGames) games.add(id); sync(); };
  const run = async () => {
    if (!sel.size) { toast('초기화할 항목을 고르세요'); return; }
    const labels = T.filter(([k]) => sel.has(k)).map(([, l]) => `· ${l}`).join('\n');
    const erased = sel.has('sessions') ? active.filter((a) => sel.has('teams') || games.has(a.id)) : [];
    const warn = erased.length ? `\n\n진행 중: ${erased.map((a) => a.label).join(', ')} — 함께 지워집니다` : '';
    if (!(await confirmBox({ title: '상태 초기화', message: `다음을 초기화합니다:\n${labels}${warn}\n\n직전 내용은 state/.backup/ 에 남습니다. 큰 초기화 전에는 [백업 내려받기] 를 먼저 해 두세요.`, ok: '초기화', danger: true }))) return;
    try {
      await api.reset([...sel], sel.has('teams') ? [] : [...games]);
      await dialog({ title: '초기화했습니다', message: '되돌리려면 초기화 전에 받아 둔 백업 파일을 [백업 올리기] 하거나, 저장 폴더의 state/.backup/ 사본을 쓰세요.', buttons: [{ label: '확인', value: true, primary: true }] });
      render();
    } catch (e) { toast(e.message); }
  };
  replace(body, h('div.a-section',
    h('h2', '🧹 현장 상태 초기화 (R-32)'),
    h('div.a-msg.info', '현장 상태 파일(state/)을 깨끗하게 되돌립니다. 서버에서 초기화하면 게임 화면 · 진행자 화면 모두 바로 깨끗한 상태를 봅니다 (R-37).'),
    h('div.a-row', h('button.btn.small', { onclick: () => go({ page: 'archive' }) }, '💾 먼저 백업 내려받기')),
    active.length > 0 && h('div.a-msg.warn', `진행 중인 게임: ${active.map((a) => a.label).join(', ')}`),
    h('div.a-row',
      h('button.btn', { onclick: () => preset(['sessions', 'scores']) }, '리허설 기록 지우기 (진행 기록 + 점수판 입력값)'),
      h('button.btn', { onclick: () => preset(T.map(([k]) => k)) }, '전부 초기화')),
    grid, gameRow,
    h('div.small-note', '팀 설정을 고르면 진행 기록 · 점수판 입력값도 함께 지웁니다 (팀 수가 사라지면 둘 다 쓸 수 없음).'),
    h('div.a-row', h('button.btn.danger.fill', { onclick: run }, '초기화'))));
  sync();
}

// ── 시작 ─────────────────────────────────────────────
async function boot() {
  A.server = (await getSession()).server;
  setServerMode(A.server);
  if (!pinStore.get()) { pinScreen(); return; }
  const problem = await verifyPin(pinStore.get());
  if (problem) { pinStore.clear(); pinScreen(problem === 'PIN 이 맞지 않습니다' ? '' : problem); return; }
  startHeartbeat();
  await loadAssetUrls(); // 썸네일 · 미리보기를 Blob 주소로 바로 (R-70)
  render();
}
boot();

export { ApiError };
