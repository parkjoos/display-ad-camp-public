// 라운드 종료 — 팀별 이번 라운드 점수 + 누적 (docs/05-screens.md 4-11, R-56)
// 점수 = 정답 수, 정답 수 방식 라운드가 연결된 게임은 정답 수 × 1개당 점수 (R-49)
import { h, replace, fitText } from './dom.js';
import { findCategory, relayStatus } from '../core/state.js';
import { replay, teamCounts, roundCounts } from '../core/scoring.js';
import { reflectPreview } from '../core/scoreboard.js';
import { rankLabel } from './score-bar.js';

export function create(app, route) {
  const gameId = route.gameId;
  const game = app.game(gameId);
  const s0 = app.session(gameId);
  const c = findCategory(game, s0.picks[s0.roundIndex]?.categoryId);
  const teamsEl = h('div.re-teams');
  const noteEl = h('div.re-note');
  const el = h('div.round-end',
    h('div.re-round', `ROUND ${s0.roundIndex + 1} · `, h('span.emoji', c?.icon ?? ''), ` ${c?.name ?? ''}`),
    h('div.re-title', '라운드가 종료되었습니다'),
    // 릴레이는 점수 대신 대표를 모두 내보낸 순서 (R-62)
    h('div.re-label', relayStatus(s0, game) ? '이번 라운드 순위' : '이번 라운드 점수'),
    teamsEl, noteEl);
  let sig = '';

  const fmt = (n, per) => (per === null ? [String(n), h('small', '개')] : [String(n * per), h('small', '점')]);

  function render() {
    const s = app.session(gameId);
    if (!s || s.screen !== 'roundEnd') return;
    const { scored } = replay(s.history);
    const round = roundCounts(s, scored)[s.roundIndex] ?? [];
    const total = teamCounts(s, scored);
    const teams = app.sessionTeams(s);
    const per = app.perCorrect(gameId);
    // 종합 점수판에 반영했으면 종합 합계 · 이번 라운드가 더한 점수 (R-57) — 반영 전 · 계산이 달라졌으면 없음
    const pv = reflectPreview(s, app.rounds(), app.scoreboard);
    const sb = pv.done && !pv.stale && pv.fill.length ? { totals: pv.totalsAfter, added: pv.added } : null;
    const relay = relayStatus(s, game);
    const next = JSON.stringify([round, total, teams, per, sb, relay]);
    if (next === sig) return; // 되돌리기 등으로 점수가 바뀔 때만 다시 그린다
    const first = sig === '';
    sig = next;
    const max = Math.max(0, ...round);
    // 릴레이 — 1등 (대표를 가장 먼저 모두 내보낸 팀), 아니면 이번 라운드 단독 최다
    const top = relay ? (relay.ranks?.filter((r) => r === 1).length === 1 ? relay.ranks.indexOf(1) : -1)
      : max > 0 && round.filter((n) => n === max).length === 1 ? round.indexOf(max) : -1;
    replace(teamsEl, teams.map((t, i) => h(`div.re-card${i === top ? '.top' : ''}${first ? '.enter' : ''}`, { style: { '--c': t.color, '--i': i } },
      i === top && h('div.re-crown', '👑'),
      h('div.re-name', t.name),
      relay
        ? [h('div.re-score.rank', relay.ranks ? rankLabel(relay.ranks[i]) : h('small', '등수 없음')), h('div.re-total', `${relay.per > 1 ? '맞힌 문제' : '맞힌 대표'} ${relay.counts[i]}/${relay.goal}`)]
        : [h('div.re-score', fmt(round[i] ?? 0, per)), h('div.re-total', `누적 ${per === null ? `${total[i] ?? 0}개` : `${(total[i] ?? 0) * per}점`}`)],
      sb && h('div.re-sb', `종합 ${sb.totals[i]}`, h('small', ` (+${sb.added[i]})`)))));
    replace(noteEl, sb && h('span.pop', '🏆 종합 점수판에 반영했습니다'));
    // 긴 팀 이름 — 2줄까지, 넘치면 글자를 줄인다 (K-10)
    setTimeout(() => teamsEl.querySelectorAll('.re-name').forEach((n) => fitText(n, { max: 54, min: 24, maxLines: 2 })), 0);
  }

  return {
    el,
    mounted: render,
    update: render,
    onKey(e) {
      const p = app.play;
      const k = e.code;
      // 다음 라운드 · 결과는 Enter 만 — → · Space · PageDown 은 뺐다 (R-85)
      if (k === 'Enter' || k === 'NumpadEnter') { p.next(); return true; }
      // ← · PageUp(이전)은 없앴다 (R-74) — [◀ 라운드로 돌아가기] 는 진행자 화면
      // Shift+N(한 라운드 더) · B(팀 점수에 반영)는 없앴다 — 진행자 화면 [한 라운드 더 ▶] · [팀 점수에 반영] (R-85)
      // Backspace(되돌리기)는 없앴다 — 고치기는 진행자 화면 [📝 정답 기록] · [◀ 라운드로 돌아가기] (R-83)
      // E(일찍 끝내기) · R(진행 초기화)은 없앴다 — 끝내기는 진행자 화면 [종료], 초기화는 게임 홈 [새로 시작] (R-80)
      return false;
    },
  };
}
