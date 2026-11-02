// 최종 결과 — 정답 수 순서, 정답 수 방식 라운드가 연결된 게임은 점수 (docs/05-screens.md 4-8, R-22, D-3, R-49)
import { h, replace, fitText } from './dom.js';
import * as S from '../core/state.js';
import { ranking, revealOrder, roundCounts, roundRanksAt, relayOf } from '../core/scoring.js';
import { ranksText } from '../core/scoreboard.js';

const HEIGHT = { 1: 0.95, 2: 0.76, 3: 0.6, 4: 0.46 };

export function create(app, route) {
  const gameId = route.gameId;
  const game = app.game(gameId);
  const podium = h('div.podium');
  const note = h('div');
  const table = h('div');
  const el = h('div.result', h('div.result-title', `${game.icon} ${game.title} · 최종 결과`), podium, note, table);
  let structSig = '';
  let pods = new Map(); // team → { pod, shown }
  let confettiShown = false;

  const podiumOrder = (n) => (n === 2 ? [1, 0] : n === 3 ? [1, 0, 2] : [1, 0, 2, 3]);

  function card(t, rank, shown, teams, per, roundRanks) {
    const team = teams[t];
    const r = rank.ranks[t];
    const heightPct = (HEIGHT[Math.min(r, 4)] ?? 0.4) * 100;
    if (!shown) return h('div.pod-card.hidden', { style: { minHeight: `${heightPct}%` } }, h('div.pod-q', '?'));
    const tie = rank.ranks.filter((x) => x === r).length > 1;
    return h(`div.pod-card.revealed${r === 1 ? '.first' : ''}`, { style: { '--c': team.color, minHeight: `${heightPct}%` } },
      r === 1 && h('div.pod-crown', '👑'),
      h('div.pod-rank', `${tie ? '공동 ' : ''}${r}위`),
      h('div.pod-team', h('span.dot', { style: { '--c': team.color } }), h('span.pod-name', team.name)),
      // 릴레이는 게임 점수(라운드 배점 합) + 라운드 등수 (R-62), 정답 수 방식 라운드가 연결된 게임은 점수 (정답 수 × 1개당 점수) + 정답 수 (R-49)
      roundRanks ? [h('div.pod-count', rank.counts[t], h('small', '점')), h('div.pod-sub', `라운드 ${ranksText(roundRanks.map((rr) => rr?.[t] ?? null))}`)]
        : per === null
          ? h('div.pod-count', h('small', '정답 '), rank.counts[t], h('small', '개'))
          : [h('div.pod-count', rank.counts[t] * per, h('small', '점')), h('div.pod-sub', `정답 ${rank.counts[t]}개`)],
      rank.decided[t] && h('div.pod-badge', '추가 문제로 결정'));
  }

  function render() {
    const s = app.session(gameId);
    if (!s || s.screen !== 'result') return;
    const rank = ranking(s);
    const teams = app.sessionTeams(s);
    const relay = relayOf(s);
    const per = relay ? null : app.perCorrect(gameId);
    // 릴레이 — 라운드마다 대표를 모두 내보낸 순서 (R-62)
    const roundRanks = relay ? s.picks.map((_, i) => roundRanksAt(s, i)) : null;
    const shownTeams = new Set(revealOrder(rank).slice(0, s.resultRevealCount).flatMap((g) => g.teams));
    const all = s.resultRevealCount >= rank.groups.length;
    const sig = JSON.stringify([rank.ranks, rank.counts, rank.decided, teams, per, roundRanks]);
    if (sig !== structSig) {
      structSig = sig;
      pods = new Map();
      const sorted = rank.ranks.map((r, t) => ({ t, r })).sort((a, b) => a.r - b.r || a.t - b.t);
      replace(podium, podiumOrder(sorted.length).map((i) => sorted[i]).filter(Boolean).map(({ t }) => {
        const shown = shownTeams.has(t);
        const pod = h('div.pod', { style: { height: '100%' } }, card(t, rank, shown, teams, per, roundRanks));
        pods.set(t, { pod, shown });
        return pod;
      }));
    } else {
      for (const [t, p] of pods) {
        const shown = shownTeams.has(t);
        if (shown !== p.shown) { p.shown = shown; replace(p.pod, card(t, rank, shown, teams, per, roundRanks)); }
      }
    }

    const pool = S.tiebreakPool(game, s).length;
    // 점수를 주는 게임은 동점이어도 점수가 같으니 가릴 필요가 없다 — 추가 문제 안내를 띄우지 않는다 (R-49)
    replace(note, all && rank.ties.length > 0 && per === null && h('div.result-note', pool ? '동점! 추가 문제로 순위를 정합니다' : '추가 문제가 없어 공동 순위로 정합니다'));
    // 긴 팀 이름 — 어절 단위로 2줄까지, 넘치면 글자를 줄인다 (K-10)
    setTimeout(() => podium.querySelectorAll('.pod-name').forEach((n) => fitText(n, { max: 54, min: 24, maxLines: 2 })), 0);
    if (all && !table.firstChild) {
      const perRound = roundCounts(s);
      // 릴레이는 라운드 등수 (R-62)
      const cell = (i, t) => (roundRanks ? (roundRanks[i] ? `${roundRanks[i][t]}등` : '-') : perRound[i][t]);
      replace(table, h('table.round-table',
        h('tr', h('th', roundRanks ? '라운드 (순위)' : per === null ? '라운드' : '라운드 (정답 수)'), teams.map((tm) => h('th', h('span.dot', { style: { '--c': tm.color } }), ' ', tm.name))),
        s.picks.map((p, i) => {
          const c = S.findCategory(game, p.categoryId);
          return h('tr', h('td', `ROUND ${i + 1} · ${c?.icon ?? ''} ${c?.name ?? p.categoryId}`), teams.map((_, t) => h('td.num', cell(i, t))));
        })));
    }
    if (!all) replace(table);
    if (all && !confettiShown && rank.groups.length) { confettiShown = true; confetti(); }
    app.play.maybeAutoFill();
  }

  function confetti() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const layer = h('div.confetti');
    const colors = ['#FF8A3D', '#FFB15E', '#FFD873', '#F4ECDD', '#93B089', '#E7692A']; // 모닥불 팔레트 (R-93)
    for (let i = 0; i < 90; i++) {
      layer.append(h('i', { style: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDelay: `${Math.random() * 0.8}s`, animationDuration: `${2.2 + Math.random() * 1.2}s` } }));
    }
    document.body.append(layer);
    setTimeout(() => layer.remove(), 3600);
  }

  return {
    el,
    mounted: render,
    update: render,
    onKey(e) {
      const c = e.code;
      // 다음 순위 공개는 Enter 만 — → · Space · PageDown 은 뺐다 (R-85)
      if (c === 'Enter' || c === 'NumpadEnter') { app.play.next(); return true; }
      // ← · PageUp(이전)은 없앴다 (R-74)
      // S(추가 문제) · B(점수판 채우기 창) · H(게임 홈)는 없앴다 — 진행자 화면 추가 문제 고르기 · [점수판 채우기], 게임 홈은 ☰ (R-85)
      // Backspace(되돌리기)는 없앴다 — 고치기는 진행자 화면 [📝 정답 기록] (R-83)
      // R(진행 초기화)은 없앴다 — 게임 홈 [새로 시작] (R-80)
      return false;
    },
  };
}
