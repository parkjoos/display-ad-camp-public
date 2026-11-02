// 룰렛 결과 지정 테스트 (R-48, docs/12-host-view.md 4-8) — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planSpin, randomBetween } from '../app/core/random.js';
import { validateGame } from '../app/core/validate.js';
import * as S from '../app/core/state.js';
import { sliceAt, spinEnd } from '../app/ui/wheel.js';
import { createPlayActions } from '../app/ui/play-actions.js';

globalThis.window ??= {}; // prefersReducedMotion — matchMedia 없으면 움직임 줄이기 아님

function photoGame(count) {
  return validateGame({
    schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진',
    categories: Array.from({ length: count }, (_, k) => ({
      id: `c${k}`, name: `카테고리${k}`,
      questions: [0, 1].map((i) => ({ id: `c${k}-q${i}`, answer: `답${k}${i}`, image: `assets/photo-quiz/c${k}/c${k}-q${i}.jpg` })),
    })),
  }, { fileId: 'photo-quiz' }).game;
}

function chainGame() {
  return validateGame({
    schemaVersion: 1, id: 'chain-talk', type: 'roulette', title: '줄줄이 말해요',
    categories: ['idiom', 'snack', 'girl', 'dang'].map((id) => ({ id, name: id, rule: `${id} 말하기`, examples: ['예'] })),
  }, { fileId: 'chain-talk' }).game;
}

/** 게임 화면 흉내 — 진행 액션이 쓰는 것만 */
function gameScreen(game, session) {
  const sessions = { [game.id]: session };
  const app = {
    route: { view: 'play', gameId: game.id },
    game: () => game,
    session: (id) => sessions[id],
    setSession: (id, s) => { sessions[id] = s; },
    ui: { roulette: {} },
    live: { seq: 1 },
    toasts: [],
    toast: (m) => app.toasts.push(m),
    render: () => {},
    go: () => {},
  };
  app.play = createPlayActions(app);
  app.cmd = (cmd, args = {}) => app.play.command({ id: 'h1', cmd, args, basedOn: null });
  return app;
}

const scoreSession = (game, candidates = game.categories.map((c) => c.id)) => S.createScoreSession({
  game, teamCount: 3, options: { rounds: 3, questionsPerRound: 1, questionOrder: 'random' }, candidates,
});

test('회전 계획 — 지정한 조각 · 원판 밖 지정은 무작위로 바꾸지 않음 (R-48)', async () => {
  for (let i = 0; i < 6; i++) {
    const plan = planSpin(6, { index: i });
    assert.equal(plan.index, i);
    assert.ok(plan.offset >= 0.15 && plan.offset <= 0.85 && plan.turns >= 4 && plan.duration >= 4000 && plan.duration <= 6000, '나머지는 그대로 무작위');
  }
  for (const bad of [-1, 6, 1.5, '2']) assert.throws(() => planSpin(6, { index: bad }), RangeError, String(bad));
  const free = planSpin(6, { index: null });
  assert.ok(free.index >= 0 && free.index < 6);
});

test('원판 각도 — 조각 수 · 이전 각도와 상관없이 정한 조각에 멈춤 (W-39, D-13)', async () => {
  for (let n = 2; n <= 60; n++) {
    const slice = 360 / n;
    for (let index = 0; index < n; index++) {
      for (const start of [0, -randomBetween(0, 360), randomBetween(0, 360 * 40)]) {
        const plan = { ...planSpin(n), index };
        const end = spinEnd(start, plan, n);
        assert.equal(sliceAt(end, n), index, `n=${n} index=${index} start=${start}`);
        assert.equal(sliceAt(end % 360, n), index, '정지 뒤 각도 (360 단위로 줄임)');
        assert.ok(end - start >= plan.turns * 360, '최소 바퀴');
        // 조각 경계에 걸치지 않음 — 조각 폭의 15~85%
        const inSlice = (((-end % 360) + 360) % 360) - index * slice;
        assert.ok(inSlice >= slice * 0.15 - 1e-9 && inSlice <= slice * 0.85 + 1e-9, `경계 n=${n}`);
      }
    }
  }
});

test('결과 지정 명령 — 원판이 몇 개든 지정한 카테고리 → 확정까지 (W-38, W-39)', async () => {
  for (const n of [2, 3, 6, 14]) {
    const game = photoGame(n);
    for (const c of game.categories) {
      const app = gameScreen(game, scoreSession(game));
      assert.deepEqual(await app.cmd('roulette.spin', { categoryId: c.id }), { ok: true });
      const r = app.play.rouletteState();
      assert.equal(r.phase, 'spinning');
      assert.equal(r.resultId, c.id, `${n}개 중 ${c.id}`);
      assert.equal(r.wheel[r.plan.index], c.id, '원판이 멈출 조각');
      app.play.spinDone();
      assert.equal((await app.cmd('roulette.confirm')).ok, true);
      assert.equal(app.session(game.id).picks.at(-1).categoryId, c.id);
      assert.deepEqual(app.toasts, [], '모니터 토스트 없음');
    }
  }
});

