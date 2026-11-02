// 서버 모드 테스트 (docs/08-tech.md 11장, 11-acceptance-tests X) — 코드 폴더 · 저장 폴더를 임시로 나눠 띄운다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdtemp, rm, readFile, writeFile, mkdir, stat, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/app.mjs';
import { seedDataDir, SECRET_FILE } from '../server/seed.mjs';
import { classifyEntry } from '../app/core/tar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const wrongPin = (n) => String((Number(PIN) + n) % 1e6).padStart(6, '0'); // PIN 에서 n 만큼 떨어진 다른 6자리 — 우연히 맞지 않게
const ORIGIN = 'https://camp.test';
const HOST = 'camp.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'); // 1×1
let codeDir, dataDir, app;

async function start(pin = PIN) {
  app = await createAppServer({ root: codeDir, dataRoot: dataDir, port: 0, pin, publicOrigin: ORIGIN, log: () => {} });
  return app;
}

before(async () => {
  codeDir = await mkdtemp(join(tmpdir(), 'camp-code-'));
  dataDir = join(await mkdtemp(join(tmpdir(), 'camp-volume-')), 'data'); // 아직 없는 폴더 = 빈 볼륨
  for (const sub of ['app', 'data', 'assets', 'state']) await cp(join(ROOT, sub), join(codeDir, sub), { recursive: true }).catch(() => {});
  for (const f of ['index.html', 'host.html', 'admin.html', 'play.html']) await cp(join(ROOT, f), join(codeDir, f));
  await cp(join(ROOT, 'docs/templates'), join(codeDir, 'docs/templates'), { recursive: true });
  await cp(join(ROOT, 'docs/manual.md'), join(codeDir, 'docs/manual.md'));
  // 복사하면 안 되는 것 — 백업 · 숨김 파일
  await mkdir(join(codeDir, 'data/.backup'), { recursive: true });
  await writeFile(join(codeDir, 'data/.backup/photo-quiz-20261001-120000.json'), '{}');
  await mkdir(join(codeDir, 'assets/photo-quiz/zz-test'), { recursive: true });
  await writeFile(join(codeDir, 'assets/photo-quiz/zz-test/zz-test-a1b2.png'), PNG);
  await start();
});
after(async () => {
  await app.close();
  await rm(codeDir, { recursive: true, force: true });
  await rm(dirname(dataDir), { recursive: true, force: true });
});

/** Host · X-Forwarded-For 를 직접 정하는 요청 (fetch 는 Host 를 바꿀 수 없다) */
function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: app.ctx.port, path, method, headers: { Host: HOST, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* 글자 */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}
const W = (extra = {}) => ({ 'X-Camp-App': '1', Origin: ORIGIN, 'Content-Type': 'application/json', ...extra });
const cookieOf = (res) => String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
async function login(pin = PIN, headers = {}) {
  return req('/api/login', { method: 'POST', headers: W(headers), body: { pin } });
}

test('빈 저장 폴더 → 처음 한 번 복사, 백업 · 숨김 파일 빼고, 다시 시작해도 덮어쓰지 않음 (X-3)', async () => {
  assert.ok((await stat(join(dataDir, 'data/app.json'))).isFile());
  assert.ok((await stat(join(dataDir, 'assets/photo-quiz/zz-test/zz-test-a1b2.png'))).isFile());
  assert.ok((await stat(join(dataDir, 'state'))).isDirectory());
  assert.ok(!(await readdir(join(dataDir, 'data'))).includes('.backup'));
  assert.match(await readFile(join(dataDir, SECRET_FILE), 'utf8'), /^[0-9a-f]{64}\n$/);
  // 저장 폴더에서 바뀐 내용은 다시 시작(다시 복사 시도)해도 그대로
  await writeFile(join(dataDir, 'data/scoreboard.json'), '{"changed":true}\n');
  assert.deepEqual(await seedDataDir(codeDir, dataDir), []);
  assert.equal(await readFile(join(dataDir, 'data/scoreboard.json'), 'utf8'), '{"changed":true}\n');
  await cp(join(codeDir, 'data/scoreboard.json'), join(dataDir, 'data/scoreboard.json'));
});

