// 게임 창 컨트롤러 — 상태 · 저장 · 화면 전환 · 키 입력 · 진행자 명령 (docs/07-state-model.md, docs/06-controls.md)
import { h } from './dom.js';
import * as S from '../core/state.js';
import * as SB from '../core/scoreboard.js';
import { emptyState, isEmptySession } from '../core/validate.js';
import { loadGame, loadScoreboardDefaults } from '../core/data.js';
import { loadAssetUrls } from '../core/assets.js';
import { createPlayActions } from './play-actions.js';
import { createOverlays } from './overlays.js';
import { renderMenu, menuKey } from './menu.js';
import * as titleView from './title.js';
import * as homeView from './game-home.js';
import * as teamView from './team-settings.js';
import * as pointsView from './points-table.js';
import * as scoreView from './scoreboard.js';
import * as rouletteView from './roulette.js';
import * as roundView from './round-intro.js';
import * as roundEndView from './round-end.js';
import * as questionView from './question.js';
import * as resultView from './result.js';
import * as topicView from './topic.js';
import * as topicWaitView from './topic-wait.js';
import * as questionPickView from './question-pick.js';
import * as statsView from './stats.js';
import { clientId } from './live-publisher.js';
import { reportDisconnect, flushBeacons } from './beacon.js';

const blankSettings = () => ({ ...emptyState.settings() });

export function normalizeSettings(s) {
  const base = blankSettings();
  if (!s || s.version !== 1) return base;
  return {
    ...base, ...s,
    teams: Array.isArray(s.teams) ? s.teams.filter((t) => t && typeof t.name === 'string') : [],
    display: { title: s.display?.title ?? null, subtitle: s.display?.subtitle ?? null },
    games: s.games && typeof s.games === 'object' ? s.games : {},
  };
}

