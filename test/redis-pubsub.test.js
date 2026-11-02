// 실시간 알림 — 구독(pub/sub)으로 바로 받기 · 끊기면 다시 붙어 채우기 · 구독을 못 하면 번호 확인 (R-51 · DEP-16, docs/08-tech.md 11-6, 11-acceptance-tests X-48)
// 로컬 redis-server · redis-cli 를 띄워 쓴다 — 없으면 건너뜀
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/app.mjs';
import { createRedis } from '../server/redis.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const which = (bin) => spawnSync('which', [bin]).stdout?.toString().trim();
const REDIS_BIN = which('redis-server');
const CLI_BIN = which('redis-cli');
const skip = REDIS_BIN && CLI_BIN ? false : 'redis-server · redis-cli 가 없어 건너뜀';
const PW = 'pubsub-pass-5678';
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const ORIGIN = 'https://camp.test';
const HOST = 'camp.test';
const procs = [];
const apps = [];
let codeDir;

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** redis-server 하나 — extra 로 명령 막기 등 */
async function startRedis(extra = []) {
  const port = await freePort();
  procs.push(spawn(REDIS_BIN, ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--requirepass', PW, ...extra], { stdio: 'ignore' }));
  const probe = createRedis({ url: `redis://127.0.0.1:${port}`, password: PW, retries: 20 });
  await probe.call('PING');
  await probe.close();
  return port;
}
const cli = (port, ...args) => spawnSync(CLI_BIN, ['-p', String(port), '-a', PW, '--no-auth-warning', ...args]).stdout.toString();
/** 지금까지 처리한 GET 명령 수 — 번호 확인(폴링)은 0.2초마다 GET 을 부른다 */
const getCalls = (port) => Number(/cmdstat_get:calls=(\d+)/.exec(cli(port, 'INFO', 'commandstats'))?.[1] ?? 0);

before(async () => {
  if (skip) return;
  codeDir = await mkdtemp(join(tmpdir(), 'camp-pubsub-code-'));
  for (const sub of ['app', 'data', 'assets']) await cp(join(ROOT, sub), join(codeDir, sub), { recursive: true });
  for (const f of ['index.html', 'host.html', 'admin.html']) await cp(join(ROOT, f), join(codeDir, f));
});
after(async () => {
  for (const a of apps) await a.close().catch(() => {});
  for (const p of procs) p.kill('SIGKILL');
  if (codeDir) await rm(codeDir, { recursive: true, force: true });
});

async function startApp(port, prefix, logs = []) {
  // 초기 데이터의 이미지는 Blob 으로 (Redis 저장소는 이미지를 두지 않는다 — R-67 · DEP-27) — 이 테스트는 실시간만 보므로 받기만 하는 가짜
  const blob = { label: '가짜 Blob', put: async (pathname) => `https://blob.test/${pathname}`, del: async () => {}, get: async () => Buffer.alloc(0) };
  const app = await createAppServer({ root: codeDir, port: 0, pin: PIN, publicOrigin: ORIGIN, redis: { url: `redis://127.0.0.1:${port}`, password: PW, prefix, seed: true }, blob, log: (m) => logs.push(m) });
  apps.push(app);
  return app;
}

function req(app, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: app.ctx.port, path, method, headers: { Host: HOST, 'X-Camp-App': '1', Origin: ORIGIN, 'Content-Type': 'application/json', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

function sse(app, path, headers = {}) {
  const queue = [];
  let wake;
  let buf = '';
  const r = http.request({ host: '127.0.0.1', port: app.ctx.port, path, headers: { Host: HOST, ...headers } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (ev) { queue.push({ event: ev, data: data ? JSON.parse(data) : null, at: Date.now() }); wake?.(); }
      }
    });
  });
  r.on('error', () => {});
  r.end();
  return {
    async next(event, timeout = 3000) {
      const t0 = Date.now();
      for (;;) {
        const idx = queue.findIndex((e) => e.event === event);
        if (idx >= 0) return queue.splice(idx, 1)[0];
        if (Date.now() - t0 > timeout) throw new Error(`${event} 이벤트가 오지 않음`);
        await new Promise((res) => { wake = res; setTimeout(res, 20); });
      }
    },
    close: () => r.destroy(),
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const live = (clientId) => ({ v: 1, clientId, seq: 2, view: 'play', gameId: 'photo-quiz', type: 'photo', screen: 'title', teams: [] });

/** 서버 A 에 게임 화면, B 로 진행자 명령 */
async function pair(port, logsA = []) {
  const prefix = `p${randomBytes(3).toString('hex')}:`; // 같은 저장소 — 서명 키 · 알림을 같이 쓴다
  const A = await startApp(port, prefix, logsA);
  const B = await startApp(port, prefix);
  const login = await req(A, '/api/login', { method: 'POST', body: { pin: PIN } });
  const H = { Cookie: String(login.headers['set-cookie'][0]).split(';')[0] };
  const clientId = `ps-${randomBytes(4).toString('hex')}`;
  const game = sse(A, `/api/live/commands?clientId=${clientId}`, H);
  await game.next('hello');
  assert.equal((await req(A, '/api/live', { method: 'POST', headers: H, body: live(clientId) })).status, 204);
  const command = async (id) => {
    const t0 = Date.now();
    assert.equal((await req(B, '/api/host/command', { method: 'POST', headers: H, body: { id, cmd: 'question.hint', basedOn: 2 } })).status, 202);
    return t0;
  };
  return { A, B, game, command };
}

test('구독으로 바로 받는다 — 다른 서버의 명령이 곧바로, 쉬는 동안 번호 확인(GET)을 하지 않음 (X-48)', { skip }, async (t) => {
  const port = await startRedis();
  const logs = [];
  const { game, command } = await pair(port, logs);
  t.after(() => game.close());
  await wait(200);
  const t0 = await command('ps1');
  const got = await game.next('command');
  assert.equal(got.data.id, 'ps1');
  assert.ok(got.at - t0 < 300, `${got.at - t0}ms — 300ms 이내 (08-tech 10장)`);
  const before = getCalls(port);
  await wait(1200);
  const idle = getCalls(port) - before;
  assert.ok(idle <= 2, `쉬는 1.2초 동안 GET ${idle}번 — 0.2초 확인이면 6번`);
  assert.ok(!logs.some((m) => m.includes('구독(pub/sub)을 쓸 수 없어')), logs.join('\n'));
});

test('구독 연결이 끊겨도 — 다시 붙어 그 사이의 명령을 채운다 (X-48)', { skip }, async (t) => {
  const port = await startRedis();
  const { game, command } = await pair(port);
  t.after(() => game.close());
  await wait(200);
  assert.match(cli(port, 'CLIENT', 'KILL', 'TYPE', 'pubsub'), /^[1-9]/, '구독 연결을 끊음');
  await command('ps2');
  const got = await game.next('command', 5000);
  assert.equal(got.data.id, 'ps2', '끊긴 사이에 보낸 명령');
});

test('구독을 못 하는 저장소 — 0.2초 번호 확인으로 돌아가 그대로 동작 (X-48)', { skip }, async (t) => {
  const port = await startRedis(['--rename-command', 'SUBSCRIBE', '']);
  const logs = [];
  const { game, command } = await pair(port, logs);
  t.after(() => game.close());
  await wait(300);
  assert.ok(logs.some((m) => m.includes('구독(pub/sub)을 쓸 수 없어')), logs.join('\n'));
  await command('ps3');
  assert.equal((await game.next('command')).data.id, 'ps3');
});
