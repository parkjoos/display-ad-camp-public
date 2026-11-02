// 상태 저장소(app/core/store.js) — 파일이 원본 · 브라우저 사본 · 서버가 꺼졌을 때 (docs/08-tech.md 6장, K-3-4 · K-3-5)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../app/core/store.js';

// ── 가짜 브라우저 저장소 · 가짜 서버 ─────────────────────
class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

let server; // { up, files: Map<name, {revision, data}>, n }
function fakeServer() {
  server = { up: true, files: new Map(), n: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    if (!server.up) throw new TypeError('fetch failed');
    const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    if (url === '/api/state') {
      const out = { settings: null, route: null, scoreboard: null, sessions: {} };
      for (const [name, e] of server.files) {
        if (name.startsWith('session:')) out.sessions[name.slice(8)] = e; else out[name] = e;
      }
      return reply(200, out);
    }
    const m = /^\/api\/state\/(?:sessions\/(.+)|(.+))$/.exec(url);
    const name = m[1] ? `session:${m[1]}` : m[2];
    const ifMatch = opts.headers['If-Match'];
    const cur = server.files.get(name);
    const ok = ifMatch === '*' ? !cur : cur?.revision === ifMatch;
    if (!ok) return reply(409, { error: '다른 창에서 바뀌었습니다', revision: cur?.revision ?? null, data: cur?.data ?? null });
    const revision = `r${++server.n}`;
    server.files.set(name, { revision, data: JSON.parse(opts.body).data });
    return reply(200, { revision });
  };
}

const at = (min) => `2026-10-29T15:${String(min).padStart(2, '0')}:00+09:00`;
const session = (q, min) => ({ version: 1, gameId: 'photo-quiz', type: 'photo', status: 'active', questionIndex: q, updatedAt: at(min) });
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  fakeServer();
});

test('서버 없이 연 창의 진행 기록 — 서버가 돌아오면 파일보다 최신인 사본을 올린다 (K-3-4)', async () => {
  server.files.set('session:photo-quiz', { revision: 'r0', data: session(0, 0) });
  localStorage.setItem('camp-game:session:v1:photo-quiz', JSON.stringify(session(0, 0)));
  server.up = false;
  const store = createStore();
  await store.init(['photo-quiz']); // 서버 없이 시작 → 리비전 모름
  assert.equal(store.status().online, false);
  store.set('session:photo-quiz', session(3, 9)); // 서버가 꺼진 동안 3문제 진행
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(store.status().pending, 1);
  server.up = true;
  await store.reconnect();
  await settle();
  assert.equal(server.files.get('session:photo-quiz').data.questionIndex, 3, '파일에 오프라인 진행분이 올라감');
  assert.equal(store.status().pending, 0);
  assert.equal(store.get('session:photo-quiz').questionIndex, 3);
});

test('서버 없이 연 창 — 재연결 전에 재시도가 먼저 가도 409 뒤 다시 올린다', async () => {
  server.files.set('session:photo-quiz', { revision: 'r0', data: session(0, 0) });
  server.up = false;
  const store = createStore();
  await store.init(['photo-quiz']);
  store.set('session:photo-quiz', session(2, 5));
  await new Promise((r) => setTimeout(r, 350));
  server.up = true;
  await store.flushAll(); // '*' 로 보냄 → 409 → 사본이 최신이라 지금 리비전으로 다시
  await settle();
  assert.equal(server.files.get('session:photo-quiz').data.questionIndex, 2);
  assert.equal(store.status().pending, 0);
});

test('서버 없이 연 창의 사본보다 파일이 최신이면 (그 사이 상태 초기화 등) 파일을 따른다', async () => {
  server.files.set('session:photo-quiz', { revision: 'r0', data: session(0, 0) });
  server.up = false;
  const remote = [];
  const store2 = createStore({ onRemote: (name, data, why) => remote.push([name, why]) });
  await store2.init(['photo-quiz']);
  store2.set('session:photo-quiz', session(1, 3));
  await new Promise((r) => setTimeout(r, 350));
  // 관리 페이지에서 15:20 에 초기화
  server.files.set('session:photo-quiz', { revision: 'r9', data: { version: 1, gameId: 'photo-quiz', empty: true, updatedAt: at(20) } });
  server.up = true;
  await store2.reconnect();
  await settle();
  assert.equal(server.files.get('session:photo-quiz').data.empty, true, '초기화가 그대로');
  assert.equal(store2.get('session:photo-quiz').empty, true);
  assert.equal(store2.status().pending, 0);
  assert.ok(remote.some(([n, why]) => n === 'session:photo-quiz' && why === 'conflict'));
});

test('게임 창 두 개 — 늦게 쓴 창이 409 를 받으면 파일을 불러온다 (K-3-5)', async () => {
  server.files.set('session:photo-quiz', { revision: 'r0', data: session(0, 0) });
  const seen = [];
  const a = createStore();
  const b = createStore({ onRemote: (name, data, why) => seen.push(why) });
  await a.init(['photo-quiz']);
  await b.init(['photo-quiz']);
  a.set('session:photo-quiz', session(1, 1));
  await new Promise((r) => setTimeout(r, 350));
  b.set('session:photo-quiz', session(5, 2)); // B 가 더 늦게 · 더 최신 시각으로 썼지만 리비전이 낡음
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(server.files.get('session:photo-quiz').data.questionIndex, 1, '먼저 쓴 창의 내용이 남음');
  assert.equal(b.get('session:photo-quiz').questionIndex, 1, 'B 는 파일을 불러옴');
  assert.deepEqual(seen, ['conflict']);
});

test('브라우저 저장소가 막힌 창 (사생활 보호) — 파일 저장으로 그대로 진행, 경고 조건 아님 (K-3)', async () => {
  // 가장 엄격한 경우: localStorage 를 읽기만 해도 오류
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  try {
    server.files.set('session:photo-quiz', { revision: 'r0', data: session(0, 0) });
    const store = createStore();
    await store.init(['photo-quiz']);
    store.set('session:photo-quiz', session(2, 4));
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(server.files.get('session:photo-quiz').data.questionIndex, 2, '파일에 저장됨');
    assert.equal(store.get('session:photo-quiz').questionIndex, 2);
    const st = store.status();
    assert.equal(st.localOk, false);
    assert.equal(st.online, true, '서버가 켜져 있으면 "저장 불가" 경고 조건이 아님');
    assert.equal(st.pending, 0);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), writable: true, configurable: true });
  }
});

test('앱 시작 — 서버가 꺼진 동안 쌓인 대기분이 최신이면 올리고, 아니면 파일이 이긴다 (6-1)', async () => {
  server.files.set('session:photo-quiz', { revision: 'r0', data: session(0, 0) });
  server.files.set('settings', { revision: 'r1', data: { version: 1, teams: [], updatedAt: at(30) } });
  localStorage.setItem('camp-game:session:v1:photo-quiz', JSON.stringify(session(4, 10)));
  localStorage.setItem('camp-game:settings:v1', JSON.stringify({ version: 1, teams: [{ name: '옛 팀', color: '#000' }], updatedAt: at(5) }));
  localStorage.setItem('camp-game:pending:v1', JSON.stringify(['session:photo-quiz', 'settings']));
  const store = createStore();
  await store.init(['photo-quiz']);
  await settle();
  assert.equal(server.files.get('session:photo-quiz').data.questionIndex, 4);
  assert.deepEqual(store.get('settings').teams, []);
  assert.equal(store.status().pending, 0);
});
