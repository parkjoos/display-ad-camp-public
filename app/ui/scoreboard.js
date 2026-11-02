// 종합 점수판 — 입력 · 발표 · 라운드 설정 (docs/13-scoreboard.md 6 ~ 9장, R-23)
// 게임 창(☰ → 종합 점수판)과 관리 페이지(점수 입력)가 같은 화면을 쓴다 — env 로 연결
import { h, replace, fitText } from './dom.js';
import * as SB from '../core/scoreboard.js';
import { revealOrder } from '../core/scoring.js';
import { randomSuffix } from '../core/random.js';

/**
 * env = { teams(), rounds(), defaults(), state(), setState(next), games(), toast(msg), confirm(opts),
 *         go(mode), points(), teamSettings(), gameTitle(id), screenClass }
 */
export function createScoreboardScreen(env, mode = 'input') {
  const el = h(`div.sb-screen${env.screenClass ? `.${env.screenClass}` : ''}`);
  const local = { sel: { r: 0, t: 0 }, menu: null, editing: null, reveal: 0, confetti: false };
  const teamCount = () => env.teams().length;
  const entries = () => env.state()?.entries ?? {};
  const cellOf = (round, t) => entries()[round.id]?.[t] ?? null;

  function setCell(round, t, cell) {
    env.setState(SB.setCell(env.state(), round.id, t, cell, teamCount()));
  }

  // ── 입력 ────────────────────────────────────────────
  function closeMenu() { local.menu?.el.remove(); local.menu = null; }

  function openMenu(round, t, anchor) {
    closeMenu();
    const cell = cellOf(round, t);
    const n = teamCount();
    const choose = (c) => { closeMenu(); setCell(round, t, c); };
    const buttons = [];
    if (round.kind === 'rank') {
      for (let k = 1; k <= n; k++) buttons.push(h('button.btn.small', { onclick: () => choose({ rank: k }) }, `${k}등 (${round.points[k - 1] ?? 0})`));
    } else if (round.kind === 'pass') {
      buttons.push(h('button.btn.small', { onclick: () => choose({ pass: true }) }, `성공 (${round.pass})`));
      buttons.push(h('button.btn.small', { onclick: () => choose({ pass: false }) }, `실패 (${round.fail})`));
    }
    if (round.kind !== 'manual' && cell) buttons.push(h('button.btn.small', { onclick: () => { closeMenu(); startEdit(round, t); } }, '점수 수정 (E)'));
    if (SB.isOverridden(round, cell)) {
      buttons.push(h('button.btn.small', { onclick: () => { const c = { ...cell }; delete c.value; choose(c); } }, '배점대로'));
    }
    buttons.push(h('button.btn.small.danger', { onclick: () => choose(null) }, '지우기'));
    const rect = anchor.getBoundingClientRect();
    const m = h('div.cell-menu', { style: { left: `${Math.min(rect.left, window.innerWidth - 420)}px`, top: `${rect.bottom + 4}px` } }, buttons);
    document.body.append(m);
    local.menu = { el: m, round, t };
  }

  function startEdit(round, t) {
    local.editing = { roundId: round.id, t };
    render();
  }

  function commitEdit(round, t, text) {
    local.editing = null;
    const v = text.trim();
    if (v === '') { render(); return; }
    // 정답 수 칸은 정답 개수 — 점수는 1개당 점수로 계산 (R-49)
    if (round.kind === 'count') {
      if (!/^\d+$/.test(v)) { env.toast('정답 수(0 이상 정수)를 입력하세요'); render(); return; }
      setCell(round, t, { count: Number(v) });
      return;
    }
    if (!/^-?\d+$/.test(v)) { env.toast('정수를 입력하세요'); render(); return; }
    const cell = cellOf(round, t);
    if (round.kind === 'manual') setCell(round, t, { value: Number(v) });
    else if (cell) setCell(round, t, { ...cell, value: Number(v) });
    else render();
  }

  function renderInput() {
    const teams = env.teams();
    if (teamCount() < 2) {
      replace(el, h('div.sb-head', h('h1', '🏆 종합 점수판')),
        h('div.big-points', h('div.warn-accent', '팀 설정이 필요합니다'), env.teamSettings && h('button.btn.primary', { onclick: env.teamSettings }, '팀 설정')));
      return;
    }
    const rounds = env.rounds();
    // 기본값 파일(data/scoreboard.json)을 못 읽었고 현장에서 바꾼 라운드도 없음 — 오류 안내 (E10, T-19)
    const errors = env.errors?.() ?? [];
    if (!rounds.length && errors.length) {
      replace(el, h('div.sb-head', h('h1', '🏆 종합 점수판')),
        h('ul.error-list', errors.map((e) => h('li', h('b', e.code), e.message))));
      return;
    }
    local.sel.r = Math.min(local.sel.r, rounds.length - 1);
    local.sel.t = Math.min(local.sel.t, teams.length - 1);
    const filled = env.state()?.filled ?? {};
    const sum = SB.totals(rounds, entries(), teamCount());
    const best = Math.max(...sum.totals);
    replace(el,
      h('div.sb-head',
        h('h1', '🏆 종합 점수판'),
        h('div.actions',
          env.points && h('button.btn', { onclick: env.points }, '배점표 (B)'),
          h('button.btn', { onclick: () => env.go('rounds') }, '라운드 설정'),
          h('button.btn', { onclick: () => env.go('present') }, '발표 화면 (P)'),
          h('button.btn.danger', { onclick: clearAll }, '초기화'))),
      h('div.sb-wrap', h('table.score-table',
        h('tr', h('th', '라운드'), teams.map((t) => h('th', h('span.dot', { style: { '--c': t.color } }), ' ', t.name)), h('th', '')),
        rounds.map((round, ri) => {
          const row = entries()[round.id] ?? [];
          const warn = SB.rowWarning(round, row, teamCount());
          const auto = filled[round.id];
          return h(`tr${warn ? '.warn' : ''}`,
            h('td.rname', round.name, h('small', `(${SB.roundSummary(round, teamCount())})`), auto && h('span.auto', `자동 · ${env.gameTitle?.(auto.from) ?? auto.from}`)),
            teams.map((_, t) => h('td', cellEl(round, ri, t))),
            h(`td${SB.rowComplete(round, row, teamCount()) ? '.done' : ''}`, SB.rowComplete(round, row, teamCount()) ? '✔' : warn ? '!' : ''));
        }),
        h('tr.total', h('td', '합계'), sum.totals.map((v, t) => h(`td${v === best && v > 0 ? '.first' : ''}.num`, `${v} (${sum.ranks[t]}위)`)), h('td')))));
  }

  function cellEl(round, ri, t) {
    const cell = cellOf(round, t);
    const sel = local.sel.r === ri && local.sel.t === t;
    if (local.editing && local.editing.roundId === round.id && local.editing.t === t) {
      const count = round.kind === 'count';
      const input = h('input.input', {
        type: 'number', value: count ? (Number.isInteger(cell?.count) ? cell.count : '') : Number.isInteger(cell?.value) ? cell.value : '', style: { width: '100%' },
        min: count ? 0 : undefined,
        placeholder: count ? '정답 수' : round.kind === 'manual' ? '점수' : `${SB.cellScore(round, cell) ?? ''}`,
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(round, t, e.target.value); }
          if (e.key === 'Escape') { e.preventDefault(); local.editing = null; render(); }
        },
        onblur: (e) => { if (local.editing) commitEdit(round, t, e.target.value); },
      });
      setTimeout(() => input.focus(), 0);
      return input;
    }
    const label = SB.cellLabel(round, cell);
    return h(`button.cell${sel ? '.sel' : ''}${label ? '' : '.empty'}`, {
      onclick: (e) => {
        local.sel = { r: ri, t };
        if (round.kind === 'manual' || round.kind === 'count') startEdit(round, t); else { render(); openMenu(round, t, e.currentTarget); }
      },
    }, label || '선택', SB.isOverridden(round, cell) && h('span.ovr', { title: '직접 수정' }, '✎'));
  }

  async function clearAll() {
    if (!(await env.confirm({ title: '점수판 초기화', message: '점수판 입력값을 모두 지울까요? (배점 · 라운드 설정은 유지)', ok: '지우기', danger: true }))) return;
    env.setState(SB.clearEntries(env.state()));
    env.toast('점수판 입력값을 지웠습니다');
  }

  // ── 발표 화면 (7장) ─────────────────────────────────
  function renderPresent() {
    const teams = env.teams();
    const rounds = env.rounds();
    const sum = SB.totals(rounds, entries(), teamCount());
    const groupsMap = new Map();
    sum.ranks.forEach((r, t) => { if (!groupsMap.has(r)) groupsMap.set(r, []); groupsMap.get(r).push(t); });
    const groups = [...groupsMap.entries()].sort((a, b) => a[0] - b[0]).map(([rank, ts]) => ({ rank, teams: ts }));
    const order = revealOrder({ groups });
    const shown = new Set(order.slice(0, local.reveal).flatMap((g) => g.teams));
    const all = local.reveal >= groups.length;
    const sorted = sum.ranks.map((r, t) => ({ r, t })).sort((a, b) => a.r - b.r || a.t - b.t);
    const pos = sorted.length === 2 ? [1, 0] : sorted.length === 3 ? [1, 0, 2] : [1, 0, 2, 3];
    const H = { 1: 95, 2: 76, 3: 60, 4: 46 };
    const same = (r) => sum.ranks.filter((x) => x === r).length > 1;
    replace(el,
      h('div.result-title', '🏆 종합 순위'),
      h('div.podium', pos.map((i) => sorted[i]).filter(Boolean).map(({ r, t }) => {
        const team = teams[t];
        const vis = shown.has(t);
        return h('div.pod', { style: { height: '100%' } }, vis
          ? h(`div.pod-card.revealed${r === 1 ? '.first' : ''}`, { style: { '--c': team.color, minHeight: `${H[Math.min(r, 4)]}%` } },
            r === 1 && h('div.pod-crown', '👑'),
            h('div.pod-rank', `${same(r) ? '공동 ' : ''}${r}위`),
            h('div.pod-team', h('span.dot', { style: { '--c': team.color } }), h('span.pod-name', team.name)),
            h('div.pod-count', sum.totals[t], h('small', ' 점')))
          : h('div.pod-card.hidden', { style: { minHeight: `${H[Math.min(r, 4)]}%` } }, h('div.pod-q', '?')));
      })),
      all && h('table.round-table',
        h('tr', h('th', '라운드'), teams.map((tm) => h('th', tm.name))),
        rounds.map((round) => h('tr', h('td', round.name), teams.map((_, t) => h('td.num', SB.cellScore(round, cellOf(round, t)) ?? '-'))))),
      !all && h('div.summary', 'Enter 다음 순위 공개 · Esc 점수판'));
    el.classList.add('present');
    // 긴 팀 이름 — 어절 단위로 2줄까지, 넘치면 글자를 줄인다 (K-10)
    setTimeout(() => el.querySelectorAll('.pod-name').forEach((n) => fitText(n, { max: 54, min: 24, maxLines: 2 })), 0);
    if (all && !local.confetti && groups.length) {
      local.confetti = true;
      const layer = h('div.confetti');
      const colors = ['#FF8A3D', '#FFB15E', '#FFD873', '#F4ECDD', '#93B089', '#E7692A']; // 모닥불 팔레트 (R-93)
      for (let i = 0; i < 90; i++) layer.append(h('i', { style: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDelay: `${Math.random() * 0.8}s` } }));
      document.body.append(layer);
      setTimeout(() => layer.remove(), 3600);
    }
  }

  // ── 라운드 설정 (8장) ───────────────────────────────
  function renderRounds() {
    const rounds = env.rounds();
    const games = env.games();
    const setRounds = (next) => env.setState(SB.setRounds(env.state(), next));
    const update = (i, patch) => setRounds(rounds.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const hasEntries = (r) => (entries()[r.id] ?? []).some((c) => c);
    const num = (v, on) => h('input.input.n', { type: 'number', value: v, onchange: (e) => { const s = e.target.value.trim(); if (/^-?\d+$/.test(s)) on(Number(s)); else e.target.value = v; } });

    async function changeKind(i, kind) {
      const r = rounds[i];
      if (hasEntries(r) && !(await env.confirm({ title: '방식 바꾸기', message: `'${r.name}' 라운드의 입력값을 지우고 방식을 바꿀까요?`, ok: '바꾸기', danger: true }))) { render(); return; }
      let state = env.state();
      if (hasEntries(r)) for (let t = 0; t < teamCount(); t++) state = SB.setCell(state, r.id, t, null, teamCount());
      const next = rounds.map((x, j) => (j === i ? { id: x.id, name: x.name, kind, ...(kind === 'rank' ? { points: [0, 0, 0, 0] } : kind === 'pass' ? { pass: 0, fail: 0 } : kind === 'count' ? { per: 0 } : {}), ...(x.gameId ? { gameId: x.gameId } : {}), ...(x.categoryId ? { categoryId: x.categoryId } : {}) } : x));
      env.setState(SB.setRounds(state, next));
    }
    async function remove(i) {
      const r = rounds[i];
      if (hasEntries(r) && !(await env.confirm({ title: '라운드 삭제', message: `'${r.name}' 라운드에 입력값이 있습니다. 삭제할까요?`, ok: '삭제', danger: true }))) return;
      setRounds(rounds.filter((_, j) => j !== i));
    }
    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= rounds.length) return;
      const next = [...rounds];
      [next[i], next[j]] = [next[j], next[i]];
      setRounds(next);
    }
    function add() {
      const taken = new Set(rounds.map((r) => r.id));
      let id;
      do { id = `round-${randomSuffix(4)}`; } while (taken.has(id));
      setRounds([...rounds, { id, name: '새 라운드', kind: 'manual' }]);
    }
    async function resetAll() {
      if (!(await env.confirm({ title: '라운드 기본값', message: '라운드 목록 · 점수 · 연결을 data/scoreboard.json 기본값으로 되돌립니다 (같은 라운드의 입력값은 유지)', ok: '되돌리기', danger: true }))) return;
      const s = { ...env.state(), rounds: null };
      const ids = new Set((env.defaults() ?? []).map((r) => r.id));
      for (const id of Object.keys(s.entries ?? {})) if (!ids.has(id)) delete s.entries[id];
      env.setState(s);
    }

    replace(el,
      h('div.sb-head', h('h1', '⚙ 라운드 설정'), h('div.actions',
        h('button.btn', { onclick: resetAll }, '기본값으로 되돌리기'),
        h('button.btn', { onclick: add }, '+ 라운드 추가'),
        h('button.btn.primary', { onclick: () => env.go('input') }, '완료'))),
      h('div.sb-wrap', h('table.round-edit',
        h('tr', h('th', '순서'), h('th', '이름'), h('th', '방식'), h('th', '점수'), h('th', '연결된 앱 게임 · 카테고리'), h('th', '')),
        rounds.map((r, i) => {
          const game = games.find((g) => g.id === r.gameId);
          return h('tr',
            h('td', h('span.order-btns', h('button', { onclick: () => move(i, -1) }, '▲'), h('button', { onclick: () => move(i, 1) }, '▼'))),
            h('td', h('input.input', { value: r.name, maxlength: 30, onchange: (e) => { const v = e.target.value.trim(); if (v) update(i, { name: v }); else { e.target.value = r.name; env.toast('이름을 입력하세요'); } } })),
            h('td', h('select', { onchange: (e) => changeKind(i, e.target.value) },
              [['rank', '등수'], ['pass', '성공 · 실패'], ['count', '정답 수'], ['manual', '직접 입력']].map(([v, l]) => h('option', { value: v, selected: v === r.kind ? true : undefined }, l)))),
            h('td', r.kind === 'rank'
              ? [0, 1, 2, 3].slice(0, teamCount() === 4 ? 4 : 3).map((k) => [`${k + 1}등 `, num(r.points[k] ?? 0, (v) => update(i, { points: [0, 1, 2, 3].map((x) => (x === k ? v : r.points[x] ?? 0)) })), ' '])
              : r.kind === 'pass' ? ['성공 ', num(r.pass, (v) => update(i, { pass: v })), ' 실패 ', num(r.fail, (v) => update(i, { fail: v }))]
                : r.kind === 'count' ? ['정답 1개당 ', num(r.per, (v) => update(i, { per: v }))] : '—'),
            h('td',
              h('select', { onchange: (e) => { const v = e.target.value; const next = { ...r }; delete next.gameId; delete next.categoryId; if (v) next.gameId = v; setRounds(rounds.map((x, j) => (j === i ? next : x))); } },
                h('option', { value: '' }, '없음'),
                games.map((g) => h('option', { value: g.id, selected: g.id === r.gameId ? true : undefined }, g.title))),
              game && ' ',
              game && h('select', { onchange: (e) => { const v = e.target.value; const next = { ...r }; delete next.categoryId; if (v) next.categoryId = v; setRounds(rounds.map((x, j) => (j === i ? next : x))); } },
                h('option', { value: '' }, '게임 전체'),
                game.categories.map((c) => h('option', { value: c.id, selected: c.id === r.categoryId ? true : undefined }, c.name)))),
            h('td', h('button.btn.small.danger', { onclick: () => remove(i) }, '삭제')));
        }))));
  }

  function render() {
    el.classList.remove('present');
    if (mode === 'present') renderPresent();
    else if (mode === 'rounds') renderRounds();
    else renderInput();
  }

  function onKey(e) {
    if (mode === 'present') {
      // 다음 순위 공개는 Enter 만 — → · Space · PageDown 은 뺐다 (R-85)
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { local.reveal += 1; render(); return true; }
      // ← · PageUp(공개 되돌리기)은 없앴다 (R-74)
      if (e.code === 'Escape') { env.go('input'); return true; }
      return false;
    }
    if (mode === 'rounds') {
      if (e.code === 'Escape') { env.go('input'); return true; }
      return false;
    }
    if (local.menu && e.code === 'Escape') { closeMenu(); return true; }
    const rounds = env.rounds();
    const n = teamCount();
    if (n < 2) return false;
    const round = rounds[local.sel.r];
    const c = e.code;
    const moveSel = (dr, dt) => { closeMenu(); local.sel = { r: Math.max(0, Math.min(rounds.length - 1, local.sel.r + dr)), t: Math.max(0, Math.min(n - 1, local.sel.t + dt)) }; render(); };
    if (c === 'ArrowDown') { moveSel(1, 0); return true; }
    if (c === 'ArrowUp') { moveSel(-1, 0); return true; }
    if (c === 'ArrowRight') { moveSel(0, 1); return true; }
    if (c === 'ArrowLeft') { moveSel(0, -1); return true; }
    if (c === 'KeyP') { env.go('present'); return true; }
    if (c === 'KeyB' && env.points) { env.points(); return true; }
    if (!round) return false;
    const digit = /^(Digit|Numpad)([0-9])$/.exec(c);
    if (round.kind === 'rank' && digit && Number(digit[2]) >= 1 && Number(digit[2]) <= n) { closeMenu(); setCell(round, local.sel.t, { rank: Number(digit[2]) }); return true; }
    if (round.kind === 'pass' && (c === 'KeyS' || c === 'KeyF')) { closeMenu(); setCell(round, local.sel.t, { pass: c === 'KeyS' }); return true; }
    if (round.kind === 'manual' && (digit || c === 'Minus' || c === 'Enter')) { startEdit(round, local.sel.t); return true; }
    if (round.kind === 'count' && (digit || c === 'Enter' || c === 'NumpadEnter')) { startEdit(round, local.sel.t); return true; }
    if (c === 'Backspace' || c === 'Delete') { closeMenu(); setCell(round, local.sel.t, null); return true; }
    if (c === 'KeyE' && round.kind !== 'manual' && round.kind !== 'count' && cellOf(round, local.sel.t)) { startEdit(round, local.sel.t); return true; }
    if (c === 'Enter' || c === 'NumpadEnter') {
      const btn = el.querySelector('.cell.sel');
      if (btn) openMenu(round, local.sel.t, btn);
      return true;
    }
    return false;
  }

  render();
  return { el, update: render, onKey, destroy: closeMenu, setMode(m) { mode = m; local.reveal = 0; local.confetti = false; closeMenu(); render(); } };
}

/** 게임 창 (☰ → 종합 점수판) */
export function create(app, route) {
  const env = {
    teams: () => app.teams(),
    rounds: () => app.rounds(),
    defaults: () => app.data.scoreboard.rounds,
    errors: () => app.data.scoreboard.errors ?? [],
    state: () => app.scoreboard,
    setState: (next) => app.setScoreboard(next),
    games: () => app.data.order.map((id) => app.game(id)).filter(Boolean).map((g) => ({ id: g.id, title: g.title, categories: g.categories })),
    toast: app.toast,
    confirm: app.confirm,
    go: (mode) => app.go({ view: 'scoreboard', mode }),
    points: () => app.go({ view: 'pointsTable' }),
    teamSettings: () => app.go({ view: 'teamSettings', back: route }),
    gameTitle: (id) => app.game(id)?.title ?? id,
  };
  const screen = createScoreboardScreen(env, route.mode ?? 'input');
  return {
    el: screen.el,
    update: screen.update,
    destroy: screen.destroy,
    onKey: screen.onKey,
    onInputKey(e) { if (e.code === 'Escape') e.target.blur(); },
  };
}
