// 정답 수 · 순위 (docs/07-state-model.md 4장, docs/games/README.md 3장, docs/13-scoreboard.md 10장)
// 게임은 맞힌 개수만 센다 (R-22). 종합 점수는 계산하지 않는다 — 정답 수 방식 라운드의 점수 표시(R-49)는 정답 수 × 1개당 점수.

export const TB = 'tb:';
export const isTb = (q) => typeof q === 'string' && q.startsWith(TB);

/**
 * history 재생.
 * @returns {{scored: Map<string, number>, none: Set<string>, reps: Map<string, number>}}
 *   scored = 문제별 맞힌 팀 (문제당 최대 1팀 — 선착순 D-2), none = [없음] 으로 표시한 문제,
 *   reps = 문제별 맞힌 대표 번호 (팀당 대표 방식, 0부터 — R-94. 기록에 없으면 빠짐)
 */
export function replay(history = []) {
  const scored = new Map();
  const none = new Set();
  const reps = new Map();
  for (const op of history) {
    if (op.op === 'add' || op.op === 'replace') {
      scored.set(op.q, op.team);
      if (Number.isInteger(op.rep)) reps.set(op.q, op.rep); else reps.delete(op.q);
      none.delete(op.q);
    } else if (op.op === 'remove') {
      if (scored.get(op.q) === op.team) { scored.delete(op.q); reps.delete(op.q); }
      if (op.none) none.add(op.q); else none.delete(op.q);
    } else if (op.op === 'none') {
      none.add(op.q);
    }
  }
  return { scored, none, reps };
}

const zeros = (n) => Array.from({ length: n }, () => 0);

/** 팀별 정답 수 (추가 문제 tb: 제외) */
export function teamCounts(session, scored = replay(session.history).scored) {
  const n = session.snapshot.teamCount;
  const counts = zeros(n);
  for (const [q, t] of scored) if (!isTb(q) && t >= 0 && t < n) counts[t] += 1;
  return counts;
}

/** 라운드별 팀 정답 수 [[팀1, 팀2, …] 라운드마다] */
export function roundCounts(session, scored = replay(session.history).scored) {
  const n = session.snapshot.teamCount;
  return session.picks.map((p) => {
    const c = zeros(n);
    for (const q of p.questionIds) {
      const t = scored.get(q);
      if (t !== undefined && t < n) c[t] += 1;
    }
    return c;
  });
}

/** 정답 수 배열 → 1224 순위 */
export function competitionRanks(counts) {
  return counts.map((c) => 1 + counts.filter((o) => o > c).length);
}

// ── 릴레이 (R-62) — 팀마다 대표 n명이 나와 맞힌 사람은 라운드에서 빠지고, 대표를 모두 내보낸 순서가 라운드 등수 ──

