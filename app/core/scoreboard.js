// 종합 점수판 · 배점표 계산 (docs/13-scoreboard.md). 게임 창 · 관리 페이지가 같이 쓴다.
// 점수판은 등수 · 성공 여부를 저장하고 점수는 매번 배점으로 계산한다.

import { competitionRanks, fillRows, replay, roundCounts, roundRanksAt } from './scoring.js';
import { emptyState } from './validate.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 지금 쓰는 라운드 목록 — 바꾼 적 없으면 data/scoreboard.json 기본값 */
export function effectiveRounds(sbState, defaultRounds) {
  return Array.isArray(sbState?.rounds) ? sbState.rounds : (defaultRounds ?? []);
}

/** 등수 칸 — 등수 하나(rank) 또는 퀴즈가 라운드마다 넣은 라운드별 등수 목록(ranks, null = 등수 없음 · R-57) */
const hasRank = (cell) => Number.isInteger(cell.rank) || Array.isArray(cell.ranks);

export const isOverridden = (round, cell) =>
  !!cell && round.kind !== 'manual' && round.kind !== 'count' && Number.isInteger(cell.value) && (hasRank(cell) || typeof cell.pass === 'boolean');

/** 라운드별 등수 목록의 점수 — 라운드마다 배점의 합 (R-57) */
const ranksScore = (round, ranks) => ranks.reduce((sum, r) => sum + (Number.isInteger(r) ? (round.points?.[r - 1] ?? 0) : 0), 0);

/**
 * 게임 화면에 점수를 보여 줄 라운드 — 그 게임 전체에 연결된 "정답 수" 라운드 (R-49).
 * 있으면 게임 화면 · 진행자 화면이 정답 수 × 1개당 점수를 보여 준다. 카테고리별 정답 수 라운드는 해당 없음.
 */
export const perCorrectRound = (rounds, gameId) =>
  (rounds ?? []).find((r) => r.kind === 'count' && r.gameId === gameId && !r.categoryId) ?? null;

/** 칸 점수 (입력 없으면 null) */
export function cellScore(round, cell) {
  if (!cell) return null;
  if (round.kind === 'manual') return Number.isInteger(cell.value) ? cell.value : null;
  // 정답 수 — 정답 수 × 1개당 점수 (R-49)
  if (round.kind === 'count') return Number.isInteger(cell.count) ? cell.count * (round.per ?? 0) : null;
  if (Number.isInteger(cell.value) && (hasRank(cell) || typeof cell.pass === 'boolean')) return cell.value;
  if (round.kind === 'rank' && Array.isArray(cell.ranks)) return ranksScore(round, cell.ranks);
  if (round.kind === 'rank') return Number.isInteger(cell.rank) ? (round.points?.[cell.rank - 1] ?? 0) : null;
  if (round.kind === 'pass') {
    if (cell.pass === true) return round.pass ?? 0;
    if (cell.pass === false) return round.fail ?? 0;
  }
  return null;
}

export const cellFilled = (round, cell) => cellScore(round, cell) !== null;

/** 라운드별 등수 목록 문구 — "1·2·-등" (- 는 정답 없는 라운드), 모두 없으면 "등수 없음" (R-57) */
export const ranksText = (ranks) => (ranks.some(Number.isInteger) ? `${ranks.map((r) => (Number.isInteger(r) ? r : '-')).join('·')}등` : '등수 없음');

/** 칸 표시 문구 — "2등 100", "1·2등 150", "성공 200", "3개 150", "-10" */
export function cellLabel(round, cell) {
  if (!cell) return '';
  const score = cellScore(round, cell);
  if (round.kind === 'rank' && Array.isArray(cell.ranks)) return `${ranksText(cell.ranks)} ${score}`;
  if (round.kind === 'rank' && Number.isInteger(cell.rank)) return `${cell.rank}등 ${score}`;
  if (round.kind === 'pass' && typeof cell.pass === 'boolean') return `${cell.pass ? '성공' : '실패'} ${score}`;
  if (round.kind === 'count' && Number.isInteger(cell.count)) return `${cell.count}개 ${score}`;
  return score === null ? '' : String(score);
}

/** 라운드 배점 요약 — "50/0/0", "성공 200 · 실패 0", "1개당 50", "직접 입력" */
export function roundSummary(round, teamCount = 3) {
  // 퀴즈에 연결된 등수 행은 라운드마다 등수를 매겨 더한다 (R-57)
  if (round.kind === 'rank') return round.points.slice(0, Math.max(3, teamCount === 4 ? 4 : 3)).join('/') + (round.gameId ? ' 라운드마다' : '');
  if (round.kind === 'pass') return `성공 ${round.pass} · 실패 ${round.fail}`;
  if (round.kind === 'count') return `1개당 ${round.per}`;
  return '직접 입력';
}

