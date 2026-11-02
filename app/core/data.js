// 게임 데이터 불러오기 (docs/02-data-schema.md, docs/08-tech.md 8장) — 게임 창 · 관리 페이지 공용
import { parseJsonText, validateApp, validateGame, validateScoreboardDefaults } from './validate.js';
import { loadAssetUrls, assetUrl, assetKnown } from './assets.js';

async function fetchText(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) return { status: res.status, text: null };
  return { status: res.status, text: await res.text() };
}

/** 게임 파일 하나 → { id, game|null, errors, warnings } */
export async function loadGame(id) {
  let r;
  try {
    r = await fetchText(`/data/games/${id}.json`);
  } catch {
    return { id, game: null, errors: [{ code: 'E01', path: id, message: `data/games/${id}.json 을 읽을 수 없습니다 (서버 연결)` }], warnings: [] };
  }
  if (r.text === null) return { id, game: null, errors: [{ code: 'E08', path: id, message: `게임 '${id}' 데이터 파일이 없습니다` }], warnings: [] };
  const parsed = parseJsonText(r.text, `data/games/${id}.json`);
  if (parsed.error) return { id, game: null, errors: [parsed.error], warnings: [] };
  const v = validateGame(parsed.value, { fileId: id });
  return { id, game: v.game, errors: v.errors, warnings: v.warnings };
}

/**
 * 앱 데이터 전부. app.json 이 없거나 깨지면 fatal.
 * @returns {{fatal?:string, app, games: Object<string, {id, game, errors, warnings}>, order: string[], scoreboard: {rounds, errors, warnings}}}
 */
export async function loadAllData() {
  let r;
  try {
    r = await fetchText('/data/app.json');
  } catch {
    return { fatal: 'data/app.json 을 불러오지 못했습니다 (서버에 연결할 수 없음)' };
  }
  if (r.text === null) return { fatal: 'data/app.json 을 불러오지 못했습니다' };
  const parsed = parseJsonText(r.text, 'data/app.json');
  if (parsed.error) return { fatal: parsed.error.message };
  const app = validateApp(parsed.value);
  if (!app.app) return { fatal: `data/app.json 을 불러오지 못했습니다 — ${app.errors.map((e) => e.message).join(', ')}` };

  const games = {};
  // 이미지 주소 표도 함께 (R-70 — 운영은 Blob 주소를 <img> 에 바로)
  await Promise.all([...app.app.games.map(async (id) => { games[id] = await loadGame(id); }), loadAssetUrls()]);
  const order = [...app.app.games].sort((a, b) => (games[a].game?.order ?? 999) - (games[b].game?.order ?? 999));
  const scoreboard = await loadScoreboardDefaults(games);
  return { app: app.app, games, order, scoreboard };
}

export async function loadScoreboardDefaults(games) {
  const validGames = Object.fromEntries(Object.values(games).filter((g) => g.game).map((g) => [g.id, g.game]));
  try {
    const r = await fetchText('/data/scoreboard.json');
    if (r.text === null) return { rounds: null, errors: [{ code: 'E10', message: '점수판 기본값을 읽을 수 없습니다' }], warnings: [] };
    const parsed = parseJsonText(r.text, 'data/scoreboard.json');
    if (parsed.error) return { rounds: null, errors: [{ code: 'E10', message: '점수판 기본값을 읽을 수 없습니다' }], warnings: [] };
    return validateScoreboardDefaults(parsed.value, { games: validGames });
  } catch {
    return { rounds: null, errors: [{ code: 'E10', message: '점수판 기본값을 읽을 수 없습니다' }], warnings: [] };
  }
}

/**
 * 이미지 요청은 한 번에 IMAGE_AT_ONCE 장까지 (미리 받기 · 없는 이미지 확인이 같이 쓴다 — R-55, docs/08-tech.md 7-1).
 * 이미지 141장을 한꺼번에 보내면 Vercel 이 함수 인스턴스를 수십 개 새로 띄우고, 인스턴스마다 저장소 점검을 한다
 */
export const IMAGE_AT_ONCE = 4;
const imageQueue = [];
let imageRunning = 0;
function inImageSlot(fn) {
  return new Promise((resolve, reject) => {
    imageQueue.push(() => fn().then(resolve, reject));
    pumpImages();
  });
}
function pumpImages() {
  while (imageRunning < IMAGE_AT_ONCE && imageQueue.length) {
    imageRunning++;
    imageQueue.shift()().finally(() => { imageRunning--; pumpImages(); });
  }
}

/** 게임 홈: 후보 카테고리 이미지가 있는지 (W02) */
export async function missingImages(game, categoryIds) {
  const paths = [];
  for (const c of game.categories) {
    if (!categoryIds.includes(c.id)) continue;
    for (const q of c.questions ?? []) {
      if (q.disabled) continue;
      if (q.image) paths.push(q.image);
      if (q.answerImage) paths.push(q.answerImage);
    }
  }
  const missing = [];
  // 주소 표가 있으면(운영) 표에 없는 것이 없는 이미지 — 요청 없이 (R-70)
  if (paths.every((p) => assetKnown(p) !== undefined)) return paths.filter((p) => !assetKnown(p));
  await Promise.all(paths.map((p) => inImageSlot(async () => {
    try {
      const res = await fetch(`/${p}`, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) missing.push(p);
    } catch { /* 서버 끊김 — 판단 보류 */ }
  })));
  return missing;
}

/** 게임 시작: 이번 게임 후보 카테고리 이미지를 모두 미리 불러오기 (docs/08-tech.md 7-1) */
const preloaded = new Map();
export function preloadImages(game, categoryIds) {
  for (const c of game.categories) {
    if (!categoryIds.includes(c.id)) continue;
    for (const q of c.questions ?? []) {
      for (const p of [q.image, q.answerImage]) {
        if (!p || preloaded.has(p)) continue;
        const img = new Image();
        preloaded.set(p, img);
        inImageSlot(() => new Promise((done) => {
          img.onload = () => done();
          img.onerror = () => done();
          img.src = assetUrl(p);
        })).then(() => img.decode?.().catch(() => {}));
      }
    }
  }
}
