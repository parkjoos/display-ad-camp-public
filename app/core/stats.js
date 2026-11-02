// 기록 · 통계 계산 (docs/05-screens.md 4-12, R-58) — 화면 · 저장과 무관한 순수 함수.
// 모니터에 보이는 화면이므로 아직 내지 않은 문제와 공개 전 정답은 내보내지 않는다.

import { replay, teamCounts, roundCounts, roundRanksAt, relayOf, relayGoal, relayRound, relayOpt, TB } from './scoring.js';
import { findCategory, findQuestion } from './state.js';
import { totals, effectiveRounds, hasEntries } from './scoreboard.js';

const zeros = (n) => Array.from({ length: n }, () => 0);
const answerOf = (game, id) => findQuestion(game, id)?.question.answer ?? '(지운 문제)';

/**
 * 라운드마다 이미 낸 문제 수. 지금 라운드는 화면에 따라 — 라운드 소개면 0, 문제 · 정답이면 지금 문제까지,
 * 결과(일찍 끝냄)면 맞힌 팀 기록이 있는 지금 문제까지. 라운드를 확정할 때 뽑아 둔 남은 문제는 세지 않는다
 */
function askedCount(session, ri, record) {
  const ids = session.picks[ri].questionIds;
  if (ri < session.roundIndex || session.screen === 'roulette' || session.screen === 'roundEnd') return ids.length;
  if (ri > session.roundIndex) return 0;
  const q = session.questionIndex;
  if (session.screen === 'round') return 0;
  if (session.screen === 'question' || session.screen === 'answer') return q + 1;
  // 결과 · 추가 문제 — 라운드 종료를 거쳤으면 q 가 마지막. [종료] 로 일찍 끝냈으면 판정 기록이 있는 지금 문제까지
  return q + (record(ids[q]) ? 1 : 0);
}

/**
 * 문제 기록 (득점형) — 라운드별로 낸 문제 · 정답 · 맞힌 팀. 지금 문제가 정답 공개 전이면 answer = null, live = true.
 * @returns {{rounds:{index:number, categoryId:string, name:string, icon:string, counts:number[],
 *   questions:{n:number, id:string, answer:(string|null), live:boolean, team:(number|null), rep:(number|null), none:boolean}[]}[],
 *   tiebreak:{n:number, id:string, answer:(string|null), live:boolean, group:number[], team:(number|null), none:boolean}[]}}
 *   rep = 맞힌 대표 (팀당 대표 방식, R-94 — 센 대표: 기록이 없거나 다 채운 대표로 기록된 정답은 남은 첫 대표). 대표를 나누지 않으면 null
 */
export function questionLog(session, game) {
  const { scored, none, reps } = replay(session.history);
  const record = (key) => scored.has(key) || none.has(key);
  const perRound = roundCounts(session, scored);
  const goal = relayGoal(session);
  const opt = goal ? relayOpt(session) : null;
  const rounds = session.picks.map((p, ri) => {
    const c = findCategory(game, p.categoryId);
    const n = askedCount(session, ri, record);
    const repAt = opt ? relayRound(p.questionIds, scored, session.snapshot.teamCount, goal, undefined, opt).repAt : [];
    const questions = p.questionIds.slice(0, n).map((id, i) => {
      const live = ri === session.roundIndex && i === session.questionIndex && session.screen === 'question';
      const team = scored.get(id) ?? null;
      return { n: i + 1, id, answer: live ? null : answerOf(game, id), live, team, rep: opt && team !== null ? repAt[i] ?? reps.get(id) ?? null : null, none: none.has(id) };
    });
    return { index: ri, categoryId: p.categoryId, name: c?.name ?? p.categoryId, icon: c?.icon ?? '❓', counts: perRound[ri], questions };
  }).filter((r) => r.questions.length > 0);
  const used = session.tiebreak?.used ?? [];
  const tiebreak = used.map((id, i) => {
    const live = i === used.length - 1 && session.screen === 'tiebreakQuestion';
    const key = TB + id;
    return { n: i + 1, id, answer: live ? null : answerOf(game, id), live, group: session.tiebreak.groups?.[i] ?? [], team: scored.get(key) ?? null, none: none.has(key) };
  });
  return { rounds, tiebreak };
}

