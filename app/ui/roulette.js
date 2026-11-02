// 룰렛 화면 — 준비 → 회전 → 당첨 (docs/01-app-flow.md 5장, docs/05-screens.md 4-4, R-21). 득점형만 (줄줄이 말해요는 topic-wait — R-65)
// 넣기 · 빼기 목록은 진행자 화면에만 — 모니터에 목록 · 커서가 있으면 결과를 고르는 것처럼 보인다 (R-72). 모니터는 원판만
import { h, replace, ordinal } from './dom.js';
import * as S from '../core/state.js';
import { teamCounts, relayOf, relayScores } from '../core/scoring.js';
import { createWheel } from './wheel.js';

export function create(app, route) {
  const gameId = route.gameId;
  const game = () => app.game(gameId);
  const sess = () => app.session(gameId);
  const g0 = game();

  const head = h('div.rl-head');
  const wheel = createWheel({ hubIcon: g0.icon });
  const chips = h('div.history-chips');
  const area = h('div.rl-wheel-area', wheel.el, chips);
  const strip = h('div.score-strip');
  // 더 출제할 문제가 없을 때 룰렛 준비 대신 (01-app-flow 5장)
  const done = h('div.rl-done', h('div.rd-title', '더 출제할 문제가 없습니다'), h('div.rd-sub', '모든 카테고리의 문제를 다 냈습니다'));
  const el = h('div.roulette', head, h('div.rl-body', area), done, strip);
  let card = null;
  let shownPhase = null;
  let wheelSig = '';
  let cardTimer = null;

  function sizeWheel(big) {
    const body = el.querySelector('.rl-body');
    const hgt = body?.clientHeight || window.innerHeight * 0.7;
    const wid = area.clientWidth || window.innerWidth * 0.5;
    const d = big ? Math.min(hgt * 0.84, wid * 0.92) : Math.min(hgt * 0.7, wid * 0.82);
    wheel.el.style.setProperty('--d', `${Math.round(d)}px`);
  }

  function render() {
    const s = sess();
    const g = game();
    if (!s || s.screen !== 'roulette') return;
    const r = app.play.rouletteState();
    const items = S.wheelList(g, s);
    const roundNo = s.picks.length + 1;

    const allDone = app.play.exhausted();
    el.classList.toggle('all-done', allDone);
    // 릴레이는 게임 점수 (라운드 배점 합, R-62), 정답 수 방식 라운드가 연결된 게임은 점수 (R-49)
    const relay = relayOf(s);
    const counts = relay ? relayScores(s) : teamCounts(s);
    const per = relay ? null : app.perCorrect(s.gameId);
    replace(strip, app.sessionTeams(s).map((t, i) => h('span', h('span.dot', { style: { '--c': t.color } }), ` ${t.name} `, h('span.num', (counts[i] ?? 0) * (per ?? 1)), relay && h('small', '점'))));
    if (allDone) {
      replace(head, `ROUND ${roundNo}`);
      // 릴레이 — 남은 문제는 있어도 한 라운드에 모자람 (R-62)
      done.lastChild.textContent = items.some((i) => i.short)
        ? `한 라운드(${S.sessionNeed(s)}문제)를 낼 만큼 문제가 남은 카테고리가 없습니다`
        : '모든 카테고리의 문제를 다 냈습니다';
      return;
    }

    replace(head, `ROUND ${roundNo} 카테고리 추첨`);

    // 원판 — 준비 중엔 넣은 것만 미리보기, 회전 · 정지 땐 회전 시작 때의 조각
    const cands = r.phase === 'setup' ? S.wheelCandidates(g, s) : (r.wheel ?? S.wheelCandidates(g, s));
    const sig = cands.join('|');
    if (sig !== wheelSig) {
      wheelSig = sig;
      wheel.setItems(cands.map((id) => { const c = S.findCategory(g, id); return { id, name: c.name, icon: c.icon }; }));
    }

    // 지난 판 기록
    replace(chips, s.picks.length > 0 && r.phase === 'setup' && [
      h('span', '지난 라운드:'),
      s.picks.slice(-8).map((p) => { const c = S.findCategory(g, p.categoryId); return h('span.chip', `${c?.icon ?? ''} ${c?.name ?? p.categoryId}`); }),
    ]);

    if (r.phase !== shownPhase) {
      const prev = shownPhase;
      shownPhase = r.phase;
      clearTimeout(cardTimer);
      if (r.phase === 'setup') {
        card?.remove(); card = null;
        wheel.setHighlight(null);
        requestAnimationFrame(() => { sizeWheel(false); wheel.redraw(); });
      } else if (r.phase === 'spinning') {
        sizeWheel(true);
        setTimeout(() => {
          wheel.redraw();
          wheel.spin(r.plan, () => app.play.spinDone());
        }, 320);
      } else if (r.phase === 'stopped') {
        sizeWheel(true);
        const idx = cands.indexOf(r.resultId);
        wheel.setHighlight(idx >= 0 ? idx : null);
        if (prev === null && idx >= 0) {
          // 바로 정지 상태로 들어옴 (조각 1개) — 그 조각이 위로 오게
          wheel.setRotation(-((idx + 0.5) * 360) / cands.length);
        }
        cardTimer = setTimeout(() => showCard(r.resultId, roundNo), prev === 'spinning' ? 500 : 0);
      }
    }
  }

  function showCard(id, roundNo) {
    const c = S.findCategory(game(), id);
    if (!c) return;
    card?.remove();
    card = h('div.win-card',
      h('div.wc-round', `ROUND ${roundNo} · ${ordinal(roundNo)} 게임`),
      h('div.wc-icon', c.icon),
      h('div.wc-name', c.name));
    area.append(card);
  }

  const onResize = () => { sizeWheel(app.play.rouletteState().phase !== 'setup'); wheel.redraw(); };
  window.addEventListener('resize', onResize);

  return {
    el,
    mounted() { render(); requestAnimationFrame(onResize); },
    update: render,
    destroy() { window.removeEventListener('resize', onResize); wheel.stop(); clearTimeout(cardTimer); },
    onKey(e) {
      const p = app.play;
      const phase = p.rouletteState().phase;
      const c = e.code;
      if (phase === 'spinning') return true;
      if (p.exhausted()) {
        // 결과로는 Enter 만 — → · PageDown 은 뺐다 (R-79)
        if (c === 'Enter' || c === 'NumpadEnter') { p.next(); return true; }
        return false;
      }
      // E(일찍 끝내기) · R(진행 초기화)은 룰렛에서 없앴다 — 끝내기는 진행자 화면 [종료] (R-77)
      // 넣기 · 빼기(예전 ↑ ↓ X A)는 진행자 화면에서만 — 게임 화면에는 목록이 없다 (R-72)
      // 돌리기 · 확정은 Enter 만 — 확정 → · PageDown 과 다시 돌리기 Space 는 뺐다 (R-75 · R-79). 다시 돌리기는 진행자 화면 [다시 돌리기] · 아래 Backspace (R-84)
      if (c === 'Enter' || c === 'NumpadEnter') { if (phase === 'setup') p.spin(); else p.confirmSpin(); return true; }
      // 정지 후 Backspace = 돌리기 전으로 (진행자 [다시 돌리기] 와 같음 — 넣은 카테고리는 그대로, 방금 결과만 버림) (R-84)
      if (c === 'Backspace') { if (phase === 'stopped') p.respin(); return true; }
      // ← · PageUp(이전)은 없앴다 (R-74)
      return false;
    },
  };
}
