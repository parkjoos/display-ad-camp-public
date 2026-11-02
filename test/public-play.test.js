// 공개 모드 /play — 공개용 게임 데이터 · 카테고리 한 판 순서 · 이어하기 (R-96 · R-97 · R-98 · R-102, 11-acceptance-tests P-1 ~ P-3 · P-12)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicGame, publicImagePaths, planRun, restoreRun, questionCount } from '../app/core/public-play.js';

const keep = (list) => [...list]; // 무작위 대신 그대로 — 순서를 확인하려고

const photo = {
  id: 'photo-quiz', type: 'photo', title: '사진 보고 맞추기', icon: '📷', order: 3, rules: ['사진을 보고 맞힌다'],
  defaults: { rounds: 3, relay: 2 },
  categories: [
    { id: 'snack', name: '과자', icon: '🍪', prompt: '이 과자는?', defaultEffect: 'zoom', questions: [
      { id: 'snack-aaaa', answer: '새우깡', image: 'assets/photo-quiz/snack/snack-aaaa.png', effect: 'zoom', zoom: 4, focus: [50, 50], steps: 3, note: '진행자 메모', credit: '출처', addedAt: '2026-10-20' },
      { id: 'snack-bbbb', answer: '꼬깔콘', image: 'assets/photo-quiz/snack/snack-bbbb.png', disabled: true },
      { id: 'snack-cccc', answer: '포카칩', image: 'assets/photo-quiz/snack/snack-cccc.png', answerImage: 'assets/photo-quiz/snack/snack-cccc-answer.png', hint: '감자' },
    ] },
    { id: 'person', name: '인물', icon: '🧑', disabled: true, questions: [
      { id: 'person-dddd', answer: '누군가', image: 'assets/photo-quiz/person/person-dddd.png' },
    ] },
    { id: 'empty', name: '빈 카테고리', icon: '❓', questions: [{ id: 'empty-eeee', answer: '숨김', image: 'assets/photo-quiz/empty/empty-eeee.png', disabled: true }] },
    { id: 'title', name: '제목', icon: '🎬', questions: [{ id: 'title-ffff', answer: '빠담빠담', image: 'assets/photo-quiz/title/title-ffff.png' }] },
  ],
};

const chain = {
  id: 'chain-talk', type: 'roulette', title: '줄줄이 말해요', icon: '🗣️',
  categories: [{ id: 'idiom', name: '사자성어', icon: '📜', rule: '이어 말하기', examples: ['노발 → 대발'], questions: [{ id: 'idiom-k7q2', prompt: '노발○○', answers: ['노발대발'] }] }],
};

test('공개용 게임 — 숨긴 카테고리 · 문제와 진행자 메모 · 출처 · 진행 옵션 · 행사 규칙은 빼고, 낼 문제가 없는 카테고리도 뺀다 (P-1)', () => {
  const g = publicGame(photo);
  assert.deepEqual(g.categories.map((c) => c.id), ['snack', 'title']);
  assert.deepEqual(g.categories[0].questions.map((q) => q.id), ['snack-aaaa', 'snack-cccc']);
  const text = JSON.stringify(g);
  for (const word of ['진행자 메모', '출처', 'addedAt', 'disabled', 'defaults', 'defaultEffect', '누군가', 'rules']) assert.ok(!text.includes(word), word);
  assert.deepEqual(g.categories[0].questions[0], { id: 'snack-aaaa', answer: '새우깡', image: 'assets/photo-quiz/snack/snack-aaaa.png', effect: 'zoom', zoom: 4, focus: [50, 50], steps: 3 });
  assert.equal(g.categories[0].questions[1].hint, '감자');
  assert.deepEqual([...publicImagePaths([g])], ['assets/photo-quiz/snack/snack-aaaa.png', 'assets/photo-quiz/snack/snack-cccc.png', 'assets/photo-quiz/snack/snack-cccc-answer.png', 'assets/photo-quiz/title/title-ffff.png']);
  assert.equal(questionCount(g), 3);
  assert.deepEqual(Object.keys(g).sort(), ['categories', 'icon', 'id', 'order', 'questionOrder', 'title', 'type'], '게임 설명 · 규칙은 행사용이라 빼고 /play 가 따로 (R-99)');
  // 문제 순서는 관리 페이지 설정(defaults.questionOrder)대로 — 없으면 무작위 (R-102)
  assert.equal(g.questionOrder, 'random');
  assert.equal(publicGame({ ...photo, defaults: { questionOrder: 'fixed' } }).questionOrder, 'fixed');
  // 낼 것이 없으면 게임째 빠진다
  assert.equal(publicGame({ ...photo, categories: [photo.categories[1]] }), null);
});

