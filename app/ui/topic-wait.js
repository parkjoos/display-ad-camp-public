// 주제 고르는 중 — 줄줄이 말해요 (docs/05-screens.md 4-9, R-65). 원판 · 후보 목록 없이, 진행자가 고르면 바로 주제 카드가 나온다
// 후보 주제를 미리 보여 주면 팀이 답을 미리 준비할 수 있어서 모니터에는 지난 주제만
import { h, replace } from './dom.js';
import { findCategory } from '../core/state.js';

export function create(app, route) {
  const game = () => app.game(route.gameId);
  const chips = h('div.history-chips');
  const el = h('div.topic.topic-wait',
    h('div.topic-icon', game().icon ?? ''),
    h('div.topic-name', game().title),
    h('div.topic-rule', '주제를 뽑아 주세요'),
    chips);

  function render() {
    const s = app.session(route.gameId);
    if (!s || s.screen !== 'roulette') return;
    replace(chips, s.picks.length > 0 && [
      h('span', '지난 주제:'),
      s.picks.slice(-8).map((p) => { const c = findCategory(game(), p.categoryId); return h('span.chip', `${c?.icon ?? ''} ${c?.name ?? p.categoryId}`); }),
    ]);
  }
  render();

  // 줄줄이 말해요는 게임 화면 키가 없다 — 주제 고르기 · 끝내기는 진행자 화면 주제 버튼 · [🎲 무작위] · [끝내기] (R-85)
  return { el, update: render };
}
