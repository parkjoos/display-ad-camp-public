// 로컬 서버 테스트 — 임시 폴더에 프로젝트를 복사해 포트 0 으로 띄운다 (실제 data · state 는 건드리지 않음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/app.mjs';
import { serializeGame } from '../app/core/serialize.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const wrongPin = (n) => String((Number(PIN) + n) % 1e6).padStart(6, '0'); // PIN 에서 n 만큼 떨어진 다른 6자리 — 우연히 맞지 않게
let dir, app, base, origin;

// 시험용 고정 자료 — 저장소의 실제 문제 · 이미지(검수용 샘플 등)는 바뀌거나 지워질 수 있어 테스트는 이것으로 한다
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'); // 1×1
const PHOTO_GAME = {
  schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진 보고 맞추기',
  categories: [{ id: 'food-zoom', name: '확대 음식', prompt: '이 음식은 무엇일까요?', questions: [{ id: 'food-zoom-k7q2', answer: '샘플 국수', image: 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png' }] }],
};
const EMOJI_GAME = {
  schemaVersion: 1, id: 'emoji-quiz', type: 'emoji', title: '이모티콘 퀴즈',
  categories: [{ id: 'movie', name: '영화', prompt: '이 영화 제목은?', questions: [{ id: 'movie-7xkz', answer: '기생충', emojis: '🪱🏠💰' }] }],
};
const CHAIN_GAME = {
  schemaVersion: 1, id: 'chain-talk', type: 'roulette', title: '줄줄이 말해요',
  categories: [{
    id: 'prefix', name: '앞 두 글자', rule: '앞 두 글자로 네 글자', questions: [
      { id: 'prefix-a2b3', prompt: '코스○○', answers: ['코스요리', '코스모스'], note: '세 글자 불인정' },
      { id: 'prefix-c4d5', prompt: '노발○○', answers: ['노발대발'] },
    ],
  }],
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'camp-game-test-'));
  for (const sub of ['app', 'data', 'assets']) await cp(join(ROOT, sub), join(dir, sub), { recursive: true });
  for (const f of ['index.html', 'host.html', 'admin.html']) await cp(join(ROOT, f), join(dir, f)).catch(() => {});
  await writeFile(join(dir, 'data/games/photo-quiz.json'), serializeGame(PHOTO_GAME));
  await writeFile(join(dir, 'data/games/emoji-quiz.json'), serializeGame(EMOJI_GAME));
  await writeFile(join(dir, 'data/games/chain-talk.json'), serializeGame(CHAIN_GAME));
  await mkdir(join(dir, 'assets/photo-quiz/food-zoom'), { recursive: true });
  await writeFile(join(dir, 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png'), PNG);
  app = await createAppServer({ root: dir, port: 0, pin: PIN, log: () => {} });
  base = app.url;
  origin = base;
});
after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const W = () => ({ 'X-Camp-App': '1', Origin: origin, 'Content-Type': 'application/json' });
const A = (pin = PIN) => ({ ...W(), 'X-Admin-Pin': pin });
const json = (r) => r.json();

test('health · 정적 파일 · 막힌 경로 (S-7, K-3-9)', async () => {
  const h = await fetch(`${base}/api/health`).then(json);
  assert.equal(h.app, 'camp-game');
  // 노트북 모드는 게임 화면에 PIN 이 없다 (서버 모드는 server-mode.test.js)
  assert.deepEqual(await fetch(`${base}/api/session`).then(json), { mode: 'local', loggedIn: true });
  assert.equal((await fetch(`${base}/data/app.json`)).status, 200);
  assert.equal((await fetch(`${base}/assets/photo-quiz/food-zoom/food-zoom-k7q2.png`)).headers.get('content-type'), 'image/png');
  for (const p of ['/server.mjs', '/docs/README.md', '/.git/config', '/data/.backup/x.json', '/app/../server.mjs', '/state/settings.json', '/server/app.mjs', '/%2e%2e/server.mjs']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test('이미지 ETag — 바뀌지 않았으면 304, 고치면 새 ETag. 데이터 JSON 은 그대로 no-store (R-51, X-46)', async () => {
  const put = (body) => fetch(`${base}/api/admin/assets/photo-quiz/food-zoom/food-zoom-et01.png`, { method: 'PUT', headers: { ...A(), 'Content-Type': 'image/png' }, body });
  assert.equal((await put(PNG)).status, 200);
  const url = `${base}/assets/photo-quiz/food-zoom/food-zoom-et01.png`;
  const r1 = await fetch(url);
  const etag = r1.headers.get('etag');
  assert.match(etag, /^W\/"[0-9a-z]+-[0-9a-z]+"$/);
  assert.equal(r1.headers.get('cache-control'), 'private, no-cache');
  const r2 = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(r2.status, 304);
  assert.equal((await r2.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': 'W/"0-0"' } })).status, 200, '다른 ETag 면 내용');
  assert.equal((await put(Buffer.concat([PNG, Buffer.alloc(8)]))).status, 200);
  const r3 = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(r3.status, 200, '고친 이미지는 다시 받음');
  assert.notEqual(r3.headers.get('etag'), etag);
  const data = await fetch(`${base}/data/app.json`);
  assert.equal(data.headers.get('etag'), null);
  assert.equal(data.headers.get('cache-control'), 'no-store');
});

test('없는 이미지 확인(HEAD)은 이미지 본문을 읽지 않는다 — 있는지 · 크기 · ETag 만 (R-55, X-51)', async () => {
  const url = `${base}/assets/photo-quiz/food-zoom/food-zoom-k7q2.png`;
  const reads = [];
  const orig = app.ctx.store.readWithInfo;
  app.ctx.store.readWithInfo = (rel) => { reads.push(rel); return orig(rel); };
  try {
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), PNG.length);
    assert.equal((await fetch(`${base}/assets/photo-quiz/food-zoom/food-zoom-none.png`, { method: 'HEAD' })).status, 404);
    assert.deepEqual(reads, [], 'HEAD 는 본문을 읽지 않음');
    const get = await fetch(url);
    assert.equal(get.headers.get('etag'), head.headers.get('etag'), 'GET 과 같은 ETag');
    assert.equal((await get.arrayBuffer()).byteLength, PNG.length);
    assert.equal(reads.length, 1);
  } finally { app.ctx.store.readWithInfo = orig; }
});

test('localhost 접속은 127.0.0.1 로 이동 (S-5)', async () => {
  const port = new URL(base).port;
  const http = await import('node:http');
  const status = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers: { Host: `localhost:${port}` } }, (res) => {
      resolve([res.statusCode, res.headers.location]);
      res.resume();
    });
  });
  assert.deepEqual(status, [302, `http://127.0.0.1:${port}/`]);
});

test('쓰기 요청 보호 — X-Camp-App · Origin · PIN 헤더 (S-8, S-9, I-33)', async () => {
  const g = await fetch(`${base}/api/admin/games/photo-quiz`, { headers: A() }).then(json);
  const body = JSON.stringify({ data: g.data });
  let r = await fetch(`${base}/api/admin/games/photo-quiz`, { method: 'PUT', headers: { ...A(), 'X-Camp-App': '0', 'If-Match': g.revision }, body });
  assert.equal(r.status, 403);
  r = await fetch(`${base}/api/admin/games/photo-quiz`, { method: 'PUT', headers: { ...A(), Origin: 'http://evil.example', 'If-Match': g.revision }, body });
  assert.equal(r.status, 403);
  const { 'X-Admin-Pin': _, ...noPin } = A();
  r = await fetch(`${base}/api/admin/games/photo-quiz`, { method: 'PUT', headers: { ...noPin, 'If-Match': g.revision }, body });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${base}/api/admin/check`)).status, 401);
});

test('게임 데이터 저장 — 리비전 · 검증 · 백업 · 같은 글자면 안 씀 (S-10, S-11, I-25, J-2)', async () => {
  const g = await fetch(`${base}/api/admin/games/emoji-quiz`, { headers: A() }).then(json);
  // 바뀐 게 없으면 파일을 다시 쓰지 않는다
  let r = await fetch(`${base}/api/admin/games/emoji-quiz`, { method: 'PUT', headers: { ...A(), 'If-Match': g.revision }, body: JSON.stringify({ data: g.data }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).revision, g.revision);
  // 문제 추가 (고정 자료의 문제와 겹치지 않는 값)
  const countOf = (d) => d.categories.reduce((n, c) => n + (c.questions?.length ?? 0), 0);
  const data = structuredClone(g.data);
  data.categories[0].questions.push({ id: 'movie-9cwe', answer: '저장 테스트 정답', emojis: '🧪🔬🧫', reveal: 'sequential' });
  r = await fetch(`${base}/api/admin/games/emoji-quiz`, { method: 'PUT', headers: { ...A(), 'If-Match': g.revision }, body: JSON.stringify({ data }) });
  assert.equal(r.status, 200);
  const saved = await readFile(join(dir, 'data/games/emoji-quiz.json'), 'utf8');
  assert.ok(saved.includes('"emojis": "🧪🔬🧫"'));
  const backups = await readdir(join(dir, 'data/.backup'));
  assert.ok(backups.some((f) => f.startsWith('emoji-quiz-')));
  // 낡은 리비전 → 409
  r = await fetch(`${base}/api/admin/games/emoji-quiz`, { method: 'PUT', headers: { ...A(), 'If-Match': g.revision }, body: JSON.stringify({ data }) });
  assert.equal(r.status, 409);
  // 검증 오류 → 422, 파일 그대로
  const cur = await fetch(`${base}/api/admin/games/emoji-quiz`, { headers: A() }).then(json);
  const bad = structuredClone(cur.data);
  bad.categories[0].questions.push({ id: 'movie-9cwe', answer: '중복' });
  r = await fetch(`${base}/api/admin/games/emoji-quiz`, { method: 'PUT', headers: { ...A(), 'If-Match': cur.revision }, body: JSON.stringify({ data: bad }) });
  assert.equal(r.status, 422);
  assert.ok((await r.json()).errors.some((e) => e.code === 'E05' || e.code === 'E09'));
  assert.equal(await readFile(join(dir, 'data/games/emoji-quiz.json'), 'utf8'), saved);
  // 백업 목록 · 복원
  const list = await fetch(`${base}/api/admin/backups?game=emoji-quiz`, { headers: A() }).then(json);
  assert.ok(list.length >= 1 && list[0].questions === countOf(g.data));
  r = await fetch(`${base}/api/admin/backups/${list[0].file}/restore`, { method: 'POST', headers: A() });
  assert.equal(r.status, 200);
  assert.ok(!(await readFile(join(dir, 'data/games/emoji-quiz.json'), 'utf8')).includes('저장 테스트 정답'));
});

test('이미지 저장 규칙 (S-12)', async () => {
  const png = PNG;
  let r = await fetch(`${base}/api/admin/assets/photo-quiz/person/person-abcd.png`, { method: 'PUT', headers: { ...A(), 'Content-Type': 'image/png' }, body: png });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { path: 'assets/photo-quiz/person/person-abcd.png' }, '파일 저장소는 Blob 주소 없음 (R-70)');
  r = await fetch(`${base}/api/admin/assets/photo-quiz/person/evil.exe`, { method: 'PUT', headers: { ...A(), 'Content-Type': 'image/png' }, body: png });
  assert.equal(r.status, 400);
  r = await fetch(`${base}/api/admin/assets/photo-quiz/..%2F..%2Fserver/x.png`, { method: 'PUT', headers: { ...A(), 'Content-Type': 'image/png' }, body: png });
  assert.equal(r.status, 400);
  r = await fetch(`${base}/api/admin/assets/photo-quiz/person/big.png`, { method: 'PUT', headers: { ...A(), 'Content-Type': 'image/png' }, body: Buffer.alloc(16 * 1024 * 1024) });
  assert.equal(r.status, 413);
  const check = await fetch(`${base}/api/admin/check`, { headers: A() }).then(json);
  const photo = check.games.find((g) => g.id === 'photo-quiz');
  assert.ok(photo.unusedImages.includes('assets/photo-quiz/person/person-abcd.png'), 'W08 쓰지 않는 이미지');
});

test('안 쓰는 이미지 정리 — 목록 · 지우기, 문제가 쓰는 이미지는 지우지 않음 (R-68, X-54)', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(3000)]);
  let r = await fetch(`${base}/api/admin/assets/photo-quiz/food-zoom/food-zoom-old1.png`, { method: 'PUT', headers: { ...A(), 'Content-Type': 'image/png' }, body: big });
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/api/admin/images/unused`)).status, 401, 'PIN 없이는 안 됨');
  const list = await fetch(`${base}/api/admin/images/unused`, { headers: A() }).then(json);
  const old = list.images.find((x) => x.path === 'assets/photo-quiz/food-zoom/food-zoom-old1.png');
  assert.equal(old.game, 'photo-quiz');
  assert.equal(old.size, big.length);
  assert.ok(old.mtimeMs > 0);
  assert.ok(!list.images.some((x) => x.path === 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png'), '문제가 쓰는 이미지는 목록에 없음');
  assert.deepEqual(list.images.map((x) => x.size), list.images.map((x) => x.size).sort((a, b) => b - a), '큰 것부터');

  const del = (path, headers = A()) => fetch(`${base}/api/admin/${path}`, { method: 'DELETE', headers });
  assert.equal((await del('assets/photo-quiz/food-zoom/food-zoom-k7q2.png')).status, 409, '문제가 쓰는 이미지');
  assert.ok(await readFile(join(dir, 'assets/photo-quiz/food-zoom/food-zoom-k7q2.png')));
  assert.equal((await del('assets/photo-quiz/food-zoom/food-zoom-old1.png', { 'X-Admin-Pin': PIN, Origin: origin })).status, 403, 'X-Camp-App 없이');
  assert.equal((await del('assets/photo-quiz/food-zoom/food-zoom-old1.png', { ...A(), Origin: 'https://evil.example' })).status, 403, '다른 출처');
  r = await del('assets/photo-quiz/food-zoom/food-zoom-old1.png');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { path: 'assets/photo-quiz/food-zoom/food-zoom-old1.png', size: big.length });
  await assert.rejects(readFile(join(dir, 'assets/photo-quiz/food-zoom/food-zoom-old1.png')), { code: 'ENOENT' });
  assert.equal((await del('assets/photo-quiz/food-zoom/food-zoom-old1.png')).status, 404, '이미 지움');
  assert.equal((await del('assets/photo-quiz/..%2F..%2Fdata/app.json')).status, 400);
  const after = await fetch(`${base}/api/admin/images/unused`, { headers: A() }).then(json);
  assert.ok(!after.images.some((x) => x.path.endsWith('food-zoom-old1.png')));
});

