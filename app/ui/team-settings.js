// 팀 설정 (docs/03-settings.md 2장, R-9) — 팀 이름 기본값 없음
import { h, replace } from './dom.js';
import { TEAM_COLORS, TEAM_COLOR_NAMES, validateTeamName, emptyState } from '../core/validate.js';
import * as SB from '../core/scoreboard.js';

export function create(app, route) {
  const saved = app.teams();
  const work = {
    rows: saved.map((t, i) => ({ name: t.name, color: t.color, orig: i })),
    title: app.settings.display?.title ?? '',
    subtitle: app.settings.display?.subtitle ?? '',
    errors: [],
    message: '',
  };
  if (!work.rows.length) setCount(3);
  const initial = JSON.stringify(work);
  const el = h('div.panel-screen');

  function setCount(n) {
    while (work.rows.length > n) work.rows.pop();
    while (work.rows.length < n) {
      const used = new Set(work.rows.map((r) => r.color));
      work.rows.push({ name: '', color: TEAM_COLORS.find((c) => !used.has(c)) ?? TEAM_COLORS[0], orig: null });
    }
  }

  const hasActive = () => app.activeSessions().length > 0;
  const dirty = () => JSON.stringify({ ...work, errors: [], message: '' }) !== JSON.stringify({ ...JSON.parse(initial), errors: [], message: '' });

  function render() {
    const active = hasActive();
    const n = work.rows.length;
    const nameInputs = [];
    replace(el, h('div.panel',
      h('div.panel-head', h('h1', '👥 팀 설정'), h('button.close-x', { onclick: cancel, 'aria-label': '닫기' }, '✕')),
      h('div.form-grid',
        h('span', '팀 수'),
        h('div.seg', [2, 3, 4].map((k) => h(`button${k === n ? '.on' : ''}`, {
          onclick: () => { setCount(k); work.message = ''; render(); },
        }, String(k))))),
      h('div.team-rows', work.rows.map((row, i) => {
        const others = work.rows.filter((_, j) => j !== i).map((r) => r.color);
        const input = h(`input.input${work.errors[i] ? '.invalid' : ''}`, {
          value: row.name, placeholder: '팀 이름을 입력하세요', maxlength: 30,
          oninput: (e) => { row.name = e.target.value.replace(/[\r\n]/g, ''); },
        });
        nameInputs.push(input);
        return h('div.team-row',
          h('div.key', String(i + 1)),
          h('div.color-pick', TEAM_COLORS.map((c, ci) => h(`button${row.color === c ? '.on' : ''}`, {
            style: { '--c': c }, title: TEAM_COLOR_NAMES[ci], disabled: others.includes(c) ? true : undefined,
            onclick: () => { row.color = c; render(); },
          }))),
          h('div.name-col', input, h('div.field-error', work.errors[i] ?? '')),
          h('div.order-btns',
            h('button', { onclick: () => move(i, -1), disabled: i === 0 ? true : undefined, title: '위로' }, '▲'),
            h('button', { onclick: () => move(i, 1), disabled: i === n - 1 ? true : undefined, title: '아래로' }, '▼')));
      })),
      active && h('div.field-error', '진행 중인 게임이 있어 팀 수 · 순서는 바꿀 수 없습니다 (이름 · 색은 바꿀 수 있음)'),
      h('div.subhead', '표시'),
      h('div.form-grid',
        h('span', '행사 제목'),
        h('input.input', { value: work.title, placeholder: app.data.app.title, oninput: (e) => { work.title = e.target.value; } }),
        h('span', '부제'),
        h('input.input', { value: work.subtitle, placeholder: app.data.app.subtitle || '(없음)', oninput: (e) => { work.subtitle = e.target.value; } })),
      work.message && h('div.field-error', work.message),
      h('div.panel-actions',
        h('button.link', { onclick: resetAll }, '모든 설정 초기화'),
        h('div', { style: { display: 'flex', gap: '1vw' } },
          h('button.btn', { onclick: cancel }, '취소 (Esc)'),
          h('button.btn.primary', { onclick: save }, '저장 (Enter)')))));
    if (!el.dataset.focused) {
      el.dataset.focused = '1';
      const empty = nameInputs.find((i) => !i.value) ?? nameInputs[0];
      setTimeout(() => empty?.focus(), 50);
    }
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= work.rows.length) return;
    [work.rows[i], work.rows[j]] = [work.rows[j], work.rows[i]];
    render();
  }

  async function save() {
    work.errors = work.rows.map((r, i) => validateTeamName(r.name, work.rows.filter((_, j) => j !== i).map((x) => x.name)));
    work.message = '';
    if (work.errors.some(Boolean)) { render(); return; }
    const oldCount = saved.length;
    const newCount = work.rows.length;
    const reordered = work.rows.some((r, i) => r.orig !== null && r.orig !== i);
    if (hasActive() && oldCount && (newCount !== oldCount || reordered)) {
      work.message = '진행 중인 게임이 있어 순서를 바꿀 수 없습니다 — 게임 홈에서 새로 시작하거나 진행 중 게임을 초기화하세요';
      render();
      return;
    }
    let sb = app.scoreboard;
    if (oldCount && reordered && SB.hasEntries(sb)) {
      work.message = '종합 점수판에 입력값이 있어 팀 순서를 바꿀 수 없습니다';
      render();
      return;
    }
    if (newCount < oldCount && SB.entriesBeyond(sb, newCount)) {
      const lost = Array.from({ length: oldCount - newCount }, (_, k) => newCount + k + 1).join(' · ');
      if (!(await app.confirm({ title: '팀 수 줄이기', message: `점수판에서 ${lost}번 팀 점수가 지워집니다`, danger: true, ok: '지우고 저장' }))) return;
      app.setScoreboard(SB.truncateTeams(sb, newCount));
    }
    app.setSettings({
      ...app.settings,
      teams: work.rows.map((r) => ({ name: r.name.trim(), color: r.color })),
      display: { title: work.title.trim() || null, subtitle: work.subtitle.trim() || null },
    });
    app.toast('팀 설정을 저장했습니다');
    back();
  }

  async function cancel() {
    if (dirty() && !(await app.confirm({ title: '팀 설정', message: '저장하지 않고 닫을까요?', ok: '닫기' }))) return;
    back();
  }

  async function resetAll() {
    const active = hasActive();
    const ok = await app.confirm({
      title: '모든 설정 초기화',
      message: active ? '팀 · 표시 · 게임별 옵션을 모두 지웁니다.\n진행 중인 게임 기록도 함께 지워집니다 (팀 수가 사라지므로).' : '팀 · 표시 · 게임별 옵션을 모두 지웁니다.',
      ok: '초기화', danger: true,
    });
    if (!ok) return;
    if (active) for (const [id] of app.activeSessions()) app.setSession(id, null);
    app.setSettings(emptyState.settings());
    app.toast('설정을 초기화했습니다');
    back();
  }

  function back() {
    const b = route.back;
    app.go(b && b.view !== 'teamSettings' ? b : { view: 'title' });
  }

  render();
  return {
    el,
    update() {},
    onKey(e) {
      if (e.code === 'Escape') { cancel(); return true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { save(); return true; }
      return false;
    },
    onInputKey(e) {
      if (e.code === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); save(); }
    },
  };
}
