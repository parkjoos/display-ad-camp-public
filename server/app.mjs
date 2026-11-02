// 서버 조립 (docs/08-tech.md 4장 · 11장) — createApp(요청 처리기) · createAppServer(Node 서버 — server.mjs · 테스트)
import http from 'node:http';
import { createFileStore, createRedisStore } from './store.mjs';
import { createRedis } from './redis.mjs';
import { createBlob } from './blob.mjs';
import { checkHost, checkWrite, sendJson, sendError } from './guard.mjs';
import { serveStatic } from './static.mjs';
import { createAuth, newPin } from './host-auth.mjs';
import { handleState } from './api-state.mjs';
import { handleAdmin } from './api-admin.mjs';
import { createLive } from './api-live.mjs';
import { publicData } from './public-play.mjs';
import { seedDataDir, seedStore, loadSecret, checkStorage, checkStore } from './seed.mjs';

export const APP_ID = 'camp-game';
export const VERSION = '0.1.0';

/**
 * 앱 만들기 — 저장소 준비 · 요청 처리기. 포트는 열지 않는다 (Vercel 함수는 이것만 — api/index.js, 08-tech 11-5)
 * @param root 코드 폴더 (화면 · 저장소)
 * @param dataRoot 저장 폴더 — data · assets · state. 기본은 코드 폴더 (노트북 모드)
 * @param port 받는 포트 — Host · Origin 검사의 `127.0.0.1:<포트>` (포트를 열지 않으면 null)
 * @param publicOrigin 서버 모드의 공개 주소 (`https://…`, 도메인이 여럿이면 배열 — 첫 번째가 대표). 있으면 서버 모드 (08-tech 11장)
 * @param redis Redis 저장소 (R-50, 08-tech 11-6) — `{ url, password, prefix, seed }`. 있으면 저장 폴더 대신 Redis(Upstash 등)에, 서버 모드에서만
 * @param streamMaxMs 실시간 연결(SSE)을 서버가 먼저 끊고 다시 붙게 할 시간 — 실행 시간 상한이 있는 곳(Vercel)용, 없으면 끊지 않음 (08-tech 11-4)
 * @param blob 이미지 Blob 저장소 (R-67, 08-tech 11-7) — `{ token }` 이면 SDK 로 만들고, `put` 이 있는 객체면 그대로(테스트의 가짜). Redis 저장소일 때만.
 *   Redis 저장소는 이미지를 두지 않는다 — 없거나 토큰이 없거나 SDK 를 못 불러오면 이미지 저장이 실패한다 (DEP-27)
 */