test('상태 파일 — 만들기 · 리비전 · 409 · 백업 · 형식 오류 (K-3-1, K-3-5)', async () => {
  const settings = { version: 1, teams: [{ name: '팀A', color: '#3b82f6' }, { name: '팀B', color: '#ef4444' }], display: { title: null, subtitle: null }, games: {} };
  let r = await fetch(`${base}/api/state/settings`, { method: 'PUT', headers: { ...W(), 'If-Match': '*' }, body: JSON.stringify({ data: settings }) });
  assert.equal(r.status, 200);
  const rev1 = (await r.json()).revision;
  r = await fetch(`${base}/api/state/settings`, { method: 'PUT', headers: { ...W(), 'If-Match': '*' }, body: JSON.stringify({ data: settings }) });
  assert.equal(r.status, 409, '이미 있는데 처음 만들기');
  settings.teams[0].name = '팀가';
  r = await fetch(`${base}/api/state/settings`, { method: 'PUT', headers: { ...W(), 'If-Match': rev1 }, body: JSON.stringify({ data: settings }) });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/state/settings`, { method: 'PUT', headers: { ...W(), 'If-Match': rev1 }, body: JSON.stringify({ data: settings }) });
  assert.equal(r.status, 409);
  const conflict = await r.json();
  assert.equal(conflict.data.teams[0].name, '팀가', '409 응답에 최신 내용');
  r = await fetch(`${base}/api/state/settings`, { method: 'PUT', headers: { ...W(), 'If-Match': conflict.revision }, body: JSON.stringify({ data: { version: 2 } }) });
  assert.equal(r.status, 422);
  const all = await fetch(`${base}/api/state`).then(json);
  assert.equal(all.settings.data.teams[0].name, '팀가');
  assert.ok((await readdir(join(dir, 'state/.backup'))).some((f) => f.startsWith('settings-')));
  const text = await readFile(join(dir, 'state/settings.json'), 'utf8');
  assert.ok(text.includes('{ "name": "팀가", "color": "#3b82f6" }'));
});

/** SSE 읽기 도우미 */
async function openSse(url, headers = {}) {
  const ctrl = new AbortController();
  const res = await fetch(url, { headers, signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const queue = [];
  let wake;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev) { queue.push({ event: ev, data: data ? JSON.parse(data) : null }); wake?.(); }
        }
      }
    } catch { /* 닫힘 */ }
  })();
  return {
    status: res.status,
    async next(event, timeout = 2000) {
      const t0 = Date.now();
      for (;;) {
        const idx = queue.findIndex((e) => e.event === event);
        if (idx >= 0) return queue.splice(idx, 1)[0].data;
        if (Date.now() - t0 > timeout) throw new Error(`${event} 이벤트가 오지 않음`);
        await new Promise((r) => { wake = r; setTimeout(r, 50); });
      }
    },
    close: () => ctrl.abort(),
  };
}

test('진행자 — PIN 입장 · 상태 전달 · 명령 전달 (V-1 ~ V-7, W-18, W-19)', async () => {
  assert.equal((await fetch(`${base}/api/host/state`)).status, 401, 'V-5');
  let r = await fetch(`${base}/api/host/login`, { method: 'POST', headers: W(), body: JSON.stringify({ pin: wrongPin(1) }) });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/api/host/login`, { method: 'POST', headers: W(), body: JSON.stringify({ pin: PIN }) });
  assert.equal(r.status, 204);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const H = { ...W(), Cookie: cookie };

  r = await fetch(`${base}/api/host/command`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'c1', cmd: 'question.reveal', basedOn: 1 }) });
  assert.equal(r.status, 409, '게임 화면 미연결');
  r = await fetch(`${base}/api/host/command`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'c1', cmd: 'rm -rf' }) });
  assert.equal(r.status, 400);

  const game = await openSse(`${base}/api/live/commands?clientId=test-client-1`);
  await game.next('hello');
  const host = await openSse(`${base}/api/host/stream`, { Cookie: cookie });
  await host.next('state');

  const live = { v: 1, clientId: 'test-client-1', seq: 5, view: 'play', gameId: 'photo-quiz', type: 'photo', screen: 'question', questionId: 'food-zoom-k7q2', roundIndex: 0, questionIndex: 0, roundQuestionIds: ['food-zoom-k7q2'], roundCandidateIds: ['food-zoom-k7q2'], picks: [{ categoryId: 'food-zoom', questionIds: ['food-zoom-k7q2'] }], teams: [] };
  r = await fetch(`${base}/api/live`, { method: 'POST', headers: W(), body: JSON.stringify(live) });
  assert.equal(r.status, 204);
  const st = await host.next('state');
  assert.equal(st.question.answer, '샘플 국수', '진행자 화면에는 정답');
  assert.equal(st.roundList[0].answer, '샘플 국수');
  assert.equal(st.roundList[0].id, 'food-zoom-k7q2', '다음 문제 지정용 id (R-35)');
  assert.equal(st.picks[0].name, '확대 음식');
  assert.deepEqual(st.roundCandidates, [{ id: 'food-zoom-k7q2', answer: '샘플 국수' }], '라운드에 안 뽑힌 후보 — 정답을 붙여 (R-52)');
  assert.equal(st.roundCandidateIds, undefined);

  r = await fetch(`${base}/api/host/command`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'c2', cmd: 'question.reveal', basedOn: 5 }) });
  assert.equal(r.status, 202);
  const cmd = await game.next('command');
  assert.deepEqual([cmd.cmd, cmd.basedOn], ['question.reveal', 5]);
  r = await fetch(`${base}/api/host/command`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'c3', cmd: 'question.setNext', args: { questionId: 'food-zoom-k7q2' }, basedOn: 5 }) });
  assert.equal(r.status, 202, '다음 문제 지정 명령 (R-35)');
  const setNext = await game.next('command');
  assert.deepEqual([setNext.cmd, setNext.args], ['question.setNext', { questionId: 'food-zoom-k7q2' }]);

  // 줄줄이 말해요 문제 — 지금 문제의 정답 후보만, 낸 문제는 글자만 (R-44, W-35)
  const chain = { v: 1, clientId: 'test-client-1', seq: 6, view: 'play', gameId: 'chain-talk', type: 'roulette', screen: 'topic', picks: [{ categoryId: 'prefix' }], topicId: 'prefix', topicQuestionIds: ['prefix-c4d5', 'prefix-a2b3'], topicQuestionId: 'prefix-a2b3', topicRemaining: 0, answersVisible: false, topicList: [{ id: 'prefix-a2b3', state: 'current' }, { id: 'prefix-c4d5', state: 'asked' }], topicNextId: null, questionOrder: 'fixed', teams: [] };
  r = await fetch(`${base}/api/live`, { method: 'POST', headers: W(), body: JSON.stringify(chain) });
  assert.equal(r.status, 204);
  const ct = await host.next('state');
  assert.deepEqual(ct.topic.question, { id: 'prefix-a2b3', no: 2, prompt: '코스○○', answers: ['코스요리', '코스모스'], note: '세 글자 불인정' });
  assert.deepEqual(ct.topic.asked, ['노발○○', '코스○○']);
  assert.equal(ct.topic.remaining, 0);
  assert.ok(!JSON.stringify(ct).includes('노발대발'), '지난 문제의 정답 후보는 주지 않음');
  assert.equal(ct.topicQuestionIds, undefined);
  // 진행자가 골라 내는 목록 — 문제 글자만 (R-45)
  assert.deepEqual(ct.topic.list.map((it) => [it.id, it.n, it.prompt, it.state]), [['prefix-a2b3', 1, '코스○○', 'current'], ['prefix-c4d5', 2, '노발○○', 'asked']]);
  assert.equal(ct.topic.order, 'fixed');
  assert.equal(ct.topicList, undefined);
  // 룰렛 결과 지정 (R-48) — 지정한 카테고리가 게임 화면까지 그대로
  for (const [id, c, args] of [['c4', 'topic.question', {}], ['c5', 'topic.answers', {}], ['c6', 'topic.question', { questionId: 'prefix-c4d5' }], ['c7', 'roulette.spin', { categoryId: 'prefix' }]]) {
    r = await fetch(`${base}/api/host/command`, { method: 'POST', headers: H, body: JSON.stringify({ id, cmd: c, args, basedOn: 6 }) });
    assert.equal(r.status, 202, c);
    const got = await game.next('command');
    assert.deepEqual([got.cmd, got.args], [c, args]);
  }

  // 추가 문제 고르기 (R-54) — 후보에 카테고리 이름 · 정답을 붙이고, 고른 문제가 게임 화면까지 그대로
  const result = { v: 1, clientId: 'test-client-1', seq: 7, view: 'play', gameId: 'photo-quiz', type: 'photo', screen: 'result', picks: [], teams: [],
    result: { counts: [1, 1, 0], ranks: [1, 1, 3], ties: [[0, 1]], allRevealed: true, tiebreakAvailable: true, tiebreakChoices: [{ categoryId: 'food-zoom', questionIds: ['food-zoom-k7q2'] }] } };
  r = await fetch(`${base}/api/live`, { method: 'POST', headers: W(), body: JSON.stringify(result) });
  assert.equal(r.status, 204);
  const rs = await host.next('state');
  assert.deepEqual(rs.result.tiebreakChoices.map((c) => [c.id, c.name, c.questions]), [['food-zoom', '확대 음식', [{ id: 'food-zoom-k7q2', answer: '샘플 국수' }]]]);
  assert.deepEqual(rs.result.ties, [[0, 1]], '나머지 결과 값은 그대로');
  r = await fetch(`${base}/api/host/command`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'c8', cmd: 'result.tiebreak', args: { questionId: 'food-zoom-k7q2' }, basedOn: 7 }) });
  assert.equal(r.status, 202);
  const tb = await game.next('command');
  assert.deepEqual([tb.cmd, tb.args], ['result.tiebreak', { questionId: 'food-zoom-k7q2' }]);

  // 이모티콘 퀴즈 문제 고르기 (R-90) — 남은 문제에 카테고리 이름 · 이모지 · 정답을 붙이고, [내기] 가 게임 화면까지 그대로
  const pick = { v: 1, clientId: 'test-client-1', seq: 8, view: 'play', gameId: 'emoji-quiz', type: 'emoji', screen: 'roulette', picks: [], teams: [], pickMode: true, askedCount: 0, pickChoices: [{ categoryId: 'movie', questionIds: ['movie-7xkz'] }] };
  r = await fetch(`${base}/api/live`, { method: 'POST', headers: W(), body: JSON.stringify(pick) });
  assert.equal(r.status, 204);
  const ps = await host.next('state');
  assert.deepEqual(ps.pickChoices.map((c) => [c.id, c.name, c.questions]), [['movie', '영화', [{ id: 'movie-7xkz', emojis: '🪱🏠💰', image: false, answer: '기생충' }]]]);
  r = await fetch(`${base}/api/live`, { method: 'POST', headers: W(), body: JSON.stringify({ ...pick, seq: 9, screen: 'result' }) });
  assert.equal((await host.next('state')).pickChoices, undefined, '결과 화면에는 문제 목록을 주지 않는다');
  r = await fetch(`${base}/api/host/command`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'c9', cmd: 'question.pick', args: { questionId: 'movie-7xkz' }, basedOn: 9 }) });
  assert.equal(r.status, 202);
  const qp = await game.next('command');
  assert.deepEqual([qp.cmd, qp.args], ['question.pick', { questionId: 'movie-7xkz' }]);

  r = await fetch(`${base}/api/host/logout`, { method: 'POST', headers: H });
  assert.equal(r.status, 204);
  assert.equal((await fetch(`${base}/api/host/state`, { headers: { Cookie: cookie } })).status, 401, 'V-16');
  host.close();
  game.close();
});

