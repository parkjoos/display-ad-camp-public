// 관리 API — /api/admin/* 는 요청마다 X-Admin-Pin 헤더를 검사 (R-31, docs/08-tech.md 4-3 · 4-5 · 4-6)
import { serializeGame } from '../app/core/serialize.js';
import { validateGame, validateApp, parseJsonText, SLUG_RE, emptyState, IMAGE_EXT_RE } from '../app/core/validate.js';
import { readText, revisionOf, backupFile, listBackups, stampToText, exists } from './files.mjs';
import { walkFiles } from './store.mjs';
import { HttpError, readJson, readBody, sendJson, sendEmpty, LIMITS } from './guard.mjs';
import { writeState, readAllState } from './api-state.mjs';
import { handleArchive } from './archive.mjs';
import { isPublicOn, setPublicOn } from './public-play.mjs';

const DATA_BACKUP_KEEP = 20;
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

const gamePath = (id) => `data/games/${id}.json`;
const BACKUP_DIR = 'data/.backup';

export async function readAppGames(store) {
  const text = await readText(store, 'data/app.json');
  if (text === null) return [];
  const parsed = parseJsonText(text, 'data/app.json');
  if (parsed.error) return [];
  return validateApp(parsed.value).app?.games ?? [];
}

async function readGame(store, id) {
  const text = await readText(store, gamePath(id));
  if (text === null) return null;
  const parsed = parseJsonText(text, `data/games/${id}.json`);
  if (parsed.error) return { revision: revisionOf(text), data: null, errors: [parsed.error], warnings: [] };
  const v = validateGame(parsed.value, { fileId: id });
  return { revision: revisionOf(text), data: parsed.value, errors: v.errors, warnings: v.warnings };
}

async function saveGame(ctx, id, data, ifMatch) {
  const { store } = ctx;
  return store.lock(`game:${id}`, async () => {
    const v = validateGame(data, { fileId: id });
    if (v.errors.length) throw new HttpError(422, '검증 오류가 있어 저장하지 않았습니다', { errors: v.errors, warnings: v.warnings });
    const path = gamePath(id);
    const currentText = await readText(store, path);
    if (currentText === null) throw new HttpError(404, '게임 데이터 파일이 없습니다');
    if (ifMatch !== revisionOf(currentText)) throw new HttpError(409, '파일이 다른 곳에서 바뀌었습니다');
    const text = serializeGame(data);
    if (Buffer.byteLength(text) > LIMITS.json) throw new HttpError(413, '데이터가 너무 큽니다');
    if (text === currentText) return { revision: revisionOf(text), warnings: v.warnings, changed: false };
    await backupFile(store, path, BACKUP_DIR, id, DATA_BACKUP_KEEP);
    await store.writeFile(path, text);
    const revision = revisionOf(text);
    ctx.invalidateGame?.(id);
    ctx.broadcastReload?.({ kind: 'data', name: `game:${id}`, revision });
    ctx.log(`💾 ${id} 저장 (관리 페이지)`);
    return { revision, warnings: v.warnings, changed: true };
  });
}

/** 이미지 파일 목록 (assets/<game>/ 아래) */
async function listImages(store, gameId) {
  return (await walkFiles(store, `assets/${gameId}`)).filter((r) => IMAGE_EXT_RE.test(r));
}

/** 문제가 가리키는 이미지 — 문제 · 정답 이미지 [{ question, path }] */
function imageRefs(data) {
  const out = [];
  for (const c of Array.isArray(data?.categories) ? data.categories : []) {
    for (const q of c.questions ?? []) {
      for (const key of ['image', 'answerImage']) if (typeof q[key] === 'string') out.push({ question: q.id, path: q[key] });
    }
  }
  return out;
}