/** @param quickCheck 저장소 점검을 짧게 — 인스턴스가 자주 · 한꺼번에 켜지는 Vercel 함수 (R-55, 08-tech 11-6) */
export async function createApp({ root, dataRoot = root, port = null, pin = newPin(), publicOrigin = null, redis: redisConf = null, blob: blobConf = null, streamMaxMs = null, quickCheck = false, log = console.log }) {
  const publicOrigins = [publicOrigin].flat().filter(Boolean);
  const serverMode = publicOrigins.length > 0;
  let store;
  let redis = null;
  if (redisConf) {
    if (!serverMode) throw Object.assign(new Error('Redis 저장소는 서버 모드(CAMP_PUBLIC_ORIGIN)에서만 씁니다'), { code: 'CAMP_STORAGE' });
    redis = createRedis({ url: redisConf.url, password: redisConf.password, log });
    let blob = null;
    let blobError = null;
    // 서버가 Blob 에서 받을 때 붙일 Referer — 브라우저가 우리 화면에서 보내는 값과 같게 (R-69 — 저장소 방화벽)
    const referer = `${publicOrigins[0]}/`;
    if (typeof blobConf?.put === 'function') blob = blobConf;
    else if (!blobConf?.token) blobError = 'BLOB_READ_WRITE_TOKEN 이 없습니다 — Vercel 에서 Blob 저장소를 프로젝트에 연결하세요';
    else blob = await createBlob({ ...blobConf, referer }).catch((err) => { blobError = `SDK 를 불러오지 못했습니다 — ${err.message}`; return null; });
    // 앱은 켠다 (진행 · 점수 · 이미 있는 이미지 보기는 그대로) — 이미지 저장만 실패시킨다
    if (blobError) log(`✕ 이미지 저장소(Blob)를 쓸 수 없습니다 — ${blobError}. 이미지 저장은 실패합니다 (Redis 에 넣지 않음)`);
    store = createRedisStore(redis, { prefix: redisConf.prefix, blob, blobError, referer });
    try {
      await checkStore(store, log, { quick: quickCheck });
      await seedStore(root, store, { allow: !!redisConf.seed, log });
    } catch (err) {
      await redis.close();
      throw err;
    }
  } else {
    // 저장 폴더가 따로면(서버 모드의 볼륨) 먼저 쓸 수 있는지 보고, 비어 있으면 채운다 (08-tech 11-3)
    if (dataRoot !== root) {
      await checkStorage(dataRoot, log);
      await seedDataDir(root, dataRoot, log);
    }
    store = createFileStore(dataRoot);
  }
  const ctx = { appRoot: root, store, redis, prefix: redisConf?.prefix ?? '', port, publicOrigins, streamMaxMs, log };
  ctx.auth = createAuth({ pin, log, secret: serverMode ? await loadSecret(store) : null, redis, prefix: ctx.prefix });
  const live = createLive(ctx);
  ctx.broadcastReload = live.broadcastReload;
  ctx.invalidateGame = live.invalidateGame;

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const { pathname } = url;
      // 배포 환경의 상태 확인은 다른 주소로 올 수 있다 — Host 검사 전에 (앱 이름 · 버전만)
      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, app: APP_ID, version: VERSION });
        return;
      }
      if (!checkHost(req, res, ctx)) return;
      if (pathname.startsWith('/api/')) {
        checkWrite(req, ctx);
        if (pathname === '/api/session' && req.method === 'GET') {
          sendJson(res, 200, { mode: serverMode ? 'server' : 'local', loggedIn: !serverMode || await ctx.auth.isHost(req) });
          return;
        }
        // 이미지 주소 표 (R-70) — 화면이 한 번 받아 Blob 주소를 <img> 에 바로 쓴다 (이미지마다 함수를 타지 않게). 서버 모드는 로그인한 사람만
        if (pathname === '/api/assets' && req.method === 'GET') {
          await ctx.auth.requireLogin(req);
          sendJson(res, 200, { images: await store.assetUrls() });
          return;
        }
        // 공개 모드 /play (R-96) — 로그인 없이. 관리 페이지에서 꺼 두면 제목만
        if (pathname === '/api/public' && req.method === 'GET') {
          sendJson(res, 200, await publicData(store));
          return;
        }
        // 상태 파일 · 게임 화면 실시간 — 서버 모드는 로그인한 사람만 (11-2)
        if (pathname.startsWith('/api/state') || pathname.startsWith('/api/live')) await ctx.auth.requireLogin(req);
        if (await handleState(req, res, ctx, pathname)) return;
        if (await handleAdmin(req, res, ctx, pathname, url)) return;
        if (await live.handle(req, res, pathname, url)) return;
        sendJson(res, 404, { error: '찾을 수 없습니다' });
        return;
      }
      await serveStatic(req, res, ctx, pathname);
    } catch (err) {
      sendError(res, err, log);
    }
  }

  return {
    handle, ctx, pin,
    /** 열린 실시간 연결(SSE)을 닫는다 */
    closeStreams: () => live.closeAll(),
    close: async () => { live.closeAll(); await redis?.close(); },
  };
}

/** Node 서버 — createApp 에 포트를 열어 붙인다 (server.mjs · 테스트) */
export async function createAppServer({ port = 1029, host = '127.0.0.1', ...opts }) {
  const app = await createApp({ ...opts, port });
  const server = http.createServer(app.handle);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
  } catch (err) {
    await app.close();
    throw err;
  }
  const actualPort = server.address().port;
  app.ctx.port = actualPort;

  return {
    server, ctx: app.ctx, pin: app.pin,
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((resolve) => {
      app.closeStreams();
      server.closeAllConnections?.();
      server.close(() => { Promise.resolve(app.ctx.redis?.close()).finally(resolve); });
    }),
  };
}