test('게임 화면은 하나만 — 다른 창 확인 · 이전 창 닫기 · 다른 창 열기 막기 (R-46)', async () => {
  const peers = (id) => fetch(`${base}/api/live/peers?clientId=${id}`).then(json);
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: W(), body: JSON.stringify(body) });
  const host = async () => fetch(`${base}/api/host/login`, { method: 'POST', headers: W(), body: JSON.stringify({ pin: PIN }) })
    .then((r) => r.headers.get('set-cookie').split(';')[0])
    .then((cookie) => fetch(`${base}/api/host/state`, { headers: { Cookie: cookie } }).then(json));

  await new Promise((r) => setTimeout(r, 100)); // 앞 테스트의 게임 화면 연결이 닫히기를
  const a = await openSse(`${base}/api/live/commands?clientId=gate-client-a`);
  await a.next('hello');
  assert.deepEqual(await a.next('lock'), { on: false });
  assert.deepEqual(await peers('gate-client-b'), { others: 1, locked: false }, '새 창에서 보면 다른 창 1개');
  assert.deepEqual(await peers('gate-client-a'), { others: 0, locked: false }, '자기 자신은 세지 않음');

  // 진행 중인 창 A 의 상태 — 연결 안 된 창(B)의 보고는 받지 않는다
  const playing = { v: 1, clientId: 'gate-client-a', view: 'play', gameId: 'photo-quiz', type: 'photo', screen: 'question', questionId: 'food-zoom-k7q2', teams: [] };
  assert.equal((await post('/api/live', playing)).status, 204);
  assert.equal((await post('/api/live', { v: 1, clientId: 'gate-client-b', view: 'title', teams: [] })).status, 204);
  assert.equal((await host()).view, 'play', '연결 안 된 창이 덮어쓰지 못함');

  // B 가 이전 창(A)을 닫는다 → A 에 kick
  assert.equal((await post('/api/live/takeover', { clientId: 'gate-client-b' })).status, 204);
  await a.next('kick');
  assert.equal((await host()).live, false, '새 창이 보낼 때까지 진행 중인 문제 없음');
  const b = await openSse(`${base}/api/live/commands?clientId=gate-client-b`);
  await b.next('hello');
  assert.deepEqual(await b.next('lock'), { on: false }, '연결 직후 지금 막기 상태');
  assert.deepEqual(await peers('gate-client-c'), { others: 1, locked: false }, 'A 는 연결 목록에서 빠짐');

  // 다른 창 열기 막기 → 새 창 C 는 붙지 못하고, 이전 창 닫기도 거절
  assert.equal((await post('/api/live/lock', { on: true })).status, 204);
  assert.deepEqual(await b.next('lock'), { on: true });
  assert.deepEqual(await peers('gate-client-c'), { others: 1, locked: true });
  const c = await openSse(`${base}/api/live/commands?clientId=gate-client-c`);
  await c.next('blocked');
  assert.equal((await post('/api/live/takeover', { clientId: 'gate-client-c' })).status, 423);
  assert.deepEqual(await peers('gate-client-c'), { others: 1, locked: true }, '막힌 창은 연결 목록에 들어가지 않음');

  // 막아 둔 창이 닫히면 새 창은 열 수 있다
  b.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await peers('gate-client-c')).others, 0);
  assert.equal((await post('/api/live/lock', { on: false })).status, 204);
  a.close();
  c.close();
});

