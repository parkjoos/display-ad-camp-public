// 백업 내려받기 · 올리기 테스트 (R-37, docs/04-admin.md 3-11, 11-acceptance-tests X-25 ~ X-29)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cp, mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/app.mjs';
import { UPLOAD_PART } from '../server/archive.mjs';
import { serializeGame, serializeState } from '../app/core/serialize.js';
import { emptyState } from '../app/core/validate.js';
import { tarHeader, padding, tarEnd, listTar, readHeader, classifyEntry, checkArchive } from '../app/core/tar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'); // 1×1
const game = (answer) => ({
  schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진 보고 맞추기',
  categories: [{ id: 'food-zoom', name: '확대 음식', prompt: '이 음식은 무엇일까요?', questions: [{ id: 'food-zoom-k7q2', answer, image: 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png' }] }],
});
const settings = (teamName) => serializeState('settings', { ...emptyState.settings(), teams: [{ name: teamName, color: '#3b82f6' }, { name: '둘', color: '#ef4444' }] });
let dir, app, base;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'camp-archive-'));
  for (const sub of ['app', 'data']) await cp(join(ROOT, sub), join(dir, sub), { recursive: true });
  for (const f of ['index.html', 'host.html', 'admin.html']) await cp(join(ROOT, f), join(dir, f));
  await writeFile(join(dir, 'data/games/photo-quiz.json'), serializeGame(game('원래 정답')));
  await mkdir(join(dir, 'assets/photo-quiz/food-zoom'), { recursive: true });
  await writeFile(join(dir, 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png'), PNG);
  await mkdir(join(dir, 'state/sessions'), { recursive: true });
  await writeFile(join(dir, 'state/settings.json'), settings('하나'));
  // 백업에 들어가면 안 되는 것
  await mkdir(join(dir, 'data/.backup'), { recursive: true });
  await writeFile(join(dir, 'data/.backup/photo-quiz-20261001-120000.json'), '{}');
  await mkdir(join(dir, 'state/.backup'), { recursive: true });
  await writeFile(join(dir, 'state/.backup/settings-20261001-120000.json'), '{}');
  await writeFile(join(dir, '.camp-secret'), 'x'.repeat(64));
  await writeFile(join(dir, 'assets/photo-quiz/food-zoom/.DS_Store'), 'x');
  app = await createAppServer({ root: dir, port: 0, pin: PIN, log: () => {} });
  base = app.url;
});
after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const A = (extra = {}) => ({ 'X-Camp-App': '1', Origin: base, 'X-Admin-Pin': PIN, ...extra });

function makeTar(files) {
  const parts = [];
  for (const f of files) {
    const b = Buffer.from(f.data);
    parts.push(Buffer.from(tarHeader(f.path, b.length)), b, Buffer.alloc(padding(b.length)));
  }
  parts.push(Buffer.from(tarEnd()));
  return Buffer.concat(parts);
}
const upload = (tar, parts = 'data,state') => fetch(`${base}/api/admin/archive?parts=${parts}`, { method: 'POST', headers: A({ 'Content-Type': 'application/x-tar' }), body: tar });
const download = async () => Buffer.from(await (await fetch(`${base}/api/admin/archive`, { headers: A() })).arrayBuffer());

test('tar 형식 — 긴 경로 · 검사합 · 분류 · 검사', () => {
  const long = `assets/photo-quiz/${'a'.repeat(60)}/${'b'.repeat(60)}.png`;
  const tar = makeTar([{ path: long, data: 'xy' }, { path: 'data/app.json', data: '{}' }]);
  assert.deepEqual(listTar(tar).map((e) => [e.path, e.size]), [[long, 2], ['data/app.json', 2]]);
  const broken = Buffer.from(tar);
  broken[10] ^= 1;
  assert.throws(() => readHeader(broken.subarray(0, 512)), /형식이 올바르지 않습니다/);
  assert.equal(classifyEntry('data/games/photo-quiz.json').kind, 'game');
  assert.equal(classifyEntry('assets/photo-quiz/food-zoom/a-1.png').kind, 'image');
  assert.equal(classifyEntry('state/sessions/photo-quiz.json').name, 'session:photo-quiz');
  for (const p of ['../evil.json', 'data/.backup/x.json', 'state/.backup/x.json', '.camp-secret', 'assets/photo-quiz/x/evil.exe', 'server.mjs', 'assets/Bad Dir/a.png']) {
    assert.ok(classifyEntry(p).skip, p);
  }
  assert.ok(classifyEntry('state', '5').dir);
  // 검사 — 게임 오류는 errors, 상태 형식 오류는 그 파일만 skipped
  const items = [
    { path: 'data/games/photo-quiz.json', size: 10, cls: classifyEntry('data/games/photo-quiz.json'), text: JSON.stringify({ schemaVersion: 2 }) },
    { path: 'state/settings.json', size: 10, cls: classifyEntry('state/settings.json'), text: JSON.stringify({ version: 9 }) },
  ];
  const r = checkArchive(items, (it) => it.text);
  assert.ok(r.errors.length > 0);
  assert.equal(r.skipped[0].path, 'state/settings.json');
});

test('백업 내려받기 — data · assets · state, 자동 백업 · 숨김 파일 · 서명 키 없음 (X-25)', async () => {
  const res = await fetch(`${base}/api/admin/archive`, { headers: A() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/x-tar');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="camp-game-\d{8}-\d{6}\.tar"/);
  const paths = listTar(Buffer.from(await res.arrayBuffer())).map((e) => e.path);
  for (const p of ['data/app.json', 'data/games/photo-quiz.json', 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png', 'state/settings.json']) assert.ok(paths.includes(p), p);
  assert.ok(!paths.some((p) => p.includes('.backup') || p.includes('.camp-secret') || p.includes('.DS_Store')), paths.join(','));
});

/** 게임 화면 명령 채널 — 올리기 뒤 reload 알림을 모은다 */
function listen() {
  const events = [];
  const req = http.get(`${base}/api/live/commands?clientId=archive-test-01`, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      for (const m of chunk.matchAll(/event: reload\ndata: (.+)\n/g)) events.push(JSON.parse(m[1]));
    });
  });
  req.on('error', () => {});
  return { events, close: () => req.destroy() };
}

test('백업 올리기 — 같은 이름 덮어쓰기 · 서버에만 있는 파일은 남김 · 자동 백업 · reload (X-26)', async () => {
  await writeFile(join(dir, 'assets/photo-quiz/food-zoom/server-only-a1b2.png'), PNG);
  const sse = listen();
  await new Promise((r) => setTimeout(r, 100));
  const tar = makeTar([
    { path: 'data/games/photo-quiz.json', data: serializeGame(game('올린 정답')) },
    { path: 'assets/photo-quiz/food-zoom/new-c3d4.png', data: PNG },
    { path: 'state/settings.json', data: settings('올린 팀') },
  ]);
  const res = await upload(tar);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.written, 3);
  assert.match(body.autoBackup, /^camp-game-\d{8}-\d{6}(-\d+)?\.tar$/);
  assert.ok((await readFile(join(dir, 'data/games/photo-quiz.json'), 'utf8')).includes('올린 정답'));
  assert.ok((await readFile(join(dir, 'state/settings.json'), 'utf8')).includes('올린 팀'));
  assert.deepEqual(await readFile(join(dir, 'assets/photo-quiz/food-zoom/new-c3d4.png')), PNG);
  assert.deepEqual(await readFile(join(dir, 'assets/photo-quiz/food-zoom/server-only-a1b2.png')), PNG); // 서버에만 있던 파일
  // 자동 백업 — 올리기 전 내용
  const auto = await fetch(`${base}/api/admin/archive/auto`, { headers: A() }).then((r) => r.json());
  assert.equal(auto[0].file, body.autoBackup);
  const before = Buffer.from(await (await fetch(`${base}/api/admin/archive/auto/${auto[0].file}`, { headers: A() })).arrayBuffer());
  const entry = listTar(before).find((e) => e.path === 'data/games/photo-quiz.json');
  assert.ok(before.subarray(entry.offset, entry.offset + entry.size).toString('utf8').includes('원래 정답'));
  assert.ok(!listTar(before).some((e) => e.path.startsWith('assets/')), '자동 백업은 이미지를 빼고 (올리기는 이미지를 지우지 않는다 — R-51)');
  assert.ok(listTar(before).some((e) => e.path === 'state/settings.json'));
  // 열린 게임 화면에 다시 읽으라고 알림
  await new Promise((r) => setTimeout(r, 200));
  sse.close();
  assert.ok(sse.events.some((e) => e.kind === 'data' && e.name === 'game:photo-quiz'));
  assert.ok(sse.events.some((e) => e.kind === 'state' && e.name === 'settings'));
});

test('현장 상태를 끄고 올리면 문제 · 이미지만 (X-27)', async () => {
  const stateBefore = await readFile(join(dir, 'state/settings.json'), 'utf8');
  const res = await upload(makeTar([
    { path: 'data/games/photo-quiz.json', data: serializeGame(game('상태 끈 정답')) },
    { path: 'state/settings.json', data: settings('바뀌면 안 되는 팀') },
  ]), 'data');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.written, 1);
  assert.ok(body.skipped.some((s) => s.path === 'state/settings.json'));
  assert.equal(await readFile(join(dir, 'state/settings.json'), 'utf8'), stateBefore);
  assert.ok((await readFile(join(dir, 'data/games/photo-quiz.json'), 'utf8')).includes('상태 끈 정답'));
});

test('잘못된 백업 — 게임 검증 오류는 422 · 아무것도 안 씀, 위험한 경로는 건너뜀 (X-28)', async () => {
  const gameBefore = await readFile(join(dir, 'data/games/photo-quiz.json'), 'utf8');
  const autoBefore = (await readdir(join(dir, '.restore-backup'))).length;
  let res = await upload(makeTar([
    { path: 'data/games/photo-quiz.json', data: JSON.stringify({ schemaVersion: 2, id: 'photo-quiz' }) },
    { path: 'assets/photo-quiz/food-zoom/ok-e5f6.png', data: PNG },
  ]));
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.length > 0);
  assert.equal(await readFile(join(dir, 'data/games/photo-quiz.json'), 'utf8'), gameBefore);
  assert.ok(!(await readdir(join(dir, 'assets/photo-quiz/food-zoom'))).includes('ok-e5f6.png'));
  assert.equal((await readdir(join(dir, '.restore-backup'))).length, autoBefore);
  // 정해진 위치 밖 · 숨김 · 이미지 아닌 파일은 쓰지 않고 건너뜀
  res = await upload(makeTar([
    { path: '../evil.json', data: '{}' },
    { path: 'data/.backup/evil.json', data: '{}' },
    { path: 'assets/photo-quiz/food-zoom/evil.exe', data: 'x' },
    { path: 'server.mjs', data: 'x' },
    { path: 'assets/photo-quiz/food-zoom/ok-e5f6.png', data: PNG },
  ]));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.written, 1);
  assert.equal(body.skipped.length, 4);
  assert.ok(!(await readdir(dirname(dir))).includes('evil.json'));
  assert.ok(!(await readdir(join(dir, 'assets/photo-quiz/food-zoom'))).includes('evil.exe'));
  // 잘린 파일 · tar 가 아닌 파일
  const tar = makeTar([{ path: 'data/games/photo-quiz.json', data: gameBefore }]);
  assert.equal((await upload(tar.subarray(0, 700))).status, 400);
  assert.equal((await upload(Buffer.from('x'.repeat(1024)))).status, 400);
});

