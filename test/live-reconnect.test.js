// 실행 시간 상한 대응 — 서버가 먼저 끊고 다시 붙기 · 끊긴 사이의 명령 (R-51 · DEP-17, docs/08-tech.md 11-4, 11-acceptance-tests X-45)
// 서버 하나(메모리). 서버 여러 개(Redis)는 redis.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/app.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const ORIGIN = 'https://camp.test';
const HOST = 'camp.test';
const STREAM_MAX_MS = 400;
let app, dataDir, cookie;

before(async () => {
  dataDir = join(await mkdtemp(join(tmpdir(), 'camp-reconnect-')), 'data');
  app = await createAppServer({ root: ROOT, dataRoot: dataDir, port: 0, pin: PIN, publicOrigin: ORIGIN, streamMaxMs: STREAM_MAX_MS, log: () => {} });
  cookie = String((await req('/api/login', { method: 'POST', body: { pin: PIN } })).headers['set-cookie'][0]).split(';')[0];
});
after(async () => {
  await app.close();
  await rm(dirname(dataDir), { recursive: true, force: true });
});

function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: app.ctx.port, path, method, headers: { Host: HOST, 'X-Camp-App': '1', Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 비어 있음 */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

/** SSE — 알림 번호(id) · 연결이 서버 쪽에서 닫혔는지도 본다 */
function sse(path, headers = {}) {
  const queue = [];
  let wake;
  let buf = '';
  let lastId = 0;
  let endResolve;
  const ended = new Promise((r) => { endResolve = r; });
  const r = http.request({ host: '127.0.0.1', port: app.ctx.port, path, headers: { Host: HOST, Cookie: cookie, ...headers } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const id = /^id: (\d+)$/m.exec(block)?.[1];
        if (id != null) lastId = Number(id);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (ev) { queue.push({ event: ev, id: id != null ? Number(id) : null, data: data ? JSON.parse(data) : null }); wake?.(); }
      }
    });
    res.on('end', () => endResolve());
  });
  r.on('error', () => endResolve());
  r.end();
  return {
    get lastId() { return lastId; },
    ended,
    async next(event, timeout = 3000) {
      const t0 = Date.now();
      for (;;) {
        const idx = queue.findIndex((e) => e.event === event);
        if (idx >= 0) return queue.splice(idx, 1)[0];
        if (Date.now() - t0 > timeout) throw new Error(`${event} 이벤트가 오지 않음`);
        await new Promise((res) => { wake = res; setTimeout(res, 30); });
      }
    },
    has: (event) => queue.some((e) => e.event === event),
    close: () => r.destroy(),
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const live = (clientId) => ({ v: 1, clientId, seq: 7, view: 'play', gameId: 'photo-quiz', type: 'photo', screen: 'title', teams: [] });

test('서버가 먼저 끊고 다시 붙기 — 연결 표시 그대로, 끊긴 사이의 명령은 다시 보냄, 넘겨받았으면 닫힘 (X-45)', async (t) => {
  const game = sse('/api/live/commands?clientId=mem-rc-0001');
  t.after(() => game.close());
  await game.next('hello');
  assert.deepEqual((await game.next('hosts')).data, { count: 0 });
  const host = sse('/api/host/stream?id=tab-mem-0001');
  t.after(() => host.close());
  await host.next('state');
  assert.deepEqual((await game.next('hosts')).data, { count: 1 });
  assert.equal((await req('/api/live', { method: 'POST', body: live('mem-rc-0001') })).status, 204);
  const c0 = await req('/api/host/command', { method: 'POST', body: { id: 'c0', cmd: 'question.hint', basedOn: 7 } });
  assert.equal(c0.status, 202);
  const first = await game.next('command');
  assert.equal(first.data.id, 'c0');
  assert.ok(first.id > 0, '명령에 알림 번호(SSE id)');

  // 실행 시간 상한 — 서버가 'bye' 를 보내고 닫는다
  await game.next('bye', STREAM_MAX_MS + 1000);
  await host.next('bye', 1000);
  await game.ended;
  await host.ended;
  assert.ok(!game.has('kick'));

  // 끊긴 사이 — 게임 화면은 아직 연결된 것으로, 진행자 명령은 받는다
  const st = await req('/api/host/state');
  assert.equal(st.json.connected, true, '서버가 먼저 끊은 창은 연결 표시를 지우지 않음');
  assert.equal((await req('/api/host/command', { method: 'POST', body: { id: 'c1', cmd: 'question.hint', basedOn: 7 } })).status, 202);

  // 다시 붙기 — 진행자 화면은 같은 탭 id, 게임 화면은 Last-Event-ID
  const host2 = sse('/api/host/stream?id=tab-mem-0001');
  t.after(() => host2.close());
  await host2.next('state');
  const game2 = sse('/api/live/commands?clientId=mem-rc-0001', { 'Last-Event-ID': String(game.lastId) });
  t.after(() => game2.close());
  await game2.next('hello');
  assert.deepEqual((await game2.next('hosts')).data, { count: 1 }, '진행자 수가 0 이나 2 로 바뀌지 않음');
  const missed = await game2.next('command');
  assert.equal(missed.data.id, 'c1', '끊긴 사이의 명령');
  assert.ok(missed.id > game.lastId);
  await wait(50);
  assert.ok(!game2.has('command'), '이미 받은 c0 은 번호가 앞이라 다시 보내지 않음 (같은 서버)');

  // 끊긴 사이 다른 창이 넘겨받음 → 다시 붙으면 닫힘
  await game2.next('bye', STREAM_MAX_MS + 1000);
  await game2.ended;
  assert.equal((await req('/api/live/takeover', { method: 'POST', body: { clientId: 'mem-rc-0002' } })).status, 204);
  const game3 = sse('/api/live/commands?clientId=mem-rc-0001', { 'Last-Event-ID': String(game2.lastId) });
  t.after(() => game3.close());
  await game3.next('kick');
  await game3.ended;
  assert.ok(!game3.has('hello'), '넘겨받은 뒤에는 붙지 않음');
});

test('?last= 로 새로 연 연결도 끊긴 사이의 명령을 받는다 · 15초보다 오래된 것은 버림 (X-45)', async (t) => {
  const game = sse('/api/live/commands?clientId=mem-rc-0101');
  t.after(() => game.close());
  await game.next('hello');
  assert.equal((await req('/api/live', { method: 'POST', body: live('mem-rc-0101') })).status, 204);
  await game.next('bye', STREAM_MAX_MS + 1000);
  await game.ended;
  const last = game.lastId;
  assert.equal((await req('/api/host/command', { method: 'POST', body: { id: 'q1', cmd: 'question.hint', basedOn: 7 } })).status, 202);
  const again = sse(`/api/live/commands?clientId=mem-rc-0101&last=${last}`);
  t.after(() => again.close());
  assert.equal((await again.next('command')).data.id, 'q1');
  again.close();

  // 오래된 알림 — 시계를 16초 앞으로
  const now = Date.now;
  Date.now = () => now() + 16_000;
  t.after(() => { Date.now = now; });
  const late = sse(`/api/live/commands?clientId=mem-rc-0101&last=${last}`);
  t.after(() => late.close());
  await late.next('hello');
  await wait(50);
  assert.ok(!late.has('command'), '15초가 지난 명령은 다시 보내지 않음');
});

test('직접 닫은 연결은 그대로 바로 끊김 처리 (X-45)', async () => {
  const game = sse('/api/live/commands?clientId=mem-rc-0201');
  await game.next('hello');
  const before = (await req('/api/live/peers?clientId=none')).json.others;
  game.close();
  await wait(100);
  assert.equal((await req('/api/live/peers?clientId=none')).json.others, before - 1, '브라우저가 닫은 창은 바로 빠짐');
});

test('떠날 때 알리기 — 창을 닫거나 새로고침하면 연결 표시를 바로 지운다 (X-49)', async (t) => {
  const watcher = sse('/api/live/commands?clientId=mem-lv-0002');
  t.after(() => watcher.close());
  await watcher.next('hello');
  const game = sse('/api/live/commands?clientId=mem-lv-0001');
  t.after(() => game.close());
  await game.next('hello');
  const host = sse('/api/host/stream?id=tab-lv-0001');
  t.after(() => host.close());
  await host.next('state');
  const others = async () => (await req('/api/live/peers?clientId=none')).json.others;
  const before = await others();
  assert.equal((await req('/api/live/leave', { method: 'POST', body: { clientId: 'mem-lv-0001' } })).status, 204);
  assert.equal(await others(), before - 1, '닫은 게임 화면이 바로 빠짐');
  await game.ended;
  let hostsBefore = (await watcher.next('hosts')).data.count;
  while (watcher.has('hosts')) hostsBefore = (await watcher.next('hosts')).data.count; // 마지막 값
  assert.equal((await req('/api/live/leave', { method: 'POST', body: { hostId: 'tab-lv-0001' } })).status, 204);
  assert.equal((await watcher.next('hosts')).data.count, hostsBefore - 1, '닫은 진행자 화면이 진행자 수에서 바로 빠짐');
  assert.equal((await req('/api/live/leave', { method: 'POST', body: {} })).status, 400);
  assert.equal((await req('/api/live/leave', { method: 'POST', body: { clientId: 'mem-lv-0002' }, headers: { Cookie: '' } })).status, 401, '로그인 없이는 못 지움');
});


test('상태 파일 변경 알림 — 점수 입력 화면용, 진행자 수 · 게임 화면 수에 안 셈 · 서버가 먼저 끊음 (R-55, X-50)', async (t) => {
  const game = sse('/api/live/commands?clientId=mem-ch-0001');
  t.after(() => game.close());
  await game.next('hello');
  const hosts = (await game.next('hosts')).data.count;
  const others = async () => (await req('/api/live/peers?clientId=none')).json.others;
  const gamesBefore = await others();
  const watch = sse('/api/live/changes');
  t.after(() => watch.close());
  await watch.next('hello');
  assert.equal(await others(), gamesBefore, '게임 화면 수에 안 셈');
  await wait(50);
  assert.ok(!game.has('hosts'), `진행자 수(${hosts})가 바뀌지 않음`);

  const cur = (await req('/api/state')).json;
  const w = await req('/api/state/route', { method: 'PUT', headers: { 'If-Match': cur.route?.revision ?? '*' }, body: { data: { version: 1, route: { view: 'title' } } } });
  assert.equal(w.status, 200);
  assert.deepEqual((await watch.next('reload')).data, { kind: 'state', name: 'route', revision: w.json.revision });
  assert.deepEqual((await game.next('reload')).data, { kind: 'state', name: 'route', revision: w.json.revision }, '게임 화면도 그대로 받음');

  await watch.next('bye', STREAM_MAX_MS + 1000);
  await watch.ended;
  assert.equal((await req('/api/live/changes', { headers: { Cookie: '' } })).status, 401, '로그인 없이는 못 받음');
});
