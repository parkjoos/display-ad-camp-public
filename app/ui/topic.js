// 주제 카드 — 룰렛형 (docs/05-screens.md 4-9, D-7). 팀 · 차례 · 횟수 표시 없음
// 문제 · 정답 후보는 진행자 화면에만 — 모니터는 문제를 내는 동안에도 주제 카드 그대로 (R-65, 진행자가 문제를 읽어 준다)
import { h, replace } from './dom.js';
import { findCategory } from '../core/state.js';

export function create(app, route) {
  const s0 = app.session(route.gameId);
  const c = findCategory(app.game(route.gameId), s0.picks.at(-1)?.categoryId);
  return cardView(app, route, c);
}

function cardView(app, route, c) {
  const examples = h('div.topic-examples');
  const el = h('div.topic',
    h('div.topic-icon', c?.icon ?? ''),
    h('div.topic-name', c?.name ?? ''),
    h('div.topic-rule', c?.rule ?? ''),
    examples);
  let shown = null;

  function render() {
    const s = app.session(route.gameId);
    if (!s || s.screen !== 'topic' || !c) return;
    if (s.examplesVisible === shown) return;
    shown = s.examplesVisible;
    replace(examples, shown && c.examples.length > 0 && c.examples.map((x) => h('span.chip', x)));
  }
  render();
  // 줄줄이 말해요는 게임 화면 키가 없다 — 다음 주제 · 문제 · 끝내기는 진행자 화면 [다음 주제 ▶] · [첫 문제 ▶] · [끝내기] (R-85)
  return { el, update: render };
}
