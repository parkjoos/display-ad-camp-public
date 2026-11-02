// 제목 화면 (docs/01-app-flow.md 2장, docs/05-screens.md 4-1)
import { h, replace } from './dom.js';
import { resumeLabel } from '../core/state.js';

export function create(app) {
  const el = h('div.title-screen');

  function render() {
    const active = app.activeSessions();
    const [first] = active;
    const teams = app.teams();
    const problems = app.data.order.filter((id) => !app.game(id));
    const strip = [];
    if (problems.length) strip.push(`⚠ 데이터 오류: ${problems.join(', ')} — ☰ → 관리에서 고치세요`);
    if (app.data.scoreboard.errors?.length) strip.push('⚠ 점수판 기본값을 읽을 수 없습니다');
    if (!app.conn.online) strip.push(`○ 저장 대기 ${app.conn.pending}건 (서버 연결 끊김)`);
    if (!app.conn.online && !app.conn.localOk) strip.push('⚠ 저장 불가 — 새로고침하면 설정이 사라집니다');
    replace(el,
      h('div.title-main', app.title()),
      app.subtitle() && h('div.title-sub', app.subtitle()),
      app.teamsReady()
        ? h('div.team-badges', teams.map((t) => h('span.team-badge', h('span.dot', { style: { '--c': t.color } }), t.name)))
        : h('div.warn-accent', '⚠ 팀 설정이 필요합니다 — ☰ → 팀 설정'),
      first && h('div.resume-card',
        h('span', '진행 중: ', resumeLabel(first[1], app.game(first[0]))),
        active.length > 1 && h('span.mi-sub', `외 ${active.length - 1}개`),
        h('button.btn.primary', { onclick: () => resume() }, '이어하기')),
      h('div.title-hint', '☰ 메뉴에서 게임을 골라 주세요'),
      strip.length > 0 && h('div.bottom-strip', strip.map((s) => h('span', s))));
  }

  function resume() {
    const [first] = app.activeSessions();
    if (first) app.go({ view: 'play', gameId: first[0] });
  }

  render();
  return {
    el,
    update: render,
    // 제목 화면 키는 없다 — 메뉴는 ☰, 이어하기는 버튼 클릭으로 (R-73)
    onKey: () => false,
  };
}