test('상태 저장 · 관리 저장 → 게임 창 reload 알림', async () => {
  const game = await openSse(`${base}/api/live/commands?clientId=test-client-2`);
  await game.next('hello');
  const cur = await fetch(`${base}/api/state`).then(json);
  const route = { version: 1, route: { view: 'title' } };
  const r = await fetch(`${base}/api/state/route`, { method: 'PUT', headers: { ...W(), 'If-Match': cur.route?.revision ?? '*' }, body: JSON.stringify({ data: route }) });
  const { revision } = await r.json();
  const ev = await game.next('reload');
  assert.deepEqual(ev, { kind: 'state', name: 'route', revision });
  game.close();
});

test('상태 초기화 — 팀을 지우면 진행 기록 · 점수판도 (R-32, I-40 ~ I-44)', async () => {
  const cur = await fetch(`${base}/api/state`).then(json);
  const session = { version: 1, gameId: 'photo-quiz', type: 'photo', status: 'active', screen: 'roulette', wheel: [], picks: [], history: [], snapshot: { teamCount: 2, candidates: [], options: {} } };
  await fetch(`${base}/api/state/sessions/photo-quiz`, { method: 'PUT', headers: { ...W(), 'If-Match': cur.sessions['photo-quiz']?.revision ?? '*' }, body: JSON.stringify({ data: session }) });
  const sb = { version: 1, rounds: null, entries: { jegi: [{ rank: 1 }, { rank: 2 }] }, filled: {} };
  await fetch(`${base}/api/state/scoreboard`, { method: 'PUT', headers: { ...W(), 'If-Match': cur.scoreboard?.revision ?? '*' }, body: JSON.stringify({ data: sb }) });

  assert.equal((await fetch(`${base}/api/admin/state/reset`, { method: 'POST', headers: W(), body: JSON.stringify({ targets: ['sessions'] }) })).status, 401, 'I-44');
  let r = await fetch(`${base}/api/admin/state/reset`, { method: 'POST', headers: A(), body: JSON.stringify({ targets: ['teams'] }) });
  assert.equal(r.status, 200);
  const after = await fetch(`${base}/api/state`).then(json);
  assert.deepEqual(after.settings.data.teams, []);
  assert.equal(after.sessions['photo-quiz'].data.empty, true);
  assert.deepEqual(after.scoreboard.data.entries, {});
  const backups = await readdir(join(dir, 'state/.backup'));
  assert.ok(backups.some((f) => f.startsWith('session-photo-quiz-')), '진행 기록도 백업');
});

