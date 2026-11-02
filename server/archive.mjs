// 백업 내려받기 · 올리기 (R-37, docs/04-admin.md 3-11, docs/08-tech.md 4-3)
// 내려받기: 저장소의 data · assets · state → tar. 올리기: tar 를 읽어 임시 폴더에 받고 → 검사 → 지금 내용을 자동 백업 → 한꺼번에 쓴다
// 나눠 올리기 (R-51 · DEP-18 — Vercel 요청 4.5MB 상한): 화면이 tar 를 읽어 시작(목록 · JSON 검사 · 자동 백업) → 이미지(4MB 조각) → 끝(JSON 쓰기)
// 저장소는 파일(저장 폴더) · Redis(R-50) — store.mjs
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tarHeader, tarEnd, padding, readHeader, classifyEntry, checkArchive, PARTS, BLOCK, ARCHIVE_LIMIT } from '../app/core/tar.js';
import { revisionOf, stamp } from './files.mjs';
import { walkFiles } from './store.mjs';
import { HttpError, sendJson, sendEmpty, readJson, readBody } from './guard.mjs';

export const AUTO_DIR = '.restore-backup';
const AUTO_KEEP = 3;
const AUTO_RE = /^camp-game-\d{8}-\d{6}(?:-\d+)?\.tar$/;

/**
 * 저장소의 백업 대상 파일 — 정해진 위치의 파일만 (자동 백업 · 숨김 · 임시 파일 · 서명 키 제외)
 * @param images false 면 이미지(assets/) 빼고 — 올리기 전 자동 백업 (올리기는 이미지를 지우지 않고 같은 이름만 덮어쓴다)
 */
async function collectFiles(store, { images = true } = {}) {
  const out = [];
  for (const top of [...PARTS.data, ...PARTS.state]) {
    if (!images && top === 'assets') continue;
    for (const r of await walkFiles(store, top)) if (!classifyEntry(r).skip) out.push(r);
  }
  return out;
}

/** 쓰기 — 받는 쪽이 밀리면 기다리고, 연결이 끊기면 멈춘다 */
async function put(out, chunk) {
  if (out.destroyed) throw new Error('연결이 끊겼습니다');
  if (out.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const done = (err) => {
      out.off('drain', done);
      out.off('close', closed);
      out.off('error', done);
      if (err) reject(err); else resolve();
    };
    const closed = () => done(new Error('연결이 끊겼습니다'));
    out.on('drain', done);
    out.on('close', closed);
    out.on('error', done);
  });
}

/** 저장소 → tar (응답 스트림 · 메모리 모음으로). 파일마다 내용 · 시각을 한 번에 읽는다 */
export async function writeArchive(store, out, opts) {
  for (const rel of await collectFiles(store, opts)) {
    const file = await store.readWithInfo(rel);
    if (!file) continue; // 그 사이 지워짐
    await put(out, tarHeader(rel, file.bytes.length, file.mtimeMs));
    await put(out, file.bytes);
    const pad = padding(file.bytes.length);
    if (pad) await put(out, new Uint8Array(pad));
  }
  await put(out, tarEnd());
}

/**
 * 요청 본문(tar)을 흘려 읽으며 백업 대상 파일만 임시 폴더에 받는다 — 전체를 메모리에 두지 않는다.
 * @returns {{ items: {path, size, cls, staged}[], skipped: {path, reason}[] }}
 */
