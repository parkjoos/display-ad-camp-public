// 현장 상태 저장 — 파일이 원본, 브라우저는 임시 사본 (docs/08-tech.md 6장, R-28)
// 이름: 'settings' | 'route' | 'scoreboard' | 'session:<게임 id>'

const LS = {
  settings: 'camp-game:settings:v1',
  route: 'camp-game:route:v1',
  scoreboard: 'camp-game:scoreboard:v1',
  session: (id) => `camp-game:session:v1:${id}`,
  pending: 'camp-game:pending:v1',
};
const lsKey = (name) => (name.startsWith('session:') ? LS.session(name.slice(8)) : LS[name]);
const apiPath = (name) => (name.startsWith('session:') ? `/api/state/sessions/${name.slice(8)}` : `/api/state/${name}`);

const DEBOUNCE_MS = 300;
const RETRY_MS = 5000;

function lsGet(key) {
  try { const t = localStorage.getItem(key); return t === null ? null : JSON.parse(t); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

const stamp = (data) => (data && typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) || 0 : 0);

/**
 * @param {{onRemote:(name:string, data:any, why:'conflict'|'reload')=>void, onStatus:(status)=>void, headers?:object}} opts
 */
export function createStore({ onRemote = () => {}, onStatus = () => {} } = {}) {
  const files = new Map(); // name → { revision, data }
  const timers = new Map();
  const inflight = new Map(); // name → Promise
  const deferredReload = new Map();
  let pending = new Set(lsGet(LS.pending) ?? []);
  let online = true;
  let localOk = lsSet('camp-game:probe', 1);
  let retryTimer = null;
  const notes = [];

  const savePending = () => { lsSet(LS.pending, [...pending]); emitStatus(); };
  const emitStatus = () => onStatus({ online, pending: pending.size, localOk });

  /**
   * 파일과 엇갈렸을 때 이 창의 사본이 이기는가.
   * 서버 없이 연 뒤(파일 리비전을 모름) 쌓인 못 올린 변경이 파일보다 최신이면 사본을 올린다 — 서버가 꺼진 동안 진행한 내용
   * (docs/08-tech.md 6-1 과 같은 규칙). 리비전을 알고 있던 변경이 엇갈렸으면 다른 창이 먼저 쓴 것이므로 파일을 따른다 (K-3-5).
   */
  function offlineCopyWins(name, remoteData) {
    const e = files.get(name);
    return pending.has(name) && e?.revision == null && e?.data != null && stamp(e.data) > stamp(remoteData);
  }

  async function fetchAll() {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`state ${res.status}`);
    return res.json();
  }

  function remoteEntry(all, name) {
    if (name.startsWith('session:')) return all.sessions?.[name.slice(8)] ?? null;
    return all[name] ?? null;
  }

  /** 앱 시작 — 파일을 읽고 브라우저 사본과 맞춘다 (docs/08-tech.md 6-1) */
  async function init(gameIds = []) {
    let all = null;
    try { all = await fetchAll(); online = true; } catch { online = false; }
    const names = new Set(['settings', 'route', 'scoreboard', ...gameIds.map((id) => `session:${id}`)]);
    if (all) for (const id of Object.keys(all.sessions ?? {})) names.add(`session:${id}`);
    for (const name of names) {
      const local = lsGet(lsKey(name));
      const remote = all ? remoteEntry(all, name) : null;
      if (!all) {
        // 서버 없음 — 임시 사본으로 진행
        files.set(name, { revision: null, data: local });
        continue;
      }
      if (!remote) {
        files.set(name, { revision: null, data: local });
        if (local) { pending.add(name); notes.push('브라우저에 있던 기록을 파일로 옮겼습니다'); }
        continue;
      }
      if (local && pending.has(name) && stamp(local) > stamp(remote.data)) {
        // 서버가 꺼진 동안 진행한 내용 → 파일로 올린다
        files.set(name, { revision: remote.revision, data: local });
        continue;
      }
      files.set(name, { revision: remote.revision, data: remote.broken ? null : remote.data });
      pending.delete(name);
      lsSet(lsKey(name), remote.data);
    }
    savePending();
    for (const name of pending) schedule(name, 0);
    return { notes: [...new Set(notes)] };
  }

  function get(name) {
    return files.get(name)?.data ?? null;
  }

  /** 바꾸기 — 브라우저 사본에 즉시, 파일에는 300ms 묶어서 */
  function set(name, data) {
    const cur = files.get(name) ?? { revision: null, data: null };
    files.set(name, { ...cur, data });
    localOk = lsSet(lsKey(name), data);
    pending.add(name);
    savePending();
    schedule(name, DEBOUNCE_MS);
  }

  function schedule(name, delay) {
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => flush(name), delay));
  }

  async function flush(name) {
    timers.delete(name);
    if (inflight.has(name)) { await inflight.get(name).catch(() => {}); return flush(name); }
    if (!pending.has(name)) return;
    const entry = files.get(name);
    const p = (async () => {
      const res = await fetch(apiPath(name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1', 'If-Match': entry.revision ?? '*' },
        body: JSON.stringify({ data: entry.data }),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (offlineCopyWins(name, body.data)) {
          files.set(name, { revision: body.revision ?? null, data: files.get(name).data });
          online = true;
          return 'retry';
        }
        // 다른 창이 먼저 썼다 — 파일을 따른다 (K-3-5)
        files.set(name, { revision: body.revision ?? null, data: body.data ?? null });
        lsSet(lsKey(name), body.data ?? null);
        pending.delete(name);
        online = true;
        savePending();
        onRemote(name, body.data ?? null, 'conflict');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(new Error(body.error ?? `저장 실패 ${res.status}`), { status: res.status });
      }
      const { revision } = await res.json();
      const now = files.get(name);
      files.set(name, { ...now, revision });
      if (now.data === entry.data) pending.delete(name);
      online = true;
      savePending();
    })();
    inflight.set(name, p);
    let retry = false;
    try {
      retry = (await p) === 'retry';
    } catch (err) {
      if (err.status === 422 || err.status === 413) {
        // 형식 오류는 다시 보내도 같다 — 사본만 남기고 대기에서 뺀다
        pending.delete(name);
        savePending();
        console.warn(`상태 저장 거절 (${name}): ${err.message}`);
      } else {
        online = false;
        emitStatus();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { for (const n of pending) schedule(n, 0); }, RETRY_MS);
      }
    } finally {
      inflight.delete(name);
      if (retry) schedule(name, 0);
      else if (deferredReload.has(name)) {
        const info = deferredReload.get(name);
        deferredReload.delete(name);
        handleReload(info);
      }
    }
  }

  /** 다른 창 · 관리 페이지가 파일을 바꿨다는 서버 알림 */
  async function handleReload(info) {
    const name = info.name;
    if (inflight.has(name) || timers.has(name)) { deferredReload.set(name, info); return; }
    if (files.get(name)?.revision === info.revision) return;
    try {
      const all = await fetchAll();
      const remote = remoteEntry(all, name);
      if (offlineCopyWins(name, remote?.data)) {
        files.set(name, { revision: remote?.revision ?? null, data: files.get(name).data });
        schedule(name, 0);
        return;
      }
      files.set(name, { revision: remote?.revision ?? null, data: remote?.data ?? null });
      lsSet(lsKey(name), remote?.data ?? null);
      pending.delete(name);
      savePending();
      onRemote(name, remote?.data ?? null, 'reload');
    } catch { /* 다음 알림 때 */ }
  }

  /**
   * 서버가 다시 살아났을 때. 서버 없이 연 창은 파일 리비전을 모르므로 시작할 때와 같은 규칙(6-1)으로 파일과 맞춘 뒤 대기분을 올린다.
   */
  async function reconnect() {
    online = true;
    const unknown = [...files.keys()].filter((n) => files.get(n)?.revision == null);
    if (unknown.length) {
      try {
        const all = await fetchAll();
        for (const name of unknown) {
          const remote = remoteEntry(all, name);
          if (!remote) continue; // 파일이 없으면 대기분이 '*' 로 새로 만든다
          if (offlineCopyWins(name, remote.data)) { files.set(name, { revision: remote.revision, data: files.get(name).data }); continue; }
          if (pending.has(name)) continue; // 파일이 더 최신 — 올리다 409 가 나면 파일을 따른다
          files.set(name, { revision: remote.revision, data: remote.broken ? null : remote.data });
          lsSet(lsKey(name), remote.data);
          onRemote(name, remote.data, 'reload');
        }
      } catch { /* 아직 불안정 — 대기분 재시도가 다시 맞춘다 */ }
    }
    for (const n of pending) schedule(n, 0);
    emitStatus();
  }

  return {
    init, get, set, handleReload, reconnect,
    names: () => [...files.keys()],
    status: () => ({ online, pending: pending.size, localOk }),
    flushAll: () => Promise.all([...pending].map((n) => flush(n))),
  };
}
