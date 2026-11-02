// 오버레이 — 토스트 · 확인창 · 도움말 · 오류 · 점수판 채우기 창(비상용) (docs/05-screens.md 5장, docs/13-scoreboard.md 10장)
import { h, replace } from './dom.js';
import { helpRows } from './help.js';
import { fillCells, ranksText, cellScore } from '../core/scoreboard.js';

export function createOverlays(app) {
  const el = h('div.overlay-host');
  const toastBox = h('div.toasts');
  const modalBox = h('div');
  const fillBox = h('div');
  el.append(modalBox, fillBox, toastBox);
  let modal = null; // { onKey(e) → bool, close() }

  function toast(message, ms = 2600) {
    if (!message) return;
    while (toastBox.children.length >= 3) toastBox.firstChild.remove();
    const t = h('div.toast', message);
    toastBox.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  }

  function open(dialog, onKey) {
    close();
    const layer = h('div.overlay', { onclick: (e) => { if (e.target === layer) modal?.cancel?.(); } }, dialog);
    modalBox.append(layer);
    modal = { layer, onKey, cancel: null };
    return modal;
  }
  function close() {
    if (modal) { modal.layer.remove(); modal = null; }
  }

  /** 확인창 — Enter = 확인, Esc = 취소. 돌려준 promise 의 cancel() 은 밖에서 닫기 (취소와 같음, R-86) */
  function confirm({ title, message, ok = '확인', cancel = '취소', danger = false }) {
    let m = null;
    const p = new Promise((resolve) => {
      const done = (v) => { close(); resolve(v); };
      const okBtn = h(`button.btn${danger ? '.danger.fill' : '.primary'}`, { onclick: () => done(true) }, `${ok} (Enter)`);
      const dialog = h('div.dialog', { role: 'dialog' },
        title && h('h2', title),
        message && h('p', message),
        h('div.dialog-actions',
          h('button.btn', { onclick: () => done(false) }, `${cancel} (Esc)`),
          okBtn));
      m = open(dialog, (e) => {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { done(true); return true; }
        if (e.code === 'Escape') { done(false); return true; }
        // 확인은 Enter 만 — Space 로 포커스된 [확인] 버튼이 눌리지 않게 (R-75)
        if (e.code === 'Space') e.preventDefault();
        return true;
      });
      m.cancel = () => done(false);
      setTimeout(() => okBtn.focus(), 0);
    });
    p.cancel = () => { if (modal === m) m.cancel(); };
    return p;
  }

  function help() {
    const rows = helpRows(app);
    const dialog = h('div.dialog',
      h('h2', '단축키 (비상용 — 기본 조작은 진행자 화면)'),
      h('table.help-table', rows.map(([k, d]) => h('tr', h('td', k), h('td', d)))),
      h('div.dialog-actions', h('button.btn', { onclick: close }, '닫기 (Esc)')));
    const m = open(dialog, (e) => {
      if (e.code === 'Escape') { close(); return true; }
      return true;
    });
    m.cancel = close;
  }

  function errors(title, list, { warnings = [] } = {}) {
    const dialog = h('div.dialog',
      h('h2', title),
      h('ul.error-list',
        list.map((e) => h('li', h('b', e.code), e.message)),
        warnings.map((w) => h('li.warn', h('b', w.code), w.message))),
      h('div.dialog-actions', h('button.btn', { onclick: close }, '닫기 (Esc)')));
    const m = open(dialog, (e) => { if (e.code === 'Escape') { close(); return true; } return true; });
    m.cancel = close;
  }

  // ── 점수판 채우기 창 — 진행자 화면이 없을 때만 게임 화면에 (비상용) ──
  function renderFill() {
    const f = app.ui.fill;
    const show = f?.open && app.ui.hosts === 0 && app.route.view === 'play';
    if (!show) { replace(fillBox); return; }
    if (fillBox.dataset.sig === fillSig(f)) return;
    fillBox.dataset.sig = fillSig(f);
    replace(fillBox, h('div.overlay', fillDialog(app, f)));
  }

  const fillSig = (f) => JSON.stringify([f.mode, f.rows.map((r) => r.cells ?? r.ranks), app.ui.hosts]);

  function onKey(e) {
    if (modal) return modal.onKey(e) ?? true;
    const f = app.ui.fill;
    if (f?.open && app.ui.hosts === 0 && app.route.view === 'play') {
      if (f.mode === 'confirm') {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { app.play.fillConfirm(); return true; }
        // E(점수 고치기)는 없앴다 — 창의 [점수 고치기] 버튼으로 (R-85)
        if (e.code === 'Escape') { app.play.fillSkip(); return true; }
      } else if (e.code === 'Escape') { app.play.fillBack(); return true; }
      return e.target?.tagName !== 'INPUT' && e.target?.tagName !== 'SELECT';
    }
    return false;
  }

  return { el, toast, confirm, help, errors, renderFill, onKey, isOpen: () => !!modal };
}