/** 팀당 대표 수 — 0 이면 정답 수 방식 (릴레이 전 세션 포함) */
export const relayOf = (session) => {
  const n = session?.snapshot?.options?.relay;
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** 인당 문제 — 대표 한 명이 맞히고 빠지는 문제 수 (R-64). 없으면 1 (R-64 전 세션 포함). 앱은 사람을 세지 않고 팀이 끝나는 정답 수만 늘린다 */
export const relayPerOf = (session) => {
  const n = session?.snapshot?.options?.perRep;
  return Number.isInteger(n) && n > 0 ? n : 1;
};

/** 팀이 대표를 모두 내보내는 정답 수 — 대표 수 × 인당 문제 (R-64). 릴레이가 아니면 0 */
export const relayGoal = (session) => relayOf(session) * relayPerOf(session);

/** 라운드 순위가 정해지는 정답 수 — 한 팀만 남을 때까지 (팀 수 − 1) × 대표 수. 이보다 문제가 적은 카테고리는 쓰지 않는다 */
export const relayNeed = (teamCount, relay) => Math.max(1, teamCount - 1) * relay;

/** 배점표에 사진 게임 행이 없을 때 결과 순위에 쓰는 라운드 배점 (점수판 기본값과 같다) */
export const RELAY_POINTS = [100, 50, 0, 0];

/**
 * 릴레이 라운드 하나 — 문제 순서대로 맞힌 팀 · 대표를 세어, 대표를 모두 내보낸(goal 번 맞힌) 순서가 등수.
 * 대표는 한 명당 per 번까지 — 다 채운 대표는 빠진다 (R-94). 대표 번호 기록이 없는 정답(R-94 전 기록)이나 이미 다 채운 대표로 기록된 정답
 * (앞 문제의 정답 기록을 고쳐 생긴 것)은 그때 아직 남은 첫 대표로 센다 — 팀이 맞힌 수 · 등수는 대표 기록과 상관없다.
 * 다 내보낸 팀의 뒤 기록(정답 기록을 고쳐 생긴 것)은 세지 않는다.
 * 못 끝낸 팀은 끝낸 팀 다음 — 맞힌 수로 1224 (라운드를 일찍 끝냈거나 문제가 떨어졌을 때).
 * @param goal 팀이 끝나는 정답 수 — 대표 수 × 인당 문제 (relayGoal, R-64)
 * @param upTo 앞에서부터 이만큼의 문제만 (지금 문제 전까지 등)
 * @param opt 대표 기록 (relayOpt) — 없으면 대표 한 명이 goal 번 (대표를 나누지 않음)
 * @returns {{counts:number[], reps:number[][], repAt:(number|null)[], finish:number[], ranks:(number[]|null), decided:boolean}}
 *   counts = 팀별 맞힌 수, reps = 팀별 대표마다 맞힌 수, repAt = 문제마다 센 대표 (세지 않았으면 null),
 *   finish = 대표를 모두 내보낸 팀 (순서대로), ranks = 등수 (정답이 하나도 없으면 null), decided = 한 팀만 남아 순위가 모두 정해짐
 */
export function relayRound(questionIds, scored, teamCount, goal, upTo = questionIds.length, { reps = null, relay = 1, per = goal } = {}) {
  const counts = zeros(teamCount);
  const byRep = Array.from({ length: teamCount }, () => zeros(relay));
  const repAt = [];
  const finish = [];
  for (const q of questionIds.slice(0, upTo)) {
    const t = scored.get(q);
    repAt.push(null);
    if (t === undefined || t < 0 || t >= teamCount || counts[t] >= goal) continue;
    const want = reps?.get(q);
    const r = Number.isInteger(want) && want >= 0 && want < relay && byRep[t][want] < per ? want : byRep[t].findIndex((c) => c < per);
    if (r < 0) continue;
    byRep[t][r] += 1;
    counts[t] += 1;
    repAt[repAt.length - 1] = r;
    if (counts[t] === goal) finish.push(t);
  }
  const out = (t) => !finish.includes(t);
  const ranks = counts.some((c) => c > 0)
    ? counts.map((c, t) => (out(t) ? finish.length + 1 + counts.filter((o, u) => out(u) && o > c).length : finish.indexOf(t) + 1))
    : null;
  return { counts, reps: byRep, repAt, finish, ranks, decided: finish.length >= teamCount - 1 };
}

/** 세션의 대표 기록 — relayRound 의 opt (R-94) */
export const relayOpt = (session) => ({ reps: replay(session.history).reps, relay: relayOf(session), per: relayPerOf(session) });

/** 라운드 i 의 등수 — 릴레이면 대표를 모두 내보낸 순서, 아니면 그 라운드 정답 수 1224 (정답이 없으면 null, R-57) */
export function roundRanksAt(session, i, scored = replay(session.history).scored) {
  const goal = relayGoal(session);
  const pick = session.picks[i];
  if (!pick) return null;
  if (goal) return relayRound(pick.questionIds, scored, session.snapshot.teamCount, goal, undefined, relayOpt(session)).ranks;
  return roundRanks(roundCounts(session, scored)[i]);
}

/** 릴레이 게임 점수 — 라운드마다 등수의 배점을 더한 것 (종합 점수판과 같은 계산, 게임 결과 순위 · R-62) */
export function relayScores(session, scored = replay(session.history).scored) {
  const n = session.snapshot.teamCount;
  const points = Array.isArray(session.snapshot.points) ? session.snapshot.points : RELAY_POINTS;
  const sums = zeros(n);
  session.picks.forEach((_, i) => {
    const rr = roundRanksAt(session, i, scored);
    if (rr) rr.forEach((r, t) => { sums[t] += points[r - 1] ?? 0; });
  });
  return sums;
}

/**
 * 순위 — 정답 수 1224 순위 + 추가 문제(D-3)로 가린 순서.
 * 같은 정답 수 안에서는 추가 문제를 먼저 맞힌 팀이 위. 아직 못 가린 팀끼리는 공동.
 * 릴레이(R-62)는 정답 수 대신 라운드 배점 합 — counts 가 점수다.
 * @returns {{counts:number[], ranks:number[], groups:{rank:number, teams:number[], count:number}[], ties:{rank:number, teams:number[], count:number}[], decided:boolean[]}}
 */
export function ranking(session, scored = replay(session.history).scored) {
  const n = session.snapshot.teamCount;
  const counts = relayOf(session) ? relayScores(session, scored) : teamCounts(session, scored);
  const tbWin = Array.from({ length: n }, () => Infinity);
  (session.tiebreak?.used ?? []).forEach((qid, i) => {
    const t = scored.get(TB + qid);
    if (t !== undefined && t < n && tbWin[t] === Infinity) tbWin[t] = i;
  });
  const better = (a, b) => counts[a] > counts[b] || (counts[a] === counts[b] && tbWin[a] < tbWin[b]);
  const teams = Array.from({ length: n }, (_, t) => t);
  const ranks = teams.map((t) => 1 + teams.filter((o) => better(o, t)).length);
  const byRank = new Map();
  teams.forEach((t) => {
    if (!byRank.has(ranks[t])) byRank.set(ranks[t], []);
    byRank.get(ranks[t]).push(t);
  });
  const groups = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([rank, ts]) => ({ rank, teams: ts, count: counts[ts[0]] }));
  return {
    counts, ranks, groups,
    ties: groups.filter((g) => g.teams.length > 1),
    decided: teams.map((t) => tbWin[t] !== Infinity),
  };
}

