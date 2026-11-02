// 저장소 — 파일(노트북 모드 · 볼륨 서버 모드) / Redis(Upstash 등 — R-50 · R-51, docs/08-tech.md 11-6)
// 경로는 저장 폴더 기준 상대 경로 ('data/games/photo-quiz.json', 'assets/…', 'state/…', 'data/.backup/…')
import { randomBytes } from 'node:crypto';
import { open, readFile, unlink, stat, readdir, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWrite, withLock } from './files.mjs';
import { HttpError } from './guard.mjs';
import { fetchBytes } from './blob.mjs';

function checkRel(rel) {
  const parts = String(rel).split('/');
  if (!rel || parts.some((p) => p === '' || p === '.' || p === '..') || rel.includes('\\') || rel.includes('\0')) throw new Error(`저장 경로가 올바르지 않습니다: ${rel}`);
  return rel;
}

/** 파일 저장소 — 저장 폴더(root) 아래. 저장은 임시 파일 → 이름 바꾸기 (08-tech 4-6) */
export function createFileStore(root) {
  const abs = (rel) => join(root, ...checkRel(rel).split('/'));
  return {
    kind: 'file',
    label: root,
    async readFile(rel) {
      try { return await readFile(abs(rel)); } catch (err) { if (err.code === 'ENOENT' || err.code === 'EISDIR') return null; throw err; }
    },
    /** 내용과 크기 · 시각 한 번에 — { bytes, size, mtimeMs } · 없으면 null (이미지 ETag — static.mjs) */
    async readWithInfo(rel) {
      let fh;
      try { fh = await open(abs(rel), 'r'); } catch (err) { if (err.code === 'ENOENT' || err.code === 'EISDIR') return null; throw err; }
      try {
        const s = await fh.stat();
        if (!s.isFile()) return null;
        return { bytes: await fh.readFile(), size: s.size, mtimeMs: s.mtimeMs };
      } finally { await fh.close(); }
    },
    async writeFile(rel, data) {
      await atomicWrite(abs(rel), data);
    },
    /** 없을 때만 만들기 — 만들었으면 true */
    async writeFileIfAbsent(rel, data) {
      await mkdir(dirname(abs(rel)), { recursive: true });
      let fh;
      try { fh = await open(abs(rel), 'wx', 0o600); } catch (err) { if (err.code === 'EEXIST') return false; throw err; }
      try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
      return true;
    },
    async unlink(rel) {
      await unlink(abs(rel)).catch((err) => { if (err.code !== 'ENOENT') throw err; });
    },
    /** { size, mtimeMs, dir } · 없으면 null */
    async stat(rel) {
      try {
        const s = await stat(abs(rel));
        return { size: s.size, mtimeMs: s.mtimeMs, dir: s.isDirectory() };
      } catch { return null; }
    },
    /** 바로 아래 항목 [{ name, dir }] (이름순). 폴더가 없으면 [] */
    async readdir(rel) {
      let entries;
      try { entries = await readdir(rel ? abs(rel) : root, { withFileTypes: true }); } catch { return []; }
      return entries.filter((e) => e.isFile() || e.isDirectory())
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    /** 이미지 주소 표 (R-70) — 파일 저장소는 없음: 화면이 /assets/… 를 그대로 쓴다 */
    assetUrls: async () => null,
    /** 같은 키의 작업은 한 번에 하나씩 — 파일은 서버 하나만 쓰므로 메모리 줄 세우기로 충분 */
    lock: withLock,
    async close() {},
  };
}

// ── Redis 저장소 ─────────────────────────────────────────────
// 키 (모두 접두어로 시작 — 부서 공용 네임스페이스라 다른 키는 건드리지 않는다)
//   <p>f:<경로>     파일 — 첫 줄은 머리말 JSON {s 크기, t 시각[, g 조각 묶음, n 조각 수]}, 작으면 그 뒤에 내용
//   <p>c:<g>:<i>    큰 파일의 조각 (400KB) — 새 내용은 새 묶음(g)에 쓰고 머리말을 바꾼 뒤 옛 묶음을 지운다
//   <p>d:<폴더>     폴더 목록 HASH — 이름 → 'f' | 'd' (KEYS · SCAN 으로 훑지 않는다 — 공용 저장소에서 다른 키를 건드리지 않게)
//   <p>lock:<키>    줄 세우기 잠금 (SET NX EX)
// assets/ 아래 이미지는 머리말만 {s, t, u Blob 주소} — 이미지 본문은 Redis 에 두지도 읽지도 않는다 (R-67 · DEP-27)
//   <p>u            이미지 경로 → Blob 주소 HASH — 화면이 한 번에 받아 <img> 에 바로 쓴다 (R-70). <p>u:ok 는 처음 채웠다는 표시

/** 큰 값은 조각으로 — 요청 한 번의 크기를 작게 */
export const CHUNK = 400 * 1024;
const LOCK_TTL_S = 15;
/** Blob 으로 보내는 파일 — 이미지만 (R-67, 08-tech 11-7) */
const BLOB_RE = /^assets\/.+\.(jpe?g|png|webp|gif)$/i;
const BLOB_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const LOCK_WAIT_MS = 10_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param redis createRedis() 결과
 * @param prefix 키 접두어 (예: 'camp-game:')
 * @param blob 이미지 Blob 저장소 (R-67 — blob.mjs createBlob 또는 같은 모양의 가짜). 없으면 이미지 저장이 실패한다 (Redis 에 넣지 않는다)
 * @param blobError Blob 을 쓸 수 없는 까닭 (app.mjs — 토큰 없음 · SDK 문제) — 이미지 저장 오류 문구에
 * @param referer Blob 이 없을 때 공개 주소에서 받을 때 붙일 Referer (R-69 — 저장소 방화벽)
 */
export function createRedisStore(redis, { prefix, blob = null, blobError = null, referer = null }) {
  const K = {
    file: (rel) => `${prefix}f:${rel}`,
    chunk: (g, i) => `${prefix}c:${g}:${i}`,
    dir: (rel) => `${prefix}d:${rel}`,
    lock: (key) => `${prefix}lock:${key}`,
    urls: `${prefix}u`,
    urlsReady: `${prefix}u:ok`,
  };

  async function entry(rel) {
    const v = await redis.call('GET', K.file(checkRel(rel)));
    if (!v) return null;
    const nl = v.indexOf(10);
    const h = JSON.parse(v.toString('utf8', 0, nl < 0 ? v.length : nl));
    return { h, body: h.g || h.u ? null : v.subarray(nl + 1) };
  }

  /** 머리말만 — 크기 · 시각 · 조각 확인에 본문(작은 이미지는 400KB 까지)을 받지 않는다 (R-68). 없으면 null */
  async function headOf(rel) {
    const v = await redis.call('GETRANGE', K.file(checkRel(rel)), '0', '1023');
    if (!v?.length) return null;
    const nl = v.indexOf(10);
    return JSON.parse(v.toString('utf8', 0, nl < 0 ? v.length : nl));
  }

  const chunkKeys = (h) => Array.from({ length: h.n }, (_, i) => K.chunk(h.g, i));

  async function delKeys(keys) {
    for (let i = 0; i < keys.length; i += 256) await redis.call('DEL', ...keys.slice(i, i + 256)); // 여러 키 명령은 256개까지
  }

  /** 새 파일이면 위 폴더들의 목록에 이름을 넣는다 */
  async function addToDirs(rel) {
    const parts = rel.split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
      await redis.call('HSET', K.dir(parts.slice(0, i).join('/')), parts[i], i === parts.length - 1 ? 'f' : 'd');
    }
  }

  const head = (h) => Buffer.from(`${JSON.stringify(h)}\n`);
  const isImage = (rel) => BLOB_RE.test(rel);
  const blobFail = () => new HttpError(503, `이미지 저장소(Blob)를 쓸 수 없어 저장하지 않았습니다 — ${blobError ?? 'Blob 이 연결되어 있지 않습니다'}`);

  /**
   * 쓰기 — 새 내용을 다 쓴 뒤 머리말을 바꾸고 옛 조각 · 옛 Blob 을 지운다 (읽는 쪽은 옛것 · 새것 중 하나를 온전히 본다).
   * mtimeMs 는 Blob 으로 옮길 때 저장 시각을 그대로 두려고
   */
  async function write(rel, data, { mtimeMs } = {}) {
    if (isImage(rel) && !blob) throw blobFail();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const old = await headOf(rel);
    const h = { s: buf.length, t: mtimeMs ?? Date.now() };
    if (isImage(rel)) {
      h.u = await blob.put(rel, buf, BLOB_TYPES[rel.split('.').pop().toLowerCase()]);
      await redis.call('SET', K.file(rel), head(h));
      await redis.call('HSET', K.urls, rel, h.u);
    } else if (buf.length <= CHUNK) {
      await redis.call('SET', K.file(rel), Buffer.concat([head(h), buf]));
    } else {
      h.g = randomBytes(6).toString('hex');
      h.n = Math.ceil(buf.length / CHUNK);
      for (let i = 0; i < h.n; i++) await redis.call('SET', K.chunk(h.g, i), buf.subarray(i * CHUNK, (i + 1) * CHUNK));
      await redis.call('SET', K.file(rel), head(h));
    }
    if (old?.g) await delKeys(chunkKeys(old));
    // 옛 Blob 을 못 지워도 저장은 된 것 — 남은 것은 Blob 대시보드에서 (16-deploy)
    if (old?.u && blob) await blob.del([old.u]).catch(() => {});
    await addToDirs(rel); // 매번 — 새 파일을 쓰다 끊겨 목록에서 빠진 채로 남지 않게
    return h.u; // 이미지면 Blob 주소 — 관리 페이지가 올린 뒤 바로 쓴다 (R-70)
  }

  /** 내용과 크기 · 시각 한 번에 — 작은 파일은 GET 한 번 */
  async function readWithInfo(rel) {
    if (isImage(checkRel(rel))) {
      // 이미지는 Blob 에서만 (백업 내려받기 등) — 공개 주소라 Blob 이 꺼져 있어도 받을 수 있다. 주소가 없으면 없는 것
      const h = await headOf(rel);
      if (!h?.u) return null;
      return { bytes: await (blob ? blob.get(h.u) : fetchBytes(h.u, referer)), size: h.s, mtimeMs: h.t };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const e = await entry(rel);
      if (!e) return null;
      if (e.body) return { bytes: e.body, size: e.h.s, mtimeMs: e.h.t };
      const parts = [];
      for (const k of chunkKeys(e.h)) {
        const c = await redis.call('GET', k);
        if (!c) break; // 그 사이 새 내용으로 바뀜 — 머리말부터 다시
        parts.push(c);
      }
      if (parts.length === e.h.n) return { bytes: Buffer.concat(parts), size: e.h.s, mtimeMs: e.h.t };
    }
    throw new Error(`${rel} 을 읽는 동안 계속 바뀌었습니다`);
  }

  /** 내가 잡은 잠금일 때만 놓는다 — 그 사이 만료돼 다른 서버가 잡았으면 두고 */
  async function release(key, token) {
    const cur = await redis.call('GET', key);
    if (cur && cur.toString('utf8') === token) await redis.call('DEL', key);
  }

  return {
    kind: 'redis',
    label: `Redis ${redis.label} · 접두어 ${prefix}`,
    prefix,
    redis,
    readFile: async (rel) => (await readWithInfo(rel))?.bytes ?? null,
    readWithInfo,
    writeFile: (rel, data) => write(rel, data),
    async writeFileIfAbsent(rel, data) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length > CHUNK) throw new Error('writeFileIfAbsent 는 작은 파일만');
      const r = await redis.call('SET', K.file(checkRel(rel)), Buffer.concat([head({ s: buf.length, t: Date.now() }), buf]), 'NX');
      if (r !== 'OK') return false;
      await addToDirs(rel);
      return true;
    },
    async unlink(rel) {
      const h = await headOf(rel);
      if (!h) return;
      if (h.u) {
        // Blob 을 먼저 — 못 지우면 머리말을 남겨 다시 지울 수 있게
        if (!blob) throw new HttpError(503, '이미지 저장소(Blob)에 연결되어 있지 않아 지울 수 없습니다');
        await blob.del([h.u]);
      }
      await redis.call('DEL', K.file(rel));
      if (h.u) await redis.call('HDEL', K.urls, rel);
      if (h.g) await delKeys(chunkKeys(h));
      const parts = rel.split('/');
      await redis.call('HDEL', K.dir(parts.slice(0, -1).join('/')), parts.at(-1));
    },
    async stat(rel) {
      const h = await headOf(rel);
      if (h) return { size: h.s, mtimeMs: h.t, dir: false, ...(h.u ? { url: h.u } : {}) };
      return (await redis.call('EXISTS', K.dir(rel))) ? { size: 0, mtimeMs: 0, dir: true } : null;
    },
    async readdir(rel) {
      const flat = await redis.call('HGETALL', K.dir(rel ? checkRel(rel) : ''));
      const out = [];
      for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) out.push({ name: flat[i].toString('utf8'), dir: flat[i + 1].toString('utf8') === 'd' });
      return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    /**
     * 이미지 경로 → Blob 주소 표 (R-70) — 화면이 시작할 때 한 번 받아 <img> 에 Blob 주소를 바로 쓴다 (이미지마다 함수를 타지 않게).
     * 처음 한 번은 이미지 머리말로 채운다 (R-70 전에 올린 이미지)
     */
    async assetUrls() {
      if (!(await redis.call('EXISTS', K.urlsReady))) {
        const pairs = [];
        for (const rel of await walkFiles(this, 'assets')) {
          if (!isImage(rel)) continue;
          const h = await headOf(rel);
          if (h?.u) pairs.push(rel, h.u);
        }
        for (let i = 0; i < pairs.length; i += 200) await redis.call('HSET', K.urls, ...pairs.slice(i, i + 200));
        await redis.call('SET', K.urlsReady, '1');
      }
      const flat = await redis.call('HGETALL', K.urls);
      const out = {};
      for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) out[flat[i].toString('utf8')] = flat[i + 1].toString('utf8');
      return out;
    },
    /** 이미지 Blob 저장소 이름 (R-67) — 없으면 null */
    blob: blob?.label ?? null,
    /** Blob 을 쓸 수 없는 까닭 — 없으면 null */
    blobError: blobError ?? null,
    /** 서버 여러 개 사이의 줄 세우기 — 같은 서버 안은 메모리 줄 세우기로 먼저 묶고, 서버끼리는 잠금 키로 */
    lock(key, fn) {
      return withLock(key, async () => {
        const k = K.lock(key);
        const token = randomBytes(8).toString('hex');
        const until = Date.now() + LOCK_WAIT_MS;
        while ((await redis.call('SET', k, token, 'NX', 'EX', String(LOCK_TTL_S))) !== 'OK') {
          if (Date.now() > until) throw new HttpError(503, '다른 곳에서 저장하는 중입니다 — 잠시 후 다시 시도하세요');
          await sleep(20 + Math.random() * 40);
        }
        try { return await fn(); } finally { await release(k, token).catch(() => {}); }
      });
    },
    close: () => redis.close(),
  };
}

/** 저장소 아래 파일 경로 전부 (rel 아래, 숨김 · 임시 파일 빼고) */
export async function walkFiles(store, rel, { skipHidden = true } = {}) {
  const out = [];
  async function walk(dir) {
    for (const e of await store.readdir(dir)) {
      if (skipHidden && (e.name.startsWith('.') || e.name.endsWith('.tmp'))) continue;
      const r = dir ? `${dir}/${e.name}` : e.name;
      if (e.dir) await walk(r); else out.push(r);
    }
  }
  await walk(rel);
  return out;
}