/** 점수판 채우기 창 내용 — 게임 화면 비상용 (진행자 화면도 같은 내용을 그린다) */
function fillDialog(app, f) {
  const s = app.playing();
  const teams = s ? app.sessionTeams(s) : app.teams();
  const head = h('tr', h('th', '라운드'), teams.map((t) => h('th', h('span.dot', { style: { '--c': t.color } }), ' ', t.name)));
  if (f.mode === 'confirm') {
    return h('div.dialog.fill-dialog',
      h('h2', '종합 점수판에 채울까요?'),
      f.tie && h('p', '같은 라운드에서 정답 수가 같은 팀은 같은 등수로 채워집니다'),
      h('table.fill-table', head, f.rows.map((r) => h('tr',
        h('td', r.round.name, r.overwrite && h('div.over', '이미 입력된 값을 덮어씁니다')),
        r.skip ? h('td.skip', { colspan: teams.length }, r.skip)
          : r.round.kind === 'count'
            ? r.counts.map((n) => h('td', `${n}개 (${n * (r.round.per ?? 0)})`)) // 정답 수 행 (R-49)
            : r.ranks.map((ranks) => h('td', `${ranksText(ranks)} (${cellScore(r.round, { ranks })})`))))), // 라운드별 등수 (R-57)
      h('div.dialog-actions',
        h('button.btn', { onclick: () => app.play.fillSkip() }, '취소 (Esc)'),
        h('button.btn', { onclick: () => app.play.fillEdit() }, '점수 고치기'),
        h('button.btn.primary', { onclick: () => app.play.fillConfirm() }, '확인 (Enter)')));
  }
  // 고치기 창 — 등수 행은 라운드별 등수 그대로 점수만 직접 수정 (R-57), 정답 수 행은 정답 수 (R-49)
  const work = f.rows.map((r) => (r.skip ? null : (r.cells ?? fillCells(r)).map((c) => ({ ...c }))));
  const body = f.rows.map((r, ri) => h('tr',
    h('td', r.round.name),
    r.skip
      ? h('td.skip', { colspan: teams.length }, r.skip)
      : r.round.kind === 'count'
        ? work[ri].map((cell) => h('td', h('input', {
          type: 'number', min: 0, value: cell.count,
          oninput: (e) => { const v = e.target.value.trim(); if (/^\d+$/.test(v)) cell.count = Number(v); },
        }), ` 개 × ${r.round.per ?? 0}`))
        : work[ri].map((cell, t) => h('td', `${ranksText(r.ranks[t])} `,
        h('input', {
          type: 'number', placeholder: String(cellScore(r.round, { ranks: r.ranks[t] })), value: Number.isInteger(cell.value) ? cell.value : '',
          oninput: (e) => { const v = e.target.value.trim(); if (v === '' || !/^-?\d+$/.test(v)) delete cell.value; else cell.value = Number(v); },
        })))));
  return h('div.dialog.fill-dialog',
    h('h2', '점수 고치기'),
    h('p', '점수 칸에 숫자를 넣으면 그 칸만 직접 수정한 점수로 저장됩니다 (등수 행의 라운드별 등수는 그대로 — 바꾸려면 종합 점수판에서). 정답 수 행은 정답 수를 고칩니다.'),
    h('table.fill-table', head, body),
    h('div.dialog-actions',
      h('button.btn', { onclick: () => app.play.fillBack() }, '취소 (Esc)'),
      h('button.btn.primary', { onclick: () => app.play.fillApply(work) }, '입력')));
}
