// 문제 고르기 — 이모티콘 퀴즈 (docs/05-screens.md 4-13, R-90). 룰렛 없이 진행자가 진행자 화면에서 문제를 골라 [내기] 하면 바로 문제 화면.
// 모니터에는 카테고리 목록 · 남은 문제 수만 — 참가자가 카테고리를 말하면 그 카드를 클릭해 그 카테고리 문제를 바로 낸다 (R-91)
import { h, replace } from './dom.js';
import * as S from '../core/state.js';
import { teamCounts } from '../core/scoring.js';

export function create(app, route) {
  const gameId = route.gameId;
  const game = () => app.game(gameId);
  const cards = h('div.pick-cats');
  const sub = h('div.topic-rule', '카테고리를 골라 주세요');
  const strip = h('div.score-strip');
  const el = h('div.qpick',
    h('div.topic.qpick-body',
      h('div.qpick-head', h('span.qpick-icon', game().icon ?? ''), h('span.topic-name', game().title)),
      sub,
      cards),
    strip);

  function render() {
    const s = app.session(gameId);
    const g = game();
    if (!s || s.screen !== 'roulette') return;
    const done = app.play.exhausted();
    sub.textContent = done ? '모든 문제를 냈습니다' : '카테고리를 골라 주세요';
    // 카테고리마다 남은 문제 수 — 다 낸 카테고리는 흐리게. 클릭하면 그 카테고리 문제를 문제 순서 옵션대로 하나 (R-91)
    replace(cards, g.categories.filter((c) => !c.disabled && S.usableQuestions(c).length > 0).map((c) => {
      const left = S.remainingQuestions(g, s, c.id).length;
      return h(`button.pick-cat${left ? '' : '.off'}`, { disabled: left ? undefined : true, onclick: () => app.play.pickInCategory(c.id) },
        h('span.pc-icon', c.icon),
        h('span.pc-name', c.name),
        h('span.pc-meta', left ? `남은 문제 ${left}` : '모두 냄'));
    }));
    const counts = teamCounts(s);
    const per = app.perCorrect(s.gameId);
    replace(strip, app.sessionTeams(s).map((t, i) => h('span', h('span.dot', { style: { '--c': t.color } }), ` ${t.name} `, h('span.num', (counts[i] ?? 0) * (per ?? 1)))));
  }
  render();

  return {
    el,
    update: render,
    // 문제는 카드 클릭 · 진행자 화면 [내기] 로 고른다 — 게임 화면 키 없음 (R-91). 다 냈으면 Enter 로 결과 (룰렛 화면과 같음).
    // 클릭하고 포커스가 남은 카드가 Enter · Space(브라우저 기본)로 다시 눌리지 않게 막는다 (게임 홈과 같음)
    onKey(e) {
      const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
      if (enter && app.play.exhausted()) { app.play.next(); return true; }
      return enter || e.code === 'Space';
    },
  };
}
