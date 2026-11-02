// 게임 진행 액션 — 키보드 · 진행자 명령 · 클릭이 모두 여기로 (docs/06-controls.md, docs/12-host-view.md 6-2)
import * as S from '../core/state.js';
import { ranking, replay, fillRows } from '../core/scoring.js';
import * as SB from '../core/scoreboard.js';
import { planSpin } from '../core/random.js';
import { creditTarget } from '../core/stats.js';
import { prefersReducedMotion } from './dom.js';

export function createPlayActions(app) {
  const ctx = () => {
    const gameId = app.route.view === 'play' ? app.route.gameId : null;
    return { gameId, game: gameId ? app.game(gameId) : null, s: gameId ? app.session(gameId) : null };
  };
  const ui = app.ui;

  /** 전이 결과 적용 — toast · error · goHome 처리 */
  function apply(gameId, res) {
    if (!res) return false;
    if (res.error) { app.toast(res.error); return false; }
    if (res.toast) app.toast(res.toast);
    if (res.goHome) { app.go({ view: 'gameHome', gameId }); return true; }
    if (res.session && res.session !== app.session(gameId)) {
      app.setSession(gameId, res.session);
      maybeAutoFill();
      return true;
    }
    return false;
  }

  // ── 룰렛 (docs/01-app-flow.md 5장) ──────────────────
  function rouletteState() {
    const { gameId, s } = ctx();
    const key = `${gameId}:${s?.picks.length}:${s?.screen}`;
    if (ui.roulette.key !== key) ui.roulette = { key, phase: 'setup', plan: null, resultId: null };
    return ui.roulette;
  }

  const actions = {
    rouletteState,

    /** 득점형 룰렛 화면인데 더 출제할 문제가 없다 — 룰렛 준비 대신 안내, Enter (진행자 [결과 보기 ▶]) 로 결과 */
    exhausted() {
      const { game, s } = ctx();
      return !!s && S.isScoring(s) && s.screen === 'roulette' && !S.anyRemaining(game, s);
    },

    /** 넣기 · 빼기 — 진행자 화면 목록에서 (R-72 — 게임 화면 키 · 목록은 없앰) */
    wheelToggle(categoryId) {
      const { gameId, game, s } = ctx();
      if (!s || s.screen !== 'roulette' || rouletteState().phase !== 'setup' || !categoryId) return false;
      return apply(gameId, S.toggleWheel(s, game, categoryId));
    },
    wheelAll() {
      const { gameId, game, s } = ctx();
      if (!s || s.screen !== 'roulette' || rouletteState().phase !== 'setup') return false;
      return apply(gameId, S.includeAll(s, game));
    },
    /** 돌리기 — targetId 는 진행자가 지정한 결과 (R-48, 원판 후보인지는 command 에서 먼저 확인). 없으면 무작위 */
    spin(targetId = null) {
      const { game, s } = ctx();
      const r = rouletteState();
      if (!s || s.screen !== 'roulette') return false;
      // 줄줄이 말해요는 원판이 없다 — 무작위 주제 (R-65 — 진행자 [🎲 무작위], 게임 창 키는 R-85 에서 없앰)
      if (s.type === 'roulette') return actions.pickTopic();
      if (actions.exhausted()) return actions.next();
      if (r.phase === 'stopped') return actions.respin();
      if (r.phase !== 'setup') return false;
      const cands = S.wheelCandidates(game, s);
      if (!cands.length) { app.toast(s.type === 'roulette' ? '주제를 1개 이상 넣으세요' : '카테고리를 1개 이상 넣으세요'); return false; }
      if (cands.length === 1) {
        Object.assign(r, { phase: 'stopped', plan: null, resultId: cands[0], wheel: cands });
      } else {
        const index = targetId === null ? null : cands.indexOf(targetId);
        const plan = planSpin(cands.length, { reducedMotion: prefersReducedMotion(), index });
        Object.assign(r, { phase: 'spinning', plan, resultId: cands[plan.index], wheel: cands });
      }
      app.render();
      return true;
    },
    spinDone() {
      const r = rouletteState();
      if (r.phase !== 'spinning') return;
      r.phase = 'stopped';
      app.render();
    },
    respin() {
      const r = rouletteState();
      if (r.phase !== 'stopped') return false;
      Object.assign(r, { phase: 'setup', plan: null, resultId: null });
      app.render();
      return true;
    },
    confirmSpin() {
      const { gameId, game, s } = ctx();
      const r = rouletteState();
      if (!s || s.screen !== 'roulette' || r.phase !== 'stopped' || !r.resultId) return false;
      return apply(gameId, S.confirmPick(s, game, r.resultId));
    },

    // ── 득점형 진행 (docs/07-state-model.md 5장) ───────
    next({ skipReveal = true } = {}) {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      if (s.screen === 'roulette') {
        if (actions.exhausted()) return apply(gameId, S.next(s, game));
        const r = rouletteState();
        if (r.phase === 'stopped') return actions.confirmSpin();
        return false;
      }
      if (s.screen === 'topic') return actions.topicNext();
      if (s.screen === 'question' && skipReveal === 'skip') {
        // 진행자 화면 [넘어가기] — 정답을 공개하지 않고 다음으로
        const revealed = S.reveal(s, game).session;
        return apply(gameId, S.next(revealed, game));
      }
      if (s.screen === 'result') {
        const res = S.next(s, game);
        return apply(gameId, res);
      }
      return apply(gameId, S.next(s, game));
    },
    /** 한 문제 더 — 라운드당 문제 수를 다 내도 (R-43 — 진행자 [한 문제 더 ▶], 게임 창 `N` 은 R-85 에서 없앰) */
    moreQuestion() {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      const res = S.moreQuestion(s, game);
      if (res.error) { app.toast(res.error); return false; }
      if (res.session === s) return false;
      return apply(gameId, res);
    },
    /** 한 라운드 더 — 계획한 라운드가 끝난 뒤에도 (R-40 — 진행자 [한 라운드 더 ▶], 게임 창 `Shift+N` 은 R-85 에서 없앰) */
    moreRound() {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      const res = S.moreRound(s, game);
      if (res.error) { app.toast(res.error); return false; }
      if (res.session === s) return false;
      return apply(gameId, res);
    },
    prev() {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      if (s.screen === 'roulette') {
        const r = rouletteState();
        if (r.phase === 'stopped') return actions.respin();
        if (r.phase === 'spinning') return false;
        if (s.type === 'roulette') return apply(gameId, S.topicPrev(s));
      }
      if (s.screen === 'topic') return apply(gameId, S.topicPrev(s));
      const res = S.prev(s, game);
      if (res.confirmCancelRound) {
        if (S.roundHasHistory(s, s.roundIndex)) { app.toast('이 라운드에 정답 기록이 있어 취소할 수 없습니다'); return false; }
        app.confirm({ title: '룰렛 결과 취소', message: '룰렛 결과를 취소하고 다시 추첨할까요?', ok: '다시 추첨' })
          .then((ok) => { if (ok) apply(gameId, S.cancelRound(app.session(gameId))); });
        return true;
      }
      return apply(gameId, res);
    },
    reveal() {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      return apply(gameId, S.reveal(s, game));
    },
    stage(dir) {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      return apply(gameId, S.stageStep(s, game, dir));
    },
    hint() {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      const cur = S.currentQuestion(s);
      const q = cur ? S.findQuestion(game, cur.id)?.question : null;
      if (q && !q.hint && !s.hintVisible) { app.toast('힌트가 없는 문제입니다'); return false; }
      return apply(gameId, S.toggleHint(s));
    },
    /** 정답 영상 (R-61) — play · pause · skip · toggle. 지금 문제 화면이 들고 있는 영상에. 되면 true, 아니면 이유 */
    clip(what) {
      const c = app.clipControl;
      if (!c) return '정답 영상이 있는 문제가 아닙니다';
      return c.run(what);
    },
    /** 맞힌 팀 — rep = 맞힌 대표 (팀당 대표 방식, R-94). 없으면(숫자키) 같은 팀은 그대로 · 다른 팀은 아직 안 빠진 첫 대표 */
    credit(team, rep = null) {
      const { gameId, s } = ctx();
      if (!s) return false;
      const res = S.credit(s, team, app.teamNames(), rep);
      if (res.ignored && res.toast) app.toast(res.toast);
      if (res.ignored) return false;
      if (res.session !== s && team !== null) ui.lastCredit = { team, at: Date.now() };
      return apply(gameId, res);
    },
    /** 지금 정답 화면의 문제에 맞힌 팀이나 [없음] 을 정했는지 — 안 정했으면 넘어가기 전에 묻는다 (게임 창 Enter R-86 · 진행자 R-87) */
    answerDecided() {
      const { s } = ctx();
      const cur = s && S.currentQuestion(s);
      if (!cur) return true;
      const { scored, none } = replay(s.history);
      return scored.has(cur.key) || none.has(cur.key);
    },
    // 되돌리기(게임 창 Backspace · score.undo)는 없앴다 — 화면과 상관없이 마지막 점수를 지웠다. 고치기는 진행자 [📝 정답 기록] (R-83)
    /** @param questionId 진행자가 고른 문제 (R-54) — 없으면 후보 중 무작위 (게임 창 `S` 는 R-85 에서 없앰) */
    tiebreak(questionId = null) {
      const { gameId, game, s } = ctx();
      if (!s || s.screen !== 'result') return false;
      const res = S.openTiebreak(s, game, questionId);
      if (res.error) return res.error;
      if (res.session === s) return false; // 열 수 없음 (모두 공개 전 · 동점 없음 · 낼 문제 없음)
      // 점수판 채우기는 순위가 정해진 뒤 다시 묻는다 — 열려 있던 창은 닫고, 취소했던 것도 다시 묻게 (T-27)
      ui.fill = null;
      if (res.session.scoreboardFill === 'skipped') res.session.scoreboardFill = null;
      return apply(gameId, res);
    },
    async end({ confirmed = false } = {}) {
      const { gameId, s } = ctx();
      if (!s) return false;
      if (s.type === 'roulette') return actions.finish();
      if (!['roulette', 'round', 'question', 'answer', 'roundEnd'].includes(s.screen)) return false;
      if (!confirmed && !(await app.confirm({ title: '게임 종료', message: '게임을 종료하고 결과를 볼까요?', ok: '종료' }))) return false;
      return apply(gameId, S.endEarly(app.session(gameId)));
    },

    /** 이모티콘 퀴즈 — 게임 화면 카테고리 카드 클릭으로 그 카테고리의 문제를 바로 (R-91). 문제는 문제 순서 옵션대로 */
    pickInCategory(categoryId) {
      const { gameId, game, s } = ctx();
      if (!s || !S.pickMode(s) || s.screen !== 'roulette') return false;
      return apply(gameId, S.pickInCategory(s, game, categoryId));
    },

    // ── 룰렛형 (docs/07-state-model.md 6장) ───────────
    /** 주제 고르기 (R-65) — 진행자가 고른 주제, 없으면 무작위. 문제가 있는 주제면 첫 문제까지 바로 */
    pickTopic(categoryId = null) {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      return apply(gameId, S.pickTopic(s, game, categoryId));
    },
    topicNext() {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      return apply(gameId, S.topicNext(s, game));
    },
    examples() {
      const { gameId, s } = ctx();
      if (!s) return false;
      return apply(gameId, S.toggleExamples(s));
    },
    /** 첫 문제 · 다음 문제 — 같은 주제에서 안 낸 문제 (R-44 — 진행자 화면, 게임 창 `N` 은 R-85 에서 없앰) */
    topicQuestion() {
      const { gameId, game, s } = ctx();
      if (!s) return false;
      return apply(gameId, S.topicQuestion(s, game));
    },
    /** 정답 후보 모니터 표시 (R-44) */
    answers() {
      const { gameId, s } = ctx();
      if (!s) return false;
      return apply(gameId, S.toggleAnswers(s));
    },
    finish() {
      const { gameId, s } = ctx();
      if (!s) return false;
      app.setSession(gameId, S.finishRoulette(s).session);
      app.go({ view: 'gameHome', gameId });
      return true;
    },

    // ── 종합 점수판 채우기 (D-18, docs/13-scoreboard.md 10장) ──
    fillOpen() {
      const { gameId, s } = ctx();
      if (!s || s.screen !== 'result' || !S.isScoring(s)) return false;
      const rows = fillRows(s, app.rounds());
      if (!rows.length) {
        app.toast('점수판에 연결된 라운드가 없습니다');
        if (s.scoreboardFill === null) apply(gameId, S.setFill(s, 'skipped'));
        return false;
      }
      // 같은 진행이 라운드마다 반영한 행은 덮어쓰기 경고 없음 (R-57)
      for (const r of rows) r.overwrite = !r.skip && SB.overwrites(app.scoreboard, r.round.id, gameId, s.startedAt);
      // 등수 행은 라운드별 등수 — 같은 라운드에서 정답 수가 같은 팀이 있으면 안내 (정답 수 행은 상관없음, R-49 · R-57)
      const tie = rows.some((r) => !r.skip && r.round.kind === 'rank' && r.byRound.some((rr) => rr && new Set(rr).size < rr.length));
      ui.fill = { open: true, mode: 'confirm', rows, tie };
      app.render();
      return true;
    },
    fillConfirm() {
      const { gameId, s } = ctx();
      const f = ui.fill;
      if (!s || !f?.open) return false;
      const s0 = app.session(gameId);
      app.setScoreboard(SB.applyFill(app.scoreboard, f.rows, gameId, S.localIso(), s0.startedAt), `${app.game(gameId).title} 결과`);
      ui.fill = null;
      // 모든 라운드를 넣었다 — 라운드 반영 기록도 모두 (R-57)
      const all = S.setReflected(s0, s0.picks.map((_, i) => i)).session;
      apply(gameId, S.setFill(all, 'filled'));
      app.toast(`종합 점수판에 채웠습니다 (${app.game(gameId).title})`);
      return true;
    },
    fillEdit() {
      if (!ui.fill?.open) return false;
      ui.fill = { ...ui.fill, mode: 'edit' };
      app.render();
      return true;
    },
    fillBack() {
      if (!ui.fill?.open) return false;
      ui.fill = { ...ui.fill, mode: 'confirm' };
      app.render();
      return true;
    },
    /** cells: 행마다 [{rank, value?}] · 정답 수 행은 [{count}] (건너뛴 행은 null) */
    fillApply(cells) {
      const f = ui.fill;
      if (!f?.open) return false;
      f.rows = f.rows.map((r, i) => (r.skip || !cells?.[i] ? r : {
        ...r,
        cells: cells[i].map((c, t) => (r.round.kind === 'count'
          ? { count: Number.isInteger(c.count) && c.count >= 0 ? c.count : 0 } // 정답 수 행 (R-49)
          // 등수 행 — 라운드별 등수는 그대로, 점수만 직접 수정 (R-57). 등수 하나로 보낸 칸(예전 창)은 그 등수
          : { ...(Number.isInteger(c.rank) ? { rank: c.rank } : { ranks: [...r.ranks[t]] }), ...(Number.isInteger(c.value) ? { value: c.value } : {}) })),
      }));
      return actions.fillConfirm();
    },
    /** 팀 점수에 반영 — 라운드 종료 화면에서 이번 라운드까지 종합 점수판에 (R-57 — 진행자 화면, 게임 창 `B` 는 R-85 에서 없앰) */
    reflect() {
      const { gameId, game, s } = ctx();
      if (!s || !S.isScoring(s) || s.screen !== 'roundEnd') return { ok: false };
      const pv = SB.reflectPreview(s, app.rounds(), app.scoreboard);
      if (!pv.fill.length) return { ok: false, message: '점수판에 연결된 라운드가 없습니다 — 종합 점수판에서 직접 입력하세요' };
      const n = s.roundIndex + 1;
      app.setScoreboard(SB.applyFill(app.scoreboard, pv.fill, gameId, S.localIso(), s.startedAt), `${game.title} R${n}`); // 추이 기록 이름 (R-58)
      apply(gameId, S.setReflected(s, pv.idxs)); // 모니터는 라운드 종료 화면 카드 아래 안내로 알린다 — 토스트 없음
      return { ok: true };
    },
    fillSkip() {
      const { gameId, s } = ctx();
      if (!s) return false;
      ui.fill = null;
      apply(gameId, S.setFill(s, 'skipped'));
      app.render();
      return true;
    },
  };

  /** 결과 모두 공개 직후 "점수판에 채울까요?" — 한 번만 */
  function maybeAutoFill() {
    const { gameId, s } = ctx();
    if (!s || s.screen !== 'result' || !S.isScoring(s) || ui.fill?.open) return;
    if (s.scoreboardFill !== null) return;
    if (s.resultRevealCount < ranking(s).groups.length) return;
    // 라운드 종료 화면에서 모두 반영했고 값이 같으면 다시 묻지 않는다 (R-57)
    const rows = fillRows(s, app.rounds()).filter((r) => !r.skip);
    const reflected = s.reflectedRounds ?? [];
    if (rows.length && s.picks.every((_, i) => reflected.includes(i)) && SB.rowsMatch(app.scoreboard, rows, s.snapshot.teamCount)) {
      apply(gameId, S.setFill(s, 'filled')); // 모니터 토스트 없음 — 진행자 화면 결과 카드에 표시
      return;
    }
    actions.fillOpen();
  }
  actions.maybeAutoFill = maybeAutoFill;

  // ── 진행자 명령 → 같은 액션 (docs/07-state-model.md 11장) ──
  actions.command = async (cmd) => {
    const { s } = ctx();
    if (cmd.basedOn !== null && cmd.basedOn !== undefined && cmd.basedOn !== app.live.seq) {
      return { ok: false, message: '화면이 바뀌어 적용하지 않았습니다' };
    }
    const a = cmd.args ?? {};
    const screen = s?.screen;
    // 줄줄이 말해요는 원판이 없다 — 주제는 topic.pick 으로 (R-65)
    if (s?.type === 'roulette' && cmd.cmd.startsWith('roulette.')) return { ok: false, message: '줄줄이 말해요는 룰렛 없이 진행자가 주제를 고릅니다' };
    // 이모티콘 퀴즈도 원판이 없다 — 문제는 question.pick 으로 (R-90)
    if (S.pickMode(s) && cmd.cmd.startsWith('roulette.')) return { ok: false, message: '이모티콘 퀴즈는 룰렛 없이 진행자가 문제를 고릅니다' };
    switch (cmd.cmd) {
      case 'roulette.toggle': return { ok: actions.wheelToggle(a.categoryId) };
      case 'roulette.all': return { ok: actions.wheelAll() };
      case 'roulette.spin': {
        if (a.categoryId === undefined || a.categoryId === null) return { ok: actions.spin() };
        // 결과 지정 (R-48) — 룰렛 준비 · 원판 후보일 때만. 아니면 무작위로 바꿔 돌리지 않고 거절, 이유는 진행자 화면에만 (D-27)
        const { game } = ctx();
        if (!s || screen !== 'roulette' || rouletteState().phase !== 'setup' || actions.exhausted()) return { ok: false };
        if (!S.wheelCandidates(game, s).includes(a.categoryId)) {
          return { ok: false, message: `지정한 ${s.type === 'roulette' ? '주제' : '카테고리'}가 원판에 없습니다 — 다시 고르세요` };
        }
        return { ok: actions.spin(a.categoryId) };
      }
      case 'roulette.confirm': return { ok: actions.confirmSpin() };
      case 'roulette.respin': return { ok: actions.respin() };
      case 'round.start': return { ok: screen === 'round' && actions.next() };
      case 'answer.credit':
        if (screen !== 'answer' && screen !== 'tiebreakAnswer') return { ok: false, message: '정답 공개 후에 맞힌 팀을 고를 수 있습니다' };
        return { ok: actions.credit(a.team ?? null, a.rep ?? null) || true };
      case 'question.reveal': return { ok: (screen === 'question' || screen === 'tiebreakQuestion') && actions.reveal() };
      case 'question.next':
        // 맞힌 팀 확인 뒤 다시 온 명령 — 그 사이 다른 문제 · 화면이 됐으면 또 넘기지 않는다 (R-87)
        if (a.key !== undefined && a.key !== (s && S.currentQuestion(s)?.key)) return { ok: false, message: '이미 다음으로 넘어갔습니다' };
        if (screen === 'question' && !a.skipReveal) return { ok: false, needConfirm: 'skipReveal', message: '정답을 공개하지 않고 넘어갈까요?' };
        // 정답 화면에서 맞힌 팀도 [없음] 도 안 정했으면 진행자 화면에서 한 번 묻는다 (R-87)
        if ((screen === 'answer' || screen === 'tiebreakAnswer') && !a.noCredit && !actions.answerDecided()) {
          return { ok: false, needConfirm: 'noCredit', message: '맞힌 팀(정답자)을 체크하지 않았습니다. 이대로 다음으로 넘어갈까요?' };
        }
        if (screen === 'question') return { ok: actions.next({ skipReveal: 'skip' }) };
        // 라운드 마지막 정답 → 라운드 종료 화면, 라운드 종료 화면 → 다음 라운드 · 결과 (R-56)
        if (screen === 'answer' || screen === 'round' || screen === 'roundEnd' || screen === 'tiebreakAnswer') return { ok: actions.next() };
        if (screen === 'roulette' && actions.exhausted()) return { ok: actions.next() }; // 더 출제할 문제가 없음 → 결과
        return { ok: false };
      case 'question.more': {
        // 한 문제 더 (R-43) — 거절 이유는 진행자 화면에만
        const { gameId, game } = ctx();
        if (!s) return { ok: false };
        const res = S.moreQuestion(s, game);
        if (res.error) return { ok: false, message: res.error };
        if (res.session === s) return { ok: false, message: '라운드 마지막 문제의 정답 화면에서만 됩니다' };
        apply(gameId, res);
        return { ok: true };
      }
      case 'round.more': {
        // 한 라운드 더 (R-40) — 거절 이유는 진행자 화면에만
        const { gameId, game } = ctx();
        if (!s) return { ok: false };
        const res = S.moreRound(s, game);
        if (res.error) return { ok: false, message: res.error };
        if (res.session === s) return { ok: false, message: '라운드 종료 화면에서만 됩니다' };
        apply(gameId, res);
        return { ok: true };
      }
      // 라운드로 돌아가기 — 라운드 종료 화면에서 마지막 문제 정답 화면으로 (R-56, 키 `←`)
      case 'round.back': return { ok: screen === 'roundEnd' && actions.prev() };
      // 팀 점수에 반영 (R-57, 키 `B`) — 거절 이유는 진행자 화면에만
      case 'round.reflect': return actions.reflect();
      case 'history.credit': {
        // 정답 기록 고치기 (R-60) — 진행자 화면에만. 화면은 그대로 · 모니터 토스트 없음, 거절 이유는 진행자 화면에만
        const { gameId, game } = ctx();
        if (!s || !S.isScoring(s)) return { ok: false };
        const target = creditTarget(s, game, a.questionId);
        if (target.error) return { ok: false, message: target.error };
        const res = S.setCredit(s, a.questionId, a.team ?? null, { group: target.group, rep: a.rep ?? null, teamNames: app.teamNames() });
        if (res.error) return { ok: false, message: res.error };
        // 결과 화면에서 바뀌면 순위가 다시 정해진 뒤 채우기를 묻는다 — 열려 있던 채우기 창은 닫는다
        if (res.session !== s && s.screen === 'result') ui.fill = null;
        apply(gameId, res);
        return { ok: true };
      }
      case 'question.stage': return { ok: actions.stage(a.dir === -1 ? -1 : 1) };
      case 'question.hint': return { ok: actions.hint() };
      // 정답 영상 (R-61) — 진행자 화면 [영상 다시 재생] · [일시정지] · [영상 끝내기]. 거절 이유는 진행자 화면에만
      case 'clip.play': case 'clip.pause': case 'clip.skip': {
        const r = actions.clip(cmd.cmd.slice(5));
        return r === true ? { ok: true } : { ok: false, message: r };
      }
      case 'question.pick': {
        // 이모티콘 퀴즈 문제 고르기 (R-90) — 진행자 화면 [내기]. 거절 이유는 진행자 화면에만
        if (!s || !S.pickMode(s)) return { ok: false, message: '진행자가 문제를 고르는 게임이 아닙니다' };
        // 맞힌 팀 확인 뒤 다시 온 명령 — 그 사이 다른 문제 · 화면이 됐으면 내지 않는다 (R-87 과 같음)
        if (a.key !== undefined && a.key !== (S.currentQuestion(s)?.key ?? null)) return { ok: false, message: '이미 다음으로 넘어갔습니다' };
        if (screen === 'answer' && !a.noCredit && !actions.answerDecided()) {
          return { ok: false, needConfirm: 'noCredit', message: '맞힌 팀(정답자)을 체크하지 않았습니다. 이대로 다음 문제를 낼까요?' };
        }
        const { gameId, game } = ctx();
        const res = S.pickQuestion(s, game, typeof a.questionId === 'string' ? a.questionId : null);
        if (res.error) return { ok: false, message: res.error };
        return { ok: apply(gameId, res) };
      }
      case 'question.setNext': {
        // 다음 문제 지정 (R-35 · 라운드 밖 후보 R-52) — 진행자 화면에만 있는 명령. 거절 이유는 진행자 화면에만 (모니터 토스트 없음)
        if (!s) return { ok: false };
        if (S.pickMode(s)) return { ok: false, message: '이모티콘 퀴즈는 문제 목록의 [내기] 로 다음 문제를 고릅니다' };
        const res = S.setNextQuestion(s, a.questionId, ctx().game);
        if (res.error) return { ok: false, message: res.error };
        apply(ctx().gameId, res);
        return { ok: true };
      }
      case 'game.end': return { ok: await actions.end({ confirmed: true }) };
      case 'result.next': return { ok: screen === 'result' && actions.next() };
      case 'result.tiebreak': {
        // 진행자가 고른 추가 문제 (R-54) — 후보가 아니면 거절, 이유는 진행자 화면에만
        const r = actions.tiebreak(typeof a.questionId === 'string' ? a.questionId : null);
        return typeof r === 'string' ? { ok: false, message: r } : { ok: r };
      }
      case 'result.fillOpen': return { ok: actions.fillOpen() };
      case 'result.fill':
        if (!ui.fill?.open) actions.fillOpen();
        if (a.mode === 'edit' && Array.isArray(a.cells)) return { ok: actions.fillApply(a.cells) };
        return { ok: actions.fillConfirm() };
      case 'result.fillSkip': return { ok: actions.fillSkip() };
      case 'topic.pick': {
        // 주제 고르기 (R-65) — categoryId 가 없으면 무작위. 거절 이유는 진행자 화면에만
        const { gameId, game } = ctx();
        if (!s || s.type !== 'roulette' || screen !== 'roulette') return { ok: false, message: '주제를 고르는 화면이 아닙니다' };
        const res = S.pickTopic(s, game, typeof a.categoryId === 'string' ? a.categoryId : null);
        if (res.error) return { ok: false, message: res.error };
        return { ok: apply(gameId, res) };
      }
      case 'topic.next': return { ok: actions.topicNext() };
      case 'topic.examples': return { ok: actions.examples() };
      case 'topic.question': {
        // 첫 문제 · 다음 문제 (R-44) — 거절 이유는 진행자 화면에만
        const { gameId, game } = ctx();
        if (!s || s.screen !== 'topic') return { ok: false };
        // questionId 가 있으면 진행자 화면 목록의 [내기] (R-45)
        const res = S.topicQuestion(s, game, typeof a.questionId === 'string' ? a.questionId : null);
        if (res.error) return { ok: false, message: res.error };
        return { ok: apply(gameId, res) };
      }
      // 줄줄이 말해요 문제 · 정답 후보는 진행자 화면에만 — 모니터에 띄우지 않는다 (R-65)
      case 'topic.answers': return { ok: false, message: '문제 · 정답 후보는 진행자 화면에만 보입니다' };
      default: return { ok: false, message: '모르는 명령입니다' };
    }
  };

  return actions;
}

export { replay };