export function totals(rounds, entries = {}, teamCount) {
  const sums = Array.from({ length: teamCount }, () => 0);
  for (const r of rounds) {
    const row = entries[r.id] ?? [];
    for (let t = 0; t < teamCount; t++) {
      const v = cellScore(r, row[t]);
      if (v !== null) sums[t] += v;
    }
  }
  return { totals: sums, ranks: competitionRanks(sums) };
}

export const rowComplete = (round, row = [], teamCount) =>
  Array.from({ length: teamCount }, (_, t) => cellFilled(round, row[t])).every(Boolean);

/** 등수 순서가 이상한가 (1등 없이 2등 등) — 노란 확인 표시, 저장은 됨 */
export function rowWarning(round, row = [], teamCount) {
  if (round.kind !== 'rank') return false;
  const ranks = Array.from({ length: teamCount }, (_, t) => row[t]?.rank).filter(Number.isInteger);
  if (!ranks.length) return false;
  return Math.min(...ranks) !== 1;
}

export const blankScoreState = () => emptyState.scoreboard();

/** 칸 하나 바꾸기 — cell 이 null 이면 지우기 */
export function setCell(sbState, roundId, team, cell, teamCount) {
  const s = clone(sbState ?? blankScoreState());
  s.entries = s.entries ?? {};
  const row = Array.from({ length: teamCount }, (_, t) => s.entries[roundId]?.[t] ?? null);
  row[team] = cell;
  if (row.every((c) => c === null)) delete s.entries[roundId];
  else s.entries[roundId] = row;
  if (s.filled?.[roundId] && cell === null) {
    // 자동 입력한 행을 손으로 지우면 자동 표시도 뗀다
    if (!s.entries[roundId]) delete s.filled[roundId];
  }
  return s;
}

/** 라운드 목록 바꾸기 (배점표 · 라운드 설정) */
export function setRounds(sbState, rounds) {
  const s = clone(sbState ?? blankScoreState());
  s.rounds = clone(rounds);
  const ids = new Set(rounds.map((r) => r.id));
  for (const id of Object.keys(s.entries ?? {})) if (!ids.has(id)) delete s.entries[id];
  for (const id of Object.keys(s.filled ?? {})) if (!ids.has(id)) delete s.filled[id];
  return s;
}

/** 배점만 바꾸기 */
export function setPoints(sbState, defaultRounds, roundId, patch) {
  const rounds = clone(effectiveRounds(sbState, defaultRounds)).map((r) => (r.id === roundId ? { ...r, ...patch } : r));
  return setRounds(sbState, rounds);
}

/** 점수판 입력값만 지우기 (배점 · 라운드 설정 유지) */
export function clearEntries(sbState) {
  const s = clone(sbState ?? blankScoreState());
  s.entries = {};
  s.filled = {};
  return s;
}

/** 팀 수를 줄일 때 잘리는 입력값이 있는가 */
export function entriesBeyond(sbState, teamCount) {
  return Object.values(sbState?.entries ?? {}).some((row) => row.slice(teamCount).some((c) => c !== null && c !== undefined));
}

export function truncateTeams(sbState, teamCount) {
  const s = clone(sbState ?? blankScoreState());
  for (const id of Object.keys(s.entries ?? {})) {
    s.entries[id] = s.entries[id].slice(0, teamCount);
    if (s.entries[id].every((c) => c === null)) delete s.entries[id];
  }
  return s;
}

export const hasEntries = (sbState) => Object.keys(sbState?.entries ?? {}).length > 0;

const LOG_MAX = 200;
const LOG_MERGE_MS = 3 * 60 * 1000;

/**
 * 종합 점수 추이 기록 (R-58) — 합계가 바뀌면 log 에 { at, what, totals } 를 더한 새 상태를 돌려준다.
 * what 이 없으면 바뀐 행 이름, 행 값이 그대로면 "배점 변경". 같은 what 을 3분 안에 이어 쓰면 마지막 것을 바꾼다 (칸 여러 개를 이어 입력).
 * 입력값이 하나도 없으면 비운다 (점수판 초기화). 게임 창 · 관리 페이지가 저장할 때 부른다
 */
export function withLog(prev, next, { defaults, teamCount, what = null, at = new Date().toISOString() }) {
  if (!hasEntries(next)) return { ...next, log: [] };
  const rounds = effectiveRounds(next, defaults);
  const before = totals(effectiveRounds(prev, defaults), prev?.entries ?? {}, teamCount).totals;
  const after = totals(rounds, next.entries, teamCount).totals;
  const log = [...(next.log ?? prev?.log ?? [])];
  if (JSON.stringify(before) === JSON.stringify(after)) return { ...next, log };
  const changed = rounds.filter((r) => JSON.stringify(prev?.entries?.[r.id] ?? null) !== JSON.stringify(next.entries[r.id] ?? null)).map((r) => r.name);
  const label = what ?? (changed.length ? changed.join(' · ') : '배점 변경');
  const entry = { at, what: label, totals: after };
  const last = log.at(-1);
  if (last && last.what === label && Math.abs(Date.parse(at) - Date.parse(last.at)) < LOG_MERGE_MS) log[log.length - 1] = entry;
  else log.push(entry);
  return { ...next, log: log.slice(-LOG_MAX) };
}

