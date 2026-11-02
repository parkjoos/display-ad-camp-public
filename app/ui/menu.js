// 햄버거 메뉴 (docs/01-app-flow.md 3장, docs/05-screens.md 4-2)
import { h, replace } from './dom.js';
import { usableQuestions } from '../core/state.js';
import { setLock } from './gate.js';

function items(app) {
  const list = [];
  for (const id of app.data.order) {
    const entry = app.entry(id);
    const g = entry.game;
    const s = app.session(id);
    let sub = '';
    let badge = null;
    if (!g) {
      badge = ['⚠ 데이터 오류', 'err'];
    } else if (g.type === 'roulette') {
      const topics = g.categories.filter((c) => !c.disabled);
      const qs = topics.reduce((n, c) => n + usableQuestions(c).length, 0);
      sub = `주제 ${topics.length}${qs ? ` · 문제 ${qs}` : ''}`;
    } else {
      const cats = g.categories.filter((c) => !c.disabled);
      const qs = cats.reduce((n, c) => n + usableQuestions(c).length, 0);
      sub = `카테고리 ${cats.length} · 문제 ${qs}`;
      if (qs === 0) badge = ['준비 중', ''];
    }
    if (g && s?.status === 'active') badge = ['● 진행 중', 'live'];
    list.push({
      section: list.length === 0 ? '게임' : null,
      icon: g?.icon ?? '⚠', label: g?.title ?? id, sub, badge,
      current: app.route.gameId === id,
      run: () => app.go({ view: 'gameHome', gameId: id }),
    });
  }
  list.push({ sep: true });
  list.push({ section: '점수', icon: '🏅', label: '배점표', run: () => app.go({ view: 'pointsTable' }) });
  list.push({ icon: '🏆', label: '종합 점수판', run: () => app.go({ view: 'scoreboard', mode: 'input' }) });
  list.push({ icon: '📊', label: '기록 · 통계', sub: '종합 점수 추이 · 팀별 통계 · 문제 기록', current: app.route.view === 'stats', run: () => app.go({ view: 'stats' }) }); // R-58
  list.push({ sep: true });
  list.push({ icon: '👥', label: '팀 설정', run: () => app.go({ view: 'teamSettings', back: app.route }) });
  list.push({ icon: '⛶', label: '전체화면', run: () => { app.toggleMenu(false); app.toggleFullscreen(); } });
  list.push({ icon: '?', label: '도움말', run: () => { app.toggleMenu(false); app.showHelp(); } });
  list.push({ icon: '🎤', label: '진행자 화면 (새 창)', run: () => openWindow(app, '/host', 'camp-host') });
  // 다른 창 열기 막기 (docs/12-host-view.md 6-3, R-46)
  list.push(app.ui.lockOthers
    ? { icon: '🔓', label: '다른 창 열기 허용', sub: '지금은 다른 기기 · 탭에서 게임 화면을 열 수 없음', run: () => toggleLock(app, false) }
    : { icon: '🔒', label: '다른 창 열기 막기', sub: '켜면 다른 기기 · 탭에서 게임 화면을 열 수 없음', run: () => toggleLock(app, true) });
  list.push({ icon: '⌂', label: '제목 화면으로', run: () => app.go({ view: 'title' }) });
  list.push({ sep: true });
  list.push({ icon: '⚙', label: '관리 (새 창)', small: true, run: () => openWindow(app, '/admin', 'camp-admin') });
  return list;
}

async function toggleLock(app, on) {
  app.toggleMenu(false);
  if (!(await setLock(on))) { app.toast('서버에 연결할 수 없습니다'); return; }
  app.ui.lockOthers = on; // 서버의 lock 알림보다 먼저 메뉴에 반영
  app.toast(on ? '🔒 다른 창 열기를 막았습니다 — 다른 기기 · 탭에서는 게임 화면이 열리지 않습니다' : '🔓 다른 창 열기를 허용했습니다');
  app.render();
}

/** 진행자 화면 · 관리 페이지 — 서버가 켜져 있을 때만 새 창 (docs/08-tech.md 8장) */
async function openWindow(app, path, name) {
  app.toggleMenu(false);
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error();
  } catch {
    app.toast('서버에 연결할 수 없습니다 — start.command 로 서버를 켜세요');
    return;
  }
  const w = window.open(path, name);
  if (!w) app.toast('팝업이 막혔습니다 — 주소창에 직접 입력하세요: ' + location.origin + path);
}

export function renderMenu(app, host) {
  if (!app.ui.menuOpen) { replace(host); host._sig = null; return; }
  const list = items(app);
  const actionable = list.filter((i) => !i.sep);
  const focus = Math.min(app.ui.menuFocus, actionable.length - 1);
  const sig = JSON.stringify([list.map((i) => [i.label, i.sub, i.badge, i.current]), focus]);
  if (host._sig === sig) return;
  host._sig = sig;
  let panel = host.querySelector('.menu-panel');
  if (!panel) {
    panel = h('div.menu-panel', { role: 'menu' });
    replace(host, h('div.menu-layer', h('div.menu-dim', { onclick: () => app.toggleMenu(false) }), panel));
  }
  let idx = -1;
  replace(panel,
    h('div.menu-head', h('button', { onclick: () => app.toggleMenu(false), 'aria-label': '닫기' }, '✕'), '메뉴'),
    list.map((it) => {
      if (it.sep) return h('div.menu-sep');
      idx += 1;
      const my = idx;
      return [
        it.section && h('div.menu-section', it.section),
        h(`button.menu-item${it.small ? '.small' : ''}${it.current ? '.current' : ''}${my === focus ? '.focus' : ''}`, {
          onclick: it.run,
        },
        h('span.mi-icon', it.icon),
        h('span.mi-main', h('span', it.label), it.sub && h('span.mi-sub', it.sub)),
        it.badge && h(`span.mi-badge${it.badge[1] ? `.${it.badge[1]}` : ''}`, it.badge[0])),
      ];
    }));
  panel.querySelector('.focus')?.scrollIntoView({ block: 'nearest' });
}

export function menuKey(app, e) {
  const actionable = items(app).filter((i) => !i.sep);
  if (e.code === 'ArrowDown') { app.ui.menuFocus = (app.ui.menuFocus + 1) % actionable.length; app.render(); return true; }
  if (e.code === 'ArrowUp') { app.ui.menuFocus = (app.ui.menuFocus - 1 + actionable.length) % actionable.length; app.render(); return true; }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { actionable[app.ui.menuFocus]?.run(); return true; }
  if (e.code === 'Escape') { app.toggleMenu(false); return true; }
  return false;
}
