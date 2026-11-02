// 공개 모드 `/play` (R-96, docs/08-tech.md 11-8) — 관리 페이지 스위치 · 로그인 없이 받는 공개용 데이터
// 스위치는 저장소의 state/public.json — 현장 상태 API · 백업 대상이 아니다 (백업을 옮겨도 공개가 따라 켜지지 않게)
import { readText } from './files.mjs';
import { parseJsonText, validateApp, validateGame } from '../app/core/validate.js';
import { publicGame, publicImagePaths } from '../app/core/public-play.js';

export const PUBLIC_FILE = 'state/public.json';

/** 켜져 있는지 — 파일이 없거나 깨졌으면 꺼짐 */
export async function isPublicOn(store) {
  const text = await readText(store, PUBLIC_FILE);
  if (text === null) return false;
  try { return JSON.parse(text)?.on === true; } catch { return false; }
}

export async function setPublicOn(store, on) {
  await store.writeFile(PUBLIC_FILE, `${JSON.stringify({ version: 1, on: !!on, updatedAt: new Date().toISOString() })}\n`);
}

async function readJson(store, rel) {
  const text = await readText(store, rel);
  if (text === null) return null;
  const parsed = parseJsonText(text, rel);
  return parsed.error ? null : parsed.value;
}

/** 제목 · 공개용 게임 (메뉴 순서) — 데이터 파일이 없거나 오류가 있는 게임은 뺀다 */
async function publicGames(store) {
  const app = validateApp(await readJson(store, 'data/app.json')).app;
  const games = [];
  for (const id of app?.games ?? []) {
    const raw = await readJson(store, `data/games/${id}.json`);
    const v = raw ? validateGame(raw, { fileId: id }) : null;
    const g = v && !v.errors.length ? publicGame(v.game) : null;
    if (g) games.push(g);
  }
  games.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return { app, games };
}

/**
 * GET /api/public — 꺼져 있으면 { on: false, title } 만.
 * 켜져 있으면 공개용 게임과 이미지 주소 표(그 게임들이 쓰는 이미지만 — R-70 의 Blob 주소. 파일 저장소는 null → /assets/… 로)
 */
export async function publicData(store) {
  const on = await isPublicOn(store);
  const { app, games } = on ? await publicGames(store) : { app: validateApp(await readJson(store, 'data/app.json')).app, games: [] };
  const title = app?.title ?? '';
  if (!on) return { on: false, title };
  const all = await store.assetUrls();
  let images = null;
  if (all) {
    images = {};
    for (const p of publicImagePaths(games)) if (all[p]) images[p] = all[p];
  }
  return { on: true, title, subtitle: app?.subtitle ?? null, games, images };
}

/** 로그인 없이 줄 이미지인지 — 켜져 있고 공개한 문제가 쓰는 이미지 (파일 저장소의 /assets/… — Redis 는 Blob 주소로 바로 받는다) */
export async function isPublicImage(store, rel) {
  if (!(await isPublicOn(store))) return false;
  return publicImagePaths((await publicGames(store)).games).has(rel);
}
