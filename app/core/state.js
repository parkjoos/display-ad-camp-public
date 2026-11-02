// 세션 · 화면 전이 (docs/07-state-model.md 3 ~ 6 · 9장). 순수 함수 — 화면 · 저장과 무관.
// 모든 전이는 세션을 복사해서 바꾼 새 세션을 돌려준다: { session, toast?, error?, goHome? }

import { replay, ranking, isTb, TB, relayOf, relayPerOf, relayGoal, relayNeed, relayRound, relayOpt } from './scoring.js';
import { shuffled, pickOne } from './random.js';
import { emojiUnits, SCORE_TYPES } from './validate.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 로컬 시각 ISO (+09:00 같은 오프셋 포함) — 상태 파일을 사람이 읽기 쉽게 */
export function localIso(date = new Date()) {
  const pad = (n) => String(Math.abs(Math.trunc(n))).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

export const isScoring = (s) => SCORE_TYPES.includes(s?.type);

// ── 데이터 조회 ──────────────────────────────────────────
export const findCategory = (game, id) => game.categories.find((c) => c.id === id) ?? null;

export function findQuestion(game, qid) {
  for (const c of game.categories) {
    const q = c.questions?.find((x) => x.id === qid);
    if (q) return { question: q, category: c };
  }
  return null;
}

/** 게임 옵션 = 저장값 → 데이터 defaults (docs/03-settings.md 4장) */
export function effectiveOptions(game, gameSettings = {}) {
  const d = game.defaults ?? {};
  const pick = (key, lo, hi, fallback) => {
    const v = gameSettings[key];
    return Number.isInteger(v) && v >= lo && v <= hi ? v : (d[key] ?? fallback);
  };
  return {
    rounds: pick('rounds', 1, 20, 3),
    questionsPerRound: pick('questionsPerRound', 1, 20, 5),
    questionOrder: ['random', 'fixed'].includes(gameSettings.questionOrder) ? gameSettings.questionOrder : (d.questionOrder ?? 'random'),
    // 팀당 대표 수 (릴레이, R-62) — 0 = 끔. 데이터에 없으면 사진 보고 맞추기는 2명
    relay: pick('relay', 0, 6, game.type === 'photo' ? 2 : 0),
    // 인당 문제 (R-64) — 대표 한 명이 몇 문제를 맞히고 빠지나. 관리 페이지 진행 기본값, 없으면 1
    perRep: pick('perRep', 1, 5, 1),
  };
}

/** 카테고리 하나로 라운드를 치를 수 있는 최소 문제 수 — 릴레이는 (팀 수 − 1) × 대표 수, 아니면 1 (R-62). 인당 문제는 곱하지 않는다 (R-64 — 참고값이라 카테고리를 더 막지 않음) */
export const needPerRound = (teamCount, relay) => (relay > 0 ? relayNeed(teamCount, relay) : 1);

/** 이 세션의 needPerRound */
export const sessionNeed = (session) => needPerRound(session.snapshot?.teamCount ?? 0, relayOf(session));

/** 게임 홈 후보 카테고리 (제외 안 됨 + 숨김 아님 + (득점형) 문제가 need 개 이상 — 릴레이는 부족한 카테고리를 쓰지 않는다, R-62) */
export function homeCandidates(game, excluded = [], need = 1) {
  return game.categories
    .filter((c) => !c.disabled && !excluded.includes(c.id))
    .filter((c) => game.type === 'roulette' || usableQuestions(c).length >= Math.max(1, need))
    .map((c) => c.id);
}

export const usableQuestions = (category) => (category.questions ?? []).filter((q) => !q.disabled);

/** 이 게임에서 이미 낸 문제 (라운드 출제 + 추가 문제) */
export function usedQuestionIds(session) {
  const used = new Set();
  for (const p of session.picks ?? []) for (const q of p.questionIds ?? []) used.add(q);
  for (const q of session.tiebreak?.used ?? []) used.add(q);
  return used;
}

export function remainingQuestions(game, session, categoryId) {
  const c = findCategory(game, categoryId);
  if (!c) return [];
  const used = usedQuestionIds(session);
  return usableQuestions(c).filter((q) => !used.has(q.id));
}

/** 룰렛 준비 목록 — 숨김 아닌 카테고리 전부 (docs/07-state-model.md 4장) */
export function wheelList(game, session) {
  const scoring = isScoring(session);
  const need = scoring ? sessionNeed(session) : 1;
  return game.categories.filter((c) => !c.disabled).map((c) => {
    // 룰렛형은 문제가 있는 주제만 남은 수를 보인다 — 다 냈어도 원판 후보에서 빼지 않는다 (R-44, D-26)
    const remaining = scoring || usableQuestions(c).length > 0 ? remainingQuestions(game, session, c.id).length : null;
    return {
      id: c.id,
      included: session.wheel.includes(c.id),
      remaining,
      exhausted: scoring && remaining === 0,
      empty: scoring && usableQuestions(c).length === 0, // 처음부터 문제 없음 (모두 출제함과 구분)
      // 릴레이 — 남은 문제가 한 라운드(need)에 모자람. 원판에 넣을 수 없다 (R-62)
      short: scoring && remaining > 0 && remaining < need,
      need: scoring && need > 1 ? need : null,
      wins: session.picks.filter((p) => p.categoryId === c.id).length,
    };
  });
}

/** 원판 후보 = wheel − 사라졌거나 숨긴 카테고리 − (득점형) 남은 문제 0개 · (릴레이) 부족. 이미 뽑힌 카테고리도 그대로 (R-16) */
export function wheelCandidates(game, session) {
  return wheelList(game, session).filter((i) => i.included && !i.exhausted && !i.short).map((i) => i.id);
}

/** 한 라운드를 더 할 수 있는가 — 남은 문제가 한 라운드(릴레이는 need)만큼 있는 카테고리가 있다 */
export function anyRemaining(game, session) {
  const need = isScoring(session) ? sessionNeed(session) : 1;
  return game.categories.some((c) => !c.disabled && remainingQuestions(game, session, c.id).length >= need);
}

/**
 * 추가 문제(동점) 후보 — 이 게임에 포함된 카테고리(게임 홈에서 제외한 것 빼고)마다 아직 안 나온 문제, 데이터 순서 (R-54).
 * 진행자 화면은 카테고리 → 문제로 고르고, 게임 창 S(비상용)는 이 중 무작위
 * @returns {{ categoryId: string, questionIds: string[] }[]} 남은 문제가 있는 카테고리만
 */
export function tiebreakChoices(game, session) {
  return tiebreakByCategory(game, session).map(({ c, qs }) => ({ categoryId: c.id, questionIds: qs.map((q) => q.id) }));
}

/** 추가 문제로 낼 수 있는 문제 — 후보 전체 */
export function tiebreakPool(game, session) {
  return tiebreakByCategory(game, session).flatMap(({ qs }) => qs);
}

function tiebreakByCategory(game, session) {
  const included = session.snapshot?.candidates;
  return game.categories
    .filter((c) => !c.disabled && (!Array.isArray(included) || included.includes(c.id)))
    .map((c) => ({ c, qs: remainingQuestions(game, session, c.id) }))
    .filter(({ qs }) => qs.length > 0);
}

// ── 연출 단계 ────────────────────────────────────────────
export function stageRange(question, type) {
  if (!question) return { initial: 0, final: 0 };
  if (type === 'photo') {
    if (question.effect === 'zoom') return { initial: 0, final: question.steps ?? 3 };
    // 마지막 상자는 정답 공개 때만 벗긴다 — 힌트 단계는 상자 수 − 1 까지 (R-42)
    if (question.effect === 'mask') return { initial: 0, final: Math.max(0, (question.masks?.length ?? 0) - 1) };
    return { initial: 0, final: 0 };
  }
  if (type === 'emoji') {
    const n = question.emojis ? emojiUnits(question.emojis).length : 0;
    if (question.reveal === 'sequential' && n > 0 && !question.image) return { initial: 1, final: n };
    return { initial: n, final: n };
  }
  return { initial: 0, final: 0 };
}

// ── 세션 만들기 ──────────────────────────────────────────
/** @param points 릴레이 결과 순위에 쓰는 라운드 배점 (배점표의 이 게임 행, R-62) — 배점이 바뀌면 게임 창이 다시 맞춘다 */
export function createScoreSession({ game, teamCount, options, candidates, points = null, now = localIso() }) {
  return {
    version: 1, gameId: game.id, type: game.type, status: 'active', startedAt: now, updatedAt: now,
    snapshot: { teamCount, candidates: [...candidates], options: { ...options }, ...(options.relay > 0 && Array.isArray(points) ? { points: [...points] } : {}) },
    wheel: [...candidates], picks: [], screen: 'roulette', roundIndex: 0, questionIndex: 0, stage: 0,
    hintVisible: false, resultRevealCount: 0, scoreboardFill: null, reflectedRounds: [], history: [], tiebreak: { used: [], groups: [] },
  };
}

export function createRouletteSession({ game, candidates, options = {}, now = localIso() }) {
  // 진행 옵션은 문제 순서 하나 — 게임 시작 때 고정 (R-45)
  const questionOrder = options.questionOrder === 'fixed' ? 'fixed' : 'random';
  return {
    version: 1, gameId: game.id, type: 'roulette', status: 'active', startedAt: now, updatedAt: now,
    snapshot: { teamCount: 0, candidates: [...candidates], options: { questionOrder } },
    wheel: [...candidates], picks: [], screen: 'roulette', examplesVisible: false, answersVisible: false,
  };
}

// ── 현재 문제 ────────────────────────────────────────────
/** 지금 화면의 문제 { id, key, tb } — key 는 history 에 쓰는 이름 (추가 문제는 tb:<id>) */
export function currentQuestion(session) {
  if (session.screen === 'question' || session.screen === 'answer') {
    const id = session.picks[session.roundIndex]?.questionIds[session.questionIndex];
    return id ? { id, key: id, tb: false } : null;
  }
  if (session.screen === 'tiebreakQuestion' || session.screen === 'tiebreakAnswer') {
    const id = session.tiebreak.used.at(-1);
    return id ? { id, key: TB + id, tb: true } : null;
  }
  return null;
}

function setStage(s, game, which) {
  const cur = currentQuestion(s);
  const found = cur ? findQuestion(game, cur.id) : null;
  const range = stageRange(found?.question, s.type);
  s.stage = which === 'final' ? range.final : range.initial;
}

function touch(s) { s.updatedAt = localIso(); return s; }

// ── 득점형 전이 (docs/07-state-model.md 5장) ──────────────
/**
 * 라운드 문제 뽑기 (docs/01-app-flow.md 5-4) — 라운드당 문제 수만큼. 릴레이도 라운드당 문제 수만큼 뽑되 순위가 정해지는 최소 수보다 적게는 안 뽑고 (R-95),
 * 그래도 모자라면 문제 화면에서 하나씩 더 · 순위가 일찍 정해지면 안 낸 문제는 돌려놓는다 (R-62)
 */
export function drawRound(game, session, categoryId) {
  const rem = remainingQuestions(game, session, categoryId);
  const per = session.snapshot.options.questionsPerRound;
  const n = relayOf(session) ? Math.max(sessionNeed(session), per) : per;
  const list = session.snapshot.options.questionOrder === 'fixed' ? rem : shuffled(rem);
  return list.slice(0, n).map((q) => q.id);
}

// ── 이모티콘 퀴즈 — 진행자가 문제를 고른다 (R-90) ─────────
/** 룰렛 · 라운드 없이 진행자가 문제를 하나씩 골라 내는 게임. 문제 고르기 화면은 screen 'roulette' 을 그대로 쓴다 */
export const pickMode = (s) => s?.type === 'emoji';

/**
 * 문제 고르기 화면으로 — 지금 문제가 마지막인 채로 그 카테고리 묶음을 닫는다.
 * 예전(룰렛) 진행에서 라운드로 뽑아 두고 아직 안 낸 문제는 후보로 돌려놓는다. s 는 이미 복사본
 */
function toPickScreen(s) {
  const pick = s.picks[s.roundIndex];
  if (pick && (s.screen === 'question' || s.screen === 'answer')) pick.questionIds = pick.questionIds.slice(0, s.questionIndex + 1);
  s.screen = 'roulette'; s.roundIndex = s.picks.length; s.questionIndex = 0; s.stage = 0; s.hintVisible = false;
  return s;
}

/** 진행자가 고를 수 있는 문제 — 숨김 아닌 카테고리마다 아직 안 낸 문제, 데이터 순서. 남은 문제가 있는 카테고리만 */
export function pickChoices(game, session) {
  return game.categories
    .filter((c) => !c.disabled)
    .map((c) => ({ categoryId: c.id, questionIds: remainingQuestions(game, session, c.id).map((q) => q.id) }))
    .filter((c) => c.questionIds.length > 0);
}

/** 이 게임에서 낸 문제 수 — 문제 머리줄 "n번째 문제" (R-90) */
export const askedCount = (session) => (session.picks ?? []).reduce((n, p) => n + (p.questionIds?.length ?? 0), 0);

/**
 * 진행자가 고른 문제를 바로 낸다 (R-90) — 문제 고르기 · 정답 화면에서 → 문제 화면 (라운드 소개 없음).
 * picks 는 카테고리마다 하나: 처음 고른 순서대로 묶음을 만들고, 같은 카테고리 문제는 그 묶음 뒤에 붙는다 —
 * 결과 · 기록 · 통계의 라운드별 정답 수가 카테고리별 정답 수가 된다
 */
export function pickQuestion(session, game, questionId) {
  if (!pickMode(session)) return { session, error: '진행자가 문제를 고르는 게임이 아닙니다' };
  if (!['roulette', 'answer', 'roundEnd'].includes(session.screen)) {
    return { session, error: session.screen === 'question' ? '정답을 공개한 뒤에 다음 문제를 고를 수 있습니다' : '지금은 문제를 고를 수 없습니다' };
  }
  const found = findQuestion(game, questionId);
  if (!found || found.category.disabled || found.question.disabled) return { session, error: '없는 문제입니다' };
  const s = clone(session);
  if (s.screen === 'answer') toPickScreen(s);
  if (usedQuestionIds(s).has(questionId)) return { session, error: '이미 낸 문제입니다' };
  let i = s.picks.findIndex((p) => p.categoryId === found.category.id);
  if (i < 0) { s.picks.push({ categoryId: found.category.id, questionIds: [] }); i = s.picks.length - 1; }
  s.picks[i].questionIds.push(questionId);
  s.roundIndex = i; s.questionIndex = s.picks[i].questionIds.length - 1;
  s.screen = 'question'; s.hintVisible = false; setStage(s, game, 'initial');
  return { session: touch(s) };
}

/**
 * 카테고리로 문제 고르기 (R-91) — 게임 화면 카테고리 카드 클릭. 그 카테고리의 아직 안 낸 문제 하나를
 * 문제 순서 옵션대로(랜덤 · 작성 순서) 골라 pickQuestion 과 똑같이 낸다
 */
export function pickInCategory(session, game, categoryId) {
  const c = findCategory(game, categoryId);
  if (!c || c.disabled) return { session, error: '없는 카테고리입니다' };
  const rem = remainingQuestions(game, session, categoryId);
  if (!rem.length) return { session, error: '이 카테고리에 남은 문제가 없습니다' };
  const q = session.snapshot.options.questionOrder === 'fixed' ? rem[0] : shuffled(rem)[0];
  return pickQuestion(session, game, q.id);
}

/** 룰렛 확정 → 라운드 소개 */
export function confirmPick(session, game, categoryId) {
  const s = clone(session);
  if (s.screen !== 'roulette') return { session };
  if (isScoring(s)) {
    const questionIds = drawRound(game, s, categoryId);
    if (!questionIds.length) return { session, error: '이 카테고리에 남은 문제가 없습니다' };
    s.picks.push({ categoryId, questionIds });
    s.roundIndex = s.picks.length - 1;
    s.questionIndex = 0;
    s.screen = 'round';
  } else {
    s.picks.push({ categoryId });
    s.screen = 'topic';
    s.examplesVisible = false;
    s.answersVisible = false;
  }
  return { session: touch(s) };
}

function toResult(s) {
  s.screen = 'result';
  s.resultRevealCount = 0;
  s.hintVisible = false;
  return s;
}

export function next(session, game) {
  const s = clone(session);
  switch (s.screen) {
    case 'round':
      s.screen = 'question'; s.questionIndex = 0; s.hintVisible = false; setStage(s, game, 'initial');
      return { session: touch(s) };
    case 'question':
    case 'tiebreakQuestion':
      return reveal(session, game);
    case 'answer': {
      const pick = s.picks[s.roundIndex];
      // 이모티콘 퀴즈 — 다음 문제는 진행자가 고른다. 정답 화면 다음은 문제 고르기 (카테고리 목록, R-90)
      if (pickMode(s)) return { session: touch(toPickScreen(s)) };
      if (relayOf(s)) return relayNext(s, game);
      if (s.questionIndex + 1 < pick.questionIds.length) {
        s.screen = 'question'; s.questionIndex += 1; s.hintVisible = false; setStage(s, game, 'initial');
        return { session: touch(s) };
      }
      // 라운드 끝 → 라운드 종료 화면 (팀별 라운드 점수, R-56). 다음 라운드 · 결과는 거기서
      s.screen = 'roundEnd'; s.hintVisible = false;
      return { session: touch(s) };
    }
    case 'roundEnd': {
      // 예전(룰렛) 진행의 라운드 종료 화면에서 이어 온 이모티콘 퀴즈 — 끝은 진행자가 [종료] 로 정한다 (R-90)
      if (pickMode(s)) return { session: touch(toPickScreen(s)) };
      if (s.picks.length < s.snapshot.options.rounds) {
        // 남은 문제가 없어도 룰렛 화면으로 — 화면이 룰렛 준비 대신 "더 출제할 문제가 없습니다" 를 띄우고 → 로 결과 (01-app-flow 5장)
        s.screen = 'roulette'; s.roundIndex = s.picks.length; s.questionIndex = 0; s.stage = 0; s.hintVisible = false;
        return { session: touch(s) };
      }
      return { session: touch(toResult(s)) };
    }
    case 'roulette':
      // 득점형 — 더 출제할 문제가 없을 때만 결과로 (평소의 룰렛 진행 · 확정은 화면 쪽 전이)
      if (isScoring(s) && !anyRemaining(game, s)) return { session: touch(toResult(s)) };
      return { session };
    case 'result': {
      const groups = ranking(s).groups.length;
      if (s.resultRevealCount < groups) s.resultRevealCount += 1;
      if (s.resultRevealCount >= groups) s.status = 'finished';
      return { session: touch(s) };
    }
    case 'tiebreakAnswer': {
      s.screen = 'result'; s.hintVisible = false;
      s.resultRevealCount = ranking(s).groups.length;
      return { session: touch(s) };
    }
    default:
      return { session };
  }
}

/**
 * 릴레이 정답 화면 → (R-62). 한 팀만 남았으면 라운드 종료 (남은 팀이 꼴찌).
 * 아니면 다음 문제 — 뽑아 둔 문제를 다 냈으면 같은 카테고리에서 하나 더 (문제 순서 옵션대로), 그것도 없으면 라운드 종료.
 * 라운드를 끝낼 때 뽑아 두고 안 낸 문제는 다음 라운드 · 후보로 돌려놓는다. s 는 이미 복사본
 */
function relayNext(s, game) {
  const pick = s.picks[s.roundIndex];
  const { decided } = relayRound(pick.questionIds, replay(s.history).scored, s.snapshot.teamCount, relayGoal(s), s.questionIndex + 1, relayOpt(s));
  if (!decided) {
    if (s.questionIndex + 1 >= pick.questionIds.length) {
      const rem = remainingQuestions(game, s, pick.categoryId);
      if (rem.length) pick.questionIds.push((s.snapshot.options.questionOrder === 'fixed' ? rem[0] : shuffled(rem)[0]).id);
    }
    if (s.questionIndex + 1 < pick.questionIds.length) {
      s.screen = 'question'; s.questionIndex += 1; s.hintVisible = false; setStage(s, game, 'initial');
      return { session: touch(s) };
    }
  }
  pick.questionIds = pick.questionIds.slice(0, s.questionIndex + 1);
  s.screen = 'roundEnd'; s.hintVisible = false;
  return { session: touch(s) };
}

/** 릴레이 라운드에서 이 문제 전까지 (relayRound) — 추가 문제 · 정답 수 방식 · 낸 적 없는 문제면 null */
function relayBefore(session, key) {
  const goal = relayGoal(session);
  if (!goal || isTb(key)) return null;
  const pick = session.picks.find((p) => p.questionIds.includes(key));
  if (!pick) return null;
  return relayRound(pick.questionIds, replay(session.history).scored, session.snapshot.teamCount, goal, pick.questionIds.indexOf(key), relayOpt(session));
}

/** 릴레이에서 이 문제 전에 대표를 모두 내보낸 팀 — 이 문제의 맞힌 팀이 될 수 없다 (R-62). 추가 문제 · 정답 수 방식은 [] */
export const relayOut = (session, key) => relayBefore(session, key)?.finish ?? [];

/**
 * 맞힌 사람 — 팀당 대표 방식에서 대표 번호 (0부터, R-94). 대표 번호 없이 오면(게임 화면 숫자키) 이 문제의 맞힌 팀이 이미 그 팀이면 그대로,
 * 아니면 이 문제 전까지 인당 문제를 다 채우지 않은 첫 대표. 다 채워 빠진 대표는 고를 수 없다. 대표를 나누지 않는 문제면 { rep: null }
 * @returns {{rep:(number|null)}|{error:string}}
 */
function resolveRep(session, key, team, rep, teamNames = []) {
  const b = team === null ? null : relayBefore(session, key);
  if (!b) return { rep: null };
  const per = relayPerOf(session);
  const done = b.reps[team];
  if (rep === null || rep === undefined) {
    if (replay(session.history).scored.get(key) === team) return { rep: null };
    const r = done.findIndex((c) => c < per);
    return { rep: r < 0 ? null : r };
  }
  if (!Number.isInteger(rep) || rep < 0 || rep >= done.length) return { error: '없는 대표입니다' };
  if (done[rep] >= per) return { error: `${teamNames[team] ?? `팀${team + 1}`} 대표${rep + 1} — ${per > 1 ? `${per}문제를 다 맞혀` : '이미 맞혀'} 빠졌습니다` };
  return { rep };
}

/**
 * 지금 라운드의 릴레이 진행 (R-62) — 게임 화면 · 진행자 화면 표시용. 정답 수 방식 · 라운드 밖이면 null.
 * relay = 팀당 대표, per = 인당 문제, goal = 팀이 끝나는 정답 수 (relay × per, R-64),
 * counts · reps · finish · ranks · decided = 지금 문제까지 (relayRound — reps 는 팀별 대표마다 맞힌 수, R-94),
 * out = 지금 문제 전에 대표를 모두 내보낸 팀 (이 문제를 맞힐 수 없음), repsBefore = 지금 문제 전 대표마다 맞힌 수 (인당 문제를 채운 대표는 고를 수 없음),
 * scoredRep = 지금 문제를 맞힌 대표 (없으면 null),
 * ending = 정답 화면에서 다음이 라운드 종료 (한 팀만 남음 · 낼 문제가 없음), short = 낼 문제가 없어 순위가 다 안 정해진 채 끝남
 */
export function relayStatus(session, game) {
  const relay = relayOf(session);
  const per = relayPerOf(session);
  const goal = relay * per;
  const pick = session.picks?.[session.roundIndex];
  if (!relay || !pick || !['round', 'question', 'answer', 'roundEnd'].includes(session.screen)) return null;
  const scored = replay(session.history).scored;
  const opt = relayOpt(session);
  const n = session.snapshot.teamCount;
  const ids = pick.questionIds;
  const inQuestion = session.screen === 'question' || session.screen === 'answer';
  const at = session.screen === 'round' ? 0 : inQuestion ? session.questionIndex : ids.length;
  const before = relayRound(ids, scored, n, goal, at, opt);
  const { repAt, ...now } = inQuestion ? relayRound(ids, scored, n, goal, at + 1, opt) : before;
  const hasNext = inQuestion && (session.questionIndex + 1 < ids.length || remainingQuestions(game, session, pick.categoryId).length > 0);
  const ending = session.screen === 'roundEnd' || (session.screen === 'answer' && (now.decided || !hasNext));
  return {
    relay, per, goal, need: relayNeed(n, relay), ...now, out: before.finish, repsBefore: before.reps,
    scoredRep: inQuestion ? repAt[at] ?? null : null, ending, short: ending && !now.decided,
  };
}

/**
 * 한 문제 더 — 라운드당 문제 수는 계획값이라, 다 내도 같은 카테고리에서 아직 안 낸 문제를 하나 더 (R-43).
 * 지금 라운드 마지막 문제의 정답 화면에서만. 고르는 법은 문제 순서 옵션(랜덤 · 작성 순서)을 따른다
 */
export function moreQuestion(session, game) {
  const s = clone(session);
  if (!isScoring(s) || s.screen !== 'answer') return { session };
  const pick = s.picks[s.roundIndex];
  if (!pick || s.roundIndex !== s.picks.length - 1 || s.questionIndex + 1 < pick.questionIds.length) return { session };
  // 릴레이는 순위가 정해질 때까지 [다음 문제] 가 하나씩 더 뽑는다 — 한 팀만 남았으면 라운드 끝 (R-62)
  if (relayOf(s)) return { session, error: '팀당 대표 방식은 순위가 정해질 때까지 [다음 문제] 가 문제를 더 냅니다' };
  const rem = remainingQuestions(game, s, pick.categoryId);
  if (!rem.length) return { session, error: '이 카테고리에 남은 문제가 없습니다' };
  const q = s.snapshot.options.questionOrder === 'fixed' ? rem[0] : shuffled(rem)[0];
  pick.questionIds.push(q.id);
  s.screen = 'question'; s.questionIndex += 1; s.hintVisible = false; setStage(s, game, 'initial');
  return { session: touch(s) };
}

/**
 * 한 라운드 더 — 계획한 라운드 수와 관계없이 룰렛 준비로 (R-40, docs/07-state-model.md 5-1).
 * 라운드 종료 화면에서만 (R-56 — 전에는 라운드 마지막 정답 화면). 남은 문제가 없으면 error
 */
export function moreRound(session, game) {
  const s = clone(session);
  if (!isScoring(s) || s.screen !== 'roundEnd') return { session };
  if (!anyRemaining(game, s)) return { session, error: '더 출제할 문제가 없습니다' };
  s.screen = 'roulette'; s.roundIndex = s.picks.length; s.questionIndex = 0; s.stage = 0; s.hintVisible = false;
  return { session: touch(s) };
}

export function reveal(session, game) {
  const s = clone(session);
  if (s.screen === 'question') s.screen = 'answer';
  else if (s.screen === 'tiebreakQuestion') s.screen = 'tiebreakAnswer';
  else return { session };
  setStage(s, game, 'final');
  return { session: touch(s) };
}

/** 라운드에 득점 이력이 있는가 (라운드 취소 막기) */
export function roundHasHistory(session, roundIndex) {
  const ids = new Set(session.picks[roundIndex]?.questionIds ?? []);
  return session.history.some((op) => ids.has(op.q));
}

export function prev(session, game) {
  const s = clone(session);
  switch (s.screen) {
    case 'roulette': {
      if (s.picks.length === 0) return { session, goHome: true };
      // 이전 라운드의 라운드 종료 화면 (R-56)
      s.roundIndex = s.picks.length - 1;
      s.questionIndex = s.picks[s.roundIndex].questionIds.length - 1;
      s.screen = 'roundEnd'; s.hintVisible = false;
      return { session: touch(s) };
    }
    case 'roundEnd':
      // 라운드로 돌아가기 — 마지막 문제 정답 화면 (맞힌 팀 고치기 · 한 문제 더, R-56)
      s.screen = 'answer'; s.hintVisible = false; setStage(s, game, 'final');
      return { session: touch(s) };
    case 'round':
      return { session, confirmCancelRound: true };
    case 'question':
      if (s.questionIndex === 0) { s.screen = 'round'; s.hintVisible = false; return { session: touch(s) }; }
      s.questionIndex -= 1; s.screen = 'answer'; s.hintVisible = false; setStage(s, game, 'final');
      return { session: touch(s) };
    case 'answer':
      s.screen = 'question'; setStage(s, game, 'final');
      return { session: touch(s) };
    case 'result': {
      s.roundIndex = s.picks.length - 1;
      if (s.roundIndex < 0) return { session };
      s.questionIndex = s.picks[s.roundIndex].questionIds.length - 1;
      s.screen = 'answer'; s.resultRevealCount = 0; s.status = 'active'; setStage(s, game, 'final');
      return { session: touch(s) };
    }
    case 'tiebreakQuestion':
      s.screen = 'result'; s.hintVisible = false; s.resultRevealCount = ranking(s).groups.length;
      return { session: touch(s) };
    case 'tiebreakAnswer':
      s.screen = 'tiebreakQuestion'; setStage(s, game, 'final');
      return { session: touch(s) };
    default:
      return { session };
  }
}

/** 라운드 소개에서 룰렛 결과 취소 (확인창 뒤) */
export function cancelRound(session) {
  const s = clone(session);
  if (s.screen !== 'round') return { session };
  if (roundHasHistory(s, s.roundIndex)) return { session, error: '이 라운드에 정답 기록이 있어 취소할 수 없습니다' };
  s.picks.pop();
  s.roundIndex = s.picks.length; s.questionIndex = 0; s.screen = 'roulette';
  return { session: touch(s) };
}

/**
 * 다음 문제 지정 (진행자 화면 [다음으로], R-35 · R-52) — 고른 문제를 다음 차례 자리로.
 * 다음 차례 = 라운드 소개면 첫 문제, 문제 · 정답 화면이면 지금 문제 바로 뒤.
 * - 이번 라운드 문제: 그 자리로 옮기고 나머지는 순서를 지킨 채 한 칸씩 뒤로 (R-35)
 * - 라운드에 안 뽑힌 후보(같은 카테고리, 이 게임에서 아직 안 낸 문제 — R-52): 그 자리에 넣고, 라운드 문제 수는 그대로 —
 *   이번 라운드에서 가장 늦게 나올 문제가 후보로 돌아간다. 다음 차례가 라운드 끝이면(마지막 문제) 하나 더 붙인다 (한 문제 더와 같게 — R-43)
 */
export function setNextQuestion(session, questionId, game = null) {
  const nextAt = session.screen === 'round' ? 0
    : session.screen === 'question' || session.screen === 'answer' ? session.questionIndex + 1 : -1;
  if (!isScoring(session) || nextAt < 0) return { session, error: '지금은 다음 문제를 고를 수 없습니다' };
  const pick = session.picks[session.roundIndex];
  const ids = pick?.questionIds ?? [];
  const from = ids.indexOf(questionId);
  if (from < 0) {
    const candidate = game && pick && remainingQuestions(game, session, pick.categoryId).some((q) => q.id === questionId);
    if (!candidate) return { session, error: '이번 라운드 카테고리에서 아직 안 낸 문제가 아닙니다' };
    const s = clone(session);
    const order = s.picks[s.roundIndex].questionIds;
    if (nextAt < order.length) order.pop();
    order.splice(nextAt, 0, questionId);
    return { session: touch(s) };
  }
  if (from < nextAt) return { session, error: from === session.questionIndex ? '지금 나와 있는 문제입니다' : '이미 낸 문제입니다' };
  if (from === nextAt) return { session };
  const s = clone(session);
  const order = s.picks[s.roundIndex].questionIds;
  order.splice(from, 1);
  order.splice(nextAt, 0, questionId);
  return { session: touch(s) };
}

export function stageStep(session, game, dir) {
  if (session.screen !== 'question' && session.screen !== 'tiebreakQuestion') return { session };
  const cur = currentQuestion(session);
  const found = cur ? findQuestion(game, cur.id) : null;
  const { initial, final } = stageRange(found?.question, session.type);
  const stage = Math.min(final, Math.max(initial, session.stage + dir));
  if (stage === session.stage) return { session };
  const s = clone(session); s.stage = stage;
  return { session: touch(s) };
}

export function toggleHint(session) {
  if (!['question', 'answer', 'tiebreakQuestion', 'tiebreakAnswer'].includes(session.screen)) return { session };
  const s = clone(session); s.hintVisible = !s.hintVisible;
  return { session: touch(s) };
}

/** 지금 추가 문제에 참여하는 팀 (동점 그룹) */
export const tiebreakGroup = (session) => session.tiebreak?.groups?.at(-1) ?? [];

/**
 * 맞힌 팀 지정 — 정답 공개 화면에서만 (R-29). team = null 이면 [없음].
 * 문제당 맞힌 팀 최대 1팀 (선착순 D-2) — 다른 팀이면 교체. rep = 맞힌 대표 (팀당 대표 방식, R-94 — resolveRep)
 */
export function credit(session, team, teamNames = [], rep = null) {
  if (session.screen !== 'answer' && session.screen !== 'tiebreakAnswer') return { session, ignored: '정답 공개 후에 맞힌 팀을 고를 수 있습니다' };
  const n = session.snapshot.teamCount;
  if (team !== null && (!Number.isInteger(team) || team < 0 || team >= n)) return { session, ignored: '없는 팀' };
  if (team !== null && session.screen === 'tiebreakAnswer' && !tiebreakGroup(session).includes(team)) {
    return { session, ignored: '동점 팀만 참여합니다', toast: '동점 팀만 참여합니다' };
  }
  const cur = currentQuestion(session);
  if (!cur) return { session };
  // 릴레이 — 대표를 모두 내보낸 팀은 이번 라운드에서 빠졌다 (R-62)
  if (team !== null && relayOut(session, cur.key).includes(team)) {
    const msg = `${teamNames[team] ?? `팀${team + 1}`} — 대표가 모두 맞혀 이번 라운드에서 빠졌습니다`;
    return { session, ignored: msg, toast: msg };
  }
  const who = resolveRep(session, cur.key, team, rep, teamNames);
  if (who.error) return { session, ignored: who.error, toast: who.error };
  return creditKey(session, cur.key, team, teamNames, who.rep);
}

/**
 * 문제 하나(key — 추가 문제는 tb:<id>)의 맞힌 팀을 team 으로 (null = 없음). 맞힌 팀 지정 · 정답 기록 고치기 공용 — 같은 기록 방식.
 * rep = 맞힌 대표 (R-94) — 기록에 함께 남긴다. 같은 팀의 다른 대표면 replace. null 이면 대표 없이 (같은 팀이면 그대로)
 */
function creditKey(session, key, team, teamNames = [], rep = null) {
  const { scored, none, reps } = replay(session.history);
  const had = scored.get(key);
  const hadRep = reps.get(key) ?? null;
  const s = clone(session);
  const at = Date.now();
  const name = (t) => teamNames[t] ?? `팀${t + 1}`;
  const who = (op) => (rep === null ? op : { ...op, rep });
  let toast;
  if (team === null) {
    if (had !== undefined) s.history.push({ op: 'remove', q: key, team: had, none: true, at });
    else if (!none.has(key)) s.history.push({ op: 'none', q: key, at });
    else return { session };
  } else if (had === undefined) {
    s.history.push(who({ op: 'add', q: key, team, at }));
  } else if (had === team && (rep === null || rep === hadRep)) {
    return { session };
  } else {
    s.history.push(who({ op: 'replace', q: key, from: had, team, at }));
    toast = had === team ? `맞힌 사람 변경: ${name(team)} ${hadRep === null ? '' : `대표${hadRep + 1} → `}대표${rep + 1}`
      : `맞힌 팀 변경: ${name(had)} → ${name(team)}${rep === null ? '' : ` 대표${rep + 1}`}`;
  }
  return { session: touch(s), toast };
}

/**
 * 정답 기록 고치기 (진행자 화면 [📝 정답 기록], R-60) — 이 게임에서 이미 낸 문제 하나의 맞힌 팀. 화면은 그대로, 토스트 없음.
 * 낸 문제 · 공개됨인지는 부르는 쪽이 문제 기록으로 확인한다 (stats.js creditTarget). group = 추가 문제면 그 동점 팀.
 * 결과 화면에서 바뀌면 순위가 바뀔 수 있어 순위 공개 · 점수판 채우기를 다시 (docs/07-state-model.md 5-3)
 */
export function setCredit(session, key, team, { group = null, rep = null, teamNames = [] } = {}) {
  const n = session.snapshot.teamCount;
  if (team !== null && (!Number.isInteger(team) || team < 0 || team >= n)) return { session, error: '없는 팀입니다' };
  if (team !== null && group && !group.includes(team)) return { session, error: '추가 문제는 동점 팀만 고를 수 있습니다' };
  if (team !== null && relayOut(session, key).includes(team)) return { session, error: '그 문제 전에 대표가 모두 맞힌 팀입니다' };
  const who = resolveRep(session, key, team, rep, teamNames);
  if (who.error) return { session, error: who.error };
  const res = creditKey(session, key, team, teamNames, who.rep);
  if (res.session === session) return { session };
  if (res.session.screen === 'result') { res.session.resultRevealCount = 0; res.session.scoreboardFill = null; }
  return { session: res.session };
}

/** Shift+1~4 — 이 문제에서 그 팀 득점 취소 */
export function uncredit(session, team) {
  if (session.screen !== 'answer' && session.screen !== 'tiebreakAnswer') return { session };
  const cur = currentQuestion(session);
  if (!cur) return { session };
  const { scored } = replay(session.history);
  if (scored.get(cur.key) !== team) return { session };
  const s = clone(session);
  s.history.push({ op: 'remove', q: cur.key, team, at: Date.now() });
  return { session: touch(s) };
}

/**
 * 추가 문제 열기 (D-3) — 결과 모두 공개 + 동점 그룹 + 추가 문제 후보.
 * questionId 가 있으면 진행자가 고른 그 문제 (R-54 — 후보가 아니면 거절), 없으면 후보 중 무작위 (게임 창 S, 비상용)
 */
export function openTiebreak(session, game, questionId = null) {
  if (session.screen !== 'result') return { session };
  const rank = ranking(session);
  if (session.resultRevealCount < rank.groups.length) return { session };
  const group = rank.ties[0];
  if (!group) return { session };
  const pool = tiebreakPool(game, session);
  if (!pool.length) return { session, toast: '추가 문제가 없어 공동 순위로 정합니다' };
  const q = questionId === null ? pickOne(pool) : pool.find((x) => x.id === questionId);
  if (!q) return { session, error: '추가 문제로 낼 수 있는 문제가 아닙니다' };
  const s = clone(session);
  s.tiebreak.used.push(q.id);
  s.tiebreak.groups.push([...group.teams]);
  s.screen = 'tiebreakQuestion'; s.hintVisible = false;
  setStage(s, game, 'initial');
  return { session: touch(s) };
}

/** 일찍 끝내기 (E) → 결과. 라운드 도중이어도 라운드 종료 화면은 거치지 않는다 (R-56) */
export function endEarly(session) {
  if (!['roulette', 'round', 'question', 'answer', 'roundEnd'].includes(session.screen)) return { session };
  return { session: touch(toResult(clone(session))) };
}

export function setFill(session, value) {
  const s = clone(session); s.scoreboardFill = value;
  return { session: touch(s) };
}

/** 종합 점수판에 반영한 라운드 (R-57) — picks 인덱스, 오름차순 · 중복 없음 */
export function setReflected(session, idxs) {
  const s = clone(session);
  s.reflectedRounds = [...new Set(idxs)].filter((i) => Number.isInteger(i) && i >= 0 && i < s.picks.length).sort((a, b) => a - b);
  return { session: touch(s) };
}

export function setWheel(session, wheel) {
  const s = clone(session); s.wheel = [...wheel];
  return { session: touch(s) };
}

export function toggleWheel(session, game, categoryId) {
  const item = wheelList(game, session).find((i) => i.id === categoryId);
  // 모두 출제한 항목 · (릴레이) 문제가 부족한 항목은 넣기 · 빼기 모두 무시 (06-controls 3-4, R-62) — 넣은 채로 두면 관리에서 문제를 더 넣었을 때 바로 후보로 돌아온다
  if (!item || item.exhausted || item.short) return { session };
  const wheel = item.included ? session.wheel.filter((id) => id !== categoryId) : [...session.wheel, categoryId];
  // 데이터 순서대로 정렬해 원판 조각 순서를 고정
  const order = game.categories.map((c) => c.id);
  wheel.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return setWheel(session, wheel);
}

export function includeAll(session, game) {
  // 룰렛형의 문제를 다 낸 주제는 모두 넣기로 넣지 않는다 — 하나씩은 넣을 수 있다 (D-26, R-45)
  const wheel = wheelList(game, session).filter((i) => !i.exhausted && !i.short && !(session.type === 'roulette' && i.remaining === 0)).map((i) => i.id);
  return setWheel(session, wheel);
}

// ── 룰렛형 전이 (docs/07-state-model.md 6장) ─────────────
/** 이 주제에서 문제를 다 냈는가 — 문제가 있는 주제만 (문제 없는 주제는 늘 false) */
export function topicDone(game, session, categoryId) {
  const c = findCategory(game, categoryId);
  return !!c && usableQuestions(c).length > 0 && remainingQuestions(game, session, categoryId).length === 0;
}

/**
 * 다음 주제 → 주제 고르기. 이 주제에서 문제를 내다가 다 떨어졌으면 무작위 후보(wheel)에서 뺀다 (D-26, R-45 · R-65).
 * 다 낸 그때 한 번만 — 문제 없이 고른 주제가 넘어갈 때는 그대로 둔다
 */
export function topicNext(session, game = null) {
  if (session.screen !== 'topic') return { session };
  const s = clone(session); s.screen = 'roulette';
  const pick = s.picks.at(-1);
  if (game && pick?.questionIds?.length && topicDone(game, s, pick.categoryId)) {
    s.wheel = s.wheel.filter((id) => id !== pick.categoryId);
  }
  return { session: touch(s) };
}

/** 무작위로 고를 주제 (R-65) — 게임 홈에서 넣은 주제 중 문제를 다 내지 않은 것. 이미 고른 주제도 다시 나올 수 있다 (R-16) */
export function topicPool(game, session) {
  return wheelCandidates(game, session).filter((id) => !topicDone(game, session, id));
}

/**
 * 진행자가 주제를 고른다 (R-65 — 원판 없이, 모니터에는 고른 순간 주제 카드). categoryId 가 없으면 topicPool 에서 무작위.
 * 문제는 진행자가 [첫 문제 ▶] 로 시작한다 — 문제 · 정답 후보는 진행자 화면에만 보인다
 */
export function pickTopic(session, game, categoryId = null) {
  if (session.type !== 'roulette' || session.screen !== 'roulette') return { session };
  let id = categoryId;
  if (id === null) {
    const pool = topicPool(game, session);
    if (!pool.length) return { session, error: '무작위로 고를 주제가 없습니다 — 목록에서 직접 고르세요' };
    id = pickOne(pool);
  }
  const c = findCategory(game, id);
  if (!c || c.disabled) return { session, error: '없는 주제입니다' };
  return confirmPick(session, game, id);
}

/** 주제 카드 · 문제 화면의 지금 문제 id (주제 카드면 null, R-44) */
export function topicQuestionId(session) {
  if (session?.screen !== 'topic') return null;
  return session.picks.at(-1)?.questionIds?.at(-1) ?? null;
}

/** 줄줄이 말해요 문제 순서 옵션 — 예전 세션(빈 options)은 랜덤 (R-45) */
export const topicOrder = (session) => (session?.snapshot?.options?.questionOrder === 'fixed' ? 'fixed' : 'random');

/** 작성 순서일 때 [다음 문제] 로 나올 문제 id (랜덤이면 null) */
export function topicNextId(game, session) {
  if (session?.screen !== 'topic' || topicOrder(session) !== 'fixed') return null;
  const pick = session.picks.at(-1);
  return pick ? remainingQuestions(game, session, pick.categoryId)[0]?.id ?? null : null;
}

/**
 * 첫 문제 · 다음 문제 (R-44) — 지금 주제에서 이 게임에 아직 안 낸 문제 하나를 마지막 pick 의 questionIds 끝에 붙이고,
 * 모니터의 정답 후보는 다시 숨긴다. questionId 가 없으면 문제 순서 옵션대로(랜덤 · 작성 순서), 있으면 진행자가 고른 그 문제 (D-24, R-45)
 */
export function topicQuestion(session, game, questionId = null) {
  if (session.screen !== 'topic') return { session };
  const pick = session.picks.at(-1);
  const c = pick ? findCategory(game, pick.categoryId) : null;
  if (!c) return { session };
  if (!usableQuestions(c).length) return { session, error: '문제가 없는 주제입니다' };
  const rem = remainingQuestions(game, session, c.id);
  let q;
  if (questionId) {
    q = rem.find((x) => x.id === questionId);
    if (!q) {
      const inTopic = (c.questions ?? []).some((x) => x.id === questionId);
      return { session, error: !inTopic ? '이 주제의 문제가 아닙니다' : usedQuestionIds(session).has(questionId) ? '이미 낸 문제입니다' : '숨긴 문제입니다' };
    }
  } else {
    if (!rem.length) return { session, error: '이 주제에 남은 문제가 없습니다' };
    q = topicOrder(session) === 'fixed' ? rem[0] : pickOne(rem);
  }
  const s = clone(session);
  const last = s.picks.at(-1);
  last.questionIds = [...(last.questionIds ?? []), q.id];
  s.answersVisible = false;
  return { session: touch(s) };
}

export function topicPrev(session) {
  if (session.screen === 'topic') {
    const s = clone(session);
    const last = s.picks.at(-1);
    // 문제를 낸 뒤면 방금 낸 문제만 취소 (안 낸 것으로) → 직전 문제 · 주제 카드 (R-44)
    if (last?.questionIds?.length) {
      last.questionIds.pop();
      s.answersVisible = false;
      return { session: touch(s) };
    }
    s.picks.pop(); s.screen = 'roulette';
    return { session: touch(s) };
  }
  if (session.screen === 'roulette') return { session, goHome: true };
  return { session };
}

export function toggleExamples(session) {
  if (session.screen !== 'topic') return { session };
  const s = clone(session); s.examplesVisible = !s.examplesVisible;
  return { session: touch(s) };
}

/** 정답 후보 모니터 표시 — 문제 화면에서만 (R-44) */
export function toggleAnswers(session) {
  if (!topicQuestionId(session)) return { session };
  const s = clone(session); s.answersVisible = !s.answersVisible;
  return { session: touch(s) };
}

export function finishRoulette(session) {
  const s = clone(session); s.status = 'finished';
  return { session: touch(s) };
}

// ── 복원 검사 (docs/07-state-model.md 7장) ────────────────
/** 데이터와 맞지 않는 부분을 고친다. 고칠 수 없으면 null */
export function repairSession(session, game) {
  if (!session || session.version !== 1 || session.empty) return { session: null };
  if (session.gameId !== game.id || session.type !== game.type) return { session: null, notice: '진행 기록이 게임 데이터와 맞지 않아 지웠습니다' };
  const s = clone(session);
  const notices = [];
  s.wheel = (s.wheel ?? []).filter((id) => findCategory(game, id));
  if (isScoring(s)) {
    let dropped = 0;
    s.picks = (s.picks ?? []).filter((p) => findCategory(game, p.categoryId)).map((p) => {
      const kept = p.questionIds.filter((q) => findQuestion(game, q));
      dropped += p.questionIds.length - kept.length;
      return { ...p, questionIds: kept };
    });
    const emptyBefore = s.picks.length;
    s.picks = s.picks.filter((p) => p.questionIds.length > 0);
    if (dropped) notices.push(`관리에서 지운 문제 ${dropped}개를 건너뜁니다`);
    if (emptyBefore !== s.picks.length && ['round', 'question', 'answer', 'roundEnd'].includes(s.screen)) s.screen = 'roulette';
    // 반영한 라운드 (R-57) — 라운드가 빠져 번호가 밀렸으면 처음부터 (점수판 값은 그대로, 다시 반영하면 맞춰진다)
    s.reflectedRounds = emptyBefore !== s.picks.length || !Array.isArray(s.reflectedRounds) ? []
      : s.reflectedRounds.filter((i) => Number.isInteger(i) && i >= 0 && i < s.picks.length);
    s.tiebreak = s.tiebreak ?? { used: [], groups: [] };
    s.tiebreak.groups = s.tiebreak.groups ?? [];
    if (['question', 'answer', 'round', 'roundEnd'].includes(s.screen)) {
      if (s.roundIndex >= s.picks.length) { s.screen = s.picks.length ? 'answer' : 'roulette'; s.roundIndex = Math.max(0, s.picks.length - 1); }
      const len = s.picks[s.roundIndex]?.questionIds.length ?? 0;
      if (s.questionIndex >= len) s.questionIndex = Math.max(0, len - 1);
      if (s.screen === 'roundEnd') s.questionIndex = Math.max(0, len - 1); // 라운드 종료 화면은 그 라운드 마지막 문제 다음
    }
    if (s.screen === 'roulette') { s.roundIndex = s.picks.length; s.questionIndex = 0; }
    if ((s.screen === 'tiebreakQuestion' || s.screen === 'tiebreakAnswer') && !findQuestion(game, s.tiebreak.used.at(-1))) s.screen = 'result';
    if (s.screen === 'question' || s.screen === 'answer' || s.screen.startsWith('tiebreak')) {
      const range = stageRange(findQuestion(game, currentQuestion(s)?.id)?.question, s.type);
      s.stage = Math.min(range.final, Math.max(range.initial, s.stage ?? range.initial));
    }
  } else {
    let dropped = 0;
    s.picks = (s.picks ?? []).filter((p) => findCategory(game, p.categoryId)).map((p) => {
      if (!Array.isArray(p.questionIds)) return p;
      const kept = p.questionIds.filter((q) => findQuestion(game, q));
      dropped += p.questionIds.length - kept.length;
      return { ...p, questionIds: kept };
    });
    if (dropped) notices.push(`관리에서 지운 문제 ${dropped}개를 건너뜁니다`);
    if (s.screen === 'topic' && !s.picks.length) s.screen = 'roulette';
    s.examplesVisible = !!s.examplesVisible;
    s.answersVisible = !!s.answersVisible;
  }
  return { session: s, notice: notices.join(' · ') || undefined };
}

/** 이어하기 문구 (docs/07-state-model.md 4장) */
export function resumeLabel(session, game) {
  if (!session || session.empty) return '';
  if (!isScoring(session)) return `${game.title} · 주제 ${session.picks.length}개`;
  if (pickMode(session) && ['roulette', 'round', 'question', 'answer', 'roundEnd'].includes(session.screen)) {
    return session.screen === 'question' || session.screen === 'answer' ? `${game.title} · ${askedCount(session)}번째 문제` : `${game.title} · 문제 ${askedCount(session)}개 냄`;
  }
  if (session.screen === 'roulette') return `${game.title} · R${session.picks.length + 1} 카테고리 추첨`;
  if (session.screen === 'result' || session.screen.startsWith('tiebreak')) return `${game.title} · 결과`;
  if (session.screen === 'roundEnd') return `${game.title} · R${session.roundIndex + 1} 종료`;
  return `${game.title} · R${session.roundIndex + 1} · ${session.questionIndex + 1}번 문제`;
}

export { isTb, TB };