/** 결과 화면 공개 순서 — 하위 순위 그룹부터 */
export const revealOrder = (rank) => [...rank.groups].reverse();

/** 등수 → 배점 점수 */
export function pointsFor(round, rank) {
  if (!round || round.kind !== 'rank' || !rank) return 0;
  return round.points?.[rank - 1] ?? 0;
}

/**
 * 라운드 하나의 등수 — 그 라운드 정답 수로 1224 순위. 정답이 하나도 없는 라운드는 등수 없음(null, 0점) (R-57)
 * @returns {number[]|null}
 */
export function roundRanks(counts) {
  return Math.max(0, ...counts) > 0 ? competitionRanks(counts) : null;
}

/**
 * 종합 점수판 채우기 · 라운드마다 반영 (docs/13-scoreboard.md 10장, R-57) — 둘 다 이 계산.
 * 라운드 단위: 등수 행은 라운드마다 그 라운드 정답 수로 매긴 등수의 목록(점수 = 배점의 합), 정답 수 행(R-49)은 정답 수 합.
 * 카테고리가 연결된 행은 그 카테고리 라운드만. 추가 문제 정답은 넣지 않는다.
 * @param rounds 점수판 라운드 목록 (실제 쓰는 값)
 * @param roundIdxs 넣을 라운드 (picks 인덱스) — 없으면 모든 라운드 (게임 결과 채우기)
 * @returns {{round, skip?:string, rounds?:number[], counts?:number[], byRound?:(number[]|null)[], ranks?:(number|null)[][]}[]}
 *   ranks = 팀마다 라운드별 등수 목록 (등수 행), byRound = 라운드마다 팀별 등수 (등수 없음이면 null)
 */
export function fillRows(session, rounds, roundIdxs = null) {
  const { scored } = replay(session.history);
  const perRound = roundCounts(session, scored);
  const n = session.snapshot.teamCount;
  const use = roundIdxs ?? session.picks.map((_, i) => i);
  return rounds
    .filter((r) => r.gameId === session.gameId && (r.kind === 'rank' || r.kind === 'count'))
    .map((round) => {
      const idx = use.filter((i) => perRound[i] && (!round.categoryId || session.picks[i].categoryId === round.categoryId));
      if (!idx.length) return { round, skip: round.categoryId ? '이번 게임에서 나오지 않음 — 채우지 않음' : '넣을 라운드가 없음 — 채우지 않음' };
      if (round.kind === 'count') {
        const counts = zeros(n);
        idx.forEach((i) => perRound[i].forEach((c, t) => { counts[t] += c; }));
        return { round, rounds: idx, counts };
      }
      const byRound = idx.map((i) => roundRanksAt(session, i, scored)); // 릴레이는 대표를 모두 내보낸 순서 (R-62)
      return { round, rounds: idx, byRound, ranks: Array.from({ length: n }, (_, t) => byRound.map((rr) => (rr ? rr[t] : null))) };
    });
}