export function createApp({ root, data, store, notes = [] }) {
  const app = {
    root, data, store,
    settings: normalizeSettings(store.get('settings')),
    scoreboard: store.get('scoreboard') ?? SB.blankScoreState(),
    sessions: {},
    route: { view: 'title' },
    ui: {
      menuOpen: false,
      menuFocus: 0,
      roulette: { key: null, phase: 'setup', plan: null, resultId: null, focus: 0 },
      fill: null,
      hosts: 0,
      idle: false,
    },
    conn: store.status(),
    live: { seq: 0, lastCommand: null },
  };

  // ── 조회 ───────────────────────────────────────────
  app.teams = () => app.settings.teams ?? [];
  app.teamCount = () => app.teams().length;
  // 팀 수는 게임 시작 때 세션에 고정된다 (01-app-flow 4-5) — 끝난 게임을 다시 열 때 지금 팀 수와 달라도 그 판의 팀만 그린다.
  // 이름 · 색은 표시용이라 지금 설정을 따른다
  app.sessionTeams = (s) => Array.from({ length: s.snapshot.teamCount }, (_, i) => app.teams()[i] ?? { name: `팀${i + 1}`, color: '#888' });
  app.teamsReady = () => app.teamCount() >= 2 && app.teams().every((t) => t.name?.trim());
  app.entry = (id) => app.data.games[id] ?? null;
  app.game = (id) => app.data.games[id]?.game ?? null;
  app.session = (id) => app.sessions[id] ?? null;
  app.title = () => app.settings.display?.title || app.data.app.title;
  app.subtitle = () => app.settings.display?.subtitle ?? app.data.app.subtitle;
  app.rounds = () => SB.effectiveRounds(app.scoreboard, app.data.scoreboard.rounds);
  /** 정답 1개당 점수 — 게임 전체에 "정답 수" 라운드가 연결돼 있으면 (R-49), 아니면 null (정답 수만 표시) */
  app.perCorrect = (gameId) => SB.perCorrectRound(app.rounds(), gameId)?.per ?? null;
  /** 릴레이 결과 순위에 쓰는 라운드 배점 — 게임 전체에 연결된 등수 행, 없으면 null (기본 100 / 50 / 0, R-62) */
  app.relayPoints = (gameId) => app.rounds().find((r) => r.kind === 'rank' && r.gameId === gameId && !r.categoryId)?.points ?? null;
  app.gameSettings = (id) => app.settings.games?.[id] ?? {};
  // 진행 옵션은 관리 페이지 진행 기본값(데이터 defaults)만 — 게임 홈 옵션은 R-92 에서 없앴고, 예전에 게임 홈에서 저장한 값은 무시
  app.options = (id) => S.effectiveOptions(app.game(id), {});
  app.activeSessions = () => Object.entries(app.sessions)
    .filter(([id, s]) => s && s.status === 'active' && app.game(id))
    .sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)));
  app.currentGameId = () => app.route.gameId ?? null;
  app.playing = () => (app.route.view === 'play' ? app.session(app.route.gameId) : null);
  app.teamNames = () => app.teams().map((t) => t.name);

  // ── 세션 불러오기 · 고치기 ─────────────────────────
  for (const id of app.data.order) loadSession(id);
  syncRelayPoints(); // 게임 창이 닫혀 있는 동안 관리 페이지에서 배점을 바꿨을 수 있다
  function loadSession(id) {
    const game = app.game(id);
    const raw = store.get(`session:${id}`);
    if (!game || !raw || isEmptySession(raw)) { app.sessions[id] = null; return; }
    const res = S.repairSession(raw, game);
    app.sessions[id] = res.session;
    if (res.notice) notes.push(res.notice);
    if (!res.session) store.set(`session:${id}`, { ...emptyState.session(id), updatedAt: S.localIso() });
  }

  // ── 바꾸기 ─────────────────────────────────────────
  app.setSettings = (next) => {
    app.settings = normalizeSettings({ ...next, version: 1, updatedAt: S.localIso() });
    store.set('settings', app.settings);
    app.render();
  };
  app.setGameSettings = (id, patch) => {
    const games = { ...app.settings.games, [id]: { excludedCategories: [], ...app.gameSettings(id), ...patch } };
    app.setSettings({ ...app.settings, games });
  };
  app.setSession = (id, session) => {
    app.sessions[id] = session;
    store.set(`session:${id}`, session ?? { ...emptyState.session(id), updatedAt: S.localIso() });
    app.render();
  };
  /** what — 종합 점수 추이 기록 이름 ("사진 보고 맞추기 ROUND 2"), 없으면 바뀐 행 이름 (R-58) */
  app.setScoreboard = (next, what = null) => {
    const logged = SB.withLog(app.scoreboard, next, { defaults: app.data.scoreboard.rounds, teamCount: app.teamCount(), what, at: S.localIso() });
    app.scoreboard = { ...logged, version: 1, updatedAt: S.localIso() };
    store.set('scoreboard', app.scoreboard);
    syncRelayPoints();
    app.render();
  };

  /** 배점이 바뀌면 진행 중인 릴레이 게임의 결과 배점도 맞춘다 (R-62) — 결과 순위가 종합 점수판과 같은 배점으로 */
  function syncRelayPoints() {
    for (const [id, s] of Object.entries(app.sessions)) {
      if (!s || !S.isScoring(s) || !(s.snapshot.options?.relay > 0)) continue;
      const points = app.relayPoints(id);
      if (!points || JSON.stringify(points) === JSON.stringify(s.snapshot.points ?? null)) continue;
      app.sessions[id] = { ...s, snapshot: { ...s.snapshot, points: [...points] } };
      store.set(`session:${id}`, app.sessions[id]);
    }
  }
  app.go = (route) => {
    const prev = app.route;
    app.route = route;
    if (route.view !== prev.view || route.gameId !== prev.gameId) {
      store.set('route', { version: 1, route: { view: route.view, ...(route.gameId ? { gameId: route.gameId } : {}) }, updatedAt: S.localIso() });
    }
    app.ui.menuOpen = false;
    app.render();
  };

  // ── 다른 창 · 관리 페이지에서 바뀜 ──────────────────
  app.onRemote = (name, data, why) => {
    if (name === 'settings') app.settings = normalizeSettings(data);
    else if (name === 'scoreboard') { app.scoreboard = data ?? SB.blankScoreState(); syncRelayPoints(); }
    else if (name.startsWith('session:')) {
      const id = name.slice(8);
      const wasPlaying = app.route.view === 'play' && app.route.gameId === id;
      loadSession(id);
      app.ui.roulette.key = null;
      if (wasPlaying && !app.sessions[id]) {
        app.route = { view: 'title' };
        app.toast('관리 페이지에서 현장 상태를 초기화했습니다');
      }
    }
    if (why === 'conflict') app.toast('다른 창에서 바뀐 내용을 불러왔습니다');
    app.render();
  };

  app.onDataReload = async (info) => {
    if (!info.name?.startsWith('game:')) return;
    const id = info.name.slice(5);
    // 이미지가 바뀌었을 수 있다 — 주소 표도 다시 (R-70)
    [app.data.games[id]] = await Promise.all([loadGame(id), loadAssetUrls()]);
    app.data.scoreboard = await loadScoreboardDefaults(app.data.games);
    if (app.sessions[id]) {
      const res = S.repairSession(app.sessions[id], app.game(id) ?? { categories: [] });
      if (res.session) app.sessions[id] = res.session;
      if (res.notice) app.toast(res.notice);
    }
    app.render();
  };

  // ── 화면 · 오버레이 ────────────────────────────────
  const overlays = createOverlays(app);
  app.toast = overlays.toast;
  app.confirm = overlays.confirm;
  app.showHelp = overlays.help;
  app.showErrors = overlays.errors;
  app.overlays = overlays;
  app.play = createPlayActions(app);

  const layers = {
    screen: h('div.screen-host'),
    burger: h('button.burger', { title: '메뉴', 'aria-label': '메뉴', onclick: () => app.toggleMenu() }, '☰'),
    menu: h('div.menu-host'),
    conn: h('div.conn-mark'),
  };
  root.replaceChildren(layers.screen, layers.burger, layers.menu, overlays.el, layers.conn);

  let current = { key: null, view: null, el: null };

  function viewFor() {
    const r = app.route;
    if (r.view === 'title') return { key: 'title', mod: titleView };
    if (r.view === 'gameHome') return { key: `home:${r.gameId}`, mod: homeView };
    if (r.view === 'teamSettings') return { key: 'team', mod: teamView };
    if (r.view === 'pointsTable') return { key: 'points', mod: pointsView };
    if (r.view === 'scoreboard') return { key: `score:${r.mode ?? 'input'}`, mod: scoreView };
    if (r.view === 'stats') return { key: 'stats', mod: statsView }; // 기록 · 통계 (R-58)
    if (r.view === 'play') {
      const s = app.session(r.gameId);
      const game = app.game(r.gameId);
      if (!s || !game) return { key: 'title', mod: titleView, fallback: true };
      // 줄줄이 말해요는 원판 없이 진행자가 주제를 고른다 — 고르는 동안 후보를 보이지 않는 화면 (R-65)
      // 이모티콘 퀴즈도 원판이 없다 — 카테고리 목록을 띄우고 진행자가 문제를 고른다 (R-90)
      if (s.screen === 'roulette') return { key: `roulette:${r.gameId}:${s.picks.length}`, mod: s.type === 'roulette' ? topicWaitView : S.pickMode(s) ? questionPickView : rouletteView };
      if (s.screen === 'round') return { key: `round:${r.gameId}:${s.roundIndex}`, mod: roundView };
      if (s.screen === 'roundEnd') return { key: `roundEnd:${r.gameId}:${s.roundIndex}`, mod: roundEndView }; // 팀별 라운드 점수 (R-56)
      // 주제 카드 — 문제는 진행자 화면에만이라 문제가 바뀌어도 다시 만들지 않는다 (R-65)
      if (s.screen === 'topic') return { key: `topic:${r.gameId}:${s.picks.length}`, mod: topicView };
      if (s.screen === 'result') return { key: `result:${r.gameId}`, mod: resultView };
      const q = S.currentQuestion(s);
      return { key: `q:${r.gameId}:${q?.key}:${s.roundIndex}:${s.questionIndex}`, mod: questionView };
    }
    return { key: 'title', mod: titleView };
  }

  // 화면 그리기는 묶어서 한 번 — 창이 가려져 requestAnimationFrame 이 멈춰도 상태 보고는 계속되게 setTimeout
  let scheduled = false;
  app.render = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; renderNow(); }, 0);
  };

  function renderNow() {
    const v = viewFor();
    if (v.fallback && app.route.view === 'play') app.route = { view: 'title' };
    if (v.key !== current.key) {
      const old = current;
      if (old.view) {
        old.view.destroy?.();
        old.el.classList.add('leaving');
        setTimeout(() => old.el.remove(), 300);
      }
      const view = v.mod.create(app, app.route);
      view.el.classList.add('screen');
      layers.screen.append(view.el);
      current = { key: v.key, view, el: view.el };
      view.mounted?.();
    } else {
      current.view.update?.();
    }
    renderMenu(app, layers.menu);
    overlays.renderFill();
    const st = app.conn;
    // 제목 화면은 아래 경고 띠에 같은 문구가 있으므로 구석 표시는 생략
    const showConn = !st.online && app.route.view !== 'title';
    layers.conn.textContent = showConn ? `○ 저장 대기 ${st.pending}건 (서버 연결 끊김)` : '';
    layers.conn.classList.toggle('bad', showConn);
    app.publish?.();
  }

  app.view = () => current.view;

  // ── 메뉴 ───────────────────────────────────────────
  app.toggleMenu = (open = !app.ui.menuOpen) => {
    if (app.playing() && app.ui.roulette.phase === 'spinning' && open) { /* 회전 중에도 메뉴는 열린다 */ }
    app.ui.menuOpen = open;
    app.ui.menuFocus = 0;
    app.render();
  };

  // ── 키 입력 (docs/06-controls.md 1 · 2장) ──────────
  app.onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlays.onKey(e)) return;
    if (app.ui.menuOpen) { if (menuKey(app, e)) e.preventDefault(); return; }
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing) {
      current.view?.onInputKey?.(e);
      return;
    }
    if (e.repeat) return;
    const code = e.code;
    const spinning = app.route.view === 'play' && app.ui.roulette.phase === 'spinning';
    // 메뉴는 ☰ 버튼으로만 — M 키는 없앴다 (R-73)
    if (spinning && code !== 'Escape') { e.preventDefault(); return; }
    // 화면 키가 먼저 — 종합 점수판의 성공 · 실패 칸에서는 F 가 '실패' (13-scoreboard). 화면이 안 쓰는 F 만 전역으로
    // 도움말은 메뉴의 [도움말] 로만 — ? 키는 없앴다 (R-73)
    if (current.view?.onKey?.(e)) { e.preventDefault(); return; }
    if (code === 'KeyF') { e.preventDefault(); app.toggleFullscreen(); return; }
  };

  app.toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      app.toast('브라우저 메뉴에서 전체화면으로 전환하세요');
    }
  };

  /**
   * 연결 상태 — "서버 연결 끊김" 이 뜨는 순간(연결됨 → 끊김) 서버 로그에 비콘, 그때 응답 시간과 함께 (R-66).
   * why: 'stream'(실시간 연결 오류 — live-publisher) · 'save'(상태 저장 실패 — store). 다시 붙으면 못 보낸 비콘을 보낸다
   */
  app.setConn = (status, why = 'save') => {
    const was = app.conn?.online !== false;
    app.conn = status;
    if (was && !status.online) reportDisconnect('game', why, clientId);
    else if (!was && status.online) flushBeacons();
    app.render();
  };

  // 마우스를 3초 움직이지 않으면 커서 · ☰ 흐리게 (전체화면 진행 중)
  let idleTimer;
  const wake = () => {
    if (app.ui.idle) { app.ui.idle = false; document.body.classList.remove('idle'); }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.fullscreenElement) { app.ui.idle = true; document.body.classList.add('idle'); }
    }, 3000);
  };
  window.addEventListener('mousemove', wake);
  document.addEventListener('fullscreenchange', wake);

  for (const n of notes) setTimeout(() => app.toast(n), 400);
  return app;
}
