// 현장 상태 파일 API — state/*.json (docs/08-tech.md 4-3 · 4-6-1 · 6장, R-28). 저장소(파일 · Redis)를 거친다
import { serializeState } from '../app/core/serialize.js';
import { checkStateFile, SLUG_RE } from '../app/core/validate.js';
import { readText, revisionOf, backupFile } from './files.mjs';
import { HttpError, readJson, sendJson, LIMITS } from './guard.mjs';

const BACKUP_KEEP = 30;
const BACKED_UP = new Set(['settings', 'scoreboard']); // 진행 기록은 자주 바뀌고 안에 이력이 있어 평소엔 백업 안 함

/** 상태 파일 위치 (저장 폴더 기준) */
export function statePath(name) {
  if (name.startsWith('session:')) return `state/sessions/${name.slice(8)}.json`;
  return `state/${name}.json`;
}
const kindOf = (name) => (name.startsWith('session:') ? 'session' : name);

export async function readState(store, name) {
  const text = await readText(store, statePath(name));
  if (text === null) return null;
  try {
    return { revision: revisionOf(text), data: JSON.parse(text) };
  } catch {
    return { revision: revisionOf(text), data: null, broken: true };
  }
}

export async function readAllState(store) {
  const out = { settings: null, route: null, scoreboard: null, sessions: {} };
  for (const name of ['settings', 'route', 'scoreboard']) out[name] = await readState(store, name);
  for (const e of await store.readdir('state/sessions')) {
    const m = !e.dir && /^([a-z0-9-]+)\.json$/.exec(e.name);
    if (!m) continue;
    out.sessions[m[1]] = await readState(store, `session:${m[1]}`);
  }
  return out;
}

/**
 * 상태 파일 쓰기 — 리비전 비교 · 형식 검사 · 백업 · 원자적 쓰기.
 * @param ifMatch 마지막으로 받은 리비전, 처음 만들 때는 '*', 무조건 덮어쓰기는 null (서버 내부 · 초기화)
 * @returns {{revision:string, changed:boolean}}
 */
export function writeState(ctx, name, data, ifMatch, { backup = BACKED_UP.has(kindOf(name)) } = {}) {
  const { store } = ctx;
  return store.lock(`state:${name}`, async () => {
    const kind = kindOf(name);
    const problem = checkStateFile(kind, data, { gameId: kind === 'session' ? name.slice(8) : undefined });
    if (problem) throw new HttpError(422, `상태 파일 형식 오류: ${problem}`);
    const path = statePath(name);
    const currentText = await readText(store, path);
    const currentRev = currentText === null ? null : revisionOf(currentText);
    if (ifMatch !== null) {
      const ok = ifMatch === '*' ? currentText === null : ifMatch === currentRev;
      if (!ok) {
        let current = null;
        try { current = currentText === null ? null : JSON.parse(currentText); } catch { /* 깨진 파일 */ }
        throw new HttpError(409, '다른 창에서 바뀌었습니다', { revision: currentRev, data: current });
      }
    }
    const text = serializeState(kind, data);
    if (Buffer.byteLength(text) > LIMITS.state) throw new HttpError(413, '상태 파일이 너무 큽니다');
    if (text === currentText) return { revision: currentRev, changed: false };
    if (backup && currentText !== null) {
      const base = kind === 'session' ? `session-${name.slice(8)}` : name;
      await backupFile(store, path, 'state/.backup', base, BACKUP_KEEP);
    }
    await store.writeFile(path, text);
    const revision = revisionOf(text);
    ctx.broadcastReload?.({ kind: 'state', name, revision });
    return { revision, changed: true };
  });
}

export async function handleState(req, res, ctx, pathname) {
  if (pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, await readAllState(ctx.store));
    return true;
  }
  const m = /^\/api\/state\/(settings|route|scoreboard|sessions\/([a-z0-9-]+))$/.exec(pathname);
  if (!m) return false;
  if (req.method !== 'PUT') throw new HttpError(405, '허용되지 않은 요청입니다');
  const name = m[2] ? `session:${m[2]}` : m[1];
  if (m[2] && !SLUG_RE.test(m[2])) throw new HttpError(400, '게임 id 형식이 올바르지 않습니다');
  const body = await readJson(req, LIMITS.state + 4096);
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) throw new HttpError(428, 'If-Match 헤더가 필요합니다');
  if (!body || typeof body !== 'object' || !('data' in body)) throw new HttpError(400, '본문에 data 가 없습니다');
  const result = await writeState(ctx, name, body.data, ifMatch);
  sendJson(res, 200, { revision: result.revision });
  return true;
}