async function receive(req, stageDir) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > ARCHIVE_LIMIT) { req.resume(); throw new HttpError(413, '백업 파일이 너무 큽니다 (300MB 까지)'); }
  const items = [];
  const skipped = [];
  let buf = Buffer.alloc(0);
  let total = 0;
  let stage = 'header'; // header → body → pad → header … → end
  let cur = null;
  let remaining = 0;
  let padLeft = 0;
  const finish = async () => {
    if (cur.keep) {
      const data = Buffer.concat(cur.chunks);
      const staged = join(stageDir, String(items.length));
      await writeFile(staged, data);
      items.push({ path: cur.path, size: cur.size, cls: cur.cls, staged });
    }
    cur = null;
  };
  for await (const chunk of req) {
    total += chunk.length;
    if (total > ARCHIVE_LIMIT) throw new HttpError(413, '백업 파일이 너무 큽니다 (300MB 까지)');
    if (stage === 'end') continue;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (stage === 'header') {
        if (buf.length < BLOCK) break;
        let h;
        try { h = readHeader(buf.subarray(0, BLOCK)); } catch (err) { throw new HttpError(400, err.message); }
        buf = buf.subarray(BLOCK);
        if (!h) { stage = 'end'; break; }
        const cls = classifyEntry(h.path, h.type);
        let keep = !cls.skip && !cls.dir;
        if (cls.skip) skipped.push({ path: h.path, reason: cls.skip });
        else if (keep && h.size > cls.limit) { skipped.push({ path: h.path, reason: '파일이 너무 큽니다' }); keep = false; }
        cur = { path: h.path.replace(/^\.\//, ''), size: h.size, cls, keep, chunks: [] };
        remaining = h.size;
        padLeft = padding(h.size);
        stage = 'body';
      }
      if (stage === 'body') {
        if (remaining > 0) {
          if (!buf.length) break;
          const take = Math.min(remaining, buf.length);
          if (cur.keep) cur.chunks.push(buf.subarray(0, take));
          buf = buf.subarray(take);
          remaining -= take;
          if (remaining > 0) break;
        }
        await finish();
        stage = 'pad';
      }
      if (stage === 'pad') {
        const take = Math.min(padLeft, buf.length);
        buf = buf.subarray(take);
        padLeft -= take;
        if (padLeft > 0) break;
        stage = 'header';
      }
      if (stage === 'end') break;
    }
  }
  if (stage !== 'end' && !(stage === 'header' && buf.length === 0)) throw new HttpError(400, '백업 파일이 잘렸습니다');
  return { items, skipped };
}

/** 메모리에 모으는 쓰기 대상 (put 이 쓰는 모양만) */
function collector() {
  const chunks = [];
  return { destroyed: false, write: (c) => { chunks.push(Buffer.from(c)); return true; }, on() {}, off() {}, bytes: () => Buffer.concat(chunks) };
}

async function autoNames(store) {
  return (await store.readdir(AUTO_DIR)).map((e) => e.name).filter((f) => AUTO_RE.test(f)).sort().reverse();
}

/** 올리기 전 자동 백업 — 저장소의 .restore-backup/ 에 최근 3개. 문제 · 현장 상태만 (이미지는 지우지 않으므로 — 무료 Redis 용량) */
async function autoBackup(store) {
  const base = `camp-game-${stamp()}`;
  let name = `${base}.tar`;
  for (let n = 2; await store.stat(`${AUTO_DIR}/${name}`); n++) name = `${base}-${n}.tar`;
  const out = collector();
  await writeArchive(store, out, { images: false });
  await store.writeFile(`${AUTO_DIR}/${name}`, out.bytes());
  for (const old of (await autoNames(store)).slice(AUTO_KEEP)) await store.unlink(`${AUTO_DIR}/${old}`).catch(() => {});
  return name;
}

/** 백업 항목 하나 쓰기 — 같은 파일의 다른 저장과 줄을 세우고, 게임 · 상태면 열린 화면에 다시 읽으라고 알릴 것을 모은다 */
async function writeEntry(ctx, path, cls, bytes, reloads) {
  const key = cls.kind === 'game' ? `game:${cls.id}` : cls.kind === 'state' ? `state:${cls.name}` : `asset:${path}`;
  await ctx.store.lock(key, () => ctx.store.writeFile(path, bytes));
  if (cls.kind === 'game') {
    ctx.invalidateGame?.(cls.id);
    reloads.push({ kind: 'data', name: `game:${cls.id}`, revision: revisionOf(bytes.toString('utf8')) });
  } else if (cls.kind === 'state') {
    reloads.push({ kind: 'state', name: cls.name, revision: revisionOf(bytes.toString('utf8')) });
  }
}