/**
 * 정답 기록 고치기(R-60)로 고칠 수 있는 문제인가 — 이 게임에서 낸 문제이고 정답을 공개했을 것.
 * @param key 문제 id (추가 문제는 tb:<id>)
 * @returns {{group:(number[]|null)}|{error:string}} group = 추가 문제면 그 동점 팀
 */
export function creditTarget(session, game, key) {
  const log = questionLog(session, game);
  const tb = typeof key === 'string' && key.startsWith(TB);
  const q = typeof key !== 'string' ? null
    : tb ? log.tiebreak.find((x) => TB + x.id === key) : log.rounds.flatMap((r) => r.questions).find((x) => x.id === key);
  if (!q) return { error: '이 게임에서 낸 문제가 아닙니다' };
  if (q.live) return { error: '정답 공개 뒤에 고칠 수 있습니다' };
  return { group: tb ? q.group : null };
}

/** 끝난 라운드 — 라운드 1위 횟수는 끝난 라운드만 센다 (진행 중인 라운드는 아직 순위가 없다) */
function doneRounds(session) {
  if (['roundEnd', 'result', 'tiebreakQuestion', 'tiebreakAnswer', 'roulette'].includes(session.screen)) return session.picks.length;
  return Math.max(0, session.picks.length - 1);
}

/**
 * 게임 하나의 팀별 통계 — 정답 수 · 라운드별 정답 수 · 라운드 1위 횟수 (공동 포함) · 낸 문제 수 · 정답자 없음 수.
 * @returns {{counts:number[], rounds:{name, icon, counts:number[], top:(number|null), done:boolean}[], roundWins:number[], asked:number, noneCount:number}}
 */
export function gameStats(session, game) {
  const n = session.snapshot.teamCount;
  const { scored } = replay(session.history);
  const log = questionLog(session, game);
  const done = doneRounds(session);
  const roundWins = zeros(n);
  const rounds = log.rounds.map((r) => {
    // 릴레이는 대표를 모두 내보낸 순서가 라운드 등수 (R-62)
    const rr = r.index < done ? roundRanksAt(session, r.index, scored) : null;
    if (rr) rr.forEach((rank, t) => { if (rank === 1) roundWins[t] += 1; });
    const max = Math.max(0, ...r.counts);
    const top = relayOf(session) ? (rr && rr.filter((x) => x === 1).length === 1 ? rr.indexOf(1) : null)
      : max > 0 && r.counts.filter((c) => c === max).length === 1 ? r.counts.indexOf(max) : null;
    return { name: r.name, icon: r.icon, counts: r.counts, top, done: r.index < done };
  });
  const qs = log.rounds.flatMap((r) => r.questions).filter((q) => !q.live);
  return { counts: teamCounts(session, scored), rounds, roundWins, asked: qs.length, noneCount: qs.filter((q) => q.none && q.team === null).length };
}

/**
 * 종합 점수 추이 (R-58) — 점수판 log 를 꺾은선의 점으로. 처음은 0점. 점수는 있는데 기록이 없으면(R-58 전 상태) "지금" 한 점.
 * @returns {{points:{what:string, totals:number[]}[], now:{totals:number[], ranks:number[]}}}
 */
export function scoreTrend(sbState, defaultRounds, teamCount) {
  const now = totals(effectiveRounds(sbState, defaultRounds), sbState?.entries ?? {}, teamCount);
  const fit = (arr) => Array.from({ length: teamCount }, (_, t) => arr?.[t] ?? 0);
  const log = Array.isArray(sbState?.log) ? sbState.log : [];
  if (!hasEntries(sbState)) return { points: [], now };
  const points = [{ what: '시작', totals: zeros(teamCount) }, ...log.map((e) => ({ what: e.what, totals: fit(e.totals) }))];
  if (!log.length) points.push({ what: '지금', totals: now.totals });
  return { points, now };
}