test('줄줄이 말해요는 공개하지 않는다 — 혼자 이어 말할 수 없는 게임 (R-97, P-1)', () => {
  assert.equal(publicGame(chain), null);
  assert.equal(publicGame(null), null);
});

test('한 판은 고른 카테고리의 문제 전부 — 무작위 순서, 다른 카테고리 문제는 섞이지 않음 (R-98, P-2)', () => {
  const [snack] = publicGame(photo).categories;
  assert.deepEqual(planRun(snack, 'random', keep), { keys: ['snack-aaaa', 'snack-cccc'], index: 0, order: 'random' });
  for (let i = 0; i < 20; i++) assert.deepEqual([...planRun(snack).keys].sort(), ['snack-aaaa', 'snack-cccc']);
});

test('문제 순서가 작성 순서(fixed)면 한 판도 데이터 순서 그대로 — 섞지 않는다 (R-102, P-12)', () => {
  const [snack] = publicGame({ ...photo, defaults: { questionOrder: 'fixed' } }).categories;
  const reverse = (list) => [...list].reverse();
  assert.deepEqual(planRun(snack, 'fixed', reverse), { keys: ['snack-aaaa', 'snack-cccc'], index: 0, order: 'fixed' });
  assert.deepEqual(planRun(snack, 'random', reverse).keys, ['snack-cccc', 'snack-aaaa']);
  // 순서 설정이 바뀐 판은 이어 가지 않는다 — 순서가 없는 옛 판은 무작위로 본다
  assert.equal(restoreRun(snack, { keys: ['snack-cccc', 'snack-aaaa'], index: 1 }, 'fixed'), null);
  assert.equal(restoreRun(snack, { keys: ['snack-aaaa', 'snack-cccc'], index: 1, order: 'fixed' }, 'random'), null);
  assert.deepEqual(restoreRun(snack, { keys: ['snack-aaaa', 'snack-cccc'], index: 1, order: 'fixed' }, 'fixed'), { keys: ['snack-aaaa', 'snack-cccc'], index: 1, order: 'fixed' });
});

test('이어하기 — 그 사이 숨긴 문제는 빼고 위치를 당긴다, 다 풀었거나 깨졌으면 새 판 (P-3)', () => {
  const [snack] = publicGame(photo).categories;
  assert.deepEqual(restoreRun(snack, { keys: ['snack-cccc', 'snack-aaaa'], index: 1 }), { keys: ['snack-cccc', 'snack-aaaa'], index: 1, order: 'random' });
  // 앞에서 푼 문제(snack-bbbb)를 숨겼다 — 지금 보던 문제(snack-aaaa)를 그대로 가리킨다
  assert.deepEqual(restoreRun(snack, { keys: ['snack-bbbb', 'snack-cccc', 'snack-aaaa'], index: 2 }), { keys: ['snack-cccc', 'snack-aaaa'], index: 1, order: 'random' });
  // 보던 문제를 숨겼다 — 다음 문제부터
  assert.deepEqual(restoreRun(snack, { keys: ['snack-cccc', 'snack-bbbb', 'snack-aaaa'], index: 1 }), { keys: ['snack-cccc', 'snack-aaaa'], index: 1, order: 'random' });
  assert.equal(restoreRun(snack, { keys: ['snack-cccc', 'snack-bbbb'], index: 1 }), null, '남은 문제가 없음');
  assert.equal(restoreRun(snack, { done: true }), null, '다 푼 카테고리');
  assert.equal(restoreRun(snack, { keys: ['title-ffff'], index: 0 }), null, '다른 카테고리 문제');
  for (const bad of [null, {}, { keys: 'x', index: 0 }, { keys: [], index: 0 }, { keys: ['snack-aaaa'], index: 0.5 }]) assert.equal(restoreRun(snack, bad), null, JSON.stringify(bad));
});
