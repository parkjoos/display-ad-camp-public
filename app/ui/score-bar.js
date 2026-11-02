// 스코어보드 — 팀별 정답 수, 정답 수 방식 라운드가 연결된 게임은 점수 (docs/05-screens.md 4-10, R-22, R-49)
// 릴레이는 이번 라운드 맞힌 대표 ●○ · 대표를 모두 내보낸 팀은 등수 메달 (R-62). 대표마다 번호를 단 한 묶음 · 오른쪽 열에서는 한 줄씩 (R-64 · R-94)
// 정답 화면에서는 대표 묶음을 클릭해 맞힌 사람을 고른다 (R-94)
import { h, replace, fitText } from './dom.js';

export const MEDAL = ['🥇', '🥈', '🥉'];
/** 등수 문구 — 메달 + "1등" (4등부터는 글자만) */
export const rankLabel = (rank) => [MEDAL[rank - 1] && h('span.emoji', MEDAL[rank - 1]), `${rank}등`];

/**
 * @param side 오른쪽 세로 열 (사진 문제, R-53) — 카드를 위아래로 쌓고, 좁은 폭에 맞춰 이름은 두 줄까지 · 정답 수도 줄인다
 * @param onRep 대표 묶음 클릭 (팀, 대표) — 정답 화면에서 맞힌 사람 고르기 (R-94)
 */
export function createScoreBar(app, { side = false, onRep = null } = {}) {
  const el = h('div.scoreboard-bar');
  let cards = [];
  let prev = null;
  let sig = '';

  // 팀 이름이 칸보다 길면 글자를 줄인다 — 10자 × 4팀에서도 잘리지 않게 (K-10)
  let fitTimer = null;
  function fitNames() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      for (const n of el.querySelectorAll('.tc-name')) fitText(n, { max: 39, min: 18, maxLines: side ? 2 : 1 });
      if (side) {
        const scores = [...el.querySelectorAll('.tc-score')];
        for (const n of scores) fitText(n, { max: 86, min: 36, maxLines: Number(n.dataset.lines) || 1, box: n.classList.contains('reps') });
        // 대표 묶음은 팀마다 같은 크기로 — 맞힌 팀 ✔ 로 한 팀만 작아지지 않게 (R-94)
        const reps = scores.filter((n) => n.classList.contains('reps'));
        const least = Math.min(...reps.map((n) => parseFloat(n.style.fontSize) || Infinity));
        if (Number.isFinite(least)) for (const n of reps) n.style.fontSize = `${least}px`;
      }
    }, 0);
  }
  new ResizeObserver(fitNames).observe(el);

  function build(teams) {
    el.replaceChildren();
    cards = teams.map((t, i) => {
      const score = h('span.tc-score', '0');
      const crown = h('span.tc-crown');
      const card = h('div.team-card', { style: { '--c': t.color } },
        crown, h('span.tc-name', t.name), score, h('span.tc-key', String(i + 1)));
      el.append(card);
      return { card, score, crown };
    });
  }

  /**
   * @param counts 팀별 정답 수
   * @param scoredTeam 이 문제 맞힌 팀 (없으면 null)
   * @param dim 흐리게 할 팀 (추가 문제에서 동점 그룹이 아닌 팀)
   * @param per 정답 1개당 점수 — 있으면 정답 수 대신 점수(정답 수 × per)를 보여 준다 (R-49)
   * @param relay 릴레이 진행 (state.relayStatus, R-62) — 있으면 counts 대신 이번 라운드 맞힌 대표 수. 이 문제에 못 나오는 팀(out)은 흐리게
   * @param pick 대표 묶음을 눌러 맞힌 사람을 고를 수 있음 (정답 화면, R-94)
   */
  function update(counts, scoredTeam = null, dim = [], per = null, relay = null, pick = false) {
    if (relay) counts = relay.counts;
    const teams = app.teams().slice(0, counts.length);
    const s = JSON.stringify([teams, per, !!relay]);
    if (s !== sig) { sig = s; build(teams); prev = null; }
    const max = Math.max(...counts);
    const leaders = counts.filter((c) => c === max).length;
    counts.forEach((c, i) => {
      const x = cards[i];
      if (!x) return;
      if (relay) {
        const f = relay.finish.indexOf(i);
        const dot = (on) => h(`span.rd${on ? '.on' : ''}`, on ? '●' : '○');
        // 대표마다 한 묶음 — 번호 + 그 대표가 맞힌 수 (R-94). 이 문제 전에 인당 문제를 다 채운 대표 · 빠진 팀은 고를 수 없다
        const repGroup = (r) => {
          const n = relay.reps[i][r];
          const can = pick && onRep && !relay.out.includes(i) && relay.repsBefore[i][r] < relay.per;
          const sel = scoredTeam === i && relay.scoredRep === r;
          return h(`span.rd-rep${n >= relay.per ? '.full' : ''}${can ? '.pick' : ''}${sel ? '.sel' : ''}`,
            { onclick: can ? (e) => { e.stopPropagation(); onRep(i, r); } : null },
            h('span.rd-no', String(r + 1)), Array.from({ length: relay.per }, (_, k) => dot(k < n)));
        };
        replace(x.score, f >= 0 ? rankLabel(f + 1) : Array.from({ length: relay.relay }, (_, r) => [r > 0 && ' ', repGroup(r)]));
        x.score.classList.toggle('reps', f < 0);
        x.score.dataset.lines = f < 0 ? String(relay.relay) : '1';
        x.card.classList.toggle('done', relay.out.includes(i));
        x.crown.textContent = '';
      } else {
        x.score.textContent = String(per === null ? c : c * per);
        x.crown.textContent = max > 0 && leaders === 1 && c === max ? '👑' : '';
      }
      x.card.classList.toggle('scored', scoredTeam === i);
      x.card.classList.toggle('dim', dim.includes(i));
      if (prev && prev[i] !== undefined && prev[i] !== c) {
        const cls = c > prev[i] ? 'pop' : 'shake';
        x.card.classList.remove('pop', 'shake'); void x.card.offsetWidth; x.card.classList.add(cls);
        setTimeout(() => x.card.classList.remove(cls), 700);
        if (c > prev[i]) {
          const plus = h('span.plus-one', `+${per === null ? 1 : per}`);
          x.card.append(plus);
          setTimeout(() => plus.remove(), 950);
        }
      }
    });
    prev = [...counts];
    fitNames(); // 맞힌 팀 ✔ 표시로 이름 칸이, 자릿수로 정답 수 칸이 바뀔 수 있음
  }

  return { el, update };
}
