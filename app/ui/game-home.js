// 게임 홈 (docs/01-app-flow.md 4장, docs/05-screens.md 4-3) — 카테고리는 보여주기 · 제외만, 고르는 건 룰렛.
// 줄줄이 말해요는 머리 · 규칙 · 배점 · 시작만 — 주제 · 옵션 · 진행자용 안내는 모니터에 두지 않는다 (R-65).
// 이모티콘 퀴즈도 머리 · 규칙 · 배점 · 팀 · 시작만 — 진행 중 진행자가 문제를 고른다 (R-90)
import { h, replace } from './dom.js';
import * as S from '../core/state.js';
import * as SB from '../core/scoreboard.js';
import { missingImages, preloadImages } from '../core/data.js';
import { resumeLabel } from '../core/state.js';

export function create(app, route) {
  const gameId = route.gameId;
  const el = h('div.home');
  const local = { editPoints: false, missing: null };

  const entry = () => app.entry(gameId);
  const game = () => app.game(gameId);
  // 카테고리 카드 · 옵션이 없는 게임 — 줄줄이 말해요(R-65) · 이모티콘 퀴즈(R-90)는 진행자가 진행 중에 고른다
  const noCards = (g) => g?.type === 'roulette' || g?.type === 'emoji';
  // 제외도 없다 — 저장된 제외는 무시, 숨김 아닌 카테고리 전부 (R-65 · R-90)
  const excluded = () => (noCards(game()) ? [] : app.gameSettings(gameId).excludedCategories ?? []);

  /** 카테고리 하나로 라운드를 치를 최소 문제 수 — 릴레이는 (팀 수 − 1) × 대표 수 (R-62) */
  const relay = () => (game()?.type === 'roulette' ? 0 : app.options(gameId).relay);
  const need = () => S.needPerRound(Math.max(2, app.teamCount()), relay());

  function startProblem() {
    const g = game();
    if (!g) return '데이터 오류가 있어 시작할 수 없습니다';
    if (g.type !== 'roulette' && !app.teamsReady()) return '팀 설정이 필요합니다';
    if (!S.homeCandidates(g, excluded(), need()).length) {
      if (g.type !== 'roulette' && g.categories.every((c) => S.usableQuestions(c).length === 0)) return '문제가 없습니다';
      if (need() > 1 && S.homeCandidates(g, excluded()).length) return `팀당 대표 ${relay()}명이면 카테고리마다 문제가 ${need()}개 이상 필요합니다`;
      return '포함된 카테고리가 없습니다';
    }
    return null;
  }

  async function start({ fresh = false } = {}) {
    const g = game();
    const problem = startProblem();
    if (problem) { app.toast(problem); return; }
    const cur = app.session(gameId);
    if (cur && cur.status === 'active' && !fresh) { app.go({ view: 'play', gameId }); return; }
    if (cur && fresh && cur.status === 'active') {
      if (!(await app.confirm({ title: '새로 시작', message: '진행 중인 게임 기록이 지워집니다', ok: '새로 시작', danger: true }))) return;
    }
    const others = app.activeSessions().filter(([id]) => id !== gameId);
    if (others.length) {
      const names = others.map(([id]) => app.game(id).title).join(', ');
      if (!(await app.confirm({ title: '게임 시작', message: `진행 중인 '${names}' 게임은 그대로 저장됩니다.\n새 게임을 시작할까요?`, ok: '시작' }))) return;
    }
    const candidates = S.homeCandidates(g, excluded(), need());
    // 줄줄이 말해요의 문제 순서는 관리 페이지 진행 기본값만 — 게임 홈 옵션이 없어 예전에 저장한 값은 무시 (R-65)
    const session = g.type === 'roulette'
      ? S.createRouletteSession({ game: g, candidates, options: S.effectiveOptions(g, {}) })
      : S.createScoreSession({ game: g, teamCount: app.teamCount(), options: app.options(gameId), candidates, points: app.relayPoints(gameId) });
    preloadImages(g, candidates);
    app.ui.roulette.key = null;
    app.setSession(gameId, session);
    app.go({ view: 'play', gameId });
  }

  function toggleCategory(id) {
    const g = game();
    const c = S.findCategory(g, id);
    if (!c || !S.usableQuestions(c).length) return;
    const ex = new Set(excluded());
    if (ex.has(id)) ex.delete(id); else ex.add(id);
    app.setGameSettings(gameId, { excludedCategories: g.categories.map((x) => x.id).filter((x) => ex.has(x)) });
  }

  function linkedRounds() {
    return app.rounds().filter((r) => r.gameId === gameId);
  }

  function pointsZone() {
    if (app.data.scoreboard.errors?.length) return h('div.points-zone', h('span.pz-label', '배점'), h('span.img-warn', '점수판 기본값을 읽을 수 없습니다'));
    const rounds = linkedRounds();
    const g = game();
    const scoring = g.type !== 'roulette';
    const vals = rounds.length === 0
      ? [h('span.summary', '배점표에 연결된 라운드가 없습니다 — 라운드 설정에서 연결하세요')]
      : rounds.map((r) => {
        const label = rounds.length > 1 ? `${S.findCategory(g, r.categoryId)?.name ?? r.name} ` : '';
        if (!local.editPoints) {
          // 퀴즈는 라운드마다 등수를 매겨 더한다 (R-57)
          if (r.kind === 'rank') return h('span', label, rounds.length > 1 ? r.points.slice(0, 3).join('/') : `🥇 ${r.points[0]} · 🥈 ${r.points[1]} · 🥉 ${r.points[2]}`, scoring ? ' (라운드마다)' : '');
          if (r.kind === 'pass') return h('span', label, `성공 ${r.pass} · 실패 ${r.fail}`);
          if (r.kind === 'count') return h('span', label, `정답 1개당 ${r.per}`);
          return h('span', label, '직접 입력');
        }
        const inputs = r.kind === 'rank'
          ? r.points.slice(0, app.teamCount() === 4 ? 4 : 3).map((p, i) => pointInput(r, (v) => ({ points: r.points.map((x, j) => (j === i ? v : x)) }), p, `${i + 1}등`))
          : r.kind === 'pass' ? [pointInput(r, (v) => ({ pass: v }), r.pass, '성공'), pointInput(r, (v) => ({ fail: v }), r.fail, '실패')]
            : r.kind === 'count' ? [pointInput(r, (v) => ({ per: v }), r.per, '정답 1개당')] : ['직접 입력'];
        return h('span', label, inputs);
      });
    return h('div.points-zone',
      h('span.pz-label', '배점'),
      h('span.pz-vals', vals),
      rounds.length > 0 && h('button.btn.small', { onclick: () => { local.editPoints = !local.editPoints; render(); } }, local.editPoints ? '배점 수정 끝' : '배점 수정'),
      h('button.btn.small', { onclick: () => app.go({ view: 'pointsTable' }) }, '배점표 전체 보기'),
      scoring && h('span.pz-note', SB.perCorrectRound(rounds, gameId)
        ? '맞힌 팀에 정답 1개마다 점수를 줍니다 (게임 화면에 점수 표시). 끝나면 점수판에 정답 수로 채웁니다.'
        : relay() > 0
          // 릴레이 (R-62) — 라운드 등수는 대표를 모두 내보낸 순서, 게임 결과는 라운드 배점 합
          ? '라운드마다 대표를 모두 내보낸 순서로 등수를 매겨 배점을 더합니다. 게임 결과 순위도 그 합입니다.'
          : '이 게임은 정답 수로 순위를 정합니다. 종합 점수는 점수판에서 입력합니다.'));
  }

  function pointInput(round, patch, value, label) {
    return h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.3em', marginRight: '0.6em', fontSize: '2vh' } }, label,
      h('input.input.pz-edit', {
        type: 'number', value,
        onchange: (e) => {
          const v = e.target.value.trim();
          if (!/^-?\d+$/.test(v)) { e.target.value = value; return; }
          app.setScoreboard(SB.setPoints(app.scoreboard, app.data.scoreboard.rounds, round.id, patch(Number(v))));
        },
      }));
  }

  function categories() {
    const g = game();
    const ex = excluded();
    const cats = g.categories.filter((c) => !c.disabled);
    const compact = cats.length >= 9;
    const n = need();
    return h(`div.cat-grid${compact ? '.compact' : ''}`, cats.map((c) => {
      const usable = S.usableQuestions(c).length;
      const empty = usable === 0;
      // 릴레이 — 한 라운드에 모자라는 카테고리는 이 게임에서 쓰지 않는다 (R-62)
      const short = !empty && usable < n;
      const off = !empty && !short && ex.includes(c.id);
      return h(`button.cat-card${off ? '.off' : ''}${empty || short ? '.empty' : ''}${short ? '.short' : ''}`, {
        dataset: { key: `cat:${c.id}` }, disabled: empty || short ? true : undefined,
        onclick: () => toggleCategory(c.id),
      },
      h('span.cc-name', h('span.emoji', c.icon), c.name),
      !compact && c.description && h('span.cc-desc', c.description),
      h('span.cc-meta',
        h('span', short ? `문제 ${usable}개 · ${n}개 필요` : `문제 ${usable}개`),
        !empty && !short && h('span.cc-toggle', off ? '○ 제외' : '포함 ●')));
    }));
  }

  function footer() {
    const g = game();
    const s = app.session(gameId);
    const problem = startProblem();
    const teams = app.teams();
    const teamLine = g.type === 'roulette' ? h('div') : h('div.home-teams',
      app.teamsReady()
        ? [h('span', '팀:'), teams.map((t) => h('span.team-badge', h('span.dot', { style: { '--c': t.color } }), t.name))]
        : h('span.warn-accent', '팀 설정이 필요합니다'),
      h('button.btn.small', { onclick: () => app.go({ view: 'teamSettings', back: route }) }, '팀 설정'));
    let buttons;
    if (s && s.status === 'active') {
      buttons = [
        h('button.btn.big.primary', { onclick: () => start(), dataset: { key: 'start' } }, `▶ 이어하기 (${resumeLabel(s, g).split(' · ').slice(1).join(' · ')})`),
        h('button.btn', { onclick: () => start({ fresh: true }) }, '새로 시작'),
      ];
    } else {
      buttons = [h('button.btn.big.primary', { onclick: () => start({ fresh: true }), disabled: problem ? true : undefined, dataset: { key: 'start' } }, '▶ 게임 시작')]; // 줄줄이 말해요도 룰렛 없음 (R-65)
    }
    return h('div.home-foot', teamLine, h('div.start-area',
      problem && h('div.start-reason', problem, problem === '팀 설정이 필요합니다' && [' ', h('button.btn.small', { onclick: () => app.go({ view: 'teamSettings', back: route }) }, '팀 설정')]),
      s && s.status === 'finished' && g.type !== 'roulette' && h('button.link', { onclick: () => app.go({ view: 'play', gameId }) }, '지난 결과 보기'),
      h('div.start-btns', buttons)));
  }

  function render() {
    const focusKey = document.activeElement?.dataset?.key;
    const e = entry();
    const g = e?.game;
    if (!g) {
      replace(el,
        h('div.home-head', h('span.home-icon', '⚠'), h('div.home-title', `${gameId} — 데이터 오류`)),
        h('ul.error-list', (e?.errors ?? []).map((x) => h('li', h('b', x.code), x.message))),
        h('div.summary', '☰ → 관리 에서 고치세요'));
      return;
    }
    replace(el,
      h('div.home-head', h('span.home-icon', g.icon), h('div', h('div.home-title', g.title), g.description && h('div.home-desc', g.description))),
      g.rules.length > 0 && h('ul.home-rules', g.rules.map((r) => h('li', r))),
      pointsZone(),
      // 줄줄이 말해요는 주제 · 옵션을 두지 않는다 — 주제가 미리 보이면 팀이 답을 준비할 수 있고, 옵션 · 안내는 참여자가 알 필요가 없다 (R-65)
      // 이모티콘 퀴즈도 — 룰렛 · 라운드가 없어 제외 · 라운드 옵션이 쓰이지 않는다 (R-90)
      !noCards(g) && [
        h('div.cat-title', '카테고리', h('small', '룰렛으로 정해집니다 — 빼고 싶은 것만 제외')),
        categories(),
        local.missing?.length > 0 && h('div.img-warn', `⚠ 이미지 ${local.missing.length}개를 찾을 수 없습니다 — 관리 → 전체 검증`)],
      // 라운드 · 팀당 대표 · 순서 옵션과 요약 줄은 없앴다 — 참여자가 알 필요 없고, 진행 옵션은 관리 페이지 진행 기본값만 (R-92)
      footer());
    if (focusKey) el.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  render();
  // 후보 카테고리 이미지가 있는지 (W02)
  const g0 = game();
  if (g0 && g0.type === 'photo') {
    missingImages(g0, S.homeCandidates(g0, excluded())).then((m) => { local.missing = m; render(); });
  }

  return {
    el,
    update: render,
    // 게임 홈은 단축키가 없다 — 카드 제외 · 시작 · 이어하기 · 새로 시작은 클릭으로 (R-76).
    // 클릭하고 포커스가 남은 카드 · 버튼이 Enter · Space(브라우저 기본)로 다시 눌리지 않게 막기만 한다
    onKey(e) {
      return ['Enter', 'NumpadEnter', 'Space'].includes(e.code);
    },
  };
}
