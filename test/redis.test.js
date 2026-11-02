// Redis 저장소 · 서버 여러 개 테스트 (R-50, docs/08-tech.md 11-6, 11-acceptance-tests X-32 ~ X-41)
// 로컬 redis-server 를 띄워 쓴다 — 없으면 건너뜀. 앱은 기본 명령만 쓴다 (redis.mjs ALLOWED)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/app.mjs';
import { createRedis, RedisError } from '../server/redis.mjs';
import { createFileStore, createRedisStore, CHUNK } from '../server/store.mjs';
import { UPLOAD_PART } from '../server/archive.mjs';
import { checkStore } from '../server/seed.mjs';
import { serializeGame } from '../app/core/serialize.js';
import { listTar, tarHeader, padding, tarEnd } from '../app/core/tar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REDIS_BIN = spawnSync('which', ['redis-server']).stdout?.toString().trim();
const skip = REDIS_BIN ? false : 'redis-server 가 없어 건너뜀';
const PW = 'test-pass-1234';
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const wrongPin = (n) => String((Number(PIN) + n) % 1e6).padStart(6, '0'); // PIN 에서 n 만큼 떨어진 다른 6자리 — 우연히 맞지 않게
const ORIGIN = 'https://camp.test';
const HOST = 'camp.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PHOTO_GAME = {
  schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진 보고 맞추기',
  categories: [{ id: 'food-zoom', name: '확대 음식', prompt: '이 음식은 무엇일까요?', questions: [{ id: 'food-zoom-k7q2', answer: '샘플 국수', image: 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png' }] }],
};

let redisProc, port, url, codeDir;
const apps = [];
const prefix = () => `t${randomBytes(4).toString('hex')}:`;
/** Redis 저장소는 이미지를 Blob 에만 둔다(R-67 · DEP-27) — 테스트 앱들이 함께 쓰는 가짜 Blob (아래 fakeBlob) */
const sharedBlob = fakeBlob();

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
  });
}

