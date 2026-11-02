// 진행 상태 보고 · 진행자 명령 받기 (docs/07-state-model.md 10 · 11장, docs/12-host-view.md 6장)
import * as S from '../core/state.js';
import { replay, ranking, teamCounts, roundCounts, revealOrder, relayOf, relayPerOf, relayScores, roundRanksAt } from '../core/scoring.js';
import { reflectPreview } from '../core/scoreboard.js';
import { questionLog } from '../core/stats.js';
import { getSession } from './session.js';

export const clientId = `g-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/** 게임 창 상태 → 진행자용 상태 (id 와 상태값만 — 정답 텍스트는 서버가 데이터에서 붙인다) */
function snapshot(app) {
  const r = app.route;
  const s = r.view === 'play' ? app.session(r.gameId) : null;
  const game = s ? app.game(r.gameId) : null;
  // 득점형 진행 중에는 그 판의 팀만 (세션에 고정된 팀 수 — 끝난 게임을 다시 열었을 때도 버튼 · 표가 맞게)
  const teams = (s && game && S.isScoring(s) ? app.sessionTeams(s) : app.teams()).map((t) => ({ name: t.name, color: t.color }));
  const base = { v: 1, clientId, view: r.view, gameId: r.gameId ?? null, teams, lastCommand: app.live.lastCommand };
  if (!s || !game) return base;
  const out = { ...base, type: s.type, screen: s.screen, status: s.status, roulettePhase: null, wheelList: null, spinResult: null };
  if (s.screen === 'roulette') {
    const rs = app.play.rouletteState();
    out.roulettePhase = rs.phase;
    out.wheelList = S.wheelList(game, s);
    out.spinResult = rs.phase === 'stopped' ? rs.resultId : null;
    out.roundNo = s.picks.length + 1;
    out.plannedRounds = s.snapshot.options.rounds; // 계획값 — 넘어서도 된다 (R-40)
  }
  if (s.type === 'roulette') {
    out.picks = s.picks.map((p) => ({ categoryId: p.categoryId }));
    out.topicId = s.screen === 'topic' ? s.picks.at(-1)?.categoryId ?? null : null;
    out.examplesVisible = !!s.examplesVisible;
    if (out.topicId) {
      // 주제별 문제 (R-44) — id 만. 문제 글자 · 정답 후보는 서버가 데이터에서 붙인다
      const c = S.findCategory(game, out.topicId);
      out.topicQuestionIds = [...(s.picks.at(-1)?.questionIds ?? [])];
      out.topicQuestionId = S.topicQuestionId(s);
      out.topicRemaining = c && S.usableQuestions(c).length ? S.remainingQuestions(game, s, c.id).length : null;
      out.answersVisible = !!s.answersVisible;
      // 진행자가 골라 내는 목록 (R-45) — id 와 상태만 (데이터 순서, 숨김 제외)
      const used = S.usedQuestionIds(s);
      out.topicList = c ? S.usableQuestions(c).map((q) => ({ id: q.id, state: q.id === out.topicQuestionId ? 'current' : used.has(q.id) ? 'asked' : 'left' })) : [];
      out.topicNextId = S.topicNextId(game, s);
      out.questionOrder = S.topicOrder(s);
    }
    return out;
  }
  const { scored, none } = replay(s.history);
  out.picks = s.picks.map((p) => ({ categoryId: p.categoryId, questionIds: p.questionIds }));
  out.roundIndex = s.roundIndex;
  out.questionIndex = s.questionIndex;
  out.scores = teamCounts(s, scored);
  // 릴레이 (R-62) — 팀당 대표 수 · 게임 점수(라운드 배점 합, 결과 순위). 정답 1개당 점수는 쓰지 않는다
  const relay = relayOf(s);
  out.relayReps = relay || null;
  out.gamePoints = relay ? relayScores(s, scored) : null;
  out.per = relay ? null : app.perCorrect(s.gameId); // 정답 1개당 점수 — 있으면 진행자 화면도 점수로 (R-49)
  out.hintVisible = s.hintVisible;
  out.stage = s.stage;
  const cur = S.currentQuestion(s);
  out.questionId = cur?.key ?? null;
  out.revealed = s.screen === 'answer' || s.screen === 'tiebreakAnswer';
  // 정답 영상 (R-61) — 재생 상태 + 이 창이 클릭 · 키를 받았는지 (받기 전에는 브라우저가 소리를 막을 수 있다)
  if (app.ui.clip && app.ui.clip.key === out.questionId) {
    const { key, ...clip } = app.ui.clip;
    out.clip = { ...clip, soundReady: navigator.userActivation?.hasBeenActive ?? null };
  }
  if (cur) {
    const q = S.findQuestion(game, cur.id)?.question;
    const range = S.stageRange(q, s.type);
    out.stageFinal = range.final;
    out.stageInitial = range.initial;
    out.scoredTeam = scored.get(cur.key) ?? null;
    out.noneMarked = none.has(cur.key);
  }
  // 이모티콘 퀴즈 — 진행자가 고를 문제 (R-90). 문제 고르기 · 문제 · 정답 화면에서, id 만 (이모지 · 정답은 서버가 붙인다)
  if (S.pickMode(s)) {
    out.pickMode = true;
    out.askedCount = S.askedCount(s);
    out.pickChoices = ['roulette', 'question', 'answer'].includes(s.screen) ? S.pickChoices(game, s) : [];
  }
  // 이모티콘 퀴즈의 문제 · 정답 화면에는 라운드 목록 · 라운드 종료 안내가 없다 (R-90 — 예전 진행에서 이어 온 라운드 소개 · 라운드 종료는 그대로)
  const roundless = S.pickMode(s) && (s.screen === 'question' || s.screen === 'answer');
  if (['round', 'question', 'answer', 'roundEnd'].includes(s.screen) && s.picks[s.roundIndex] && !roundless) {
    out.roundQuestionIds = s.picks[s.roundIndex].questionIds;
    out.roundScored = out.roundQuestionIds.map((q) => scored.get(q) ?? null);
    // 라운드에 안 뽑힌 후보 (R-52) — 같은 카테고리에서 이 게임에 아직 안 낸 문제. id 만 (정답은 서버가 붙인다). 라운드 종료 화면은 목록이 없다
    if (s.screen !== 'roundEnd') out.roundCandidateIds = S.remainingQuestions(game, s, s.picks[s.roundIndex].categoryId).map((q) => q.id);
    // 라운드 마지막 문제 — 정답 화면이면 진행자 화면에 라운드 종료 안내 (R-56)
    out.isLastInRound = s.questionIndex + 1 >= out.roundQuestionIds.length;
    // 릴레이 (R-62) — 맞힌 대표 수 · 다 내보낸 순서 · 이 문제에 못 나오는 팀. 라운드 종료 안내는 한 팀만 남았거나 낼 문제가 없을 때
    out.relay = S.relayStatus(s, game);
    out.roundEnding = out.relay ? out.relay.ending : out.isLastInRound;
    out.isLastRound = s.picks.length >= s.snapshot.options.rounds;
    out.plannedRounds = s.snapshot.options.rounds;
    // 한 문제 더 (R-43) — 라운드당 문제 수는 계획값. 지금 라운드 마지막 정답 화면, 같은 카테고리에 안 낸 문제가 있을 때
    // 한 라운드 더 (R-40) — 계획한 라운드를 다 한 라운드 종료 화면, 남은 문제가 있을 때 (R-56)
    out.canMoreQuestion = s.screen === 'answer' && out.isLastInRound && s.roundIndex === s.picks.length - 1 && S.remainingQuestions(game, s, s.picks[s.roundIndex].categoryId).length > 0;
    out.canMoreRound = s.screen === 'roundEnd' && out.isLastRound && S.anyRemaining(game, s);
    // 라운드 종료 화면 — 이번 라운드 팀별 정답 수 (누적은 scores)
    if (s.screen === 'roundEnd') {
      out.roundScores = roundCounts(s, scored)[s.roundIndex];
      // 종합 점수판 반영 미리보기 (R-57) — 행마다 팀별 이번 라운드 등수 · 정답 수 · 더하는 점수, 반영 여부 · 달라짐, 반영 뒤 합계
      const pv = reflectPreview(s, app.rounds(), app.scoreboard);
      out.reflect = {
        rows: pv.rows.map((r) => ({ name: r.round.name, kind: r.round.kind, per: r.round.per ?? null, skip: r.skip ?? null, overwrite: r.overwrite, cells: r.cells })),
        done: pv.done, stale: pv.stale, totalsNow: pv.totalsNow, totalsAfter: pv.totalsAfter, ranksAfter: pv.ranksAfter, added: pv.added,
      };
    }
  }
  // 정답 기록 고치기 목록 (R-60) — 이 게임에서 낸 문제만, id 와 상태만 (정답은 서버가 붙인다)
  const log = questionLog(s, game);
  out.creditLog = {
    // 팀당 대표 방식이면 라운드 문제는 맞힌 대표까지 고친다 (R-94)
    reps: relayOf(s) ? { relay: relayOf(s), per: relayPerOf(s) } : null,
    rounds: log.rounds.map((r) => ({ index: r.index, categoryId: r.categoryId, counts: r.counts, questions: r.questions.map(({ id, n, team, rep, none, live }) => ({ id, n, team, rep, none, live })) })),
    tiebreak: log.tiebreak.map(({ id, n, group, team, none, live }) => ({ id, n, group, team, none, live })),
  };
  if (s.screen === 'tiebreakQuestion' || s.screen === 'tiebreakAnswer') out.tiebreakGroup = S.tiebreakGroup(s);
  if (s.screen === 'result' || s.screen.startsWith('tiebreak')) {
    const rank = ranking(s, scored);
    const allRevealed = s.resultRevealCount >= rank.groups.length;
    out.result = {
      counts: rank.counts, ranks: rank.ranks, decided: rank.decided,
      revealCount: s.resultRevealCount, groupCount: rank.groups.length,
      allRevealed,
      revealedTeams: revealOrder(rank).slice(0, s.resultRevealCount).flatMap((g) => g.teams),
      ties: rank.ties.map((g) => g.teams),
      tiebreakAvailable: S.tiebreakPool(game, s).length > 0,
      // 추가 문제 고르기 (R-54) — 모두 공개 · 동점 · 점수를 주지 않는 게임에서만, id 만 (정답은 서버가 붙인다)
      tiebreakChoices: s.screen === 'result' && allRevealed && rank.ties.length > 0 && out.per === null ? S.tiebreakChoices(game, s) : [],
      perRound: roundCounts(s, scored).map((counts, i) => ({ categoryId: s.picks[i].categoryId, counts, ...(relay ? { ranks: roundRanksAt(s, i, scored) } : {}) })),
      fillState: s.scoreboardFill,
    };
  }
  const f = app.ui.fill;
  out.fill = f?.open ? {
    mode: f.mode, tie: f.tie,
    rows: f.rows.map((row) => ({
      roundId: row.round.id, name: row.round.name, skip: row.skip ?? null, overwrite: !!row.overwrite,
      points: row.round.points ?? [], ranks: row.ranks ?? null, // 등수 행은 팀마다 라운드별 등수 목록 (R-57)
      kind: row.round.kind, per: row.round.per ?? null, counts: row.counts ?? null, // 정답 수 행 (R-49)
    })),
  } : null;
  return out;
}

export function startLive(app) {
  let lastJson = '';
  let sendTimer = null;
  let es = null;
  // 끊겼다 다시 붙을 때 (docs/08-tech.md 11-4) — 마지막으로 받은 알림 번호, 서버가 먼저 끊었는지(bye), 실행한 명령 id
  let lastId = null;
  let bye = false;
  const done = new Set();
  const seen = (ev) => { if (ev.lastEventId !== '') lastId = Number(ev.lastEventId); };

  async function send(body) {
    try {
      const res = await fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1' }, body: JSON.stringify(body) });
      // 서버 모드: 같은 브라우저의 진행자 화면에서 [나가기] 했거나 PIN 이 바뀜 → PIN 화면으로 (저장 대기분은 브라우저 사본에 남는다)
      if (res.status === 401) authLost();
    } catch { /* 서버 끊김 — 재연결 후 다시 보냄 */ }
  }

  let lastKey = '';
  /**
   * seq 는 화면 · 문제 · 점수가 바뀔 때만 올린다 (명령 결과 · 정답 영상 재생 상태는 제외) — 진행자 명령의 basedOn 비교용.
   * 보내기(100ms 묶음)를 기다리지 않고 명령을 받을 때도 맞춘다 — 연타한 두 번째 명령이 낡은 basedOn 으로 통과하지 않게 (W-16)
   */
  function syncSeq() {
    const snap = snapshot(app);
    const key = JSON.stringify({ ...snap, lastCommand: null, clip: null });
    if (key !== lastKey) { lastKey = key; app.live.seq += 1; }
    return snap;
  }
  function flush() {
    sendTimer = null;
    const snap = syncSeq();
    const json = JSON.stringify(snap);
    if (json === lastJson && !forceNext) return;
    forceNext = false;
    lastJson = json;
    send({ ...snap, seq: app.live.seq, sentAt: Date.now() });
  }
  let forceNext = true;

  app.publish = () => {
    if (sendTimer || stopped) return;
    sendTimer = setTimeout(flush, 100);
  };
  const beat = setInterval(() => { forceNext = true; app.publish(); }, 30_000);
  // 이 창이 처음 클릭 · 키를 받으면 진행자 화면의 "영상 소리가 막힐 수 있음" 경고를 바로 지운다 (R-61)
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => app.publish(), { once: true });

  // 이 창을 멈춘다 — 다른 창이 닫음(kick) · 막기 중이라 거절(blocked) (docs/12-host-view.md 6-3, R-46)
  let stopped = false;
  function stop(kind) {
    if (stopped) return;
    stopped = true;
    es?.close();
    clearTimeout(retry);
    clearTimeout(sendTimer);
    clearInterval(beat);
    app.stopped = kind;
    app.render = () => {};
    app.onStopped?.(kind);
  }

  function connect() {
    if (stopped) return;
    es?.close();
    // 브라우저가 스스로 다시 붙으면 Last-Event-ID 를 보내고, 새로 여는 연결은 last= 로 — 끊긴 사이의 명령을 받는다
    es = new EventSource(`/api/live/commands?clientId=${clientId}${lastId !== null ? `&last=${lastId}` : ''}`);
    es.addEventListener('hello', (ev) => {
      seen(ev);
      app.store.reconnect();
      app.setConn(app.store.status());
      forceNext = true;
      app.publish();
    });
    es.addEventListener('command', async (ev) => {
      seen(ev);
      const cmd = JSON.parse(ev.data);
      // 다시 붙을 때 다시 온 명령은 한 번만
      if (cmd.id) {
        if (done.has(cmd.id)) return;
        done.add(cmd.id);
        if (done.size > 200) done.delete(done.values().next().value);
      }
      syncSeq();
      const res = await app.play.command(cmd);
      app.live.lastCommand = { id: cmd.id, ok: !!res.ok, message: res.message ?? null, needConfirm: res.needConfirm ?? null };
      forceNext = true;
      app.render();
      app.publish();
    });
    es.addEventListener('reload', (ev) => {
      seen(ev);
      const info = JSON.parse(ev.data);
      if (info.kind === 'state') app.store.handleReload(info);
      else if (info.kind === 'data') app.onDataReload(info);
    });
    es.addEventListener('kick', () => stop('kick'));
    // 서버가 실행 시간 상한 전에 먼저 끊음 (Vercel) — 곧바로 다시 붙으므로 끊김으로 보이지 않게
    es.addEventListener('bye', () => { bye = true; });
    es.addEventListener('blocked', () => stop('blocked'));
    es.addEventListener('lock', (ev) => {
      seen(ev);
      app.ui.lockOthers = !!JSON.parse(ev.data).on;
      app.render();
    });
    es.addEventListener('hosts', (ev) => {
      seen(ev);
      app.ui.hosts = JSON.parse(ev.data).count ?? 0;
      app.render();
    });
    es.onerror = () => {
      if (stopped) return;
      if (bye) {
        bye = false;
        if (es.readyState === 2) connect(); // 보통은 브라우저가 스스로 다시 붙는다
        return;
      }
      app.setConn({ ...app.store.status(), online: false }, 'stream');
      // 네트워크 끊김은 브라우저가 알아서 다시 붙지만, 오류 응답(비상용 python 서버의 404 등)으로 닫히면 직접 다시 연결
      if (es.readyState === 2) { clearTimeout(retry); retry = setTimeout(reconnect, 3000); }
    };
  }
  // 서버 모드에서 입장 쿠키가 무효가 되면(PIN 변경 · [나가기]) 새로고침 → PIN 화면 (docs/08-tech.md 11-2)
  async function authLost() {
    const s = await getSession();
    if (!s.server || s.loggedIn) return false;
    location.reload();
    return true;
  }
  async function reconnect() {
    if (!(await authLost())) connect();
  }
  let retry = null;
  connect();

  // 창을 닫거나 새로고침할 때 — 서버에 알려 연결 표시를 바로 지운다 (Vercel 은 닫힌 연결을 서버가 모른다 — docs/08-tech.md 11-4)
  window.addEventListener('pagehide', () => {
    if (stopped) return;
    es?.close();
    fetch('/api/live/leave', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1' }, body: JSON.stringify({ clientId }) }).catch(() => {});
  });
  // 뒤로 가기 캐시에서 돌아오면 다시 붙는다
  window.addEventListener('pageshow', (e) => { if (e.persisted && !stopped) connect(); });
}