test('결과 지정 거절 — 원판에 없거나 룰렛 준비가 아니면 무작위로 돌리지 않음 (W-42, D-27)', async () => {
  const game = photoGame(6);
  // 빠진 카테고리
  let app = gameScreen(game, scoreSession(game, ['c0', 'c1', 'c2']));
  let res = await app.cmd('roulette.spin', { categoryId: 'c4' });
  assert.equal(res.ok, false);
  assert.equal(res.message, '지정한 카테고리가 원판에 없습니다 — 다시 고르세요');
  assert.equal(app.play.rouletteState().phase, 'setup', '돌지 않음');
  assert.deepEqual(app.toasts, [], '이유는 진행자 화면에만');
  // 없는 id
  assert.equal((await app.cmd('roulette.spin', { categoryId: 'nope' })).ok, false);
  // 남은 문제가 없는 카테고리 (득점형 — 원판 후보 아님)
  const used = { ...scoreSession(game), picks: [{ categoryId: 'c5', questionIds: ['c5-q0', 'c5-q1'] }] };
  app = gameScreen(game, used);
  res = await app.cmd('roulette.spin', { categoryId: 'c5' });
  assert.equal(res.ok, false);
  assert.match(res.message, /원판에 없습니다/);
  // 회전 중 · 정지 뒤에는 지정 명령을 받지 않는다 (정지 뒤 [다시 돌리기] 로 바뀌지 않게)
  app = gameScreen(game, scoreSession(game));
  assert.equal((await app.cmd('roulette.spin', { categoryId: 'c1' })).ok, true);
  assert.equal((await app.cmd('roulette.spin', { categoryId: 'c2' })).ok, false);
  app.play.spinDone();
  assert.equal((await app.cmd('roulette.spin', { categoryId: 'c2' })).ok, false);
  assert.equal(app.play.rouletteState().phase, 'stopped');
  assert.equal(app.play.rouletteState().resultId, 'c1');
});

test('결과 지정 없음 · 원판 1개 — 지금처럼 (W-44, D-11)', async () => {
  const game = photoGame(6);
  let app = gameScreen(game, scoreSession(game));
  assert.equal((await app.cmd('roulette.spin')).ok, true);
  const r = app.play.rouletteState();
  assert.equal(r.phase, 'spinning');
  assert.ok(r.wheel.includes(r.resultId));
  // 원판 1개 — 지정해도 회전 없이 그 카테고리
  app = gameScreen(game, scoreSession(game, ['c3']));
  assert.equal((await app.cmd('roulette.spin', { categoryId: 'c3' })).ok, true);
  assert.deepEqual([app.play.rouletteState().phase, app.play.rouletteState().resultId], ['stopped', 'c3']);
});

test('줄줄이 말해요는 원판 없이 진행자가 주제를 고른다 — topic.pick, 룰렛 명령은 거절 (R-65, W-43)', async () => {
  const game = chainGame();
  const session = S.createRouletteSession({ game, candidates: game.categories.map((c) => c.id) });
  const app = gameScreen(game, session);
  const res = await app.cmd('roulette.spin', { categoryId: 'girl' });
  assert.deepEqual(res, { ok: false, message: '줄줄이 말해요는 룰렛 없이 진행자가 주제를 고릅니다' });
  assert.equal((await app.cmd('topic.pick', { categoryId: 'girl' })).ok, true);
  let s = app.session(game.id);
  assert.deepEqual([s.screen, s.picks.at(-1).categoryId], ['topic', 'girl']);
  assert.equal((await app.cmd('topic.pick', { categoryId: 'dang' })).ok, false, '주제를 고르는 화면에서만');
  assert.deepEqual(await app.cmd('topic.answers'), { ok: false, message: '문제 · 정답 후보는 진행자 화면에만 보입니다' }, '모니터에 정답 후보를 띄우지 않음');
  assert.equal((await app.cmd('topic.next')).ok, true);
  // 무작위 — 게임 홈에서 넣은 주제 중에서
  const out = gameScreen(game, S.createRouletteSession({ game, candidates: ['snack'] }));
  assert.equal((await out.cmd('topic.pick')).ok, true);
  assert.equal(out.session(game.id).picks.at(-1).categoryId, 'snack');
  assert.equal((await out.cmd('topic.pick', { categoryId: 'nope' })).message, '주제를 고르는 화면이 아닙니다');
  await out.cmd('topic.next');
  assert.equal((await out.cmd('topic.pick', { categoryId: 'nope' })).message, '없는 주제입니다', '거절 이유는 진행자 화면에만');
  // 게임 창 비상용 Space (spin) 도 무작위 주제
  const key = gameScreen(game, S.createRouletteSession({ game, candidates: ['idiom'] }));
  assert.equal(key.play.spin(), true);
  s = key.session(game.id);
  assert.deepEqual([s.screen, s.picks.at(-1).categoryId], ['topic', 'idiom']);
});