test('PIN 헤더 없이 백업 API 는 401 (X-29)', async () => {
  const { 'X-Admin-Pin': _, ...noPin } = A();
  assert.equal((await fetch(`${base}/api/admin/archive`, { headers: noPin })).status, 401);
  assert.equal((await fetch(`${base}/api/admin/archive?parts=data`, { method: 'POST', headers: noPin, body: await download() })).status, 401);
  assert.equal((await fetch(`${base}/api/admin/archive/auto`, { headers: noPin })).status, 401);
});

// ── 나눠 올리기 (R-51 · DEP-18 — Vercel 요청 4.5MB 상한) ──────────────
const J = (body) => ({ method: 'POST', headers: A({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
const putPart = (id, path, offset, bytes) => fetch(`${base}/api/admin/archive/upload/${id}?path=${encodeURIComponent(path)}&offset=${offset}`, { method: 'PUT', headers: A({ 'Content-Type': 'application/octet-stream' }), body: bytes });

test('나눠 올리기 — 시작에서 검사 · 자동 백업, 이미지는 4MB 조각, 문제 · 상태는 끝에서 (X-47)', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(UPLOAD_PART + 1000, 7)]);
  const BIG = 'assets/photo-quiz/food-zoom/big-e5f6.png';
  const SMALL = 'assets/photo-quiz/food-zoom/small-g7h8.png';
  const gameText = serializeGame(game('나눠 올린 정답'));
  const r = await fetch(`${base}/api/admin/archive/begin`, J({
    parts: ['data', 'state'],
    items: [
      { path: 'data/games/photo-quiz.json', size: 1 }, { path: BIG, size: big.length }, { path: SMALL, size: PNG.length },
      { path: 'state/settings.json', size: 1 }, { path: '../evil.png', size: 3 },
    ],
    texts: { 'data/games/photo-quiz.json': gameText, 'state/settings.json': settings('나눠 올린 팀') },
  }));
  assert.equal(r.status, 200);
  const started = await r.json();
  assert.match(started.id, /^[a-f0-9]{16}$/);
  assert.match(started.autoBackup, /^camp-game-\d{8}-\d{6}(-\d+)?\.tar$/);
  assert.deepEqual(started.images.map((x) => x.path).sort(), [BIG, SMALL]);

  assert.equal((await putPart(started.id, 'assets/photo-quiz/food-zoom/other-a1b2.png', 0, PNG)).status, 400, '목록에 없는 이미지');
  assert.equal((await putPart(started.id, SMALL, 5, PNG)).status, 400, '크기를 넘는 조각');
  assert.equal((await putPart(started.id, BIG, 0, big.subarray(0, UPLOAD_PART))).status, 204);
  assert.ok(!(await readdir(join(dir, 'assets/photo-quiz/food-zoom'))).includes('big-e5f6.png'), '조각이 다 오기 전에는 쓰지 않음');
  assert.equal((await putPart(started.id, BIG, UPLOAD_PART, big.subarray(UPLOAD_PART))).status, 204);
  assert.equal((await putPart(started.id, SMALL, 0, PNG)).status, 204);
  assert.deepEqual(await readFile(join(dir, BIG)), big, '조각을 이어 붙여 그대로');
  assert.deepEqual(await readFile(join(dir, SMALL)), PNG);
  assert.ok(!(await readFile(join(dir, 'data/games/photo-quiz.json'), 'utf8')).includes('나눠 올린 정답'), '문제는 끝에서 쓴다');

  const fin = await fetch(`${base}/api/admin/archive/upload/${started.id}/finish`, { method: 'POST', headers: A() });
  assert.equal(fin.status, 200);
  const body = await fin.json();
  assert.equal(body.written, 4);
  assert.equal(body.autoBackup, started.autoBackup);
  assert.ok(body.skipped.some((x) => x.path === '../evil.png'));
  assert.equal(await readFile(join(dir, 'data/games/photo-quiz.json'), 'utf8'), gameText);
  assert.ok((await readFile(join(dir, 'state/settings.json'), 'utf8')).includes('나눠 올린 팀'));
  assert.equal((await fetch(`${base}/api/admin/archive/upload/${started.id}/finish`, { method: 'POST', headers: A() })).status, 404, '끝난 올리기는 지워짐');
  const auto = Buffer.from(await (await fetch(`${base}/api/admin/archive/auto/${started.autoBackup}`, { headers: A() })).arrayBuffer());
  assert.ok(!listTar(auto).some((e) => e.path.startsWith('assets/')), '자동 백업은 이미지를 빼고');
});

test('나눠 올리기 — 검증 오류는 시작에서 422 · 아무것도 안 씀, 요청 하나가 4MB 를 넘으면 413 (X-47)', async () => {
  const autoBefore = (await readdir(join(dir, '.restore-backup'))).length;
  const bad = { ...game('x'), categories: [{ id: 'Bad Id', name: '', questions: [] }] };
  const r = await fetch(`${base}/api/admin/archive/begin`, J({ parts: ['data'], items: [{ path: 'data/games/photo-quiz.json', size: 1 }], texts: { 'data/games/photo-quiz.json': JSON.stringify(bad) } }));
  assert.equal(r.status, 422);
  assert.ok((await r.json()).errors.length > 0);
  assert.equal((await readdir(join(dir, '.restore-backup'))).length, autoBefore, '자동 백업도 만들지 않음');
  const missing = await fetch(`${base}/api/admin/archive/begin`, J({ parts: ['data'], items: [{ path: 'data/games/photo-quiz.json', size: 1 }], texts: {} }));
  assert.equal(missing.status, 400, 'JSON 내용 없이');
  const ok = await (await fetch(`${base}/api/admin/archive/begin`, J({ parts: ['data'], items: [{ path: 'assets/photo-quiz/food-zoom/huge-a1b2.png', size: UPLOAD_PART + 10 }], texts: {} }))).json();
  assert.equal((await putPart(ok.id, 'assets/photo-quiz/food-zoom/huge-a1b2.png', 0, Buffer.alloc(UPLOAD_PART + 10))).status, 413);
});