test('PIN 실패 5회 → 잠금 (진행자 · 관리 합산, I-29)', async () => {
  for (const pin of [wrongPin(1), wrongPin(2), wrongPin(3)]) {
    assert.equal((await fetch(`${base}/api/admin/verify`, { method: 'POST', headers: A(pin) })).status, 401);
  }
  // 같은 틀린 PIN 이 반복되면 1회로
  assert.equal((await fetch(`${base}/api/admin/verify`, { method: 'POST', headers: A(wrongPin(3)) })).status, 401);
  assert.equal((await fetch(`${base}/api/host/login`, { method: 'POST', headers: W(), body: JSON.stringify({ pin: wrongPin(4) }) })).status, 401);
  assert.equal((await fetch(`${base}/api/host/login`, { method: 'POST', headers: W(), body: JSON.stringify({ pin: wrongPin(5) }) })).status, 429);
  assert.equal((await fetch(`${base}/api/admin/verify`, { method: 'POST', headers: A() })).status, 429, '잠금 중에는 맞는 PIN 도 거절');
});

test('백업 — 게임별 최근 20개만, 가장 오래된 것부터 지움 (I-25)', async () => {
  const { backupFile, listBackups } = await import('../server/files.mjs');
  const { createFileStore } = await import('../server/store.mjs');
  const store = createFileStore(dir);
  for (let i = 1; i <= 22; i++) {
    await store.writeFile('rotation-src.json', JSON.stringify({ n: i }));
    await backupFile(store, 'rotation-src.json', 'rotation-backup', 'rotation', 20);
  }
  const bdir = join(dir, 'rotation-backup');
  const list = await listBackups(store, 'rotation-backup', 'rotation');
  assert.equal(list.length, 20);
  const kept = await Promise.all(list.map(async (b) => JSON.parse(await readFile(join(bdir, b.name), 'utf8')).n));
  assert.deepEqual(kept, Array.from({ length: 20 }, (_, i) => 22 - i), '최신부터 20개 — 1 · 2 번째 백업이 지워짐');
});

test('이미지 주소 표 — 노트북 모드(파일 저장소)는 표가 없어 null, 화면은 /assets/… 그대로 (R-70, X-58)', async () => {
  const r = await fetch(`${base}/api/assets`).then(json);
  assert.deepEqual(r, { images: null }); // 올리기 응답에 url 이 없는 것은 S-12 (path 만)
});
