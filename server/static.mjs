// 정적 파일 제공 — 허용 경로 목록만 (docs/08-tech.md 4-2)
// 화면 코드는 코드 폴더(appRoot)에서, 데이터 · 이미지는 저장소(store — 저장 폴더 · 볼륨 · Redis, 08-tech 11-3 · 11-6)에서
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { sendJson } from './guard.mjs';
import { isPublicImage } from './public-play.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const PAGES = {
  '/': ['index.html', 'no-cache', 'app'],
  '/index.html': ['index.html', 'no-cache', 'app'],
  '/host': ['host.html', 'no-store', 'app'],
  '/admin': ['admin.html', 'no-store', 'app'],
  '/play': ['play.html', 'no-cache', 'app'], // 공개 모드 (R-96) — 데이터는 /api/public 이 켜져 있을 때만
};

/**
 * 요청 경로 → [파일 상대 경로, 캐시, 'app' | 'data'] 또는 null (제공 안 함).
 * 'data' 는 저장 폴더의 파일 — 정답이 들어 있어 서버 모드에서는 로그인한 사람에게만 (08-tech 11-2)
 */
export function resolveStatic(pathname) {
  if (PAGES[pathname]) return PAGES[pathname];
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const parts = decoded.split('/').slice(1);
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return null;
  const rel = parts.join('/');
  if (parts[0] === 'app' && parts.length > 1) return [rel, 'no-cache', 'app'];
  if (parts[0] === 'assets' && parts.length > 1) return [rel, 'no-cache', 'data'];
  if (rel === 'data/app.json' || rel === 'data/scoreboard.json') return [rel, 'no-store', 'data'];
  if (parts[0] === 'data' && parts[1] === 'games' && parts.length === 3 && /^[a-z0-9-]+\.json$/.test(parts[2])) return [rel, 'no-store', 'data'];
  if (rel === 'docs/templates/emoji-quiz-template.tsv') return [rel, 'no-cache', 'app'];
  if (rel === 'docs/manual.md') return [rel, 'no-cache', 'app']; // 진행자 설명서 — 앱 안 요약 설명서의 링크 (R-51)
  return null;
}

/** 저장소 파일의 ETag — 크기 · 저장 시각 (내용을 읽지 않고 만든다) */
export const etagOf = ({ size, mtimeMs }) => `W/"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
const etagMatches = (header, etag) => header.trim() === '*' || header.split(',').some((v) => v.trim() === etag);

/** @param ctx { appRoot, store(저장소), auth } */
export async function serveStatic(req, res, ctx, pathname) {
  const found = resolveStatic(pathname);
  if (!found || (req.method !== 'GET' && req.method !== 'HEAD')) {
    sendJson(res, 404, { error: '찾을 수 없습니다' });
    return;
  }
  const [rel, cache, where] = found;
  const headers = {
    'Content-Type': TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  };
  if (rel === 'host.html' || rel === 'admin.html') headers['X-Robots-Tag'] = 'noindex';
  if (where === 'data') {
    // 공개 모드 (R-96) — 공개한 문제가 쓰는 이미지는 로그인 없이 (파일 저장소일 때 /play 가 /assets/… 로 받는다)
    const open = rel.startsWith('assets/') && ctx.auth.serverMode && !(await ctx.auth.isHost(req)) && await isPublicImage(ctx.store, rel);
    if (!open) await ctx.auth.requireLogin(req);
    if (cache === 'no-cache') {
      headers['Cache-Control'] = 'private, no-cache';
      const info = await ctx.store.stat(rel);
      // Blob 에 있는 이미지 (R-67, 08-tech 11-7) — 로그인한 화면에만 주소를 알려 주고, 바이트는 Blob CDN 에서 바로 받게.
      // 주소가 바뀌면(이미지 교체) 바로 따라가도록 이 응답은 저장하지 않는다
      if (info?.url && req.method === 'GET') {
        res.writeHead(302, { Location: info.url, 'Cache-Control': 'private, no-cache' });
        res.end();
        return;
      }
      // 이미지 — 바뀌지 않았으면 304 로 다시 받지 않게 (크기 · 저장 시각 ETag, 서버가 여럿이어도 같은 값 — R-51)
      const inm = req.headers['if-none-match'];
      if (inm && info && !info.dir && etagMatches(inm, etagOf(info))) {
        res.writeHead(304, { ETag: etagOf(info), 'Cache-Control': headers['Cache-Control'] });
        res.end();
        return;
      }
    }
    if (req.method === 'HEAD') {
      // 없는 이미지 확인(게임 홈 — W02)은 있는지 · 크기만 본다 — 이미지 본문(조각)을 저장소에서 읽지 않는다 (R-55)
      const info = await ctx.store.stat(rel);
      if (!info || info.dir) { sendJson(res, 404, { error: '찾을 수 없습니다' }); return; }
      if (cache === 'no-cache') headers.ETag = etagOf(info);
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      res.end();
      return;
    }
    const file = await ctx.store.readWithInfo(rel);
    if (file === null) { sendJson(res, 404, { error: '찾을 수 없습니다' }); return; }
    if (cache === 'no-cache') headers.ETag = etagOf(file);
    res.writeHead(200, { ...headers, 'Content-Length': file.bytes.length });
    res.end(file.bytes);
    return;
  }
  const file = join(ctx.appRoot, rel);
  let info;
  try {
    info = await stat(file);
  } catch {
    sendJson(res, 404, { error: '찾을 수 없습니다' });
    return;
  }
  if (!info.isFile()) { sendJson(res, 404, { error: '찾을 수 없습니다' }); return; }
  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}