test('로그인 없이 — 화면 껍데기 · 상태 확인만, 정답이 든 데이터 · 이미지 · 상태 · 실시간은 401 (X-4, X-5)', async () => {
  const s = await req('/api/session');
  assert.deepEqual(s.json, { mode: 'server', loggedIn: false });
  for (const p of ['/', '/host', '/admin', '/app/style.css', '/app/main.js', '/docs/templates/emoji-quiz-template.tsv', '/docs/manual.md']) {
    assert.equal((await req(p)).status, 200, p);
  }
  for (const p of ['/data/app.json', '/data/games/photo-quiz.json', '/data/scoreboard.json', '/assets/photo-quiz/zz-test/zz-test-a1b2.png', '/api/state', '/api/live/commands?clientId=abcdefgh12', '/api/host/state']) {
    assert.equal((await req(p)).status, 401, p);
  }
  assert.equal((await req('/api/live', { method: 'POST', headers: W(), body: { v: 1 } })).status, 401);
  assert.equal((await req('/api/state/settings', { method: 'PUT', headers: W({ 'If-Match': '*' }), body: { data: {} } })).status, 401);
  // 막힌 경로는 여전히 404 — 서명 키 포함
  for (const p of ['/.camp-secret', '/state/settings.json', '/server.mjs', '/data/.backup/x.json']) assert.equal((await req(p)).status, 404, p);
});

test('Host · Origin — 공개 주소와 127.0.0.1 만, 상태 확인은 Host 무관 (X-14, X-15)', async () => {
  assert.equal((await req('/', { headers: { Host: 'evil.test' } })).status, 403);
  assert.equal((await req('/', { headers: { Host: `127.0.0.1:${app.ctx.port}` } })).status, 200);
  const h = await req('/api/health', { headers: { Host: '10.1.2.3:1029' } });
  assert.equal(h.status, 200);
  assert.equal(h.json.app, 'camp-game');
  assert.equal((await req('/api/login', { method: 'POST', headers: W({ Origin: 'https://evil.test' }), body: { pin: PIN } })).status, 403);
});

test('공개 주소 여러 개 — 어느 도메인으로 와도 Host · Origin 통과, 목록에 없는 곳은 403 (X-31)', async () => {
  const ORIGIN2 = 'https://camp2.test';
  const twoDir = join(await mkdtemp(join(tmpdir(), 'camp-two-')), 'data');
  const two = await createAppServer({ root: codeDir, dataRoot: twoDir, port: 0, pin: PIN, publicOrigin: [ORIGIN, ORIGIN2], log: () => {} });
  const call = (host, headers = {}, method = 'GET', path = '/') => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: two.ctx.port, path, method, headers: { Host: host, ...headers } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    r.end(method === 'POST' ? JSON.stringify({ pin: PIN }) : undefined);
  });
  try {
    assert.equal(await call(HOST), 200);
    assert.equal(await call('camp2.test'), 200);
    assert.equal(await call('evil.test'), 403);
    assert.equal(await call('camp2.test', W({ Origin: ORIGIN2 }), 'POST', '/api/login'), 204);
    assert.equal(await call('camp2.test', W({ Origin: 'https://evil.test' }), 'POST', '/api/login'), 403);
  } finally {
    await two.close();
    await rm(dirname(twoDir), { recursive: true, force: true });
  }
});