/** POST /api/admin/archive?parts=data,state */
async function upload(req, res, ctx, url) {
  const wanted = new Set((url.searchParams.get('parts') ?? 'data,state').split(',').filter((p) => p in PARTS));
  if (!wanted.size) throw new HttpError(400, '올릴 부분(parts)을 고르세요');
  const stageDir = await mkdtemp(join(tmpdir(), 'camp-upload-'));
  try {
    const { items, skipped } = await receive(req, stageDir);
    const chosen = [];
    for (const it of items) {
      if (wanted.has(it.cls.part)) chosen.push(it);
      else skipped.push({ path: it.path, reason: it.cls.part === 'state' ? '현장 상태는 고르지 않음' : '문제 · 이미지는 고르지 않음' });
    }
    const texts = new Map();
    for (const it of chosen) if (it.cls.kind !== 'image') texts.set(it, (await readFile(it.staged)).toString('utf8'));
    const result = checkArchive(chosen, (it) => texts.get(it));
    if (result.errors.length) {
      sendJson(res, 422, { error: '검증 오류가 있어 올리지 않았습니다', errors: result.errors });
      return;
    }
    if (!result.keep.length) throw new HttpError(400, '올릴 파일이 없습니다');
    const auto = await autoBackup(ctx.store);
    const reloads = [];
    for (const it of result.keep) await writeEntry(ctx, it.path, it.cls, await readFile(it.staged), reloads);
    for (const info of reloads) ctx.broadcastReload?.(info);
    ctx.log(`📥 백업 올리기 — ${result.keep.length}개 파일 (${[...wanted].join(' · ')}), 올리기 전 자동 백업 ${auto}`);
    sendJson(res, 200, { written: result.keep.length, counts: result.counts, skipped: [...skipped, ...result.skipped], autoBackup: auto });
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── 나눠 올리기 (R-51 · DEP-18) ──────────────────────────────
// 요청 하나가 4.5MB 를 넘지 않게 (Vercel). 임시 사본을 쌓지 않는다 — 무료 Redis 용량(250MB)에 지금 데이터(약 95MB)를 한 번 더 두지 않게.
// 이미지를 먼저, 문제 · 현장 상태(JSON)는 끝에 쓴다 — 중간에 끊겨도 문제가 아직 없는 이미지를 가리키지 않는다.
const UPLOAD_DIR = '.upload';
const UPLOAD_KEEP_MS = 2 * 60 * 60 * 1000;
/** 이미지 조각 하나 — Vercel 요청 상한(4.5MB) 아래 */
export const UPLOAD_PART = 4 * 1024 * 1024;
const BEGIN_LIMIT = 4 * 1024 * 1024;
const sessionPath = (id) => `${UPLOAD_DIR}/${id}.json`;
const partDir = (id, path) => `${UPLOAD_DIR}/${id}/${createHash('sha1').update(path).digest('hex').slice(0, 16)}`;

async function readSession(store, id) {
  const t = await store.readFile(sessionPath(id));
  if (t === null) throw new HttpError(404, '올리기가 없습니다 — 처음부터 다시 올리세요');
  return JSON.parse(t.toString('utf8'));
}

/** 끝났거나 오래된 올리기의 조각 · 기록 지우기 */
async function dropSession(store, id) {
  for (const d of await store.readdir(`${UPLOAD_DIR}/${id}`)) {
    for (const f of await store.readdir(`${UPLOAD_DIR}/${id}/${d.name}`)) await store.unlink(`${UPLOAD_DIR}/${id}/${d.name}/${f.name}`).catch(() => {});
  }
  await store.unlink(sessionPath(id)).catch(() => {});
}

async function dropOldSessions(store) {
  for (const e of await store.readdir(UPLOAD_DIR)) {
    const m = /^([a-f0-9]{16})\.json$/.exec(e.name);
    if (!m) continue;
    const info = await store.stat(sessionPath(m[1]));
    if (info && Date.now() - info.mtimeMs > UPLOAD_KEEP_MS) await dropSession(store, m[1]).catch(() => {});
  }
}

/**
 * POST /api/admin/archive/begin — { parts, items: [{ path, size }], texts: { 경로: JSON 글자 } }
 * 서버가 다시 나누고 검사한다 (화면 미리보기와 같은 규칙 — checkArchive). 오류면 422, 아무것도 쓰지 않는다.
 * 통과하면 지금 내용을 자동 백업하고 { id, images: [{ path, size }], autoBackup } — 화면은 images 를 보낸 뒤 finish.
 */
async function begin(req, res, ctx) {
  const body = await readJson(req, BEGIN_LIMIT);
  const wanted = new Set((Array.isArray(body?.parts) ? body.parts : []).filter((p) => p in PARTS));
  if (!wanted.size) throw new HttpError(400, '올릴 부분(parts)을 고르세요');
  const texts = body?.texts && typeof body.texts === 'object' ? body.texts : {};
  const items = [];
  const skipped = [];
  for (const raw of Array.isArray(body?.items) ? body.items : []) {
    const size = Number(raw?.size);
    if (typeof raw?.path !== 'string' || !Number.isInteger(size) || size < 0) throw new HttpError(400, '올릴 목록 형식이 올바르지 않습니다');
    const cls = classifyEntry(raw.path);
    if (cls.dir) continue;
    if (cls.skip) { skipped.push({ path: raw.path, reason: cls.skip }); continue; }
    const path = raw.path.replace(/^\.\//, '');
    if (!wanted.has(cls.part)) { skipped.push({ path, reason: cls.part === 'state' ? '현장 상태는 고르지 않음' : '문제 · 이미지는 고르지 않음' }); continue; }
    if (cls.kind !== 'image' && typeof texts[path] !== 'string') throw new HttpError(400, `${path} 의 내용이 없습니다`);
    items.push({ path, size: cls.kind === 'image' ? size : Buffer.byteLength(texts[path]), cls });
  }
  const result = checkArchive(items, (it) => texts[it.path]);
  if (result.errors.length) {
    sendJson(res, 422, { error: '검증 오류가 있어 올리지 않았습니다', errors: result.errors });
    return;
  }
  if (!result.keep.length) throw new HttpError(400, '올릴 파일이 없습니다');
  await dropOldSessions(ctx.store);
  const autoBackupName = await autoBackup(ctx.store);
  const id = randomBytes(8).toString('hex');
  const images = result.keep.filter((it) => it.cls.kind === 'image').map((it) => ({ path: it.path, size: it.size }));
  const files = result.keep.filter((it) => it.cls.kind !== 'image').map((it) => ({ path: it.path, text: texts[it.path] }));
  await ctx.store.writeFile(sessionPath(id), JSON.stringify({ id, parts: [...wanted], images, files, counts: result.counts, skipped: [...skipped, ...result.skipped], autoBackup: autoBackupName }));
  ctx.log(`📥 백업 올리기 시작 — 이미지 ${images.length}개 · 문제 · 상태 ${files.length}개 (${[...wanted].join(' · ')}), 올리기 전 자동 백업 ${autoBackupName}`);
  sendJson(res, 200, { id, images, autoBackup: autoBackupName });
}

/**
 * PUT /api/admin/archive/upload/<id>?path=<이미지 경로>&offset=<바이트> — 본문은 이미지(또는 4MB 조각).
 * 한 번에 다 오면 바로 쓰고, 조각이면 따로 두었다가 마지막 조각에서 이어 붙여 쓴다.
 */
async function putImage(req, res, ctx, id, url) {
  const session = await readSession(ctx.store, id);
  const path = url.searchParams.get('path') ?? '';
  const img = session.images.find((x) => x.path === path);
  if (!img) throw new HttpError(400, '올릴 목록에 없는 이미지입니다');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const bytes = await readBody(req, UPLOAD_PART);
  if (!Number.isInteger(offset) || offset < 0 || offset + bytes.length > img.size || (bytes.length === 0 && img.size > 0)) throw new HttpError(400, '조각 위치가 올바르지 않습니다');
  const cls = classifyEntry(path);
  if (offset === 0 && bytes.length === img.size) {
    await writeEntry(ctx, path, cls, bytes, []);
  } else {
    const dir = partDir(id, path);
    await ctx.store.writeFile(`${dir}/${String(offset).padStart(12, '0')}`, bytes);
    if (offset + bytes.length === img.size) {
      const names = (await ctx.store.readdir(dir)).map((e) => e.name).sort();
      const parts = [];
      let at = 0;
      for (const n of names) {
        if (Number(n) !== at) throw new HttpError(400, '빠진 조각이 있습니다 — 처음부터 다시 올리세요');
        const b = await ctx.store.readFile(`${dir}/${n}`);
        parts.push(b);
        at += b.length;
      }
      if (at !== img.size) throw new HttpError(400, '빠진 조각이 있습니다 — 처음부터 다시 올리세요');
      await writeEntry(ctx, path, cls, Buffer.concat(parts), []);
      for (const n of names) await ctx.store.unlink(`${dir}/${n}`).catch(() => {});
    }
  }
  sendEmpty(res, 204);
}

/** POST /api/admin/archive/upload/<id>/finish — 문제 · 현장 상태(JSON)를 쓰고 열린 화면에 알린다 */
async function finish(res, ctx, id) {
  const session = await readSession(ctx.store, id);
  const reloads = [];
  for (const f of session.files) await writeEntry(ctx, f.path, classifyEntry(f.path), Buffer.from(f.text), reloads);
  for (const info of reloads) ctx.broadcastReload?.(info);
  await dropSession(ctx.store, id);
  const written = session.images.length + session.files.length;
  ctx.log(`📥 백업 올리기 — ${written}개 파일 (${session.parts.join(' · ')}), 올리기 전 자동 백업 ${session.autoBackup}`);
  sendJson(res, 200, { written, counts: session.counts, skipped: session.skipped, autoBackup: session.autoBackup });
}

function sendTar(res, name) {
  res.writeHead(200, {
    'Content-Type': 'application/x-tar',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}

/** /api/admin/archive* — PIN 확인은 api-admin 이 먼저 한다. 처리했으면 true */
export async function handleArchive(req, res, ctx, pathname, url) {
  if (pathname === '/api/admin/archive') {
    if (req.method === 'GET') {
      sendTar(res, `camp-game-${stamp()}.tar`);
      try { await writeArchive(ctx.store, res); } catch (err) { ctx.log(`⚠ 백업 내려받기 실패: ${err.message}`); res.destroy(); return true; }
      res.end();
      ctx.log('📤 백업 내려받기');
      return true;
    }
    if (req.method === 'POST') { await upload(req, res, ctx, url); return true; }
    throw new HttpError(405, '허용되지 않은 요청입니다');
  }
  if (pathname === '/api/admin/archive/begin' && req.method === 'POST') { await begin(req, res, ctx); return true; }
  const up = /^\/api\/admin\/archive\/upload\/([a-f0-9]{16})(\/finish)?$/.exec(pathname);
  if (up && !up[2] && req.method === 'PUT') { await putImage(req, res, ctx, up[1], url); return true; }
  if (up && up[2] && req.method === 'POST') { await finish(res, ctx, up[1]); return true; }
  if (pathname === '/api/admin/archive/auto' && req.method === 'GET') {
    const out = [];
    for (const file of await autoNames(ctx.store)) {
      const info = await ctx.store.stat(`${AUTO_DIR}/${file}`);
      if (!info) continue;
      const m = /(\d{8})-(\d{6})/.exec(file);
      out.push({ file, size: info.size, savedAt: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)} ${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4)}` });
    }
    sendJson(res, 200, out);
    return true;
  }
  const m = /^\/api\/admin\/archive\/auto\/([^/]+)$/.exec(pathname);
  if (m && req.method === 'GET') {
    const file = decodeURIComponent(m[1]);
    if (!AUTO_RE.test(file)) throw new HttpError(400, '자동 백업 파일 이름이 올바르지 않습니다');
    const bytes = await ctx.store.readFile(`${AUTO_DIR}/${file}`);
    if (bytes === null) throw new HttpError(404, '자동 백업이 없습니다');
    sendTar(res, file);
    res.end(bytes);
    return true;
  }
  return false;
}