async function checkAll(store) {
  const ids = await readAppGames(store);
  const games = [];
  for (const id of ids) {
    const g = await readGame(store, id);
    if (!g) { games.push({ id, errors: [{ code: 'E08', path: id, message: `게임 '${id}' 데이터 파일이 없습니다` }], warnings: [], missingImages: [], unusedImages: [] }); continue; }
    const refs = imageRefs(g.data);
    const missing = [];
    for (const r of refs) if (!(await exists(store, r.path))) missing.push({ ...r, code: 'W02' });
    const referenced = new Set(refs.map((r) => r.path));
    const unused = (await listImages(store, id)).filter((p) => !referenced.has(p));
    games.push({ id, errors: g.errors, warnings: g.warnings, missingImages: missing, unusedImages: unused });
  }
  return { games };
}

/**
 * 쓰지 않는 이미지 정리 목록 (R-68, docs/04-admin.md 3-14) — 크기 · 저장 시각과 함께, 큰 것부터.
 * 데이터 파일이 없거나 깨진 게임은 무엇을 쓰는지 알 수 없으므로 빼고 skipped 로 알린다
 */
async function unusedImages(store) {
  const images = [];
  const skipped = [];
  for (const id of await readAppGames(store)) {
    const g = await readGame(store, id);
    if (!g?.data) { skipped.push(id); continue; }
    const referenced = new Set(imageRefs(g.data).map((r) => r.path));
    for (const path of await listImages(store, id)) {
      if (referenced.has(path)) continue;
      const s = await store.stat(path);
      if (s && !s.dir) images.push({ game: id, path, size: s.size, mtimeMs: s.mtimeMs });
    }
  }
  images.sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1));
  return { images, skipped };
}

/** 상태 초기화 (R-32, docs/04-admin.md 3-10) */
async function resetState(ctx, targets, games) {
  const want = new Set(targets);
  // 팀 수가 사라지면 진행 기록 · 점수판 입력값은 쓸 수 없다 → 함께, 모든 게임
  if (want.has('teams')) { want.add('sessions'); want.add('scores'); games = []; }
  const now = new Date().toISOString();
  const revisions = {};
  const all = await readAllState(ctx.store);

  if (want.has('sessions')) {
    const ids = new Set([...(await readAppGames(ctx.store)), ...Object.keys(all.sessions)]);
    for (const id of ids) {
      if (games?.length && !games.includes(id)) continue;
      const cur = all.sessions[id];
      if (!cur || cur.data?.empty) continue;
      // 시각을 남겨 두어야 서버 없이 진행하던 창의 옛 사본이 초기화를 덮지 않는다 (store.js — 더 최신인 쪽이 이김)
      const r = await writeState(ctx, `session:${id}`, { ...emptyState.session(id), updatedAt: now }, null, { backup: true });
      revisions[`session:${id}`] = r.revision;
    }
  }
  if (want.has('scores') || want.has('scoreboardConfig')) {
    const cur = all.scoreboard?.data ?? emptyState.scoreboard();
    const next = { ...emptyState.scoreboard(), ...cur, version: 1 };
    if (want.has('scores')) { next.entries = {}; next.filled = {}; }
    if (want.has('scoreboardConfig')) next.rounds = null;
    next.updatedAt = now;
    revisions.scoreboard = (await writeState(ctx, 'scoreboard', next, null, { backup: true })).revision;
  }
  if (want.has('teams') || want.has('gameOptions') || want.has('display')) {
    const cur = all.settings?.data ?? emptyState.settings();
    const next = { ...emptyState.settings(), ...cur, version: 1 };
    if (want.has('teams')) next.teams = [];
    if (want.has('gameOptions')) next.games = {};
    if (want.has('display')) next.display = { title: null, subtitle: null };
    next.updatedAt = now;
    revisions.settings = (await writeState(ctx, 'settings', next, null, { backup: true })).revision;
  }
  if (want.has('route')) {
    revisions.route = (await writeState(ctx, 'route', { ...emptyState.route(), updatedAt: now }, null, { backup: true })).revision;
  }
  ctx.log(`🧹 상태 초기화: ${[...want].join(', ')}`);
  return revisions;
}

