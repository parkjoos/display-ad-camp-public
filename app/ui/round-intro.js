// 라운드 소개 (docs/05-screens.md 4-5, D-4) — "두 번째 게임은 🎬 영화 · 드라마 제목 입니다"
import { h, ordinal } from './dom.js';
import { findCategory } from '../core/state.js';
import { relayOf, relayPerOf } from '../core/scoring.js';

export function create(app, route) {
  const s = app.session(route.gameId);
  const g = app.game(route.gameId);
  const pick = s.picks[s.roundIndex];
  const c = findCategory(g, pick.categoryId);
  const n = s.roundIndex + 1;
  const relay = relayOf(s);
  const per = relayPerOf(s);
  const el = h('div.round-intro',
    h('div.ri-round', `ROUND ${n}`),
    h('div.ri-lead', `${ordinal(n)} 게임은`),
    h('div.ri-cat', h('span.emoji', c.icon), h('span', c.name), h('span.tail', '입니다')),
    c.description && h('div.ri-desc', c.description),
    // 릴레이는 문제 수가 정해져 있지 않다 — 규칙을 보인다 (R-62). 대표가 함께 나와 한 사람이 인당 문제까지 맞히고 빠진다 (R-64 · R-94)
    h('div.ri-count', !relay ? `총 ${pick.questionIds.length}문제`
      : per > 1 ? `팀당 대표 ${relay}명 · 인당 ${per}문제 — ${per}문제 맞힌 사람은 빠지고, 대표가 모두 빠진 순서로 1 · 2 · 3등`
        : `팀당 대표 ${relay}명 — 맞히면 빠지고, 대표가 모두 맞힌 순서로 1 · 2 · 3등`));
  return {
    el,
    update() {},
    onKey(e) {
      const p = app.play;
      // 첫 문제는 Enter 만 — → · Space · PageDown 은 뺐다 (R-82)
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { p.next(); return true; }
      // ← · PageUp(이전)은 없앴다 (R-74)
      // Backspace(되돌리기)는 없앴다 — 지난 라운드 점수가 보이지 않게 지워졌다. 고치기는 진행자 화면 [📝 정답 기록] (R-83)
      // E(일찍 끝내기) · R(진행 초기화)은 없앴다 — 끝내기는 진행자 화면 [종료], 초기화는 게임 홈 [새로 시작] (R-80)
      return false;
    },
  };
}
