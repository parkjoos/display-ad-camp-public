// 무작위 (docs/01-app-flow.md 5-3 · 5-4, docs/02-data-schema.md 3-5). 고정 시드 없음 — 매 게임 새로 뽑는다.
// 브라우저 · Node 22 모두 globalThis.crypto.getRandomValues 를 쓴다.

const cryptoObj = globalThis.crypto;

/** 0 이상 n 미만 정수 (치우침 없음) */
export function randomInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`randomInt: ${n}`);
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do {
    cryptoObj.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

/** [0, 1) 실수 */
export function randomFloat() {
  const buf = new Uint32Array(1);
  cryptoObj.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

/** min 이상 max 이하 실수 */
export const randomBetween = (min, max) => min + (max - min) * randomFloat();

/** 섞은 새 배열 (Fisher–Yates) */
export function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pickOne = (list) => list[randomInt(list.length)];

// ── id 발급 ──────────────────────────────────────────────
/** 헷갈리는 0 · 1 · i · l · o 를 뺀 31자 */
export const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function randomSuffix(length = 4) {
  let s = '';
  for (let i = 0; i < length; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return s;
}

/** `<카테고리 id>-<무작위 4자리>`. taken 과 겹치면 다시 뽑는다 (D-14) */
export function newQuestionId(categoryId, taken = new Set()) {
  for (let i = 0; i < 1000; i++) {
    const id = `${categoryId}-${randomSuffix(4)}`;
    if (!taken.has(id)) return id;
  }
  throw new Error('문제 id 를 만들 수 없습니다');
}

/** 카테고리 id 제안 — 다른 사람이 동시에 만든 카테고리와 겹치지 않게 무작위 */
export function suggestCategoryId(taken = new Set()) {
  for (let i = 0; i < 1000; i++) {
    const id = `category-${randomSuffix(4)}`;
    if (!taken.has(id)) return id;
  }
  throw new Error('카테고리 id 를 만들 수 없습니다');
}

// ── 룰렛 ─────────────────────────────────────────────────
/**
 * 회전 계획 — 결과를 회전 시작 순간 먼저 정한다 (docs/01-app-flow.md 5-3).
 * @param {number} count 조각 수
 * @param {{reducedMotion?:boolean, index?:number|null}} opts index 진행자가 지정한 조각 (R-48) — 없으면 무작위
 * @returns {{index:number, offset:number, turns:number, duration:number}}
 *   index 당첨 조각, offset 조각 안 멈춤 위치(조각 폭의 15~85%), turns 최소 바퀴, duration ms (4~6초)
 */
export function planSpin(count, { reducedMotion = false, index = null } = {}) {
  // 지정한 조각이 원판 밖이면 무작위로 바꾸지 않고 멈춘다 (D-27) — 부르는 쪽이 먼저 거른다
  if (index !== null && !(Number.isInteger(index) && index >= 0 && index < count)) throw new RangeError(`planSpin index: ${index}`);
  return {
    index: index ?? randomInt(count),
    offset: randomBetween(0.15, 0.85),
    turns: 4 + randomInt(3),
    duration: reducedMotion ? 1500 : Math.round(randomBetween(4000, 6000)),
  };
}
