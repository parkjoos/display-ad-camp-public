// 문제 · 정답 공개 화면 — 득점형 (docs/05-screens.md 4-6 · 4-7, R-26 · R-29)
// 같은 문제의 문제 → 정답 공개 → (← 로) 다시 문제는 이 화면 하나가 이어서 그린다
import { h, replace, fitText } from './dom.js';
import * as S from '../core/state.js';
import { replay, teamCounts, relayOf, relayScores } from '../core/scoring.js';
import { createPhoto } from './render-photo.js';
import { createEmoji } from './render-emoji.js';
import { createClip } from './clip.js';
import { clipSpec } from '../core/youtube.js';
import { createScoreBar, rankLabel } from './score-bar.js';

export function create(app, route) {
  const gameId = route.gameId;
  const game = app.game(gameId);
  const s0 = app.session(gameId);
  const cur = S.currentQuestion(s0);
  const found = S.findQuestion(game, cur.id);
  const q = found?.question;
  const cat = found?.category;
  const tb = cur.tb;

  const left = h('div.ph-left');
  const qno = h('span.num');
  const headEl = h('div.play-head', left, h('div.ph-right', qno));
  const prompt = h('div.prompt');
  const box = h('div.stage-box');
  const main = h('div.play-main', prompt, box);
  // 사진 문제는 스코어보드를 오른쪽 세로 열로 — 사진 칸을 높게 (R-53, D-32). 이모티콘은 아래 띠 그대로
  const side = game.type === 'photo';
  // 팀당 대표 방식 — 정답 화면에서 점수 띠의 대표 묶음을 클릭하면 그 사람이 맞힌 것으로 (R-94)
  const bar = createScoreBar(app, { side, onRep: (team, rep) => app.play.credit(team, rep) });
  const el = h(side ? 'div.play.side' : 'div.play', headEl, main, bar.el);

  let renderer = null;
  let hintEl = null;
  let answerEl = null;
  let creditEl = null;
  let lastCredit = undefined;
  // 정답 글자 숨기기 — 정답 이미지(없으면 원래 사진)만 보이고, 맞힌 팀은 작은 띠로 (R-41 · R-47)
  const hideText = !!q?.hideAnswerText;

  const promptText = q?.prompt ?? cat?.prompt ?? null;
  if (promptText) prompt.textContent = promptText; else prompt.remove();
  if (!q) {
    box.append(h('div.img-missing', '⚠ 문제를 찾을 수 없습니다 (관리에서 지워졌을 수 있음)'));
  } else if (game.type === 'photo') {
    renderer = createPhoto(box, q);
  } else {
    renderer = createEmoji(box, q);
  }

  // 정답 영상 (R-61) — 정답 공개 때 사진 위에서 자동 재생하고, 끝나면 걷어내고 정답 띠. 문제 화면에서 미리 불러 둔다
  const spec = q && game.type === 'photo' ? clipSpec(q) : null;
  const clip = spec ? createClip(box, spec, { onChange: () => { syncClip(); app.render(); } }) : null;
  let wasRevealed = null; // 처음 그릴 때 이미 정답 화면이면(새로고침 · 라운드 종료에서 돌아옴) 자동 재생하지 않는다
  function syncClip() { app.ui.clip = { key: cur.key, ...clip.status() }; }
  if (clip) {
    syncClip();
    app.clipControl = { key: cur.key, run: clipCommand };
  }

  /** 진행자 [영상 다시 재생 · 일시정지 · 영상 끝내기] (R-61 — 게임 창 V 는 R-81 에서 없앰) — 되면 true, 아니면 이유 */
  function clipCommand(act) {
    const s = app.session(gameId);
    if (s?.screen !== 'answer' && s?.screen !== 'tiebreakAnswer') return '정답 공개 뒤에 재생됩니다';
    const now = clip.status().state;
    if (act === 'pause') return clip.pause() || '재생 중이 아닙니다';
    if (act === 'skip') return clip.finish() || '재생 중인 영상이 없습니다';
    if (now === 'paused') return clip.resume();
    if (now === 'playing' || now === 'loading') return true;
    return clip.play();
  }

  /** 정답 화면 Enter — 맞힌 팀도 [없음] 도 정하지 않았으면 한 번 묻는다 (R-86) */
  let asking = null;
  async function nextFromAnswer() {
    if (app.play.answerDecided()) { app.play.next(); return; }
    asking = app.confirm({ title: '맞힌 팀 확인', message: '맞힌 팀(정답자)을 체크하지 않았습니다. 이대로 다음으로 넘어갈까요?', ok: '넘어가기' });
    const ok = await asking;
    asking = null;
    const s = app.session(gameId);
    // 확인창이 떠 있는 동안 진행자 화면에서 이미 넘겼으면 또 넘기지 않는다
    if (ok && S.currentQuestion(s)?.key === cur.key && (s.screen === 'answer' || s.screen === 'tiebreakAnswer')) app.play.next();
  }

  function header(s) {
    if (tb) {
      const names = S.tiebreakGroup(s).map((t) => app.teams()[t]?.name ?? `팀${t + 1}`);
      replace(left, h('span.tb-badge', `추가 문제 — ${names.join(' · ')} 동점`));
      qno.textContent = '';
      return;
    }
    // 이모티콘 퀴즈는 라운드가 없다 — 카테고리 · 이 게임에서 몇 번째 문제 (R-90)
    if (S.pickMode(s)) {
      replace(left, h('span.emoji', game.icon), ' ', h('span.emoji', cat?.icon ?? ''), ` ${cat?.name ?? ''}`);
      qno.textContent = `${S.askedCount(s)}번째 문제`;
      return;
    }
    replace(left, h('span.emoji', game.icon), ` ROUND ${s.roundIndex + 1} · `, h('span.emoji', cat?.icon ?? ''), ` ${cat?.name ?? ''}`);
    // 릴레이는 순위가 정해질 때까지 내므로 문제 수가 없다 (R-62)
    qno.textContent = relayOf(s) ? `Q ${s.questionIndex + 1}` : `Q ${s.questionIndex + 1} / ${s.picks[s.roundIndex].questionIds.length}`;
  }

  function render() {
    const s = app.session(gameId);
    if (!s) return;
    const now = S.currentQuestion(s);
    if (!now || now.key !== cur.key) return; // 다른 문제 — 라우터가 새 화면을 만든다
    const revealed = s.screen === 'answer' || s.screen === 'tiebreakAnswer';
    header(s);
    renderer?.set({ stage: s.stage, revealed });
    if (clip) {
      if (revealed && wasRevealed === false) clip.play();
      else if (!revealed && wasRevealed) clip.reset();
      else if (!revealed) clip.prepare();
    }
    wasRevealed = revealed;
    // 영상이 화면을 덮고 있는 동안은 정답 띠(정답 글자 · 맞힌 팀)를 띄우지 않는다
    const holdBand = !!clip?.covering();

    // 힌트 띠
    const wantHint = s.hintVisible && q?.hint;
    if (wantHint && !hintEl) { hintEl = h('div.hint-band', `💡 ${q.hint}`); main.append(hintEl); }
    if (!wantHint && hintEl) { hintEl.remove(); hintEl = null; }
    hintEl?.classList.toggle('top', revealed);

    // 정답 띠 + 맞힌 팀
    if (revealed && !answerEl && q && !holdBand) {
      const text = hideText ? null : h('div.answer-text', q.answer);
      creditEl = h('div.answer-credit');
      // 영상이 끝난 뒤면 영상을 걷어내는 동안(0.4초) 기다렸다가
      const delay = clip?.status().state === 'done' ? 0.4 : renderer?.revealDelay?.() ?? 0;
      answerEl = h(`div.answer-band${hideText ? '.credit-only' : ''}`, { style: { '--delay': `${delay}s` } }, text, creditEl);
      main.append(answerEl);
      if (text) requestAnimationFrame(() => fitText(text, { max: 150, min: 64, maxLines: 2 }));
      lastCredit = undefined;
    }
    if ((!revealed || holdBand) && answerEl) { answerEl.remove(); answerEl = null; creditEl = null; }
    const relay = tb ? null : S.relayStatus(s, game);
    if (creditEl) {
      const { scored, none } = replay(s.history);
      const t = scored.get(cur.key);
      const key = t !== undefined ? `t${t}r${relay?.scoredRep ?? ''}` : none.has(cur.key) ? 'none' : '';
      if (key !== lastCredit) {
        lastCredit = key;
        const team = t !== undefined ? app.teams()[t] : null;
        const per = app.perCorrect(s.gameId);
        // 릴레이 — 맞힌 사람과 그 대표가 맞힌 수 (R-94), 이 문제로 대표를 모두 내보냈으면 등수 확정 (R-62)
        const done = relay && team ? relay.finish.indexOf(t) : -1;
        const k = relay?.scoredRep ?? null;
        const n = k === null ? 0 : relay.reps[t][k];
        const who = k === null ? `${relay?.counts[t]}/${relay?.goal}`
          : `대표${k + 1}${relay.per > 1 ? ` ${n}/${relay.per}` : ''}${n >= relay.per ? ' · 빠짐' : ''}`;
        const what = !team ? '' : !relay ? `✔ ${team.name} +${per !== null && !cur.tb ? per : 1}`
          : done >= 0 && !relay.out.includes(t) ? [`✔ ${team.name} — `, rankLabel(done + 1), ' 확정'] : `✔ ${team.name} ${who}`;
        replace(creditEl, key === '' ? '' : h('span.pop', team ? h('span', { style: { color: team.color } }, what) : '정답자 없음'));
        if (hideText) answerEl.hidden = key === '';
      }
    }

    // 스코어보드
    const { scored } = replay(s.history);
    const dim = tb ? app.teams().map((_, i) => i).filter((i) => !S.tiebreakGroup(s).includes(i)) : [];
    // 릴레이 게임의 추가 문제는 동점이 된 게임 점수(라운드 배점 합)를 보인다 (R-62)
    const counts = tb && relayOf(s) ? relayScores(s) : teamCounts(s);
    bar.update(counts, revealed ? scored.get(cur.key) ?? null : null, dim, app.perCorrect(s.gameId), relay, s.screen === 'answer');
  }

  return {
    el,
    mounted: render,
    update: render,
    destroy() {
      asking?.cancel(); // 진행자 화면에서 넘겨 이 문제가 사라지면 확인창도 닫는다 (R-86)
      renderer?.destroy?.();
      if (clip) {
        clip.destroy();
        if (app.clipControl?.key === cur.key) app.clipControl = null;
        if (app.ui.clip?.key === cur.key) app.ui.clip = null;
      }
    },
    onKey(e) {
      const p = app.play;
      const s = app.session(gameId);
      const revealed = s.screen === 'answer' || s.screen === 'tiebreakAnswer';
      const c = e.code;
      // 정답 공개 · (공개 뒤) 다음은 Enter 만 — → · Space · PageDown 은 뺐다 (R-75 · R-82 · R-85)
      // ← · PageUp(이전)은 없앴다 (R-74)
      if (c === 'Enter' || c === 'NumpadEnter') { if (revealed) nextFromAnswer(); else p.reveal(); return true; }
      // Z · Shift+Z(힌트 단계) · H(힌트)는 없앴다 — 진행자 화면 [힌트 단계 ▶] · [◀] · [💡 힌트] 로 (R-78)
      // 1~4 · 0 · Shift+1~4(맞힌 팀 · 없음 · 득점 취소) · V · Shift+V(정답 영상)는 없앴다 — 진행자 화면 맞힌 팀 버튼 · [없음] · 영상 버튼으로 (R-81)
      // Backspace(되돌리기)는 없앴다 — 맞힌 팀은 진행자 화면 맞힌 팀 버튼 · [없음], 지난 문제는 [📝 정답 기록] (R-83)
      // N(한 문제 더)은 없앴다 — 진행자 화면 [한 문제 더 ▶] (R-85)
      // E(일찍 끝내기) · R(진행 초기화)은 없앴다 — 끝내기는 진행자 화면 [종료], 초기화는 게임 홈 [새로 시작] (R-80)
      return false;
    },
  };
}