test('게임 화면 입장 — 쿠키 속성 · 같은 쿠키로 데이터 · 진행자 화면 (X-6, X-7, X-13)', async () => {
  const wrong = await login(wrongPin(1), { 'X-Forwarded-For': '10.9.9.9' });
  assert.equal(wrong.status, 401);
  const ok = await login(PIN, { 'X-Forwarded-Proto': 'https' });
  assert.equal(ok.status, 204);
  const set = ok.headers['set-cookie'][0];
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=604800', 'Secure']) assert.ok(set.includes(part), part);
  assert.ok(!(await login(PIN)).headers['set-cookie'][0].includes('Secure'), 'http 로 들어오면 Secure 없음');
  const cookie = cookieOf(ok);
  assert.ok(!cookie.includes(PIN));
  assert.deepEqual((await req('/api/session', { headers: { Cookie: cookie } })).json, { mode: 'server', loggedIn: true });
  assert.equal((await req('/data/app.json', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await req('/assets/photo-quiz/zz-test/zz-test-a1b2.png', { headers: { Cookie: cookie } })).headers['content-type'], 'image/png');
  assert.equal((await req('/api/state', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await req('/api/host/state', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await req('/api/live', { method: 'POST', headers: W({ Cookie: cookie }), body: { v: 1, screen: 'title' } })).status, 204);
  // 서명을 고친 쿠키 → 401
  const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await req('/data/app.json', { headers: { Cookie: forged } })).status, 401);
});

test('실패 잠금은 접속한 곳별 — X-Forwarded-For 마지막 주소 (X-11)', async () => {
  for (let i = 1; i <= 5; i++) {
    const r = await login(String(100000 + i), { 'X-Forwarded-For': '10.0.0.1' });
    assert.equal(r.status, i < 5 ? 401 : 429);
  }
  assert.equal((await login(PIN, { 'X-Forwarded-For': '10.0.0.1' })).status, 429);
  // 앞쪽 주소를 꾸며도 인그레스가 붙인 마지막 주소로 센다
  assert.equal((await login(PIN, { 'X-Forwarded-For': '1.1.1.1, 10.0.0.1' })).status, 429);
  // 다른 곳은 그대로 입장
  assert.equal((await login(PIN, { 'X-Forwarded-For': '10.0.0.2' })).status, 204);
});

test('[나가기] 한 쿠키는 401, 관리 PIN 확인은 쿠키도 준다 · 관리 API 는 여전히 PIN 헤더 (X-12, X-16)', async () => {
  const cookie = cookieOf(await login());
  assert.equal((await req('/api/host/logout', { method: 'POST', headers: W({ Cookie: cookie }) })).status, 204);
  assert.equal((await req('/api/host/state', { headers: { Cookie: cookie } })).status, 401);
  const v = await req('/api/admin/verify', { method: 'POST', headers: W({ 'X-Admin-Pin': PIN }) });
  assert.equal(v.status, 204);
  const adminCookie = cookieOf(v);
  assert.equal((await req('/assets/photo-quiz/zz-test/zz-test-a1b2.png', { headers: { Cookie: adminCookie } })).status, 200);
  assert.equal((await req('/api/admin/check', { headers: { Cookie: adminCookie } })).status, 401);
  assert.equal((await req('/api/admin/check', { headers: { Cookie: adminCookie, 'X-Admin-Pin': PIN } })).status, 200);
});

test('서버를 다시 띄워도 쿠키 유지, PIN 을 바꾸면 다시 입장 (X-9, X-10)', async () => {
  const cookie = cookieOf(await login());
  await app.close();
  await start();
  assert.equal((await req('/api/host/state', { headers: { Cookie: cookie } })).status, 200);
  await app.close();
  await start(wrongPin(7));
  assert.equal((await req('/api/host/state', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await login(wrongPin(7))).status, 204);
  await app.close();
  await start();
});

test('공개 모드 /play — 관리 페이지에서 켜야 공개용 데이터 · 그 문제들의 이미지만 로그인 없이, 나머지는 그대로 잠김 (R-96, P-4 · P-5)', async () => {
  const admin = (extra = {}) => W({ 'X-Admin-Pin': PIN, ...extra });
  const game = JSON.parse(await readFile(join(dataDir, 'data/games/photo-quiz.json'), 'utf8'));
  const used = game.categories.filter((c) => !c.disabled).flatMap((c) => c.questions).find((q) => !q.disabled && q.image).image;
  await stat(join(dataDir, used)); // 초기 데이터에 있는 이미지
  const unused = 'assets/photo-quiz/zz-test/zz-test-a1b2.png';

  assert.equal((await req('/play')).status, 200, '화면 껍데기는 언제나');
  assert.deepEqual((await req('/api/public')).json, { on: false, title: '2026 디광 캠핑' }, '꺼져 있으면 제목만');
  assert.equal((await req(`/${used}`)).status, 401);

  assert.equal((await req('/api/admin/public', { method: 'PUT', headers: W(), body: { on: true } })).status, 401, '관리 PIN 헤더');
  assert.equal((await req('/api/admin/public', { method: 'PUT', headers: admin(), body: { on: 'yes' } })).status, 400);
  assert.deepEqual((await req('/api/admin/public', { method: 'PUT', headers: admin(), body: { on: true } })).json, { on: true });
  assert.deepEqual((await req('/api/admin/public', { headers: { 'X-Admin-Pin': PIN } })).json, { on: true });

  const p = (await req('/api/public')).json;
  assert.equal(p.on, true);
  assert.equal(p.images, null, '파일 저장소 — 화면은 /assets/… 로 받는다');
  assert.deepEqual(p.games.map((g) => g.id), ['emoji-quiz', 'photo-quiz'], '메뉴 순서 — 줄줄이 말해요는 공개하지 않음 (R-97)');
  assert.ok(!/"note"|"addedAt"|"disabled"|"defaults"/.test(JSON.stringify(p)), '진행자 메모 · 숨김 · 진행 옵션은 나가지 않는다');
  assert.equal((await req(`/${used}`)).status, 200, '공개한 문제의 이미지');
  assert.equal((await req(`/${unused}`)).status, 401, '공개한 문제가 쓰지 않는 이미지는 그대로');
  for (const path of ['/data/app.json', '/data/games/photo-quiz.json', '/api/state', '/api/host/state', '/api/assets', '/api/live/commands?clientId=abcdefgh12']) {
    assert.equal((await req(path)).status, 401, path);
  }
  assert.ok(classifyEntry('state/public.json').skip, '스위치는 백업에 넣지 않는다 — 백업을 옮겨도 공개가 따라 켜지지 않게');

  assert.deepEqual((await req('/api/admin/public', { method: 'PUT', headers: admin(), body: { on: false } })).json, { on: false });
  assert.equal((await req('/api/public')).json.on, false);
  assert.equal((await req(`/${used}`)).status, 401);
});

// ── server.mjs 시작 (X-1, X-2) ───────────────────────────

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** server.mjs 를 환경 변수로 띄워 출력이 `until` 을 만족하거나 끝날 때까지 */
function runServer(env, until = () => false) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += d; if (until(out)) child.kill('SIGTERM'); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

test('서버 모드 시작 — CAMP_PIN 없거나 틀리면 시작 안 함, 로그에 PIN 없음 (X-1, X-2)', async () => {
  for (const pin of [undefined, '12345', 'abcdef']) {
    const r = await runServer({ CAMP_PUBLIC_ORIGIN: ORIGIN, CAMP_DATA_DIR: dataDir, ...(pin ? { CAMP_PIN: pin } : {}) });
    assert.equal(r.code, 1, String(pin));
    assert.match(r.out, /CAMP_PIN 은 6자리 숫자여야 합니다/);
  }
  const bad = await runServer({ CAMP_PUBLIC_ORIGIN: 'https://camp.test/path', CAMP_PIN: PIN });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /CAMP_PUBLIC_ORIGIN/);
  const port = await freePort();
  const r = await runServer({ CAMP_PUBLIC_ORIGIN: `${ORIGIN}/`, CAMP_PIN: PIN, CAMP_DATA_DIR: dataDir, CAMP_HOST: '127.0.0.1', CAMP_PORT: String(port) }, (out) => out.includes('PIN '));
  assert.match(r.out, /서버 모드/);
  assert.ok(r.out.includes(`게임 화면    ${ORIGIN}/`), r.out);
  assert.ok(!r.out.includes(PIN), 'PIN 값이 로그에 없음');
  // 쉼표로 여러 개 — 첫 번째가 대표, 나머지는 "다른 주소" (X-31)
  const port2 = await freePort();
  const r2 = await runServer({ CAMP_PUBLIC_ORIGIN: `${ORIGIN}, https://camp2.test/`, CAMP_PIN: PIN, CAMP_DATA_DIR: dataDir, CAMP_HOST: '127.0.0.1', CAMP_PORT: String(port2) }, (out) => out.includes('PIN '));
  assert.ok(r2.out.includes(`게임 화면    ${ORIGIN}/`), r2.out);
  assert.match(r2.out, /다른 주소 {4}https:\/\/camp2\.test /);
  const bad2 = await runServer({ CAMP_PUBLIC_ORIGIN: `${ORIGIN},https://camp2.test/x`, CAMP_PIN: PIN });
  assert.equal(bad2.code, 1);
});

test('저장 폴더 점검 — 쓸 수 있으면 로그, 없으면 CAMP_STORAGE 로 시작 안 함 (X-24)', async (t) => {
  const logs = [];
  const okDir = join(await mkdtemp(join(tmpdir(), 'camp-check-')), 'data');
  const ok = await createAppServer({ root: codeDir, dataRoot: okDir, port: 0, pin: PIN, publicOrigin: ORIGIN, log: (m) => logs.push(m) });
  await ok.close();
  assert.ok(logs.some((m) => m.includes('저장 폴더 점검 ✔')));
  assert.ok(!(await readdir(okDir)).includes('.camp-check'), '점검 파일은 지운다');
  await rm(dirname(okDir), { recursive: true, force: true });
  if (process.getuid?.() === 0) { t.skip('root 는 권한 제한을 받지 않음 (이미지 빌드의 테스트 단계)'); return; }
  const ro = await mkdtemp(join(tmpdir(), 'camp-ro-'));
  await chmod(ro, 0o555);
  try {
    await assert.rejects(
      createAppServer({ root: codeDir, dataRoot: join(ro, 'data'), port: 0, pin: PIN, publicOrigin: ORIGIN, log: () => {} }),
      (err) => err.code === 'CAMP_STORAGE' && /저장 폴더에 쓸 수 없습니다/.test(err.message),
    );
  } finally {
    await chmod(ro, 0o755);
    await rm(ro, { recursive: true, force: true });
  }
});

test('X-Forwarded-For 를 꾸며도 서버 전체 실패 상한에 걸림 (X-11)', async () => {
  const capDir = join(await mkdtemp(join(tmpdir(), 'camp-cap-')), 'data');
  const capApp = await createAppServer({ root: codeDir, dataRoot: capDir, port: 0, pin: PIN, publicOrigin: ORIGIN, log: () => {} });
  const post = (forwardedFor, pin) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: capApp.ctx.port, path: '/api/login', method: 'POST', headers: { Host: HOST, ...W({ 'X-Forwarded-For': forwardedFor }) } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    r.end(JSON.stringify({ pin }));
  });
  try {
    const codes = [];
    for (let i = 0; i < 100; i++) codes.push(await post(`10.1.0.${i + 1}`, wrongPin(1))); // 곳마다 1회씩 — 곳별 잠금(5회)에는 안 걸림
    assert.equal(codes.filter((c) => c === 401).length, 99);
    assert.equal(codes.at(-1), 429);
    assert.equal(await post('10.9.9.9', PIN), 429, '맞는 PIN 도 잠시 막힘');
  } finally {
    await capApp.close();
    await rm(dirname(capDir), { recursive: true, force: true });
  }
});
