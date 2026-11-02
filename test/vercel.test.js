// Vercel 함수 진입점 · 공개 파일 막기 (R-51 · DEP-15, docs/08-tech.md 11-5, 11-acceptance-tests X-43 · X-44)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStatic } from '../server/static.mjs';
import { readEnv, VERCEL_ORIGIN_VARS } from '../server/config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const HOST = 'camp.test';

/** includeFiles 의 `{a,b,…}` 목록 */
const included = () => vercel.functions['api/index.js'].includeFiles.replace(/^\{|\}$/g, '').split(',');

test('모든 경로를 함수로 — 공개 폴더는 robots.txt 뿐 (X-44)', () => {
  assert.deepEqual(vercel.rewrites, [{ source: '/(.*)', destination: '/api/index' }]);
  assert.equal(vercel.outputDirectory, 'public');
  assert.deepEqual(readdirSync(join(ROOT, 'public')), ['robots.txt']);
  assert.match(readFileSync(join(ROOT, 'public/robots.txt'), 'utf8'), /Disallow: \//);
  assert.deepEqual(vercel.regions, ['icn1']);
});

test('함수에 넣는 파일 — 서버가 코드 폴더에서 내주는 것은 모두, 문서 · 상태는 설명서 · 템플릿만 (X-44)', () => {
  const inc = included();
  const glob = (g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`);
  const covers = (rel) => inc.some((g) => glob(g).test(rel));
  for (const p of ['/', '/host', '/admin', '/play', '/app/main.js', '/app/host/main.js', '/app/play/main.js', '/docs/manual.md', '/docs/templates/emoji-quiz-template.tsv']) {
    const [rel, , where] = resolveStatic(p);
    assert.equal(where, 'app', p);
    assert.ok(covers(rel), `${rel} 이 includeFiles 에 없음`);
  }
  // 초기 데이터(CAMP_SEED)는 함수 안에만 — 정적 파일로 나가지 않는다
  assert.ok(covers('data/games/photo-quiz.json') && covers('data/app.json'));
  for (const g of inc) assert.doesNotMatch(g, /^(docs\/\*\*|state|\.claude|\.camp-secret|data\/\*\*)/, g);
});

test('실시간 연결은 함수 실행 시간 상한보다 먼저 끊고 다시 붙는다 (X-45)', () => {
  const max = vercel.functions['api/index.js'].maxDuration;
  assert.ok(max <= 300, '무료 플랜 상한 300초');
  const src = readFileSync(join(ROOT, 'api/index.js'), 'utf8');
  const ms = Number(/STREAM_MAX_MS = ([\d_]+)/.exec(src)[1].replace(/_/g, ''));
  assert.ok(ms <= (max - 20) * 1000, `${ms}ms 는 ${max}초보다 넉넉히 짧아야 함`);
});

// ── 함수를 실제 요청으로 ─────────────────────────────────────

const env = { ...process.env };
let dataDir;
after(async () => {
  process.env = env;
  if (dataDir) await rm(dirname(dataDir), { recursive: true, force: true });
});

/** handler 를 Node 서버에 붙여 요청 하나 — Host 를 정할 수 있게 http.request */
async function call(handler, path, headers = {}) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: server.address().port, path, headers: { Host: HOST, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      r.on('error', reject);
      r.end();
    });
  } finally {
    server.close();
  }
}

test('함수 진입점 — 첫 요청에 앱을 만들고 화면 · 설명서는 열림, 정답 데이터는 로그인 필요 (X-43)', async () => {
  dataDir = join(await mkdtemp(join(tmpdir(), 'camp-vercel-')), 'data');
  process.env = { ...env, CAMP_PUBLIC_ORIGIN: `https://${HOST}`, CAMP_PIN: PIN, CAMP_DATA_DIR: dataDir };
  delete process.env.VERCEL;
  delete process.env.CAMP_REDIS_URL;
  const { default: handler } = await import('../api/index.js');
  const health = await call(handler, '/api/health');
  assert.equal(health.status, 200);
  const page = await call(handler, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/i);
  assert.equal((await call(handler, '/docs/manual.md')).status, 200);
  const session = JSON.parse((await call(handler, '/api/session')).body);
  assert.deepEqual(session, { mode: 'server', loggedIn: false });
  for (const p of ['/data/app.json', '/data/games/photo-quiz.json', '/api/state']) assert.equal((await call(handler, p)).status, 401, p);
  for (const p of ['/docs/08-tech.md', '/state/settings.json', '/.camp-secret', '/server/app.mjs', '/package.json']) assert.equal((await call(handler, p)).status, 404, p);
  assert.equal((await call(handler, '/', { Host: 'evil.test' })).status, 403);
});

test('설정이 없거나 틀리면 503 · 로그 — Vercel 에서 Redis 없이 · 서버 모드 아님 (X-43)', async (t) => {
  const errors = [];
  const orig = console.error;
  console.error = (m) => errors.push(String(m));
  t.after(() => { console.error = orig; });

  const clean = () => { for (const k of ['CAMP_REDIS_URL', 'REDIS_URL', 'KV_URL', 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'VERCEL', 'VERCEL_ENV', ...VERCEL_ORIGIN_VARS, 'CAMP_PUBLIC_ORIGIN', 'CAMP_PIN']) delete process.env[k]; };
  process.env = { ...env };
  clean();
  Object.assign(process.env, { VERCEL: '1', CAMP_PUBLIC_ORIGIN: `https://${HOST}`, CAMP_PIN: PIN });
  const noRedis = (await import('../api/index.js?no-redis')).default;
  const r1 = await call(noRedis, '/');
  assert.equal(r1.status, 503);
  assert.match(JSON.parse(r1.body).error, /REDIS_URL · KV_URL 또는 CAMP_REDIS_URL/, '응답에 무엇이 빠졌는지 (변수 이름만)');
  assert.match(errors.join('\n'), /REDIS_URL/);

  // Upstash 의 REST 주소만 있을 때
  process.env.KV_REST_API_URL = 'https://example.upstash.io';
  const restOnly = (await import('../api/index.js?rest-only')).default;
  assert.match(JSON.parse((await call(restOnly, '/')).body).error, /REST 주소만/);

  process.env = { ...env };
  clean();
  const local = (await import('../api/index.js?local')).default;
  const r2 = await call(local, '/api/health');
  assert.equal(r2.status, 503);
  assert.match(JSON.parse(r2.body).error, /CAMP_PUBLIC_ORIGIN/);
  assert.match(errors.join('\n'), /서버 모드로만/);

  // 미리보기 배포 — 운영 도메인 변수 · Upstash 연결 변수가 들어와도 켜지 않는다 (운영 Redis 를 지킴, R-63)
  process.env = { ...env };
  clean();
  Object.assign(process.env, { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: HOST, VERCEL_URL: 'camp-abc123.vercel.app', VERCEL_BRANCH_URL: 'camp-git-x.vercel.app', REDIS_URL: 'rediss://default:secret@example.upstash.io:6379' });
  const preview = (await import('../api/index.js?preview')).default;
  const r3 = await call(preview, '/');
  assert.equal(r3.status, 503);
  assert.match(JSON.parse(r3.body).error, /미리보기 배포\(preview\)는 쓰지 않습니다/);
  assert.doesNotMatch(errors.join('\n') + r1.body + r2.body + r3.body, new RegExp(`${PIN}|secret`), 'PIN · Redis 비밀번호는 로그 · 응답에 없다');
});

test('Vercel 운영 배포는 시스템 환경 변수로 공개 주소 — 운영 도메인이 대표, CAMP_PUBLIC_ORIGIN 은 더함, 미리보기 · Vercel 밖은 쓰지 않음 (X-52)', () => {
  const sys = { VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'camp.fun', VERCEL_URL: 'camp-abc123-team.vercel.app', VERCEL_BRANCH_URL: 'camp-git-main-team.vercel.app', CAMP_PIN: PIN };
  const all = ['https://camp.fun', 'https://camp-abc123-team.vercel.app', 'https://camp-git-main-team.vercel.app'];
  const prod = readEnv({ ...sys, VERCEL_ENV: 'production' });
  assert.deepEqual(prod.publicOrigins, all);
  assert.equal(prod.serverMode, true);
  assert.equal(prod.pin, PIN);
  // 예전에 넣은 CAMP_PUBLIC_ORIGIN 은 뒤에 더한다 (겹치면 하나)
  assert.deepEqual(readEnv({ ...sys, VERCEL_ENV: 'production', CAMP_PUBLIC_ORIGIN: 'https://camp.vercel.app, https://camp.fun' }).publicOrigins, [...all, 'https://camp.vercel.app']);
  // 브랜치 주소가 없는 배포 (CLI 로 올림)
  assert.deepEqual(readEnv({ ...sys, VERCEL_ENV: 'production', VERCEL_BRANCH_URL: '' }).publicOrigins, all.slice(0, 2));
  // 운영 도메인 변수는 미리보기에도 들어온다 — 미리보기 · 개발 · Vercel 밖에서는 서버 모드로 켜지 않음
  for (const e of [{ ...sys, VERCEL_ENV: 'preview' }, { ...sys, VERCEL_ENV: 'development' }, { ...sys, VERCEL: undefined, VERCEL_ENV: 'production' }]) {
    const c = readEnv(e);
    assert.deepEqual(c.publicOrigins, [], JSON.stringify(e));
    assert.equal(c.serverMode, false);
  }
  // 미리보기에 CAMP_PUBLIC_ORIGIN 을 넣으면 예전처럼 그것만
  assert.deepEqual(readEnv({ ...sys, VERCEL_ENV: 'preview', CAMP_PUBLIC_ORIGIN: 'https://camp.vercel.app' }).publicOrigins, ['https://camp.vercel.app']);
  assert.throws(() => readEnv({ ...sys, VERCEL_ENV: 'production', VERCEL_URL: 'a b/c' }), /VERCEL_URL 가 도메인 형식이 아닙니다/);
  assert.throws(() => readEnv({ ...sys, VERCEL_ENV: 'production', CAMP_PIN: undefined }), /CAMP_PIN/, 'PIN 은 여전히 직접 넣는다');
});

test('Redis 주소 — CAMP_REDIS_URL 이 먼저, 없으면 Vercel 의 Upstash 연결(REDIS_URL → KV_URL), Vercel 밖에서는 집지 않음 (X-43)', () => {
  const base = { CAMP_PUBLIC_ORIGIN: `https://${HOST}`, CAMP_PIN: PIN };
  const up = 'rediss://default:secret@example.upstash.io:6379';
  assert.equal(readEnv({ ...base, VERCEL: '1', REDIS_URL: up }).redis.source, 'REDIS_URL');
  assert.equal(readEnv({ ...base, VERCEL: '1', REDIS_URL: up }).redis.url, up);
  assert.equal(readEnv({ ...base, VERCEL: '1', KV_URL: up }).redis.source, 'KV_URL');
  assert.equal(readEnv({ ...base, VERCEL: '1', REDIS_URL: up, CAMP_REDIS_URL: 'redis://127.0.0.1:6379' }).redis.source, 'CAMP_REDIS_URL');
  assert.equal(readEnv({ ...base, REDIS_URL: up }).redis, null, 'Vercel 밖에서는 다른 용도의 REDIS_URL 을 쓰지 않음');
  assert.equal(readEnv({ REDIS_URL: up, VERCEL: '1' }).redis, null, '서버 모드가 아니면 오류 대신 저장 폴더 — 미리보기 배포는 api/index.js 가 503');
  assert.throws(() => readEnv({ ...base, VERCEL: '1', REDIS_URL: 'http://nope' }), /REDIS_URL 는 redis:\/\//);
});

test('이미지 Blob 저장소 — Redis 저장소는 언제나 Blob 필수, 토큰이 없으면 token: null (이미지 저장을 막음 — R-67 · DEP-27, X-55)', async () => {
  const sys = { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'camp.fun', CAMP_PIN: PIN, REDIS_URL: 'rediss://default:secret@example.upstash.io:6379' };
  const token = 'vercel_blob_rw_test_token';
  assert.deepEqual(readEnv({ ...sys, BLOB_READ_WRITE_TOKEN: token }).blob, { token });
  assert.deepEqual(readEnv(sys).blob, { token: null }, '토큰 없음 — Redis 로 가지 않게 Blob 필수로 넘김');
  assert.equal(readEnv({ ...sys, VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: token }).blob, null, '미리보기');
  assert.equal(readEnv({ ...sys, REDIS_URL: undefined, BLOB_READ_WRITE_TOKEN: token }).blob, null, 'Redis 저장소가 아님');
  assert.deepEqual(readEnv({ CAMP_PUBLIC_ORIGIN: `https://${HOST}`, CAMP_PIN: PIN, CAMP_REDIS_URL: 'redis://127.0.0.1:6379', BLOB_READ_WRITE_TOKEN: token }).blob, { token }, 'Vercel 밖 Redis 서버도');
  assert.equal(readEnv({ CAMP_PUBLIC_ORIGIN: `https://${HOST}`, CAMP_PIN: PIN }).blob, null, '저장 폴더 — 이미지는 파일');
  // SDK(@vercel/blob — D-34)는 켤 때만 불러온다 — 설치돼 있으면(Vercel 빌드) 쓰는 함수가 있는지
  let sdk = null;
  try { sdk = await import('@vercel/blob'); } catch { /* 노트북에서 npm install 없이 — 앱은 Blob 을 켜지 않으므로 괜찮다 */ }
  if (sdk) for (const fn of ['put', 'del']) assert.equal(typeof sdk[fn], 'function', fn);
});

test('서버가 Blob 에서 받을 때 Referer 로 우리 주소를 붙인다 — 저장소 방화벽(Referer 검사)을 지나게 (R-69, X-57)', async (t) => {
  const { fetchBytes, createBlob } = await import('../server/blob.mjs');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.referer ?? null);
    if (!String(req.headers.referer ?? '').startsWith('https://camp.fun/')) { res.writeHead(403); res.end(); return; } // 방화벽 흉내
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from('png-bytes'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/assets/g/c/q-a1-abcd1234.png`;
  assert.equal((await fetchBytes(url, 'https://camp.fun/')).toString(), 'png-bytes');
  await assert.rejects(fetchBytes(url), /Blob 에서 받지 못했습니다 \(403\)/, 'Referer 가 없으면 방화벽에 막힘');
  const blob = await createBlob({ token: 'x', referer: 'https://camp.fun/', load: async () => ({ put: async () => ({}), del: async () => {} }) });
  assert.equal((await blob.get(url)).toString(), 'png-bytes', 'createBlob 의 get 도 같은 Referer');
  assert.deepEqual(seen, ['https://camp.fun/', null, 'https://camp.fun/']);
});
