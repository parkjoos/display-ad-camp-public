// 관리 API 클라이언트 — PIN 은 이 탭의 sessionStorage 에만, 요청마다 X-Admin-Pin 헤더 (docs/04-admin.md 2-1, R-31)
import { serverDownHint } from '../ui/session.js';
import { setAssetUrl } from '../core/assets.js';

const PIN_KEY = 'camp-admin-pin';

// 서버 모드 (R-36) — 안내 문구만 다르다. 페이지가 시작할 때 정한다
let serverMode = false;
export function setServerMode(v) { serverMode = !!v; }

export const pinStore = {
  get() { try { return sessionStorage.getItem(PIN_KEY); } catch { return null; } },
  set(pin) { try { sessionStorage.setItem(PIN_KEY, pin); } catch { /* 사생활 보호 창 */ } memoryPin = pin; },
  clear() { try { sessionStorage.removeItem(PIN_KEY); } catch { /* */ } memoryPin = null; },
};
let memoryPin = pinStore.get();

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `요청 실패 (${status})`);
    this.status = status;
    this.body = body ?? {};
  }
}

let askPin = null; // PIN 이 바뀌었을 때(401) 다시 묻는 함수 — 페이지가 등록

export function onPinNeeded(fn) { askPin = fn; }

/**
 * 관리 API 요청 → 응답 그대로 (백업 파일 내려받기 등). 401 이면 PIN 을 다시 물어 같은 요청을 다시 보낸다.
 */
export async function adminRaw(path, { method = 'GET', headers = {}, body, json } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const h = { 'X-Admin-Pin': memoryPin ?? '', ...headers };
    if (method !== 'GET') { h['X-Camp-App'] = '1'; }
    let payload = body;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(json); }
    let res;
    try {
      res = await fetch(path, { method, headers: h, body: payload, cache: 'no-store' });
    } catch {
      throw new ApiError(0, { error: serverDownHint(serverMode) });
    }
    if (res.status === 401 && askPin) {
      const ok = await askPin(serverMode ? 'PIN 이 바뀌었습니다 — 운영자에게 받은 PIN 을 입력하세요' : 'PIN 이 바뀌었습니다 (서버를 다시 켰을 수 있음) — 터미널의 PIN 을 입력하세요');
      if (ok) continue;
    }
    return res;
  }
  throw new ApiError(401, { error: 'PIN 이 맞지 않습니다' });
}

/**
 * 관리 API 요청 → JSON. 401 이면 PIN 을 다시 물어 같은 요청을 다시 보낸다 (편집 내용은 그대로).
 */