/** 채우기 행의 기본 칸 — 등수 행은 라운드별 등수 목록 (R-57), 정답 수 행은 정답 수 (R-49) */
export const fillCells = (row) =>
  (row.round.kind === 'count' ? row.counts.map((count) => ({ count })) : row.ranks.map((ranks) => ({ ranks: [...ranks] })));

/**
 * 퀴즈 결과 · 라운드 반영으로 채우기 (D-18, R-57).
 * @param rows fillRows() 결과 (+ 고치기 창에서 고친 cells: [{ranks, value?} | {rank, value?}] · 정답 수 행은 [{count}])
 * @param session 그 게임 진행의 시작 시각 — 같은 진행이 다시 쓸 때 덮어쓰기 경고를 내지 않게 (R-57)
 */
export function applyFill(sbState, rows, gameId, at, session = null) {
  let s = clone(sbState ?? blankScoreState());
  s.entries = s.entries ?? {};
  s.filled = s.filled ?? {};
  for (const row of rows) {
    if (row.skip) continue;
    const cells = row.cells ?? fillCells(row);
    s.entries[row.round.id] = cells.map((c) => (c ? { ...c } : null));
    s.filled[row.round.id] = { from: gameId, at, ...(session ? { session } : {}) };
  }
  return s;
}

/** 이 행에 이 진행이 아닌 값이 있는가 — "이미 입력된 값을 덮어씁니다" (같은 진행이 라운드마다 쓴 값은 아님, R-57) */
export function overwrites(sbState, roundId, gameId, session) {
  const has = (sbState?.entries?.[roundId] ?? []).some((c) => c);
  const f = sbState?.filled?.[roundId];
  return has && !(f && f.from === gameId && f.session === session);
}

const sameCell = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 점수판 값이 이 행들의 계산과 같은가 (건너뛴 행 제외) — 다시 반영할지 · 결과 채우기 창을 띄울지 (R-57) */
export function rowsMatch(sbState, rows, teamCount) {
  return rows.filter((r) => !r.skip).every((row) => {
    const want = fillCells(row);
    const have = sbState?.entries?.[row.round.id] ?? [];
    return Array.from({ length: teamCount }, (_, t) => sameCell(have[t], want[t])).every(Boolean);
  });
}

/**
 * 라운드 종료 화면의 [팀 점수에 반영] 미리보기 (R-57, docs/13-scoreboard.md 10-6).
 * @returns {{rows:{round, skip?:string, overwrite:boolean, cells:{rank:(number|null), count:number, add:number}[]}[],
 *   idxs:number[], fill:object[], done:boolean, stale:boolean, totalsNow:number[], totalsAfter:number[], ranksAfter:number[], added:number[]}}
 *   cells = 팀마다 이번 라운드 등수(등수 행) · 정답 수 · 더하는 점수. fill = 반영할 때 쓸 행 (fillRows)
 */
export function reflectPreview(session, rounds, sbState) {
  const n = session.snapshot.teamCount;
  const ri = session.roundIndex;
  const reflected = session.reflectedRounds ?? [];
  const idxs = [...new Set([...reflected, ri])].sort((a, b) => a - b);
  const fill = fillRows(session, rounds, idxs);
  const scored = replay(session.history).scored;
  const counts = roundCounts(session, scored)[ri] ?? Array.from({ length: n }, () => 0);
  const rr = roundRanksAt(session, ri, scored); // 릴레이는 대표를 모두 내보낸 순서 (R-62)
  const added = Array.from({ length: n }, () => 0);
  const rows = fill.map((row) => {
    const here = !row.round.categoryId || session.picks[ri]?.categoryId === row.round.categoryId;
    if (!here) return { round: row.round, skip: '이번 라운드는 해당 없음', overwrite: false, cells: [] };
    const cells = counts.map((c, t) => {
      const rank = row.round.kind === 'rank' ? (rr ? rr[t] : null) : null;
      const add = row.round.kind === 'count' ? c * (row.round.per ?? 0) : (Number.isInteger(rank) ? (row.round.points?.[rank - 1] ?? 0) : 0);
      added[t] += add;
      return { rank, count: c, add };
    });
    return { round: row.round, overwrite: overwrites(sbState, row.round.id, session.gameId, session.startedAt), cells };
  });
  const usable = fill.filter((r) => !r.skip);
  const done = reflected.includes(ri);
  const after = totals(rounds, applyFill(sbState, usable, session.gameId, '', session.startedAt).entries, n);
  return {
    rows, idxs, fill: usable, done,
    stale: done && !rowsMatch(sbState, fillRows(session, rounds, reflected), n),
    totalsNow: totals(rounds, sbState?.entries ?? {}, n).totals,
    totalsAfter: after.totals, ranksAfter: after.ranks, added,
  };
}
