// 배점표 — 게임별 1 · 2 · 3등 점수 (정답 수 방식은 정답 1개당 점수 — R-49) 보기 · 입력 (docs/13-scoreboard.md 4장, R-24)
import { h, replace } from './dom.js';
import * as SB from '../core/scoreboard.js';

export function create(app) {
  const el = h('div.sb-screen');
  const local = { sel: 0, big: null, edit: false };

  const rounds = () => app.rounds();
  const cols = () => (app.teamCount() === 4 ? 4 : 3);

  function setPoints(round, patch) {
    app.setScoreboard(SB.setPoints(app.scoreboard, app.data.scoreboard.rounds, round.id, patch));
  }

  function numInput(value, onValid) {
    return h('input.input', {
      type: 'number', value,
      onchange: (e) => {
        const v = e.target.value.trim();
        if (!/^-?\d+$/.test(v)) { e.target.value = value; return; }
        onValid(Number(v));
      },
    });
  }

  async function resetPoints() {
    if (!(await app.confirm({ title: '배점 기본값', message: '모든 라운드 점수를 data/scoreboard.json 기본값으로 되돌립니다', ok: '되돌리기' }))) return;
    const defs = new Map((app.data.scoreboard.rounds ?? []).map((r) => [r.id, r]));
    const next = rounds().map((r) => {
      const d = defs.get(r.id);
      if (!d || d.kind !== r.kind) return r;
      return { ...r, ...(r.kind === 'rank' ? { points: [...d.points] } : r.kind === 'pass' ? { pass: d.pass, fail: d.fail } : r.kind === 'count' ? { per: d.per } : {}) };
    });
    app.setScoreboard(SB.setRounds(app.scoreboard, next));
  }

  function render() {
    if (app.data.scoreboard.errors?.length && !Array.isArray(app.scoreboard?.rounds)) {
      replace(el, h('div.sb-head', h('h1', '🏅 게임별 배점')), h('ul.error-list', app.data.scoreboard.errors.map((e) => h('li', h('b', e.code), e.message))));
      return;
    }
    const list = rounds();
    local.sel = Math.min(local.sel, list.length - 1);
    if (local.big) {
      const r = list.find((x) => x.id === local.big);
      if (r) {
        replace(el, h('div.big-points',
          h('div.bp-name', r.name, r.kind === 'rank' && r.gameId && h('small', { style: { color: 'var(--text-dim)', marginLeft: '0.4em', fontSize: '0.5em' } }, '라운드마다')),
          r.kind === 'rank'
            ? h('div.bp-vals', ['🥇', '🥈', '🥉', '4️⃣'].slice(0, cols()).map((m, i) => h('div.bp-card', h('div.medal', m), h('div.pts.num', r.points[i]))))
            : r.kind === 'pass'
              ? h('div.bp-vals', h('div.bp-card', h('div.medal', '⭕'), h('div.pts.num', r.pass)), h('div.bp-card', h('div.medal', '❌'), h('div.pts.num', r.fail)))
              : r.kind === 'count'
                ? h('div.bp-vals', h('div.bp-card', h('div.medal', '⭕'), h('div.pts.num', `+${r.per}`), h('div', { style: { fontSize: '3.4vh' } }, '정답 1개당')))
                : h('div.bp-name', '직접 입력'),
          h('div.summary', 'Esc — 표로 돌아가기')));
        return;
      }
      local.big = null;
    }
    const n = cols();
    const rowH = Math.max(6, Math.min(9, 78 / Math.max(1, list.length)));
    replace(el,
      h('div.sb-head',
        h('h1', '🏅 게임별 배점'),
        h('div.actions',
          local.edit && h('button.btn', { onclick: resetPoints }, '기본값으로'),
          h(`button.btn${local.edit ? '.primary' : ''}`, { onclick: () => { local.edit = !local.edit; render(); } }, local.edit ? '수정 끝 (E)' : '수정 (E)'),
          h('button.btn', { onclick: () => app.go({ view: 'scoreboard', mode: 'input' }) }, '점수판'))),
      h('div.sb-wrap', h('table.points-table',
        h('tr', h('th', ''), ['🥇 1등', '🥈 2등', '🥉 3등', '4등'].slice(0, n).map((x) => h('th', x))),
        list.map((r, i) => h(`tr${i === local.sel ? '.sel' : ''}`, { onclick: () => { local.sel = i; render(); }, style: { height: `${rowH}vh` } },
          h('td', { style: { fontSize: `${Math.min(3.4, rowH * 0.45)}vh` } }, r.name, r.kind === 'rank' && r.gameId && h('small', { style: { color: 'var(--text-dim)', marginLeft: '0.4em', fontSize: '0.6em' } }, '라운드마다')), // R-57
          r.kind === 'rank'
            ? r.points.slice(0, n).map((p, k) => h('td', { style: { fontSize: `${Math.min(5, rowH * 0.62)}vh` } }, local.edit ? numInput(p, (v) => setPoints(r, { points: r.points.map((x, j) => (j === k ? v : x)) })) : p))
            : h('td', { colspan: n, style: { fontSize: `${Math.min(4, rowH * 0.5)}vh` } },
              r.kind === 'pass'
                ? (local.edit ? ['성공 ', numInput(r.pass, (v) => setPoints(r, { pass: v })), ' · 실패 ', numInput(r.fail, (v) => setPoints(r, { fail: v }))] : `성공 ${r.pass} · 실패 ${r.fail}`)
                : r.kind === 'count'
                  ? (local.edit ? ['정답 1개당 ', numInput(r.per, (v) => setPoints(r, { per: v }))] : `정답 1개당 ${r.per}`)
                  : '직접 입력'))))));
  }

  render();
  return {
    el,
    update: render,
    onKey(e) {
      const list = rounds();
      if (e.code === 'ArrowDown') { local.sel = Math.min(list.length - 1, local.sel + 1); render(); return true; }
      if (e.code === 'ArrowUp') { local.sel = Math.max(0, local.sel - 1); render(); return true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { local.big = list[local.sel]?.id ?? null; render(); return true; }
      if (e.code === 'Escape') { if (local.big) { local.big = null; render(); return true; } return false; }
      if (e.code === 'KeyE') { local.edit = !local.edit; render(); return true; }
      return false;
    },
    onInputKey(e) {
      if (e.code === 'Escape') { e.target.blur(); }
      if (e.code === 'Enter') { e.target.blur(); }
    },
  };
}
