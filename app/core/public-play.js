// 공개 모드 `/play` (R-96 · R-97 · R-98 · R-102, docs/01-app-flow.md 8장) — 공개용 게임 데이터 · 카테고리 한 판의 문제 순서
// 서버(공개 API — server/public-play.mjs)와 /play 화면이 같이 쓴다
import { shuffled } from './random.js';

// 공개하는 필드 — 진행자 메모(note) · 이미지 출처(credit) · 숨김 · 추가일 · 진행 옵션은 내보내지 않는다 (문제 순서만 따로 — R-102).
// 게임 규칙(rules) · 설명(description)도 행사용(팀 · 대표 · "가장 먼저")이라 빼고, /play 가 혼자 하는 문구를 따로 보여 준다 (R-99)
const GAME_FIELDS = ['id', 'type', 'title', 'icon', 'order'];
const CATEGORY_FIELDS = ['id', 'name', 'icon', 'description', 'prompt'];
const QUESTION_FIELDS = ['id', 'answer', 'emojis', 'image', 'effect', 'zoom', 'focus', 'steps', 'masks', 'reveal',
  'answerImage', 'hideAnswerText', 'answerClip', 'clipStart', 'clipEnd', 'prompt', 'hint'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/**
 * 공개용 게임 — 숨기지 않은 카테고리 · 문제만, 공개하는 필드만. 낼 문제가 없는 카테고리는 뺀다. 남는 게 없으면 null.
 * 줄줄이 말해요(roulette)는 팀원이 차례로 이어 말하는 게임이라 혼자 할 수 없어 공개하지 않는다 (R-97)
 * @param game 검증을 거친 게임 (validateGame 의 game)
 */
export function publicGame(game) {
  if (!game || game.type === 'roulette') return null;
  const categories = (game.categories ?? []).filter((c) => !c.disabled).map((c) => ({
    ...pick(c, CATEGORY_FIELDS),
    questions: (c.questions ?? []).filter((q) => !q.disabled).map((q) => pick(q, QUESTION_FIELDS)),
  })).filter((c) => c.questions.length > 0);
  if (!categories.length) return null;
  // 문제 순서는 관리 페이지의 게임 설정(defaults.questionOrder)을 따른다 — 작성 순서(fixed) / 무작위(random) (R-102)
  const questionOrder = game.defaults?.questionOrder === 'fixed' ? 'fixed' : 'random';
  return { ...pick(game, GAME_FIELDS), questionOrder, categories };
}

/** 공개용 게임들이 쓰는 이미지 경로 — 로그인 없이 줄 이미지 (문제 · 정답 이미지) */
export function publicImagePaths(games) {
  const out = new Set();
  for (const g of games) for (const c of g.categories) for (const q of c.questions) {
    if (q.image) out.add(q.image);
    if (q.answerImage) out.add(q.answerImage);
  }
  return out;
}

/**
 * 한 판 — 고른 카테고리의 숨기지 않은 문제 전부를 게임의 문제 순서대로 (룰렛 · 라운드 없음, R-96 · R-98 · R-102)
 * @param order 'fixed' = 작성 순서 / 'random' = 무작위
 * @returns { keys: 문제 id 목록, index: 0, order }
 */
export function planRun(category, order = 'random', shuffle = shuffled) {
  const list = order === 'fixed' ? category.questions : shuffle(category.questions);
  return { keys: list.map((q) => q.id), index: 0, order };
}

/**
 * 이어하기 — 저장해 둔 판을 지금 카테고리에 맞춘다. 그 사이 숨기거나 지운 문제는 빼고, 그만큼 위치를 당긴다.
 * 새로 생긴 문제는 넣지 않는다 (처음부터 하면 들어간다). 맞출 게 없거나 다 풀었으면 null.
 * 문제 순서 설정이 바뀌었으면(순서가 없는 옛 판은 무작위) 이어 가지 않고 null — 새 판이 바뀐 순서로 시작한다 (R-102)
 * @param saved { keys, index, order }
 */
export function restoreRun(category, saved, order = 'random') {
  if (!Array.isArray(saved?.keys) || !Number.isInteger(saved.index)) return null;
  if ((saved.order ?? 'random') !== order) return null;
  const ids = new Set(category.questions.map((q) => q.id));
  const keys = [];
  let index = 0;
  saved.keys.forEach((k, i) => {
    if (!ids.has(k)) return;
    keys.push(k);
    if (i < saved.index) index += 1;
  });
  return keys.length && index < keys.length ? { keys, index, order } : null;
}

/** 게임 카드 · 소개에 보일 문제 수 */
export const questionCount = (game) => game.categories.reduce((n, c) => n + c.questions.length, 0);