export async function handleAdmin(req, res, ctx, pathname, url) {
  if (!pathname.startsWith('/api/admin/')) return false;
  await ctx.auth.requireAdmin(req);
  const { store } = ctx;

  // 서버 모드: 관리 페이지도 데이터 · 이미지를 읽어야 하므로 PIN 확인 때 입장 쿠키를 함께 준다 (08-tech 11-2)
  if (pathname === '/api/admin/verify' && req.method === 'POST') {
    sendEmpty(res, 204, ctx.auth.serverMode ? { 'Set-Cookie': ctx.auth.hostCookie(await ctx.auth.issue(), req) } : {});
    return true;
  }

  // 백업 내려받기 · 올리기 (R-37, docs/04-admin.md 3-11)
  if (pathname.startsWith('/api/admin/archive') && await handleArchive(req, res, ctx, pathname, url)) return true;

  let m = /^\/api\/admin\/games\/([a-z0-9-]+)$/.exec(pathname);
  if (m) {
    const id = m[1];
    if (!SLUG_RE.test(id)) throw new HttpError(400, '게임 id 형식이 올바르지 않습니다');
    if (req.method === 'GET') {
      const g = await readGame(store, id);
      if (!g) throw new HttpError(404, '게임 데이터 파일이 없습니다');
      sendJson(res, 200, g);
      return true;
    }
    if (req.method === 'PUT') {
      const body = await readJson(req, LIMITS.json);
      if (!body || typeof body !== 'object' || !body.data) throw new HttpError(400, '본문에 data 가 없습니다');
      const ifMatch = req.headers['if-match'];
      if (!ifMatch) throw new HttpError(428, 'If-Match 헤더가 필요합니다');
      const r = await saveGame(ctx, id, body.data, ifMatch);
      sendJson(res, 200, { revision: r.revision, warnings: r.warnings });
      return true;
    }
    throw new HttpError(405, '허용되지 않은 요청입니다');
  }

  if (pathname === '/api/admin/images/unused' && req.method === 'GET') {
    sendJson(res, 200, await unusedImages(store));
    return true;
  }

  m = /^\/api\/admin\/assets\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (m) {
    if (req.method !== 'PUT' && req.method !== 'DELETE') throw new HttpError(405, '허용되지 않은 요청입니다');
    const [gameId, categoryId, fileName] = m.slice(1).map((s) => { try { return decodeURIComponent(s); } catch { return ''; } });
    const fm = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(jpg|jpeg|png|webp|gif)$/.exec(fileName);
    if (!SLUG_RE.test(gameId) || !SLUG_RE.test(categoryId)) throw new HttpError(400, '게임 · 카테고리 id 형식이 올바르지 않습니다');
    if (!fm) throw new HttpError(400, '파일 이름 · 형식이 올바르지 않습니다 (jpg · png · webp · gif)');
    const rel = `assets/${gameId}/${categoryId}/${fileName}`; // 슬러그 · 파일 이름 검사를 거친 조각만으로 조립
    if (req.method === 'DELETE') {
      // 문제가 쓰지 않는 이미지만 (R-68) — 확인과 지우기 사이에 저장이 끼지 않게 게임 저장과 같은 줄에서 다시 본다
      const size = await store.lock(`game:${gameId}`, async () => {
        const g = await readGame(store, gameId);
        if (!g?.data) throw new HttpError(409, '게임 데이터를 읽을 수 없어 지우지 않았습니다');
        if (imageRefs(g.data).some((r) => r.path === rel)) throw new HttpError(409, '문제에서 쓰는 이미지라 지우지 않았습니다');
        return store.lock(`asset:${rel}`, async () => {
          const s = await store.stat(rel);
          if (!s || s.dir) throw new HttpError(404, '이미지가 없습니다 (이미 지웠을 수 있습니다)');
          await store.unlink(rel);
          return s.size;
        });
      });
      ctx.log(`🗑 이미지 지움 ${rel} (${Math.round(size / 1024)}KB — 쓰지 않는 이미지, 관리 페이지)`);
      sendJson(res, 200, { path: rel, size });
      return true;
    }
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    if (type !== IMAGE_TYPES[fm[2]]) throw new HttpError(400, `Content-Type 이 파일 형식과 다릅니다 (${type})`);
    const bytes = await readBody(req, LIMITS.image);
    if (!bytes.length) throw new HttpError(400, '빈 이미지입니다');
    const url = await store.lock(`asset:${rel}`, () => store.writeFile(rel, bytes));
    ctx.log(`🖼 이미지 저장 ${rel}`);
    sendJson(res, 200, url ? { path: rel, url } : { path: rel }); // url — Blob 주소 (Redis 저장소, R-70)
    return true;
  }

  if (pathname === '/api/admin/backups' && req.method === 'GET') {
    const id = url.searchParams.get('game') ?? '';
    if (!SLUG_RE.test(id)) throw new HttpError(400, '게임 id 형식이 올바르지 않습니다');
    const list = await listBackups(store, BACKUP_DIR, id);
    const out = [];
    for (const b of list) {
      const text = await readText(store, `${BACKUP_DIR}/${b.name}`);
      let categories = null, questions = null;
      try {
        const data = JSON.parse(text);
        categories = data.categories?.length ?? 0;
        questions = (data.categories ?? []).reduce((n, c) => n + (c.questions?.length ?? 0), 0);
      } catch { /* 깨진 백업 */ }
      out.push({ file: b.name, savedAt: stampToText(b.stamp), categories, questions });
    }
    sendJson(res, 200, out);
    return true;
  }

  m = /^\/api\/admin\/backups\/([^/]+)\/restore$/.exec(pathname);
  if (m && req.method === 'POST') {
    const file = decodeURIComponent(m[1]);
    const fm = /^([a-z0-9-]+)-\d{8}-\d{6}(?:-\d+)?\.json$/.exec(file);
    if (!fm) throw new HttpError(400, '백업 파일 이름이 올바르지 않습니다');
    const text = await readText(store, `${BACKUP_DIR}/${file}`);
    if (text === null) throw new HttpError(404, '백업 파일이 없습니다');
    const parsed = parseJsonText(text, file);
    if (parsed.error) throw new HttpError(422, '백업 파일을 읽을 수 없습니다');
    const id = parsed.value?.id;
    if (!id || !SLUG_RE.test(id) || !file.startsWith(`${id}-`)) throw new HttpError(422, '백업 파일의 게임을 알 수 없습니다');
    const current = await readGame(store, id);
    if (!current) throw new HttpError(404, '게임 데이터 파일이 없습니다');
    const r = await saveGame(ctx, id, parsed.value, current.revision);
    ctx.log(`↺ ${id} 백업 복원 (${file})`);
    sendJson(res, 200, { revision: r.revision });
    return true;
  }

  if (pathname === '/api/admin/check' && req.method === 'GET') {
    sendJson(res, 200, await checkAll(store));
    return true;
  }

  if (pathname === '/api/admin/state/reset' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const allowed = ['sessions', 'scores', 'scoreboardConfig', 'teams', 'gameOptions', 'display', 'route'];
    const targets = Array.isArray(body?.targets) ? body.targets.filter((t) => allowed.includes(t)) : [];
    if (!targets.length) throw new HttpError(400, '초기화할 대상을 고르세요');
    const games = Array.isArray(body?.games) ? body.games.filter((g) => SLUG_RE.test(g)) : [];
    sendJson(res, 200, { revisions: await resetState(ctx, targets, games) });
    return true;
  }

  // 공개 모드 /play 켜기 · 끄기 (R-96, docs/04-admin.md 3-16)
  if (pathname === '/api/admin/public') {
    if (req.method === 'PUT') {
      const body = await readJson(req, 1024);
      if (typeof body?.on !== 'boolean') throw new HttpError(400, 'on 은 true · false 여야 합니다');
      await setPublicOn(store, body.on);
      ctx.log(`🌐 공개 모드 ${body.on ? '켬' : '끔'} (관리 페이지)`);
    } else if (req.method !== 'GET') throw new HttpError(405, '허용되지 않은 요청입니다');
    sendJson(res, 200, { on: await isPublicOn(store) });
    return true;
  }

  throw new HttpError(404, '찾을 수 없습니다');
}

export { readGame };