before(async () => {
  if (skip) return;
  port = await freePort();
  url = `redis://127.0.0.1:${port}`;
  redisProc = spawn(REDIS_BIN, ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--requirepass', PW], { stdio: 'ignore' });
  const probe = createRedis({ url, password: PW, retries: 20 });
  await probe.call('PING');
  await probe.close();
  codeDir = await mkdtemp(join(tmpdir(), 'camp-redis-code-'));
  for (const sub of ['app', 'data', 'assets']) await cp(join(ROOT, sub), join(codeDir, sub), { recursive: true });
  for (const f of ['index.html', 'host.html', 'admin.html']) await cp(join(ROOT, f), join(codeDir, f));
  await writeFile(join(codeDir, 'data/games/photo-quiz.json'), serializeGame(PHOTO_GAME));
  await mkdir(join(codeDir, 'assets/photo-quiz/food-zoom'), { recursive: true });
  await writeFile(join(codeDir, 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png'), PNG);
});

after(async () => {
  for (const a of apps) await a.close().catch(() => {});
  redisProc?.kill('SIGKILL');
  if (codeDir) await rm(codeDir, { recursive: true, force: true });
});

async function startApp(pfx, { seed = false, logs = [], streamMaxMs = null, quickCheck = false, blob = sharedBlob } = {}) {
  const app = await createAppServer({ root: codeDir, port: 0, pin: PIN, publicOrigin: ORIGIN, redis: { url, password: PW, prefix: pfx, seed }, blob, streamMaxMs, quickCheck, log: (m) => logs.push(m) });
  apps.push(app);
  return app;
}

/** Host · X-Forwarded-For 를 직접 정하는 요청 */
function req(app, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: app.ctx.port, path, method, headers: { Host: HOST, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch { /* 글자 */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}
const W = (extra = {}) => ({ 'X-Camp-App': '1', Origin: ORIGIN, 'Content-Type': 'application/json', ...extra });
const cookieOf = (res) => String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
const login = (app, headers = {}) => req(app, '/api/login', { method: 'POST', headers: W(headers), body: { pin: PIN } });

/** SSE (Host 헤더를 직접) — 알림 번호(lastId) · 서버 쪽에서 닫혔는지(ended)도 */
function sse(app, path, headers = {}) {
  const queue = [];
  let wake;
  let buf = '';
  let lastId = null;
  let endResolve;
  const ended = new Promise((r) => { endResolve = r; });
  const r = http.request({ host: '127.0.0.1', port: app.ctx.port, path, headers: { Host: HOST, ...headers } }, (res) => {
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
        if (ev) { queue.push({ event: ev, data: data ? JSON.parse(data) : null }); wake?.(); }
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
        if (idx >= 0) return queue.splice(idx, 1)[0].data;
        if (Date.now() - t0 > timeout) throw new Error(`${event} 이벤트가 오지 않음`);
        await new Promise((res) => { wake = res; setTimeout(res, 50); });
      }
    },
    close: () => r.destroy(),
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('RESP 클라이언트 — 바이트 그대로 · NX · 서버 오류 · 쓰지 않는 명령 · 끊기면 다시 붙음 (X-32)', { skip }, async () => {
  const r = createRedis({ url, password: PW });
  try {
    const bytes = randomBytes(1000);
    assert.equal(await r.call('SET', 'k:bin', bytes), 'OK');
    assert.deepEqual(await r.call('GET', 'k:bin'), bytes);
    assert.equal(await r.call('SET', 'k:bin', 'x', 'NX'), null, '있으면 NX 는 안 씀');
    assert.equal(await r.call('GET', 'k:none'), null);
    await r.call('HSET', 'k:hash', 'a', '1');
    await assert.rejects(r.call('GET', 'k:hash'), RedisError, '자료형이 다르면 서버 오류');
    await assert.rejects(r.call('KEYS', '*'), /쓰지 않는 Redis 명령/, '목록에 없는 명령은 쓰지 않는다');
    // 서버가 연결을 끊어도 (저장소 업데이트 · 쉰 연결 정리) 다시 붙어 재시도
    const kill = spawnSync('redis-cli', ['-p', String(port), '-a', PW, '--no-auth-warning', 'CLIENT', 'KILL', 'TYPE', 'normal']);
    assert.equal(kill.status, 0);
    assert.deepEqual(await r.call('GET', 'k:bin'), bytes);
    const bad = createRedis({ url, password: 'wrong', retries: 0 });
    await assert.rejects(bad.call('PING'), /인증 실패/);
    await bad.close();
  } finally {
    await r.close();
  }
});

test('저장소 — 파일 · Redis 가 같게 동작 (쓰기 · 덮어쓰기 · 큰 파일 조각 · 목록 · 지우기 · 없을 때만 쓰기) (X-33)', { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'camp-store-'));
  const redis = createRedis({ url, password: PW });
  try {
    for (const store of [createFileStore(dir), createRedisStore(redis, { prefix: prefix(), blob: fakeBlob() })]) {
      const big = randomBytes(CHUNK * 2 + 123);
      await store.writeFile('data/games/x.json', '{"a":1}');
      assert.equal((await store.readFile('data/games/x.json')).toString(), '{"a":1}', store.kind);
      assert.equal((await store.stat('data/games/x.json')).size, 7);
      await store.writeFile('assets/g/c/big.png', big);
      assert.deepEqual(await store.readFile('assets/g/c/big.png'), big, `${store.kind} 큰 파일`);
      await store.writeFile('assets/g/c/big.png', 'small');
      assert.equal((await store.readFile('assets/g/c/big.png')).toString(), 'small', '큰 파일 → 작은 파일');
      await store.writeFile('assets/g/c/big.png', big);
      assert.deepEqual(await store.readFile('assets/g/c/big.png'), big, '작은 → 큰 파일');
      assert.deepEqual(await store.readdir(''), [{ name: 'assets', dir: true }, { name: 'data', dir: true }]);
      assert.deepEqual(await store.readdir('assets/g/c'), [{ name: 'big.png', dir: false }]);
      assert.equal((await store.stat('assets/g')).dir, true);
      assert.equal((await store.stat('assets/g/c/big.png')).size, big.length, `${store.kind} 큰 파일 크기 (Redis 는 머리말만 — R-68)`);
      assert.equal(await store.stat('assets/g/c/nope.png'), null);
      assert.equal(await store.readFile('nope.json'), null);
      assert.deepEqual(await store.readdir('nope'), []);
      await store.unlink('assets/g/c/big.png');
      assert.equal(await store.readFile('assets/g/c/big.png'), null);
      assert.deepEqual(await store.readdir('assets/g/c'), []);
      // 큰 파일 조각은 이미지가 아닌 파일(백업 tar · 나눠 올리기 조각)에만 — Redis 이미지는 Blob (DEP-27)
      await store.writeFile('data/.backup/big.tar', big);
      assert.deepEqual(await store.readFile('data/.backup/big.tar'), big, `${store.kind} 큰 파일 조각`);
      await store.writeFile('data/.backup/big.tar', 'small');
      assert.equal((await store.readFile('data/.backup/big.tar')).toString(), 'small', '큰 파일 → 작은 파일');
      await store.writeFile('data/.backup/big.tar', big);
      const head = store.kind === 'redis' ? JSON.parse((await redis.call('GET', `${store.prefix}f:data/.backup/big.tar`)).toString()) : null;
      if (head) assert.equal(head.n, 3, '400KB 조각 3개');
      await store.unlink('data/.backup/big.tar');
      assert.equal(await store.readFile('data/.backup/big.tar'), null);
      if (head) assert.equal(await redis.call('EXISTS', ...Array.from({ length: head.n }, (_, i) => `${store.prefix}c:${head.g}:${i}`)), 0, '조각도 지움');
      assert.equal(await store.writeFileIfAbsent('.secret', 'a'), true);
      assert.equal(await store.writeFileIfAbsent('.secret', 'b'), false);
      assert.equal((await store.readFile('.secret')).toString(), 'a');
      await assert.rejects(store.readFile('../x'), /올바르지 않습니다/);
    }
  } finally {
    await redis.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('잠금 — 서버 두 개가 같은 키를 동시에 고쳐도 하나씩 (X-34)', { skip }, async () => {
  const p = prefix();
  const r1 = createRedis({ url, password: PW });
  const r2 = createRedis({ url, password: PW });
  const s1 = createRedisStore(r1, { prefix: p });
  const s2 = createRedisStore(r2, { prefix: p });
  try {
    await s1.writeFile('counter', '0');
    const bump = (s) => s.lock('counter', async () => {
      const n = Number((await s.readFile('counter')).toString());
      await wait(5);
      await s.writeFile('counter', String(n + 1));
    });
    await Promise.all(Array.from({ length: 10 }, (_, i) => bump(i % 2 ? s1 : s2)));
    assert.equal((await s1.readFile('counter')).toString(), '10');
  } finally {
    await r1.close();
    await r2.close();
  }
});

test('빈 저장소는 저절로 채우지 않는다 — CAMP_SEED 없이 켜면 경고만, 데이터 없음 (X-35)', { skip }, async () => {
  const logs = [];
  const app = await startApp(prefix(), { logs });
  assert.ok(logs.some((m) => m.includes('저장소 점검 ✔')));
  assert.ok(logs.some((m) => m.includes('저장소가 비어 있습니다')), logs.join('\n'));
  const cookie = cookieOf(await login(app));
  assert.equal((await req(app, '/data/app.json', { headers: { Cookie: cookie } })).status, 404);
});

test('서버 두 개가 같은 Redis 로 — 데이터 · 쿠키 · 저장 충돌 · 이미지 · 실시간 · 잠금 · 백업 (X-36 ~ X-41)', { skip }, async (t) => {
  const p = prefix();
  const logsA = [];
  const A = await startApp(p, { seed: true, logs: logsA });
  const B = await startApp(p, { seed: true }); // 이미 채워졌으면 다시 넣지 않는다
  assert.ok(logsA.some((m) => m.includes('초기 데이터')), logsA.join('\n'));

  const cookie = cookieOf(await login(A));
  const H = { Cookie: cookie };

  await t.test('같은 데이터 · 한쪽에서 받은 쿠키를 다른 쪽에서도 (X-36)', async () => {
    const a = await req(A, '/data/app.json', { headers: H });
    const b = await req(B, '/data/app.json', { headers: H });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200, '서명 키가 같아 B 에서도 로그인 상태');
    assert.deepEqual(a.buf, b.buf);
  });

  await t.test('게임 데이터 저장 — 다른 서버에서 바로 보임, 같은 리비전으로 동시에 저장하면 하나는 409 (X-37)', async () => {
    const AH = W({ 'X-Admin-Pin': PIN });
    const g = (await req(B, '/api/admin/games/photo-quiz', { headers: AH })).json;
    const data = structuredClone(g.data);
    data.categories[0].questions[0].answer = '서버 A 정답';
    const data2 = structuredClone(g.data);
    data2.categories[0].questions[0].answer = '서버 B 정답';
    const [ra, rb] = await Promise.all([
      req(A, '/api/admin/games/photo-quiz', { method: 'PUT', headers: { ...AH, 'If-Match': g.revision }, body: { data } }),
      req(B, '/api/admin/games/photo-quiz', { method: 'PUT', headers: { ...AH, 'If-Match': g.revision }, body: { data: data2 } }),
    ]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
    const winner = ra.status === 200 ? '서버 A 정답' : '서버 B 정답';
    const seen = (await req(B, '/data/games/photo-quiz.json', { headers: H })).json;
    assert.equal(seen.categories[0].questions[0].answer, winner);
    const backups = (await req(A, '/api/admin/backups?game=photo-quiz', { headers: AH })).json;
    assert.ok(backups.length >= 1, '저장 전 백업');
  });

  await t.test('큰 이미지 — Blob 에 올려 Redis 에는 주소만, 다른 서버에서 302 (X-38 · R-67)', async () => {
    const big = Buffer.concat([PNG, randomBytes(CHUNK + 5000)]);
    const r = await req(A, '/api/admin/assets/photo-quiz/food-zoom/big-a1b2.png', { method: 'PUT', headers: { ...W({ 'X-Admin-Pin': PIN }), 'Content-Type': 'image/png' }, body: big });
    assert.equal(r.status, 200);
    const got = await req(B, '/assets/photo-quiz/food-zoom/big-a1b2.png', { headers: H });
    assert.equal(got.status, 302);
    assert.deepEqual(sharedBlob.objects.get(got.headers.location).bytes, big, 'Blob 에 그대로');
    // HEAD(없는 이미지 확인)는 머리말로 — 크기 · ETag 가 서버가 달라도 같다 (X-46)
    const headA = await req(A, '/assets/photo-quiz/food-zoom/big-a1b2.png', { method: 'HEAD', headers: H });
    const headB = await req(B, '/assets/photo-quiz/food-zoom/big-a1b2.png', { method: 'HEAD', headers: H });
    assert.deepEqual([headB.status, Number(headB.headers['content-length'])], [200, big.length]);
    assert.ok(headB.headers.etag);
    assert.equal(headA.headers.etag, headB.headers.etag);
    const check = (await req(B, '/api/admin/check', { headers: W({ 'X-Admin-Pin': PIN }) })).json;
    assert.ok(check.games.find((x) => x.id === 'photo-quiz').unusedImages.includes('assets/photo-quiz/food-zoom/big-a1b2.png'), '폴더 목록에도 보임');
    // 안 쓰는 이미지 정리 (R-68) — 목록은 A, 지우기는 B, 다시 A 에서 사라짐 (big-a1b2 는 뒤의 백업 테스트가 쓴다)
    const gone = Buffer.concat([PNG, randomBytes(CHUNK + 10)]);
    const goneDeletedBefore = sharedBlob.deleted.length;
    assert.equal((await req(A, '/api/admin/assets/photo-quiz/food-zoom/gone-c3d4.png', { method: 'PUT', headers: { ...W({ 'X-Admin-Pin': PIN }), 'Content-Type': 'image/png' }, body: gone })).status, 200);
    const unused = (await req(A, '/api/admin/images/unused', { headers: W({ 'X-Admin-Pin': PIN }) })).json;
    assert.equal(unused.images.find((x) => x.path === 'assets/photo-quiz/food-zoom/gone-c3d4.png').size, gone.length);
    const del = await req(B, '/api/admin/assets/photo-quiz/food-zoom/gone-c3d4.png', { method: 'DELETE', headers: W({ 'X-Admin-Pin': PIN }) });
    assert.equal(del.status, 200);
    assert.equal((await req(A, '/assets/photo-quiz/food-zoom/gone-c3d4.png', { headers: H })).status, 404);
    assert.equal(sharedBlob.deleted.length, goneDeletedBefore + 1, 'Blob 에서도 지움');
    const after = (await req(A, '/api/admin/images/unused', { headers: W({ 'X-Admin-Pin': PIN }) })).json;
    assert.ok(!after.images.some((x) => x.path.endsWith('gone-c3d4.png')));
    assert.ok(after.images.some((x) => x.path.endsWith('big-a1b2.png')));
  });

  await t.test('게임 화면은 A, 진행자 화면은 B — 상태 · 명령 · reload 가 서버를 건넌다 (X-39)', async () => {
    const game = sse(A, '/api/live/commands?clientId=redis-game-01', H);
    t.after(() => game.close());
    await game.next('hello');
    assert.deepEqual(await game.next('hosts'), { count: 0 }, '연결 직후 — 진행자 화면 없음');
    const host = sse(B, '/api/host/stream', H);
    t.after(() => host.close());
    await host.next('state');
    assert.deepEqual(await game.next('hosts'), { count: 1 }, 'A 의 게임 화면이 B 의 진행자 화면 수를 안다');
    const live = { v: 1, clientId: 'redis-game-01', seq: 3, view: 'play', gameId: 'photo-quiz', type: 'photo', screen: 'question', questionId: 'food-zoom-k7q2', roundIndex: 0, questionIndex: 0, roundQuestionIds: ['food-zoom-k7q2'], picks: [{ categoryId: 'food-zoom', questionIds: ['food-zoom-k7q2'] }], teams: [] };
    assert.equal((await req(A, '/api/live', { method: 'POST', headers: W(H), body: live })).status, 204);
    let st = await host.next('state');
    while (!st.question) st = await host.next('state'); // 연결 직후 상태가 먼저 올 수 있다
    assert.ok(st.connected);
    assert.match(st.question.answer, /정답|국수/);
    const r = await req(B, '/api/host/command', { method: 'POST', headers: W(H), body: { id: 'c1', cmd: 'question.reveal', basedOn: 3 } });
    assert.equal(r.status, 202);
    const cmd = await game.next('command');
    assert.deepEqual([cmd.cmd, cmd.basedOn], ['question.reveal', 3]);
    // B 에서 상태 저장 → A 의 게임 화면에 reload
    const cur = (await req(B, '/api/state', { headers: H })).json;
    const w = await req(B, '/api/state/route', { method: 'PUT', headers: W({ ...H, 'If-Match': cur.route?.revision ?? '*' }), body: { data: { version: 1, route: { view: 'title' } } } });
    assert.equal(w.status, 200);
    assert.deepEqual(await game.next('reload'), { kind: 'state', name: 'route', revision: w.json.revision });
    host.close();
    game.close();
    await wait(300);
  });

  await t.test('게임 화면은 하나만 (R-46) — 다른 서버의 창도 세고, 닫고, 막는다 (X-40)', async () => {
    const peers = async (app, id) => (await req(app, `/api/live/peers?clientId=${id}`, { headers: H })).json;
    const a = sse(A, '/api/live/commands?clientId=redis-gate-a', H);
    await a.next('hello');
    assert.deepEqual(await peers(B, 'redis-gate-b'), { others: 1, locked: false }, 'B 에서도 A 의 창이 보인다');
    assert.equal((await req(B, '/api/live/takeover', { method: 'POST', headers: W(H), body: { clientId: 'redis-gate-b' } })).status, 204);
    await a.next('kick');
    const b = sse(B, '/api/live/commands?clientId=redis-gate-b', H);
    await b.next('hello');
    assert.equal((await req(B, '/api/live/lock', { method: 'POST', headers: W(H), body: { on: true } })).status, 204);
    assert.deepEqual(await b.next('lock'), { on: false });
    assert.deepEqual(await b.next('lock'), { on: true });
    const c = sse(A, '/api/live/commands?clientId=redis-gate-c', H);
    await c.next('blocked');
    assert.equal((await req(A, '/api/live/takeover', { method: 'POST', headers: W(H), body: { clientId: 'redis-gate-c' } })).status, 423);
    b.close();
    await wait(300);
    assert.equal((await peers(A, 'redis-gate-c')).others, 0, '막아 둔 창이 닫히면 다른 서버에서도 바로');
    assert.equal((await req(A, '/api/live/lock', { method: 'POST', headers: W(H), body: { on: false } })).status, 204);
    a.close();
    c.close();
  });

  await t.test('PIN 실패 잠금 · [나가기] 를 서버끼리 같이 (X-41)', async () => {
    const XFF = { 'X-Forwarded-For': '10.7.7.7' };
    const codes = [];
    for (let i = 1; i <= 5; i++) {
      const r = await req(i % 2 ? A : B, '/api/login', { method: 'POST', headers: W(XFF), body: { pin: wrongPin(i + 1) } });
      codes.push(r.status);
    }
    assert.deepEqual(codes, [401, 401, 401, 401, 429], 'A · B 를 오가도 합쳐서 5회');
    assert.equal((await req(B, '/api/login', { method: 'POST', headers: W(XFF), body: { pin: PIN } })).status, 429);
    const c2 = cookieOf(await login(A));
    assert.equal((await req(B, '/api/host/state', { headers: { Cookie: c2 } })).status, 200);
    assert.equal((await req(A, '/api/host/logout', { method: 'POST', headers: W({ Cookie: c2 }) })).status, 204);
    assert.equal((await req(B, '/api/host/state', { headers: { Cookie: c2 } })).status, 401, 'A 에서 나간 쿠키는 B 에서도 안 됨');
  });

  await t.test('백업 내려받기 · 올리기 — Redis 저장소에서도 같게, 자동 백업은 다른 서버에서도 보임 (X-26 · X-36)', async () => {
    const AH = W({ 'X-Admin-Pin': PIN });
    const down = await req(B, '/api/admin/archive', { headers: AH });
    assert.equal(down.status, 200);
    const paths = listTar(down.buf).map((e) => e.path);
    for (const p2 of ['data/app.json', 'data/games/photo-quiz.json', 'assets/photo-quiz/food-zoom/big-a1b2.png']) assert.ok(paths.includes(p2), p2);
    assert.ok(!paths.some((x) => x.includes('.camp-secret') || x.includes('.seeded') || x.includes('.backup')), paths.join(','));
    const g = (await req(A, '/api/admin/games/photo-quiz', { headers: AH })).json;
    const up = structuredClone(g.data);
    up.categories[0].questions[0].answer = '올린 정답';
    const b = Buffer.from(serializeGame(up));
    const tar = Buffer.concat([Buffer.from(tarHeader('data/games/photo-quiz.json', b.length)), b, Buffer.alloc(padding(b.length)), Buffer.from(tarEnd())]);
    const r = await req(A, '/api/admin/archive?parts=data', { method: 'POST', headers: { ...AH, 'Content-Type': 'application/x-tar' }, body: tar });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await req(B, '/data/games/photo-quiz.json', { headers: H })).json.categories[0].questions[0].answer, '올린 정답');
    const auto = (await req(B, '/api/admin/archive/auto', { headers: AH })).json;
    assert.equal(auto[0].file, r.json.autoBackup);
    const autoTar = await req(B, `/api/admin/archive/auto/${auto[0].file}`, { headers: AH });
    const autoPaths = listTar(autoTar.buf).map((e) => e.path);
    assert.ok(autoPaths.includes('data/games/photo-quiz.json'), '자동 백업에 올리기 전 문제');
    assert.ok(!autoPaths.some((x) => x.startsWith('assets/')), '자동 백업은 이미지를 빼고 — 무료 Redis 용량 (R-51)');
  });
});

test('서버가 먼저 끊은 게임 화면이 다른 서버로 다시 붙어도 — 연결 표시 그대로 · 끊긴 사이의 명령 (X-45)', { skip }, async (t) => {
  const p = prefix();
  const A = await startApp(p, { seed: true, streamMaxMs: 500 }); // 실행 시간 상한이 있는 서버 (Vercel)
  const B = await startApp(p);
  const H = { Cookie: cookieOf(await login(A)) };
  const game = sse(A, '/api/live/commands?clientId=redis-rc-0001', H);
  t.after(() => game.close());
  await game.next('hello');
  assert.deepEqual(await game.next('hosts'), { count: 0 });
  const host = sse(A, '/api/host/stream?id=tab-redis-0001', H);
  t.after(() => host.close());
  await host.next('state');
  assert.deepEqual(await game.next('hosts'), { count: 1 });
  const live = { v: 1, clientId: 'redis-rc-0001', seq: 4, view: 'play', gameId: 'photo-quiz', type: 'photo', screen: 'title', teams: [] };
  assert.equal((await req(A, '/api/live', { method: 'POST', headers: W(H), body: live })).status, 204);

  await game.next('bye', 2000);
  await host.next('bye', 2000);
  await game.ended;
  await host.ended;
  assert.ok(game.lastId != null, '받은 알림 번호');
  assert.equal((await req(B, '/api/host/state', { headers: H })).json.connected, true, '끊긴 사이에도 연결된 것으로');
  assert.equal((await req(B, '/api/host/command', { method: 'POST', headers: W(H), body: { id: 'rc1', cmd: 'question.hint', basedOn: 4 } })).status, 202);

  const host2 = sse(B, '/api/host/stream?id=tab-redis-0001', H);
  t.after(() => host2.close());
  await host2.next('state');
  const game2 = sse(B, '/api/live/commands?clientId=redis-rc-0001', { ...H, 'Last-Event-ID': String(game.lastId) });
  t.after(() => game2.close());
  await game2.next('hello');
  assert.deepEqual(await game2.next('hosts'), { count: 1 }, '진행자 수가 그대로');
  const cmd = await game2.next('command');
  assert.deepEqual([cmd.id, cmd.cmd], ['rc1', 'question.hint'], 'A 에서 끊긴 사이 B 가 받은 명령을 B 에 다시 붙은 창이 받음');
  game2.close();
  host2.close();
  await wait(300);
});

test('나눠 올리기를 서버 둘에 나눠 보내도 — 시작은 A, 조각은 B, 끝은 A (X-47)', { skip }, async () => {
  const p = prefix();
  const A = await startApp(p, { seed: true });
  const B = await startApp(p);
  const AH = W({ 'X-Admin-Pin': PIN });
  const big = Buffer.concat([PNG, randomBytes(UPLOAD_PART + 3000)]);
  const path = 'assets/photo-quiz/food-zoom/split-a1b2.png';
  const game = structuredClone(PHOTO_GAME);
  game.categories[0].questions[0].answer = '나눠 올린 정답';
  const begun = await req(A, '/api/admin/archive/begin', { method: 'POST', headers: AH, body: { parts: ['data'], items: [{ path, size: big.length }, { path: 'data/games/photo-quiz.json', size: 1 }], texts: { 'data/games/photo-quiz.json': serializeGame(game) } } });
  assert.equal(begun.status, 200);
  const { id } = begun.json;
  const part = (app, offset, bytes) => req(app, `/api/admin/archive/upload/${id}?path=${encodeURIComponent(path)}&offset=${offset}`, { method: 'PUT', headers: { ...AH, 'Content-Type': 'application/octet-stream' }, body: bytes });
  assert.equal((await part(B, 0, big.subarray(0, UPLOAD_PART))).status, 204);
  assert.equal((await part(A, UPLOAD_PART, big.subarray(UPLOAD_PART))).status, 204, '다른 서버가 받은 앞 조각과 이어 붙임');
  const fin = await req(A, `/api/admin/archive/upload/${id}/finish`, { method: 'POST', headers: AH });
  assert.equal(fin.status, 200);
  assert.equal(fin.json.written, 2);
  const H = { Cookie: cookieOf(await login(B)) };
  const got = await req(B, `/${path}`, { headers: H });
  assert.equal(got.status, 302);
  assert.deepEqual(sharedBlob.objects.get(got.headers.location).bytes, big, '나눠 올린 이미지도 Blob 에');
  assert.equal((await req(B, '/data/games/photo-quiz.json', { headers: H })).json.categories[0].questions[0].answer, '나눠 올린 정답');
});

test('떠날 때 알리기 — 연결이 다른 서버에 열린 채여도 바로 지운다 (Vercel 은 닫힌 연결을 함수가 모름, X-49)', { skip }, async (t) => {
  const p = prefix();
  const A = await startApp(p, { seed: true });
  const B = await startApp(p);
  const H = { Cookie: cookieOf(await login(A)) };
  const watcher = sse(A, '/api/live/commands?clientId=redis-lv-0002', H);
  t.after(() => watcher.close());
  await watcher.next('hello');
  const game = sse(A, '/api/live/commands?clientId=redis-lv-0001', H);
  t.after(() => game.close());
  await game.next('hello');
  const host = sse(A, '/api/host/stream?id=tab-redis-lv-01', H);
  t.after(() => host.close());
  await host.next('state');
  while ((await watcher.next('hosts')).count !== 1); // 연결 직후 0 → 진행자 화면이 붙어 1
  const others = async () => (await req(B, '/api/live/peers?clientId=none', { headers: H })).json.others;
  assert.equal(await others(), 2);
  assert.equal((await req(B, '/api/live/leave', { method: 'POST', headers: W(H), body: { clientId: 'redis-lv-0001', hostId: 'tab-redis-lv-01' } })).status, 204);
  assert.equal(await others(), 1, 'A 에 연결이 열린 채여도 B 에 알리면 바로 빠짐');
  assert.deepEqual(await watcher.next('hosts'), { count: 0 }, '진행자 수도 바로 — 다른 서버의 게임 화면까지');
});

test('서버 여럿이 동시에 켜져도 시작 점검이 서로의 점검 파일을 건드리지 않는다 (Vercel 인스턴스 여럿이 한꺼번에, X-43)', { skip }, async () => {
  const r = createRedis({ url, password: PW });
  const base = createRedisStore(r, { prefix: prefix() });
  // 실제 저장소(도쿄)처럼 호출마다 몇 ms 씩 — 점검 단계들이 서로 엇갈리게
  const jitter = () => new Promise((res) => setTimeout(res, Math.random() * 8));
  const slow = { ...base };
  for (const m of ['writeFile', 'readFile', 'unlink']) slow[m] = async (...a) => { await jitter(); return base[m](...a); };
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => checkStore(slow)));
  await r.close();
  assert.deepEqual(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message), [], '모두 통과');
});

test('상태 파일 변경 알림이 서버를 건넌다 — 점수 입력 화면은 A, 게임 창 저장은 B (R-55, X-50)', { skip }, async (t) => {
  const p = prefix();
  const A = await startApp(p, { seed: true });
  const B = await startApp(p);
  const H = { Cookie: cookieOf(await login(A)) };
  const watch = sse(A, '/api/live/changes', H);
  t.after(() => watch.close());
  await watch.next('hello');
  const w = await req(B, '/api/state/route', { method: 'PUT', headers: W({ ...H, 'If-Match': '*' }), body: { data: { version: 1, route: { view: 'title' } } } });
  assert.equal(w.status, 200);
  assert.deepEqual(await watch.next('reload'), { kind: 'state', name: 'route', revision: w.json.revision });
});

test('Vercel 시작 점검은 짧게 — 명령 2개(PING 빼고), 점검 파일 · 폴더 목록을 만들지 않는다 (R-55, X-51)', { skip }, async () => {
  const r = createRedis({ url, password: PW });
  const calls = [];
  const counted = { ...r, call: (...a) => { calls.push(String(a[0]).toUpperCase()); return r.call(...a); } };
  const store = createRedisStore(counted, { prefix: prefix() });
  const logs = [];
  await checkStore(store, (m) => logs.push(m), { quick: true });
  assert.deepEqual(calls.filter((c) => c !== 'PING'), ['SET', 'GET']);
  assert.match(logs[0], /저장소 점검 ✔ .* · 짧게/);
  assert.deepEqual(await store.readdir(''), [], '점검 파일 · 폴더 목록 없음');
  calls.length = 0;
  await checkStore(store, () => {});
  assert.ok(calls.filter((c) => c !== 'PING').length >= 10, `전부 하면 ${calls.length - 1}개`);
  await r.close();

  const logs2 = [];
  await startApp(prefix(), { seed: true, quickCheck: true, logs: logs2 });
  assert.ok(logs2.some((m) => /저장소 점검 ✔ .* · 짧게/.test(m)), '앱도 짧은 점검으로 켜짐');
});

/** 가짜 Blob — createBlob(server/blob.mjs)과 같은 모양 (put · del · get, R-67) */
function fakeBlob() {
  const objects = new Map();
  const deleted = [];
  return {
    label: '가짜 Blob', objects, deleted,
    async put(pathname, bytes, contentType) {
      const u = `https://blob.test/${pathname.replace(/(\.\w+)$/, `-${randomBytes(4).toString('hex')}$1`)}`;
      objects.set(u, { bytes: Buffer.from(bytes), contentType });
      return u;
    },
    async del(urls) { for (const u of urls) { deleted.push(u); objects.delete(u); } },
    async get(u) { const o = objects.get(u); if (!o) throw new Error(`없는 Blob ${u}`); return o.bytes; },
  };
}

test('이미지 Blob 저장소 — Redis 에는 머리말(주소)만 · 교체하면 새 주소 · 지우기 (R-67, X-55)', { skip }, async (t) => {
  const p = prefix();
  const blob = fakeBlob();
  const r = createRedis({ url, password: PW });
  t.after(() => r.close());
  const store = createRedisStore(r, { prefix: p, blob });
  const big = Buffer.concat([PNG, randomBytes(CHUNK + 1000)]);
  await store.writeFile('assets/g/c/q-a1.png', big);
  const raw = (await r.call('GET', `${p}f:assets/g/c/q-a1.png`)).toString();
  const h1 = JSON.parse(raw);
  assert.equal(raw, `${JSON.stringify(h1)}\n`, '머리말만 — 본문 없음');
  assert.equal(h1.s, big.length);
  assert.equal(h1.g, undefined, '조각 없음');
  assert.match(h1.u, /^https:\/\/blob\.test\/assets\/g\/c\/q-a1-[0-9a-f]{8}\.png$/);
  assert.equal(blob.objects.get(h1.u).contentType, 'image/png');
  assert.deepEqual(await store.readFile('assets/g/c/q-a1.png'), big);
  assert.equal((await store.stat('assets/g/c/q-a1.png')).url, h1.u);
  assert.deepEqual(await store.readdir('assets/g/c'), [{ name: 'q-a1.png', dir: false }], '폴더 목록은 그대로');
  await store.writeFile('assets/g/c/q-a1.png', PNG);
  const h2 = JSON.parse((await r.call('GET', `${p}f:assets/g/c/q-a1.png`)).toString());
  assert.notEqual(h2.u, h1.u, '교체하면 새 주소 (캐시가 옛 사진을 보여 주지 않게)');
  assert.deepEqual(blob.deleted, [h1.u], '옛 Blob 지움');
  await store.writeFile('data/games/x.json', '{"a":1}');
  assert.equal((await store.stat('data/games/x.json')).url, undefined, '이미지가 아닌 파일은 Redis 그대로');
  assert.equal((await store.readFile('data/games/x.json')).toString(), '{"a":1}');
  await store.unlink('assets/g/c/q-a1.png');
  assert.ok(blob.deleted.includes(h2.u));
  assert.equal(await store.stat('assets/g/c/q-a1.png'), null);
  assert.deepEqual(await store.readdir('assets/g/c'), []);
});

test('Redis 에서는 이미지 본문을 읽지 않는다 — 주소 없는 옛 이미지 키는 없는 것, 화면은 302 · 백업에는 Blob 바이트 (R-67 · DEP-27, X-56)', { skip }, async () => {
  const p = prefix();
  const A = await startApp(p, { seed: true });
  const H = { Cookie: cookieOf(await login(A)) };
  const AH = W({ 'X-Admin-Pin': PIN });
  // 옮기기 전 형식(머리말 + 본문)의 키를 직접 넣어도 — 이제는 읽지 않는다
  const legacy = 'assets/photo-quiz/food-zoom/legacy-e5f6.png';
  await A.ctx.redis.call('SET', `${p}f:${legacy}`, Buffer.concat([Buffer.from(`${JSON.stringify({ s: PNG.length, t: Date.now() })}\n`), PNG]));
  await A.ctx.redis.call('HSET', `${p}d:assets/photo-quiz/food-zoom`, 'legacy-e5f6.png', 'f');
  assert.equal(await A.ctx.store.readFile(legacy), null, '본문이 있어도 읽지 않음');
  assert.equal((await req(A, `/${legacy}`, { headers: H })).status, 404);
  // 초기 데이터의 이미지도 Blob 으로 — 화면은 302, 백업 tar 에는 Blob 에서 받은 바이트
  const used = 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png';
  const got = await req(A, `/${used}`, { headers: H });
  assert.equal(got.status, 302);
  assert.equal(got.headers['cache-control'], 'private, no-cache');
  assert.deepEqual(sharedBlob.objects.get(got.headers.location).bytes, PNG);
  const down = await req(A, '/api/admin/archive', { headers: AH });
  const entry = listTar(down.buf).find((e) => e.path === used);
  assert.deepEqual(down.buf.subarray(entry.offset, entry.offset + entry.size), PNG);
  // 옮기기 화면 · API 는 없다
  assert.equal((await req(A, '/api/admin/images/blob', { headers: AH })).status, 404);
  assert.equal((await req(A, '/api/admin/images/blob/move', { method: 'POST', headers: AH, body: { path: used } })).status, 404);
});

test('운영에서 Blob 을 쓸 수 없으면 이미지는 저장하지 않는다 — Redis 에 넣지 않고 503, 앱은 켜짐 (R-67, X-55)', { skip }, async () => {
  for (const [blob, why] of [
    [{ token: 'x', load: () => Promise.reject(new Error("Cannot find package '@vercel/blob'")) }, /SDK 를 불러오지 못했습니다/],
    [{ token: null }, /BLOB_READ_WRITE_TOKEN 이 없습니다/],
  ]) {
    const p = prefix();
    const logs = [];
    const app = await startApp(p, { logs, blob });
    assert.equal(app.ctx.store.blob, null);
    assert.match(app.ctx.store.blobError, why);
    assert.ok(logs.some((m) => m.startsWith('✕ 이미지 저장소(Blob)를 쓸 수 없습니다') && why.test(m)), logs.join('\n'));
    const AH = W({ 'X-Admin-Pin': PIN });
    const up = await req(app, '/api/admin/assets/photo-quiz/food-zoom/no-redis-a1b2.png', { method: 'PUT', headers: { ...AH, 'Content-Type': 'image/png' }, body: PNG });
    assert.equal(up.status, 503);
    assert.match(up.json.error, /이미지 저장소\(Blob\)를 쓸 수 없어 저장하지 않았습니다/);
    assert.equal(await app.ctx.redis.call('GET', `${p}f:assets/photo-quiz/food-zoom/no-redis-a1b2.png`), null, 'Redis 에 넣지 않음');
    // 이미지가 아닌 저장은 그대로
    const H = { Cookie: cookieOf(await login(app)) };
    const w = await req(app, '/api/state/route', { method: 'PUT', headers: W({ ...H, 'If-Match': '*' }), body: { data: { version: 1, route: { view: 'title' } } } });
    assert.equal(w.status, 200);
  }
});

test('이미지 주소 표 — 화면이 한 번 받아 Blob 주소를 바로 (이미지마다 함수를 타지 않게), 올리기 · 지우기에 따라감, 처음 한 번은 머리말로 채움 (R-70, X-58)', { skip }, async () => {
  const p = prefix();
  const A = await startApp(p, { seed: true });
  const B = await startApp(p);
  const AH = W({ 'X-Admin-Pin': PIN });
  assert.equal((await req(A, '/api/assets')).status, 401, '로그인 없이는 안 됨');
  const H = { Cookie: cookieOf(await login(A)) };
  const used = 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png';
  let map = (await req(B, '/api/assets', { headers: H })).json.images;
  assert.match(map[used], /^https:\/\/blob\.test\/assets\/photo-quiz\/food-zoom\/food-zoom-k7q2-[0-9a-f]{8}\.png$/, '초기 데이터 이미지');
  assert.equal(map[used], (await req(A, `/${used}`, { headers: H })).headers.location, '302 와 같은 주소');
  // 올리면 응답에 주소, 다른 서버의 표에도 바로
  const up = await req(A, '/api/admin/assets/photo-quiz/food-zoom/new-a7b8.png', { method: 'PUT', headers: { ...AH, 'Content-Type': 'image/png' }, body: PNG });
  assert.match(up.json.url, /^https:\/\/blob\.test\/.+new-a7b8-[0-9a-f]{8}\.png$/);
  map = (await req(B, '/api/assets', { headers: H })).json.images;
  assert.equal(map['assets/photo-quiz/food-zoom/new-a7b8.png'], up.json.url);
  // 교체하면 새 주소, 지우면 빠짐
  const again = await req(B, '/api/admin/assets/photo-quiz/food-zoom/new-a7b8.png', { method: 'PUT', headers: { ...AH, 'Content-Type': 'image/png' }, body: PNG });
  assert.notEqual(again.json.url, up.json.url);
  assert.equal((await req(A, '/api/assets', { headers: H })).json.images['assets/photo-quiz/food-zoom/new-a7b8.png'], again.json.url);
  assert.equal((await req(A, '/api/admin/assets/photo-quiz/food-zoom/new-a7b8.png', { method: 'DELETE', headers: AH })).status, 200);
  assert.ok(!('assets/photo-quiz/food-zoom/new-a7b8.png' in (await req(B, '/api/assets', { headers: H })).json.images));
  // R-70 전에 올린 이미지(표가 없던 때) — 처음 받을 때 머리말로 채운다
  await A.ctx.redis.call('DEL', `${p}u`, `${p}u:ok`);
  map = (await req(B, '/api/assets', { headers: H })).json.images;
  assert.equal(map[used], (await req(A, `/${used}`, { headers: H })).headers.location, '머리말로 다시 채움');
  assert.equal(await A.ctx.redis.call('EXISTS', `${p}u:ok`), 1);
});