export async function adminFetch(path, opts) {
  const res = await adminRaw(path, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** PIN 확인 (첫 화면) */
export async function verifyPin(pin) {
  let res;
  try {
    res = await fetch('/api/admin/verify', { method: 'POST', headers: { 'X-Admin-Pin': pin, 'X-Camp-App': '1' } });
  } catch {
    return serverDownHint(serverMode);
  }
  if (res.status === 204) { pinStore.set(pin); return null; }
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 429) return body?.error ?? 'PIN 이 맞지 않습니다';
  // 이 앱 서버가 아닌 곳(python http.server 비상 대안 등)이 응답 — PIN 을 확인할 수 없다 (S-15)
  return serverMode ? serverDownHint(true) : '게임 서버가 켜져 있지 않습니다 — start.command 로 서버를 켜세요';
}

export const api = {
  game: (id) => adminFetch(`/api/admin/games/${id}`),
  saveGame: (id, data, revision) => adminFetch(`/api/admin/games/${id}`, { method: 'PUT', headers: { 'If-Match': revision }, json: { data } }),
  // 올린 이미지의 Blob 주소를 주소 표에 바로 (R-70 — 미리보기 · 문제 목록이 Blob 에서 바로)
  upload: async (gameId, categoryId, fileName, blob) => {
    const r = await adminFetch(`/api/admin/assets/${gameId}/${categoryId}/${fileName}`, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
    setAssetUrl(r.path, r.url);
    return r;
  },
  backups: (id) => adminFetch(`/api/admin/backups?game=${id}`),
  restore: (file) => adminFetch(`/api/admin/backups/${encodeURIComponent(file)}/restore`, { method: 'POST' }),
  check: () => adminFetch('/api/admin/check'),
  // 쓰지 않는 이미지 정리 (R-68) — 지우기는 문제가 쓰지 않는 이미지만 (서버가 다시 확인)
  unusedImages: () => adminFetch('/api/admin/images/unused'),
  deleteImage: (path) => adminFetch(`/api/admin/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }),
  reset: (targets, games) => adminFetch('/api/admin/state/reset', { method: 'POST', json: { targets, games } }),
  // 공개 모드 /play (R-96)
  publicMode: () => adminFetch('/api/admin/public'),
  setPublicMode: (on) => adminFetch('/api/admin/public', { method: 'PUT', json: { on } }),
  // 백업 내려받기 · 올리기 (R-37, docs/04-admin.md 3-11)
  archive: () => adminRaw('/api/admin/archive'),
  uploadArchive: (file, parts) => adminFetch(`/api/admin/archive?parts=${parts.join(',')}`, { method: 'POST', headers: { 'Content-Type': 'application/x-tar' }, body: file }),
  // 나눠 올리기 (R-51 · DEP-18) — 시작(목록 · JSON) → 이미지 조각 → 끝
  archiveBegin: (body) => adminFetch('/api/admin/archive/begin', { method: 'POST', json: body }),
  archivePart: (id, path, offset, bytes) => adminFetch(`/api/admin/archive/upload/${id}?path=${encodeURIComponent(path)}&offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }),
  archiveFinish: (id) => adminFetch(`/api/admin/archive/upload/${id}/finish`, { method: 'POST' }),
  autoBackups: () => adminFetch('/api/admin/archive/auto'),
  autoBackup: (file) => adminRaw(`/api/admin/archive/auto/${encodeURIComponent(file)}`),
};

// 상태 API (PIN 없이) — 점수 입력용
export async function readState() {
  const res = await fetch('/api/state', { cache: 'no-store' });
  if (!res.ok) throw new ApiError(res.status, null);
  return res.json();
}
export async function writeState(name, data, revision) {
  const res = await fetch(`/api/state/${name}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1', 'If-Match': revision ?? '*' },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

/**
 * 상태 파일이 바뀌면 알림 — 점수 입력 화면이 게임 창에서 바꾼 값을 따라간다 (R-55, docs/08-tech.md 4-4).
 * onChange({ name, revision }), 끊겼다 다시 붙으면 onResync() — 그 사이 놓친 것을 한 번 다시 읽게. 닫는 함수를 돌려준다
 */
export function watchState({ onChange, onResync }) {
  let es = null;
  let opened = false;
  let byeAt = 0;
  let closed = false;
  let retry = null;
  function connect() {
    if (closed) return;
    es?.close();
    es = new EventSource('/api/live/changes');
    es.addEventListener('hello', () => {
      // 서버가 실행 시간 상한 전에 먼저 끊고(Vercel 270초) 곧바로 다시 붙은 것이면 놓친 것이 없다
      if (opened && Date.now() - byeAt > 5000) onResync();
      opened = true;
    });
    es.addEventListener('bye', () => { byeAt = Date.now(); });
    es.addEventListener('reload', (ev) => {
      let info;
      try { info = JSON.parse(ev.data); } catch { return; }
      onChange(info);
    });
    es.onerror = () => {
      // 네트워크 끊김은 브라우저가 다시 붙지만, 오류 응답으로 닫히면 직접
      if (!closed && es.readyState === 2) { clearTimeout(retry); retry = setTimeout(connect, 3000); }
    };
  }
  connect();
  return () => { closed = true; clearTimeout(retry); es?.close(); };
}
