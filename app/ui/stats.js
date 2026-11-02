// 기록 · 통계 — 종합 점수 추이 · 팀별 통계 · 문제 기록 (docs/05-screens.md 4-12, R-58). 모니터용 · 보기 전용
import { h, replace } from './dom.js';
import { isScoring } from '../core/state.js';
import { questionLog, gameStats, scoreTrend } from '../core/stats.js';

const TABS = [['trend', '📈 종합 점수 추이'], ['teams', '👥 팀별 통계'], ['questions', '📝 문제 기록']];
const SVG = 'http://www.w3.org/2000/svg';

/** SVG 요소 — h() 는 HTML 이름공간이라 따로 */
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** 길면 가운데를 줄인다 — 끝의 라운드 번호("R2")가 남게 */
const short = (text, max = 9) => (text.length > max ? `${text.slice(0, max - 3)}…${text.slice(-2)}` : text);

export function create(app, route) {
  const local = { tab: TABS.some(([k]) => k === route.tab) ? route.tab : 'trend' };
  const tabsEl = h('div.st-tabs');
  const body = h('div.st-body');
  const el = h('div.stats', h('div.st-head', h('h1', '📊 기록 · 통계'), tabsEl), body);
  let sig = '';

  const teams = () => app.teams();
  /** 득점형 게임 중 진행 기록이 있는 것 (데이터 순서) */
  const played = () => app.data.order
    .map((id) => ({ id, game: app.game(id), s: app.session(id) }))
    .filter((x) => x.game && x.s && x.s.picks?.length);

  function setTab(k) { local.tab = k; sig = ''; render(); body.scrollTop = 0; }

  // ── 📈 종합 점수 추이 ───────────────────────────────
  function trendTab() {
    const tm = teams();
    const { points, now } = scoreTrend(app.scoreboard, app.data.scoreboard.rounds, tm.length);
    const ranking = tm.map((t, i) => ({ t, i, total: now.totals[i], rank: now.ranks[i] })).sort((a, b) => a.rank - b.rank || a.i - b.i);
    const side = h('div.st-rank', h('h2', '지금 순위'), ranking.map((x) => h(`div.st-rank-card${x.rank === 1 && x.total > 0 ? '.first' : ''}`, { style: { '--c': x.t.color } },
      h('span.st-rk', `${x.rank}위`), h('span.st-nm', x.t.name), h('span.st-pt', x.total), x.rank === 1 && x.total > 0 && h('span.st-crown', '👑'))));
    if (!points.length) return h('div.st-trend', h('div.st-empty', '아직 종합 점수판에 들어간 점수가 없습니다'), side);
    return h('div.st-trend', h('div.st-chart', chart(points, tm)), side);
  }

  function chart(points, tm) {
    const W = 1000, H = 560, L = 70, R = 150, T = 24, B = 92;
    const max = Math.max(10, ...points.flatMap((p) => p.totals));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const x = (i) => L + (points.length === 1 ? 0 : (i * (W - L - R)) / (points.length - 1));
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const grid = [];
    for (let v = 0; v <= top; v += step) grid.push(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'st-grid' }), s('text', { x: L - 12, y: y(v) + 7, class: 'st-axis', 'text-anchor': 'end' }, v));
    // 아래 이름 — 많으면 건너뛰며 (마지막은 늘), 적으면 덜 줄인다
    const every = Math.max(1, Math.ceil(points.length / 8));
    const room = points.length <= 3 ? 18 : points.length <= 5 ? 11 : 9;
    const labels = points.map((p, i) => ((i % every === 0 || i === points.length - 1)
      ? s('text', { x: x(i), y: H - B + 34, class: 'st-xlabel', 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle' }, short(p.what, room))
      : null));
    // 점수가 같은 팀 선이 완전히 겹치지 않게 팀마다 조금씩 위아래로
    const dy = (k) => (k - (tm.length - 1) / 2) * 4;
    const lines = tm.map((t, k) => [
      s('polyline', { points: points.map((p, i) => `${x(i)},${y(p.totals[k]) + dy(k)}`).join(' '), fill: 'none', stroke: t.color, 'stroke-width': 6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      points.map((p, i) => s('circle', { cx: x(i), cy: y(p.totals[k]) + dy(k), r: i === points.length - 1 ? 9 : 6, fill: t.color })),
    ]);
    // 선 끝 이름 · 점수 — 겹치지 않게 위아래로 벌린다
    const last = points.at(-1).totals;
    const ends = tm.map((t, k) => ({ t, y: y(last[k]), v: last[k] })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 34) ends[i].y = ends[i - 1].y + 34;
    const endLabels = ends.map((e) => s('text', { x: x(points.length - 1) + 16, y: e.y + 9, class: 'st-end', fill: e.t.color }, `${short(e.t.name, 6)} ${e.v}`));
    return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'st-svg', role: 'img', 'aria-label': '종합 점수 추이' }, grid, labels, lines, endLabels);
  }

  // ── 👥 팀별 통계 ────────────────────────────────────
  function teamsTab() {
    const tm = teams();
    const { now } = scoreTrend(app.scoreboard, app.data.scoreboard.rounds, tm.length);
    const games = played().filter((x) => isScoring(x.s)).map((x) => ({ ...x, st: gameStats(x.s, x.game) }));
    const quiz = tm.map((_, t) => games.reduce((sum, g) => sum + (g.st.counts[t] ?? 0), 0));
    const wins = tm.map((_, t) => games.reduce((sum, g) => sum + (g.st.roundWins[t] ?? 0), 0));
    const cards = h('div.st-teams', tm.map((t, i) => h('div.st-team', { style: { '--c': t.color } },
      h('div.st-team-name', t.name),
      h('div.st-team-total', now.totals[i], h('small', `점 · ${now.ranks[i]}위`)),
      h('div.st-team-line', `퀴즈 정답 ${quiz[i]}개 · 라운드 1위 ${wins[i]}번`),
      games.map((g) => h('div.st-team-line.dim', `${g.game.icon} 정답 ${g.st.counts[i] ?? 0}개`)))));
    const tables = games.length
      ? games.map((g) => h('div.st-game',
        h('h2', `${g.game.icon} ${g.game.title}`, h('small', `문제 ${g.st.asked}개 · 정답자 없음 ${g.st.noneCount}개`)),
        h('table.st-table',
          h('tr', h('th', '라운드'), tm.slice(0, g.s.snapshot.teamCount).map((t) => h('th', h('span.dot', { style: { '--c': t.color } }), ' ', t.name))),
          g.st.rounds.map((r, ri) => h('tr', h('td', `ROUND ${ri + 1} · ${r.icon} ${r.name}${r.done ? '' : ' (진행 중)'}`),
            r.counts.map((c, t) => h(`td.num${r.top === t ? '.top' : ''}`, r.top === t ? { style: { '--c': tm[t]?.color } } : null, c)))),
          h('tr.sum', h('td', '합계'), g.st.counts.map((c) => h('td.num', c))))))
      : h('div.st-empty.small', '아직 진행한 퀴즈 게임이 없습니다');
    return [cards, tables];
  }

  // ── 📝 문제 기록 ────────────────────────────────────
  function questionsTab() {
    const tm = teams();
    const team = (t) => tm[t] ?? { name: `팀${t + 1}`, color: '#888' };
    const credit = (q) => (q.live ? h('span.st-live', '진행 중')
      : q.team !== null ? h('span.st-credit', { style: { color: team(q.team).color } }, `✔ ${team(q.team).name}`)
        : q.none ? h('span.st-none', '정답자 없음') : h('span.st-none', '기록 없음'));
    const list = played();
    if (!list.length) return h('div.st-empty.small', '아직 진행한 게임이 없습니다');
    return list.map(({ game, s: ses }) => {
      if (!isScoring(ses)) {
        // 줄줄이 말해요 — 뽑힌 주제 · 낸 문제 글자 (정답 후보는 보이지 않음)
        const byTopic = new Map();
        for (const p of ses.picks) {
          const c = game.categories.find((x) => x.id === p.categoryId);
          const cur = byTopic.get(p.categoryId) ?? { c, times: 0, prompts: [] };
          cur.times += 1;
          for (const qid of p.questionIds ?? []) cur.prompts.push(c?.questions?.find((q) => q.id === qid)?.prompt ?? '(지운 문제)');
          byTopic.set(p.categoryId, cur);
        }
        return h('div.st-game', h('h2', `${game.icon} ${game.title}`, h('small', `주제 ${ses.picks.length}번 추첨`)),
          h('div.st-rounds', [...byTopic.values()].map((x) => h('div.st-round',
            h('div.st-round-head', `${x.c?.icon ?? '❓'} ${x.c?.name ?? ''}`, h('small', ` ×${x.times}`)),
            x.prompts.length ? h('div.st-chips', x.prompts.map((p) => h('span.chip', p))) : h('div.st-none', '주제 카드만')))));
      }
      const log = questionLog(ses, game);
      return h('div.st-game', h('h2', `${game.icon} ${game.title}`),
        h('div.st-rounds',
          log.rounds.map((r) => h('div.st-round',
            h('div.st-round-head', `ROUND ${r.index + 1} · ${r.icon} ${r.name}`,
              h('span.st-round-sum', r.counts.map((c, t) => h('span', { style: { color: team(t).color } }, `${team(t).name} ${c}`)))),
            r.questions.map((q) => h('div.st-q', h('span.st-qn', `Q${q.n}`), h('span.st-ans', q.answer ?? '—'), credit(q))))),
          log.tiebreak.length > 0 && h('div.st-round',
            h('div.st-round-head', '추가 문제 (동점)'),
            log.tiebreak.map((q) => h('div.st-q', h('span.st-qn', `+${q.n}`), h('span.st-ans', q.answer ?? '—'), h('span.st-none', q.group.map((t) => team(t).name).join(' · ')), credit(q))))));
    });
  }

  function render() {
    // 점수판 · 진행 기록 · 팀이 바뀔 때만 다시 그린다 (다른 창 · 진행자 화면에서 바뀌어도 바로)
    const next = JSON.stringify([local.tab, app.scoreboard, app.teams(), played().map((x) => [x.id, x.s.updatedAt])]);
    if (next === sig) return;
    sig = next;
    replace(tabsEl, TABS.map(([k, label], i) => h(`button.st-tab${local.tab === k ? '.on' : ''}`, { onclick: () => setTab(k) }, h('small', String(i + 1)), label)));
    const keep = body.scrollTop;
    replace(body, local.tab === 'trend' ? trendTab() : local.tab === 'teams' ? teamsTab() : questionsTab());
    body.scrollTop = keep;
  }

  render();
  return {
    el,
    update: render,
    onKey(e) {
      const k = e.code;
      const i = TABS.findIndex(([t]) => t === local.tab);
      const digit = /^(Digit|Numpad)([1-3])$/.exec(k);
      if (digit) { setTab(TABS[Number(digit[2]) - 1][0]); return true; }
      if (k === 'ArrowRight') { setTab(TABS[(i + 1) % TABS.length][0]); return true; }
      // ← (이전 탭)은 없앴다 — → 는 한 바퀴 돈다 (R-74)
      if (k === 'ArrowDown' || k === 'PageDown') { body.scrollBy({ top: body.clientHeight * (k === 'PageDown' ? 0.9 : 0.3), behavior: 'smooth' }); return true; }
      if (k === 'ArrowUp' || k === 'PageUp') { body.scrollBy({ top: -body.clientHeight * (k === 'PageUp' ? 0.9 : 0.3), behavior: 'smooth' }); return true; }
      return false;
    },
  };
}

/** 눈금 간격 — 4 ~ 6칸 정도로 10 · 20 · 50 · 100 … */
function niceStep(max) {
  const raw = max / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
}
