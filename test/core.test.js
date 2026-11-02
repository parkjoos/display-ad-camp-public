// 공용 모듈 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { serializeGame, serializeApp, serializeScoreboard, serializeState, stringify } from '../app/core/serialize.js';
import { validateGame, validateApp, validateScoreboardDefaults, parseJsonText, validateTeamName, checkStateFile, charCount, isSingleEmoji, emojiUnits } from '../app/core/validate.js';
import { randomInt, newQuestionId, ID_ALPHABET, planSpin, shuffled } from '../app/core/random.js';
import * as S from '../app/core/state.js';
import { ranking, replay, teamCounts, roundCounts, fillRows, relayRound, relayNeed, roundRanksAt, relayScores, relayPerOf, relayGoal } from '../app/core/scoring.js';
import * as SB from '../app/core/scoreboard.js';
import { missingImages, preloadImages, IMAGE_AT_ONCE } from '../app/core/data.js';
import { questionLog, gameStats, scoreTrend, creditTarget } from '../app/core/stats.js';
import { parseTime, formatTime, parseYouTube, clipSpec, clipRangeText } from '../app/core/youtube.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// 시험용 고정 자료 — 저장소의 실제 카테고리 · 문제 · 라운드는 늘거나 줄 수 있어, 개수나 내용에 기대는 테스트는 이것으로 한다
const SB_DEFAULTS = {
  schemaVersion: 1,
  rounds: [
    { id: 'team-forming', name: '팀 정하기', kind: 'rank', points: [50, 0, 0, 0] },
    { id: 'ten-seconds', name: '10초 안에 성공하라', kind: 'rank', points: [200, 100, 50, 0] },
    { id: 'chain-talk', name: '줄줄이 말해요', kind: 'pass', pass: 200, fail: 0, gameId: 'chain-talk' },
    { id: 'photo-quiz', name: '사진 보고 맞추기', kind: 'rank', points: [100, 50, 0, 0], gameId: 'photo-quiz' },
  ],
};

function rouletteFixture() {
  return validateGame({
    schemaVersion: 1, id: 'chain-talk', type: 'roulette', title: '줄줄이 말해요',
    categories: [
      { id: 'idiom', name: '사자성어', rule: '돌아가며 사자성어 말하기', examples: ['일석이조'] },
      { id: 'snack', name: '봉지과자', rule: '돌아가며 과자 이름 말하기', examples: ['새우깡'] },
    ],
  }, { fileId: 'chain-talk' }).game;
}

// ── 데이터 파일 ──────────────────────────────────────────
test('초기 데이터 파일은 검증을 통과하고 고정 직렬화와 글자 단위로 같다 (J-3)', () => {
  const appText = read('data/app.json');
  const app = validateApp(JSON.parse(appText));
  assert.equal(app.errors.length, 0);
  assert.equal(serializeApp(JSON.parse(appText)), appText);
  for (const id of app.app.games) {
    const text = read(`data/games/${id}.json`);
    const res = validateGame(JSON.parse(text), { fileId: id });
    assert.deepEqual(res.errors, [], id);
    assert.equal(serializeGame(JSON.parse(text)), text, `${id} 직렬화`);
  }
  const sbText = read('data/scoreboard.json');
  assert.equal(serializeScoreboard(JSON.parse(sbText)), sbText);
});

test('직렬화: 키 순서 고정 · 기본값 생략 · \\u 이스케이프 없음 (J-1 ~ J-4)', () => {
  const messy = {
    categories: [{ questions: [{ addedAt: '2026-10-07', effect: 'zoom', answer: '초계국수 ', zoom: 6, id: 'food-zoom-k7q2', image: 'assets/photo-quiz/food-zoom/food-zoom-k7q2.jpg', focus: [50, 50], steps: 3, disabled: false, masks: [[1, 2, 3, 4]] }], name: '확대 음식', id: 'food-zoom', icon: '❓' }],
    type: 'photo', id: 'photo-quiz', title: '사진', schemaVersion: 1, order: 999, defaults: { rounds: 3, questionsPerRound: 4 },
  };
  const out = serializeGame(messy);
  assert.ok(out.startsWith('{\n  "schemaVersion": 1,\n  "id": "photo-quiz",\n  "type": "photo",\n  "title": "사진",'));
  assert.ok(!out.includes('"order"'), '기본값 order 생략');
  assert.ok(!out.includes('"rounds"'), '기본값 rounds 생략');
  assert.ok(out.includes('"questionsPerRound": 4'));
  assert.ok(!out.includes('"icon"'), '기본 아이콘 생략');
  assert.ok(!out.includes('"focus"') && !out.includes('"steps"') && !out.includes('"disabled"'));
  assert.ok(!out.includes('"masks"'), '확대 문제의 가림 상자는 정리 (W09)');
  assert.ok(out.includes('"answer": "초계국수"'), '앞뒤 공백 제거');
  assert.ok(!out.includes('\\u'));
  assert.ok(out.endsWith('}\n') && !out.includes('\r'));
  assert.equal(serializeGame(JSON.parse(out)), out, '두 번 저장해도 같은 글자');
  assert.equal(stringify({ a: [[1, 2], [3, 4]], b: ['x', 'y'] }), '{\n  "a": [[1, 2], [3, 4]],\n  "b": ["x", "y"]\n}\n');
});

test('상태 파일 직렬화 — 작은 객체는 한 줄 (K-3-10)', () => {
  const s = serializeState('settings', { games: {}, version: 1, teams: [{ color: '#3b82f6', name: '팀A' }], display: { title: null, subtitle: null } });
  assert.ok(s.includes('{ "name": "팀A", "color": "#3b82f6" }'));
  assert.equal(serializeState('settings', JSON.parse(s)), s);
});

// ── 검증 ─────────────────────────────────────────────────
const baseGame = () => ({
  schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진',
  categories: [{ id: 'food-zoom', name: '확대 음식', questions: [{ id: 'food-zoom-k7q2', answer: '국수', image: 'assets/photo-quiz/food-zoom/food-zoom-k7q2.jpg' }] }],
});

test('타이머 없음 — 예전 파일의 timerSeconds 는 무시하고 저장할 때 뺀다 (R-33, G-14)', () => {
  const old = { ...baseGame(), defaults: { rounds: 2, timerSeconds: 60 } };
  old.categories[0].questions[0].timerSeconds = 20;
  const v = validateGame(old, { fileId: 'photo-quiz' });
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings.filter((w) => w.path.includes('timerSeconds')), [], '경고도 없음');
  assert.equal('timerSeconds' in v.game.defaults, false);
  assert.equal('timerSeconds' in v.game.categories[0].questions[0], false);
  assert.equal('timerSeconds' in S.effectiveOptions(v.game, { timerSeconds: 30 }), false, '게임 옵션에도 없음');

  const out = serializeGame(old);
  assert.ok(!out.includes('timerSeconds') && out.includes('"rounds": 2'), '데이터 파일 — 저장할 때 정리');
  const settings = serializeState('settings', { version: 1, teams: [], display: { title: null, subtitle: null }, games: { 'photo-quiz': { excludedCategories: [], rounds: 2, timerSeconds: 30 } } });
  assert.ok(!settings.includes('timerSeconds') && settings.includes('"rounds": 2'), '게임 옵션 저장값');
  const session = serializeState('session', { version: 1, gameId: 'photo-quiz', snapshot: { teamCount: 3, candidates: [], options: { rounds: 3, questionsPerRound: 5, questionOrder: 'random', timerSeconds: 10 } } });
  assert.ok(!session.includes('timerSeconds') && session.includes('"questionOrder": "random"'), '진행 기록 옵션');
});

test('이모티콘 정답 이미지 — 검증 통과 · 저장 순서 (R-39, E-15-1 · I-22-1)', () => {
  const g = {
    schemaVersion: 1, id: 'emoji-quiz', type: 'emoji', title: '이모티콘 퀴즈',
    categories: [{ id: 'movie', name: '영화', questions: [
      { prompt: '제목은?', answerImage: 'assets/emoji-quiz/movie/movie-9cwe-answer.jpg', reveal: 'sequential', emojis: '🪱🏠💰', answer: '기생충', id: 'movie-9cwe' },
      { id: 'movie-2abc', answer: '겨울왕국', image: 'assets/emoji-quiz/movie/movie-2abc.png', answerImage: 'assets/emoji-quiz/movie/movie-2abc-answer.png' },
    ] }],
  };
  const v = validateGame(g, { fileId: 'emoji-quiz' });
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  const [a, b] = v.game.categories[0].questions;
  assert.equal(a.answerImage, 'assets/emoji-quiz/movie/movie-9cwe-answer.jpg');
  assert.equal(b.answerImage, 'assets/emoji-quiz/movie/movie-2abc-answer.png', '이미지 문제도');
  const out = serializeGame(g);
  const at = (k) => out.indexOf(`"${k}"`);
  assert.ok(at('reveal') < at('answerImage') && at('answerImage') < at('prompt'), '키 순서: … reveal · answerImage · prompt …');
  assert.equal(serializeGame(JSON.parse(out)), out);
  // 다른 폴더 경로는 사진 문제와 같은 경고 (W06)
  const other = structuredClone(g);
  other.categories[0].questions[0].answerImage = 'assets/photo-quiz/x/y.jpg';
  assert.ok(validateGame(other, { fileId: 'emoji-quiz' }).warnings.some((w) => w.path.endsWith('answerImage')));
});

test('검증 오류 코드', () => {
  assert.equal(parseJsonText('{ "a": 1,, }', 'x').error.code, 'E01');
  assert.match(parseJsonText('<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> b', 'x').error.message, /git 충돌/);
  const v2 = baseGame(); v2.schemaVersion = 2;
  assert.ok(validateGame(v2, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E02'));
  const noAnswer = baseGame(); delete noAnswer.categories[0].questions[0].answer;
  assert.ok(validateGame(noAnswer, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E03'));
  const badSlug = baseGame(); badSlug.categories[0].id = 'Movie Scene';
  assert.ok(validateGame(badSlug, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E04'));
  const dup = baseGame(); dup.categories[0].questions.push({ ...dup.categories[0].questions[0] });
  assert.ok(validateGame(dup, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E05'));
  assert.ok(validateGame(baseGame(), { fileId: 'photo' }).errors.some((e) => e.code === 'E06'));
  const video = baseGame(); video.type = 'video';
  assert.ok(validateGame(video, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E07'));
  const zoomless = baseGame(); zoomless.categories[0].questions[0].effect = 'zoom';
  assert.ok(validateGame(zoomless, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E09'));
  const maskless = baseGame(); maskless.categories[0].questions[0].effect = 'mask';
  assert.ok(validateGame(maskless, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E09'));
});

test('검증 경고 · 보정', () => {
  const g = baseGame();
  Object.assign(g.categories[0].questions[0], { effect: 'zoom', zoom: 12, steps: 9, focus: [120, -3] });
  g.categories[0].questions.push({ id: 'food-zoom-3fhx', answer: ' 국 수', image: 'assets/x/y.jpg' });
  const res = validateGame(g, { fileId: 'photo-quiz' });
  assert.deepEqual(res.errors, []);
  const q = res.game.categories[0].questions[0];
  assert.equal(q.zoom, 10); assert.equal(q.steps, 6); assert.deepEqual(q.focus, [100, 0]);
  assert.ok(res.warnings.some((w) => w.code === 'W01'));
  assert.ok(res.warnings.some((w) => w.code === 'W06'));
  assert.ok(res.warnings.some((w) => w.code === 'W07'));
});

test('점수판 기본값 검증 (E10 · W11)', () => {
  assert.equal(validateScoreboardDefaults({ schemaVersion: 1 }).errors[0].code, 'E10');
  const res = validateScoreboardDefaults(SB_DEFAULTS, { games: { 'photo-quiz': { categories: [] } } });
  assert.equal(res.errors.length, 0);
  assert.ok(res.warnings.some((w) => w.code === 'W11'), '없는 게임에 연결된 라운드');
  assert.equal(res.rounds.length, SB_DEFAULTS.rounds.length);
  // 저장소의 기본값 파일은 오류 없이 읽힌다 — 라운드 수 · 배점은 바뀔 수 있어 보지 않는다
  assert.deepEqual(validateScoreboardDefaults(JSON.parse(read('data/scoreboard.json'))).errors, []);
});

test('글자 수 · 이모지 · 팀 이름', () => {
  assert.equal(charCount('👨‍👩‍👧한글'), 3);
  assert.ok(isSingleEmoji('🇰🇷'));
  assert.ok(!isSingleEmoji('🧸🔍'));
  assert.equal(emojiUnits('🪱🏠 💰').length, 3);
  assert.equal(validateTeamName(''), '팀 이름을 입력하세요');
  assert.equal(validateTeamName('열한글자를넘는팀이름이다'), '10자 이내로 입력하세요');
  assert.equal(validateTeamName(' 팀A ', ['팀a']), '다른 팀과 이름이 같습니다');
  assert.equal(validateTeamName('팀B', ['팀A']), null);
});

test('상태 파일 형식 검사', () => {
  assert.equal(checkStateFile('settings', { version: 1, teams: [] }), null);
  assert.ok(checkStateFile('settings', { version: 2 }));
  assert.ok(checkStateFile('session', { version: 1, gameId: 'a', type: 'photo', status: 'active', screen: 'question', picks: [], wheel: [], history: [] }, { gameId: 'b' }));
  assert.equal(checkStateFile('session', { version: 1, gameId: 'a', empty: true }, { gameId: 'a' }), null);
});

// ── 무작위 ───────────────────────────────────────────────
test('무작위 — 고르게 나옴 (D-12 개발용)', () => {
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) counts[randomInt(4)]++;
  for (const c of counts) assert.ok(c > 850 && c < 1150, `분포 ${counts}`);
  const id = newQuestionId('food-zoom');
  assert.match(id, new RegExp(`^food-zoom-[${ID_ALPHABET}]{4}$`));
  const spin = planSpin(14);
  assert.ok(spin.index >= 0 && spin.index < 14 && spin.offset >= 0.15 && spin.offset <= 0.85 && spin.duration >= 4000 && spin.duration <= 6000);
  assert.deepEqual([...shuffled([1, 2, 3])].sort(), [1, 2, 3]);
});

// ── 세션 전이 ────────────────────────────────────────────
function fixture({ perCat = 4, cats = ['a', 'b'] } = {}) {
  return validateGame({
    schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진',
    categories: cats.map((c) => ({
      id: c, name: c.toUpperCase(),
      questions: Array.from({ length: perCat }, (_, i) => ({ id: `${c}-q${i}`, answer: `${c}${i}`, image: `assets/photo-quiz/${c}/${c}-q${i}.jpg` })),
    })),
  }, { fileId: 'photo-quiz' }).game;
}

function start(game, options = {}) {
  return S.createScoreSession({
    game, teamCount: options.teamCount ?? 3,
    options: { rounds: 3, questionsPerRound: 2, questionOrder: 'random', ...options },
    candidates: game.categories.map((c) => c.id),
  });
}

test('득점형 한 바퀴 — 룰렛 → 소개 → 문제 → 정답 → … → 결과 (E-1)', () => {
  const game = fixture();
  let s = start(game);
  assert.equal(s.screen, 'roulette');
  s = S.confirmPick(s, game, 'a').session;
  assert.equal(s.screen, 'round'); assert.equal(s.picks[0].questionIds.length, 2);
  s = S.next(s, game).session; assert.equal(s.screen, 'question');
  s = S.next(s, game).session; assert.equal(s.screen, 'answer');
  s = S.credit(s, 0).session;
  s = S.next(s, game).session; assert.equal(s.screen, 'question'); assert.equal(s.questionIndex, 1);
  s = S.reveal(s, game).session;
  s = S.next(s, game).session; assert.equal(s.screen, 'roundEnd', '라운드 끝 → 라운드 종료 화면 (R-56)');
  s = S.next(s, game).session; assert.equal(s.screen, 'roulette'); assert.equal(s.roundIndex, 1);
  for (let r = 1; r < 3; r++) {
    s = S.confirmPick(s, game, r === 1 ? 'a' : 'b').session;
    for (let q = 0; q < 2; q++) { s = S.next(s, game).session; s = S.next(s, game).session; }
    s = S.next(s, game).session; s = S.next(s, game).session; // 라운드 종료 → 다음
  }
  assert.equal(s.screen, 'result');
  const groups = ranking(s).groups.length;
  for (let i = 0; i < groups; i++) s = S.next(s, game).session;
  assert.equal(s.status, 'finished');
});

test('라운드 수는 계획값 — 다 해도 한 라운드 더, 남은 문제가 없으면 막힘 (R-40)', () => {
  const game = fixture({ perCat: 4, cats: ['a', 'b'] });
  let s = start(game, { rounds: 1 });
  s = S.confirmPick(s, game, 'a').session;
  s = S.next(s, game).session; s = S.next(s, game).session; // Q1 정답
  assert.equal(S.moreRound(s, game).session, s, '라운드 끝이 아니면 무시');
  s = S.next(s, game).session; s = S.next(s, game).session; // Q2 정답 = 계획한 마지막 라운드 끝
  assert.equal(S.moreRound(s, game).session, s, '정답 화면에서는 무시 — 라운드 종료 화면에서 (R-56)');
  s = S.next(s, game).session; assert.equal(s.screen, 'roundEnd');
  assert.equal(S.next(s, game).session.screen, 'result', '→ 는 지금처럼 결과');
  s = S.moreRound(s, game).session;
  assert.equal(s.screen, 'roulette'); assert.equal(s.roundIndex, 1);
  s = S.confirmPick(s, game, 'b').session;
  assert.equal(s.picks.length, 2, '계획(1)을 넘어 2라운드');
  for (let q = 0; q < 2; q++) { s = S.next(s, game).session; s = S.next(s, game).session; }
  s = S.credit(s, 1).session;
  s = S.next(s, game).session;
  assert.equal(S.moreRound(s, game).session.screen, 'roulette', '몇 번이든');
  assert.deepEqual(roundCounts(s, replay(s.history).scored).length, 2, '라운드별 정답 수에 추가 라운드도');
  // 남은 문제가 없으면 막힘
  const tiny = fixture({ perCat: 2, cats: ['a'] });
  let t = start(tiny, { rounds: 1 });
  t = S.confirmPick(t, tiny, 'a').session;
  t.screen = 'roundEnd'; t.questionIndex = 1;
  assert.match(S.moreRound(t, tiny).error, /더 출제할 문제가 없습니다/);
});

test('라운드당 문제 수는 계획값 — 다 내도 같은 카테고리에서 한 문제 더 (R-43)', () => {
  const game = fixture({ perCat: 4, cats: ['a', 'b'] });
  let s = start(game, { rounds: 2, questionsPerRound: 2, questionOrder: 'fixed' });
  s = S.confirmPick(s, game, 'a').session;
  s = S.next(s, game).session; s = S.next(s, game).session; // Q1 정답
  assert.equal(S.moreQuestion(s, game).session, s, '라운드 끝이 아니면 무시');
  s = S.next(s, game).session; s = S.next(s, game).session; // Q2 정답 = 계획한 문제 수 끝
  s = S.moreQuestion(s, game).session;
  assert.equal(s.screen, 'question'); assert.equal(s.questionIndex, 2);
  assert.deepEqual(s.picks[0].questionIds, ['a-q0', 'a-q1', 'a-q2'], '같은 카테고리 · 작성 순서대로 안 낸 문제');
  s = S.reveal(s, game).session; s = S.credit(s, 0).session;
  s = S.moreQuestion(s, game).session; s = S.reveal(s, game).session; // 4번째
  assert.match(S.moreQuestion(s, game).error, /남은 문제가 없습니다/, '카테고리를 다 쓰면 막힘');
  assert.equal(S.next(s, game).session.screen, 'roundEnd', '→ 는 라운드 종료 화면 (R-56)');
  assert.deepEqual(roundCounts(s, replay(s.history).scored)[0], [1, 0, 0], '추가 문제 정답도 라운드 정답 수에');
});

test('라운드 종료 화면 — 라운드 마지막 정답 → 라운드 점수 → 다음 라운드 · 돌아가기 · 이어하기 (R-56)', () => {
  const game = fixture({ perCat: 4, cats: ['a', 'b'] });
  let s = start(game, { rounds: 2, questionsPerRound: 2, questionOrder: 'fixed' });
  s = S.confirmPick(s, game, 'a').session;
  s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, 0).session; // Q1 정답 · 팀1
  s = S.next(s, game).session; assert.equal(s.screen, 'question', '라운드 중간은 다음 문제');
  s = S.reveal(s, game).session; s = S.credit(s, 2).session; // Q2 정답 · 팀3
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roundEnd'); assert.equal(s.roundIndex, 0); assert.equal(s.questionIndex, 1);
  assert.deepEqual(roundCounts(s, replay(s.history).scored)[0], [1, 0, 1], '이번 라운드 점수');
  assert.equal(S.resumeLabel(s, game), '사진 · R1 종료');
  assert.equal(S.currentQuestion(s), null, '지금 문제 없음');
  assert.ok(S.credit(s, 1).ignored, '맞힌 팀은 정답 화면에서만');
  assert.equal(S.moreQuestion(s, game).session, s, '한 문제 더는 정답 화면에서');
  // 라운드로 돌아가기 — 마지막 문제 정답 → 한 문제 더 → 다시 라운드 종료
  let b = S.prev(s, game).session;
  assert.equal(b.screen, 'answer'); assert.equal(b.questionIndex, 1);
  b = S.moreQuestion(b, game).session; b = S.reveal(b, game).session;
  b = S.next(b, game).session; assert.equal(b.screen, 'roundEnd'); assert.equal(b.questionIndex, 2);
  // 계획한 라운드가 남았으면 → 룰렛 준비, 룰렛 준비에서 ← 는 라운드 종료로
  assert.equal(S.moreRound(s, game).session.screen, 'roulette', '한 라운드 더도 같은 곳으로 (버튼은 계획한 라운드 뒤에만)');
  s = S.next(s, game).session; assert.equal(s.screen, 'roulette'); assert.equal(s.roundIndex, 1);
  const back = S.prev(s, game).session;
  assert.equal(back.screen, 'roundEnd'); assert.equal(back.roundIndex, 0); assert.equal(back.questionIndex, 1);
  // 일찍 끝내기 · 상태 파일 형식 검사 · 복원
  assert.equal(S.endEarly(back).session.screen, 'result');
  assert.equal(checkStateFile('session', back, { gameId: 'photo-quiz' }), null);
  const r = S.repairSession({ ...back, questionIndex: 9 }, game).session;
  assert.equal(r.screen, 'roundEnd'); assert.equal(r.questionIndex, 1, '라운드 마지막 문제로 맞춤');
  // 계획한 마지막 라운드 → 라운드 종료 → 결과
  s = S.confirmPick(s, game, 'b').session;
  for (let q = 0; q < 2; q++) { s = S.next(s, game).session; s = S.next(s, game).session; }
  s = S.next(s, game).session; assert.equal(s.screen, 'roundEnd'); assert.equal(s.roundIndex, 1);
  assert.equal(S.next(s, game).session.screen, 'result');
});

test('가림 문제 힌트 단계 — 마지막 상자는 정답 공개 때만 (R-42)', () => {
  const one = { effect: 'mask', masks: [[8.3, 77.7, 83.5, 12.2]] }; // 다크나이트 — 제목 상자 1개
  assert.deepEqual(S.stageRange(one, 'photo'), { initial: 0, final: 0 }, '상자 1개면 힌트 단계 없음');
  const two = { effect: 'mask', masks: [[1, 1, 10, 10], [20, 20, 10, 10]] };
  assert.deepEqual(S.stageRange(two, 'photo'), { initial: 0, final: 1 }, '상자 2개면 1번만 힌트로');
  assert.deepEqual(S.stageRange({ effect: 'mask', masks: [] }, 'photo'), { initial: 0, final: 0 });
});

test('정답 글자 숨기기 — 정답 이미지가 있을 때만 (R-41)', () => {
  const g = baseGame();
  const q = g.categories[0].questions[0];
  Object.assign(q, { hideAnswerText: true, answerImage: 'assets/photo-quiz/food-zoom/food-zoom-k7q2-answer.jpg' });
  const v = validateGame(g, { fileId: 'photo-quiz' });
  assert.deepEqual(v.errors, []);
  assert.equal(v.game.categories[0].questions[0].hideAnswerText, true);
  const out = serializeGame(g);
  assert.ok(out.indexOf('"answerImage"') < out.indexOf('"hideAnswerText"'), '키 순서: answerImage 다음');
  // 정답 이미지가 없어도 켤 수 있다 — 확대 과자처럼 원래 사진이 곧 정답 (R-47)
  const no = baseGame(); no.categories[0].questions[0].hideAnswerText = true;
  const nv = validateGame(no, { fileId: 'photo-quiz' });
  assert.ok(!nv.warnings.some((w) => w.path.endsWith('hideAnswerText')), '경고 없음');
  assert.equal(nv.game.categories[0].questions[0].hideAnswerText, true);
  assert.ok(serializeGame(no).includes('"hideAnswerText": true'), '저장해도 남음');
  // false 는 기본값 — 저장하지 않음
  q.hideAnswerText = false;
  assert.ok(!serializeGame(g).includes('hideAnswerText'));
  // 틀린 형식
  q.hideAnswerText = 'yes';
  assert.ok(validateGame(g, { fileId: 'photo-quiz' }).errors.some((e) => e.code === 'E04'));
});

test('정답 영상 — 유튜브 주소 · 시간 읽기 (R-61)', () => {
  for (const [text, sec] of [['83', 83], ['83.5', 83.5], ['1:23', 83], ['1:02:03', 3723], ['83s', 83], ['1m23s', 83], ['1h2m3s', 3723], ['0', 0]]) {
    assert.equal(parseTime(text), sec, text);
  }
  for (const bad of ['', 'abc', '1:75', '-3']) assert.equal(parseTime(bad), null, bad);
  assert.equal(formatTime(83), '1:23');
  assert.equal(formatTime(83.5), '1:23.5');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(3723), '1:02:03');
  const id = 'dQw4w9WgXcQ';
  for (const url of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `youtu.be/${id}?si=abc`, `https://m.youtube.com/watch?v=${id}&list=x`,
    `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`, `https://music.youtube.com/watch?v=${id}`]) {
    assert.deepEqual(parseYouTube(url), { id, start: null, end: null }, url);
  }
  assert.deepEqual(parseYouTube(`https://youtu.be/${id}?t=83`), { id, start: 83, end: null });
  assert.deepEqual(parseYouTube(`https://www.youtube.com/watch?v=${id}&t=1m23s`), { id, start: 83, end: null });
  assert.deepEqual(parseYouTube(`https://www.youtube.com/embed/${id}?start=83&end=95`), { id, start: 83, end: 95 });
  assert.match(parseYouTube('https://www.youtube.com/clip/UgkxAbCdEf').error, /클립 주소/);
  assert.ok(parseYouTube('https://vimeo.com/123').error);
  assert.ok(parseYouTube('https://www.youtube.com/watch?v=short').error);
  // 문제 → 재생 구간. 끝이 시작보다 앞이면 끝까지
  assert.deepEqual(clipSpec({ answerClip: `https://youtu.be/${id}`, clipStart: 83, clipEnd: 95 }), { id, start: 83, end: 95 });
  assert.deepEqual(clipSpec({ answerClip: `https://youtu.be/${id}?t=83` }), { id, start: 83, end: null });
  assert.deepEqual(clipSpec({ answerClip: `https://youtu.be/${id}`, clipStart: 95, clipEnd: 83 }), { id, start: 95, end: null });
  assert.equal(clipSpec({ answerClip: 'nope' }), null);
  assert.equal(clipSpec({}), null);
  assert.equal(clipRangeText({ start: 83, end: 95 }), '1:23 – 1:35 (12초)');
  assert.equal(clipRangeText({ start: 0, end: null }), '0:00 부터 끝까지');
});

test('정답 영상 — 검증 · 저장 순서 (R-61)', () => {
  const id = 'dQw4w9WgXcQ';
  const g = baseGame();
  const q = g.categories[0].questions[0];
  Object.assign(q, { note: '메모', answerClip: `https://youtu.be/${id}`, clipStart: 83, clipEnd: 95.5, hideAnswerText: true });
  const v = validateGame(g, { fileId: 'photo-quiz' });
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  const vq = v.game.categories[0].questions[0];
  assert.deepEqual([vq.answerClip, vq.clipStart, vq.clipEnd], [`https://youtu.be/${id}`, 83, 95.5]);
  const out = serializeGame(g);
  const at = (k) => out.indexOf(`"${k}"`);
  assert.ok(at('hideAnswerText') < at('answerClip') && at('answerClip') < at('clipStart') && at('clipStart') < at('clipEnd') && at('clipEnd') < at('note'), '키 순서: hideAnswerText · answerClip · clipStart · clipEnd · (credit) · prompt …');
  // 실행용은 주소를 정리하고 t= · end= 를 구간으로
  const g2 = baseGame();
  Object.assign(g2.categories[0].questions[0], { answerClip: `https://www.youtube.com/watch?v=${id}&t=1m23s&list=x` });
  const q2 = validateGame(g2, { fileId: 'photo-quiz' }).game.categories[0].questions[0];
  assert.deepEqual([q2.answerClip, q2.clipStart, q2.clipEnd], [`https://youtu.be/${id}`, 83, undefined]);
  // 읽을 수 없는 주소 · 앞뒤가 바뀐 구간은 경고만 — 게임은 쓸 수 있다
  const g3 = baseGame();
  Object.assign(g3.categories[0].questions[0], { answerClip: 'https://www.youtube.com/clip/UgkxAbCdEf' });
  const v3 = validateGame(g3, { fileId: 'photo-quiz' });
  assert.deepEqual(v3.errors, []);
  assert.ok(v3.warnings.some((w) => w.code === 'W13'));
  assert.equal(v3.game.categories[0].questions[0].answerClip, undefined, '영상 없이');
  const g4 = baseGame();
  Object.assign(g4.categories[0].questions[0], { answerClip: `https://youtu.be/${id}`, clipStart: 95, clipEnd: 83 });
  const v4 = validateGame(g4, { fileId: 'photo-quiz' });
  assert.ok(v4.warnings.some((w) => w.code === 'W01' && w.path.endsWith('clipEnd')));
  assert.equal(v4.game.categories[0].questions[0].clipEnd, undefined, '끝까지 재생');
  // 주소 없이 구간만 — 무시
  const g5 = baseGame();
  Object.assign(g5.categories[0].questions[0], { clipStart: 3 });
  assert.ok(validateGame(g5, { fileId: 'photo-quiz' }).warnings.some((w) => w.code === 'W09'));
});

test('같은 카테고리 재당첨 — 안 나온 문제만, 모자라면 남은 만큼 (D-18 · D-19)', () => {
  const game = fixture({ perCat: 3 });
  let s = start(game);
  s = S.confirmPick(s, game, 'a').session;
  const first = s.picks[0].questionIds;
  s.screen = 'roundEnd'; s.questionIndex = 1;
  s = S.next(s, game).session;
  s = S.confirmPick(s, game, 'a').session;
  assert.equal(s.picks[1].questionIds.length, 1);
  assert.ok(!first.includes(s.picks[1].questionIds[0]));
  assert.equal(S.wheelList(game, s).find((i) => i.id === 'a').exhausted, true);
  assert.deepEqual(S.wheelCandidates(game, s), ['b']);
});

test('모두 출제한 카테고리 — X 무시 (D-20), 남은 문제가 없으면 룰렛 준비 대신 안내 → 결과 (D-21)', () => {
  const game = fixture({ perCat: 2, cats: ['a'] });
  let s = start(game, { rounds: 3 });
  s = S.confirmPick(s, game, 'a').session;
  s.screen = 'roundEnd'; s.questionIndex = 1;
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roulette', '라운드가 남았으면 결과로 바로 가지 않고 룰렛 화면');
  assert.equal(S.anyRemaining(game, s), false);
  assert.equal(S.toggleWheel(s, game, 'a').session, s, '모두 출제한 항목의 X 는 무시');
  s = S.next(s, game).session;
  assert.equal(s.screen, 'result', '안내에서 → 로 결과');
});

test('작성 순서 — 재당첨 시 다음 문제부터 (D-23)', () => {
  const game = fixture({ perCat: 4 });
  let s = start(game, { questionOrder: 'fixed' });
  s = S.confirmPick(s, game, 'a').session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q0', 'a-q1']);
  s.screen = 'roundEnd'; s.questionIndex = 1;
  s = S.next(s, game).session;
  s = S.confirmPick(s, game, 'a').session;
  assert.deepEqual(s.picks[1].questionIds, ['a-q2', 'a-q3']);
});

test('다음 문제 지정 — 이번 라운드 안에서 고른 문제를 다음 차례로 (R-35, W-24 ~ W-27)', () => {
  const game = fixture({ perCat: 5, cats: ['a'] });
  let s = S.confirmPick(start(game, { questionsPerRound: 4, questionOrder: 'fixed' }), game, 'a').session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q0', 'a-q1', 'a-q2', 'a-q3']);
  // 라운드 소개 — 첫 문제 고르기 (W-24)
  s = S.setNextQuestion(s, 'a-q2').session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q2', 'a-q0', 'a-q1', 'a-q3']);
  s = S.next(s, game).session;
  assert.equal(S.currentQuestion(s).id, 'a-q2');
  // 문제 진행 중 — 뒤의 문제를 바로 다음으로, 나머지는 한 칸씩 뒤로 (W-25)
  s = S.setNextQuestion(s, 'a-q3').session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q2', 'a-q3', 'a-q0', 'a-q1']);
  // 현재 문제 · 라운드 밖 문제는 거절, 이미 다음 차례면 그대로 (W-26)
  assert.equal(S.setNextQuestion(s, 'a-q2').error, '지금 나와 있는 문제입니다');
  assert.equal(S.setNextQuestion(s, 'a-q4').error, '이번 라운드 카테고리에서 아직 안 낸 문제가 아닙니다', '게임 데이터 없이는 후보도 확인 못 함');
  assert.equal(S.setNextQuestion(s, 'a-q3').session, s);
  s = S.next(s, game).session; s = S.credit(s, 1).session; // 정답 공개 → 팀2
  s = S.next(s, game).session;
  assert.equal(S.currentQuestion(s).id, 'a-q3');
  assert.equal(S.setNextQuestion(s, 'a-q2').error, '이미 낸 문제입니다');
  // 정답 수 · 라운드별 정답 수는 순서와 상관없이 그대로 (W-27)
  assert.deepEqual(teamCounts(s), [0, 1, 0]);
  assert.deepEqual(roundCounts(s), [[0, 1, 0]]);
  assert.ok(S.setNextQuestion({ ...s, screen: 'result' }, 'a-q0').error, '다른 화면에서는 고를 수 없음');
});

test('라운드에 안 뽑힌 후보를 다음 문제로 — 문제 수 그대로, 라운드 마지막이면 하나 더 (R-52, W-45 ~ W-47)', () => {
  const game = fixture({ perCat: 6, cats: ['a', 'b'] });
  let s = S.confirmPick(start(game, { questionsPerRound: 3, questionOrder: 'fixed' }), game, 'a').session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q0', 'a-q1', 'a-q2']);
  // 라운드 소개 — 후보를 첫 문제로, 가장 늦게 나올 문제(a-q2)가 후보로 돌아감 (W-45)
  s = S.setNextQuestion(s, 'a-q4', game).session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q4', 'a-q0', 'a-q1']);
  assert.deepEqual(S.remainingQuestions(game, s, 'a').map((q) => q.id), ['a-q2', 'a-q3', 'a-q5']);
  s = S.next(s, game).session;
  assert.equal(S.currentQuestion(s).id, 'a-q4');
  // 문제 진행 중 — 후보를 바로 다음으로 (W-45)
  s = S.setNextQuestion(s, 'a-q2', game).session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q4', 'a-q2', 'a-q0']);
  // 다른 카테고리 · 지금 문제는 거절 (W-47)
  assert.equal(S.setNextQuestion(s, 'b-q0', game).error, '이번 라운드 카테고리에서 아직 안 낸 문제가 아닙니다');
  assert.equal(S.setNextQuestion(s, 'a-q4', game).error, '지금 나와 있는 문제입니다');
  s = S.next(s, game).session; s = S.next(s, game).session; // 정답 공개 → a-q2
  s = S.next(s, game).session; s = S.next(s, game).session; // 정답 공개 → a-q0 (라운드 마지막)
  assert.equal(S.currentQuestion(s).id, 'a-q0');
  // 라운드 마지막 — 후보를 고르면 한 문제 더 붙는다 (W-46, R-43 과 같게)
  s = S.setNextQuestion(s, 'a-q5', game).session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q4', 'a-q2', 'a-q0', 'a-q5']);
  s = S.next(s, game).session; s = S.next(s, game).session;
  assert.equal(S.currentQuestion(s).id, 'a-q5');
  // 이미 낸 문제는 후보가 아님 — 다음 라운드에서도 (W-47)
  assert.deepEqual(S.remainingQuestions(game, s, 'a').map((q) => q.id), ['a-q1', 'a-q3']);
});

test('맞힌 팀 지정 · 교체 · 없음 · 취소 (F-1 ~ F-7, R-29 — 되돌리기는 R-83 에서 없앰)', () => {
  const game = fixture();
  let s = S.confirmPick(start(game), game, 'a').session;
  s = S.next(s, game).session;
  assert.ok(S.credit(s, 0).ignored, '정답 공개 전에는 셀 수 없음 (W-5)');
  s = S.next(s, game).session;
  s = S.credit(s, 0).session;
  assert.deepEqual(teamCounts(s), [1, 0, 0]);
  assert.equal(S.credit(s, 0).session, s, '같은 팀 다시 — 변화 없음');
  const rep = S.credit(s, 2, ['A', 'B', 'C']);
  s = rep.session;
  assert.equal(rep.toast, '맞힌 팀 변경: A → C');
  assert.deepEqual(teamCounts(s), [0, 0, 1]);
  s = S.uncredit(s, 2).session;
  assert.deepEqual(teamCounts(s), [0, 0, 0]);
  assert.equal(s.history.length, 3, '지정 · 교체 · 취소가 기록으로 남는다');
  s = S.credit(s, null).session;
  assert.ok(replay(s.history).none.has(s.picks[0].questionIds[0]), '[없음] 표시');
  assert.ok(S.credit(s, 5).ignored, '없는 팀 번호 무시 (F-8)');
});

test('동점 추가 문제 — 3·3·0 → 팀2 승 (F-16)', () => {
  const game = fixture({ perCat: 6 });
  let s = S.confirmPick(start(game, { rounds: 1, questionsPerRound: 6 }), game, 'a').session;
  const credits = [0, 1, 0, 1, 0, 1];
  for (const t of credits) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, t).session; }
  s = S.next(s, game).session; s = S.next(s, game).session; // 라운드 종료 (R-56) → 결과
  assert.equal(s.screen, 'result');
  assert.deepEqual(ranking(s).ranks, [1, 1, 3]);
  assert.equal(S.openTiebreak(s, game).session, s, '모두 공개 전에는 열 수 없음');
  while (s.resultRevealCount < ranking(s).groups.length) s = S.next(s, game).session;
  s = S.openTiebreak(s, game).session;
  assert.equal(s.screen, 'tiebreakQuestion');
  assert.deepEqual(S.tiebreakGroup(s), [0, 1]);
  s = S.next(s, game).session;
  assert.equal(S.credit(s, 2).toast, '동점 팀만 참여합니다', 'F-17');
  s = S.credit(s, 1).session;
  s = S.next(s, game).session;
  assert.equal(s.screen, 'result');
  const r = ranking(s);
  assert.deepEqual(r.ranks, [2, 1, 3]);
  assert.deepEqual(r.counts, [3, 3, 0], '정답 수는 그대로');
  assert.ok(!s.picks.flatMap((p) => p.questionIds).includes(s.tiebreak.used[0]));
});

test('추가 문제 — 아무도 못 맞히면 동점 그대로 · 다시 S (F-16-2), 낼 문제가 없으면 공동 순위 (F-16-3), 재출제 없음 (F-16-4)', () => {
  // 카테고리 a 2문제 + b 1문제: 1 · 1 · 0 동점 → 추가 문제는 b 의 1문제뿐
  const game = validateGame({
    schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진',
    categories: [
      { id: 'a', name: 'A', questions: [0, 1].map((i) => ({ id: `a-q${i}`, answer: `a${i}`, image: `assets/photo-quiz/a/a-q${i}.jpg` })) },
      { id: 'b', name: 'B', questions: [{ id: 'b-q0', answer: 'b0', image: 'assets/photo-quiz/b/b-q0.jpg' }] },
    ],
  }, { fileId: 'photo-quiz' }).game;
  let s = S.confirmPick(start(game, { rounds: 1, questionsPerRound: 2 }), game, 'a').session;
  for (const t of [0, 1]) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, t).session; }
  s = S.next(s, game).session;
  while (s.resultRevealCount < ranking(s).groups.length) s = S.next(s, game).session;
  assert.deepEqual(ranking(s).ranks, [1, 1, 3]);
  assert.deepEqual(S.tiebreakPool(game, s).map((q) => q.id), ['b-q0']);
  s = S.openTiebreak(s, game).session;
  s = S.next(s, game).session; // 정답 공개
  s = S.credit(s, null).session; // 아무도 못 맞힘
  s = S.next(s, game).session;
  assert.equal(s.screen, 'result');
  assert.deepEqual(ranking(s).ranks, [1, 1, 3], 'F-16-2 동점 그대로');
  assert.equal(S.tiebreakPool(game, s).length, 0, 'F-16-4 연 문제는 다시 안 나옴');
  assert.equal(S.openTiebreak(s, game).session, s, 'F-16-3 낼 문제가 없으면 열리지 않음 (화면: "추가 문제가 없어 공동 순위로 정합니다")');
});

test('추가 문제 고르기 — 포함된 카테고리의 안 낸 문제만 · 고른 문제로 열기 · 거절 · S 는 그 안에서 무작위 (R-54, W-48 ~ W-50)', () => {
  const game = fixture({ perCat: 3, cats: ['a', 'b', 'c'] });
  // 게임 홈에서 c 를 뺀 게임 — a 에서 두 문제, 팀1 · 팀2 하나씩 → 1 · 1 · 0 동점
  let s = S.createScoreSession({ game, teamCount: 3, options: { rounds: 1, questionsPerRound: 2, questionOrder: 'fixed' }, candidates: ['a', 'b'] });
  s = S.confirmPick(s, game, 'a').session;
  for (const t of [0, 1]) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, t).session; }
  s = S.next(s, game).session;
  while (s.resultRevealCount < ranking(s).groups.length) s = S.next(s, game).session;
  // 후보 — 카테고리별 남은 문제, 데이터 순서. 낸 문제 · 제외한 카테고리 없음 (W-49)
  assert.deepEqual(S.tiebreakChoices(game, s), [{ categoryId: 'a', questionIds: ['a-q2'] }, { categoryId: 'b', questionIds: ['b-q0', 'b-q1', 'b-q2'] }]);
  for (const id of ['a-q0', 'c-q0', 'zz']) assert.equal(S.openTiebreak(s, game, id).error, '추가 문제로 낼 수 있는 문제가 아닙니다', id);
  // 고른 문제로 열기 (W-48) — 다음 후보에서는 빠진다
  let t = S.openTiebreak(s, game, 'b-q1').session;
  assert.equal(t.screen, 'tiebreakQuestion');
  assert.equal(S.currentQuestion(t).id, 'b-q1');
  t = S.next(t, game).session; t = S.credit(t, null).session; t = S.next(t, game).session;
  assert.equal(t.screen, 'result');
  assert.deepEqual(S.tiebreakChoices(game, t).map((c) => c.questionIds), [['a-q2'], ['b-q0', 'b-q2']]);
  // 게임 창 S — 무작위도 포함된 카테고리 안에서만 (W-50)
  for (let i = 0; i < 30; i++) {
    const id = S.openTiebreak(t, game).session.tiebreak.used.at(-1);
    assert.notEqual(S.findQuestion(game, id).category.id, 'c', id);
  }
});

test('동점 4·4·4 — 차례로 가림 (F-16-1)', () => {
  const game = fixture({ perCat: 20 });
  let s = S.confirmPick(start(game, { rounds: 1, questionsPerRound: 12 }), game, 'a').session;
  for (let i = 0; i < 12; i++) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, i % 3).session; }
  s = S.next(s, game).session;
  while (s.resultRevealCount < ranking(s).groups.length) s = S.next(s, game).session;
  s = S.openTiebreak(s, game).session; s = S.next(s, game).session; s = S.credit(s, 0).session; s = S.next(s, game).session;
  assert.deepEqual(S.tiebreakGroup(s), [0, 1, 2]);
  s = S.openTiebreak(s, game).session;
  assert.deepEqual(S.tiebreakGroup(s), [1, 2]);
  s = S.next(s, game).session; s = S.credit(s, 2).session; s = S.next(s, game).session;
  assert.deepEqual(ranking(s).ranks, [1, 3, 2]);
  assert.equal(ranking(s).ties.length, 0);
});

test('이전 이동 (E-2) · 라운드 취소 막기 · 일찍 끝내기 (F-18)', () => {
  const game = fixture();
  let s = S.confirmPick(start(game), game, 'a').session;
  assert.ok(S.prev(s, game).confirmCancelRound);
  s = S.cancelRound(s).session;
  assert.equal(s.screen, 'roulette'); assert.equal(s.picks.length, 0);
  assert.ok(S.prev(s, game).goHome);
  s = S.confirmPick(s, game, 'a').session;
  s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, 1).session;
  s = S.prev(s, game).session; assert.equal(s.screen, 'question');
  s = S.prev(s, game).session; assert.equal(s.screen, 'round');
  assert.ok(S.cancelRound(s).error, '득점 이력이 있으면 취소 불가');
  s = S.endEarly(s).session;
  assert.equal(s.screen, 'result');
  assert.deepEqual(teamCounts(s), [0, 1, 0]);
});

test('룰렛 준비 — 넣기 · 빼기 · 모두 넣기', () => {
  const game = fixture({ cats: ['a', 'b', 'c'] });
  let s = start(game);
  s = S.toggleWheel(s, game, 'b').session;
  assert.deepEqual(s.wheel, ['a', 'c']);
  s = S.toggleWheel(s, game, 'b').session;
  assert.deepEqual(s.wheel, ['a', 'b', 'c']);
  s = S.setWheel(s, []).session;
  s = S.includeAll(s, game).session;
  assert.deepEqual(s.wheel, ['a', 'b', 'c']);
});

test('룰렛형 — 횟수 제한 없음 · 확정 취소 · 끝내기 (D-7, H)', () => {
  const game = rouletteFixture();
  let s = S.createRouletteSession({ game, candidates: S.homeCandidates(game) });
  for (let i = 0; i < 12; i++) {
    s = S.confirmPick(s, game, 'idiom').session;
    assert.equal(s.screen, 'topic');
    s = S.topicNext(s).session;
  }
  assert.equal(s.picks.length, 12);
  assert.equal(S.wheelList(game, s).find((i) => i.id === 'idiom').wins, 12);
  s = S.confirmPick(s, game, 'snack').session;
  s = S.topicPrev(s).session;
  assert.equal(s.picks.length, 12); assert.equal(s.screen, 'roulette');
  s = S.finishRoulette(s).session;
  assert.equal(s.status, 'finished');
});

test('복원 — 지운 문제 건너뛰기 (J-11)', () => {
  const game = fixture();
  let s = S.confirmPick(start(game), game, 'a').session;
  s = S.next(s, game).session;
  const gone = s.picks[0].questionIds[0];
  const trimmed = JSON.parse(JSON.stringify(game));
  trimmed.categories[0].questions = trimmed.categories[0].questions.filter((q) => q.id !== gone);
  const res = S.repairSession(s, trimmed);
  assert.ok(res.notice);
  assert.ok(!res.session.picks[0].questionIds.includes(gone));
});

// ── 점수판 ───────────────────────────────────────────────
test('점수판 계산 · 직접 수정 · 채우기 (T-7 · T-11 · T-21 · T-23)', () => {
  const games = { 'chain-talk': rouletteFixture(), 'photo-quiz': fixture() };
  const rounds = validateScoreboardDefaults(SB_DEFAULTS, { games }).rounds;
  let sb = SB.blankScoreState();
  sb = SB.setCell(sb, 'ten-seconds', 0, { rank: 2 }, 3);
  sb = SB.setCell(sb, 'ten-seconds', 1, { rank: 1 }, 3);
  sb = SB.setCell(sb, 'ten-seconds', 2, { rank: 3 }, 3);
  assert.deepEqual(SB.totals(rounds, sb.entries, 3).totals, [100, 200, 50]);
  sb = SB.setPoints(sb, rounds, 'ten-seconds', { points: [300, 100, 50, 0] });
  const eff = SB.effectiveRounds(sb, rounds);
  assert.deepEqual(SB.totals(eff, sb.entries, 3).totals, [100, 300, 50], '배점을 바꾸면 다시 계산');
  sb = SB.setCell(sb, 'chain-talk', 0, { pass: true }, 3);
  sb = SB.setCell(sb, 'ten-seconds', 0, { rank: 2, value: 90 }, 3);
  assert.deepEqual(SB.totals(eff, sb.entries, 3).totals, [290, 300, 50]);
  assert.ok(SB.isOverridden(eff[1], sb.entries['ten-seconds'][0]));

  const game = fixture({ cats: ['a', 'b'] });
  let s = S.confirmPick(start(game, { rounds: 1, questionsPerRound: 2 }), game, 'a').session;
  for (const t of [0, 0]) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, t).session; }
  s = S.next(s, game).session;
  const rows = fillRows(s, eff);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].ranks, [[1], [2], [2]], '등수 행은 팀마다 라운드별 등수 (R-57)');
  sb = SB.applyFill(sb, rows, 'photo-quiz', '2026-10-29T17:30:00+09:00');
  assert.deepEqual(sb.entries['photo-quiz'], [{ ranks: [1] }, { ranks: [2] }, { ranks: [2] }]);
  assert.equal(sb.filled['photo-quiz'].from, 'photo-quiz');
  assert.deepEqual(roundCounts(s), [[2, 0, 0]]);
});

test('정답 수 라운드 — 정답 1개당 점수 · 게임 화면 점수 라운드 · 채우기 (R-49)', () => {
  const game = fixture({ cats: ['a', 'b'] });
  const games = { 'photo-quiz': game };
  const raw = {
    schemaVersion: 1,
    rounds: [
      { id: 'quiz', name: '퀴즈', kind: 'count', per: 50, gameId: 'photo-quiz' },
      { id: 'quiz-a', name: '퀴즈 A', kind: 'count', per: 10, gameId: 'photo-quiz', categoryId: 'a' },
      { id: 'quiz-rank', name: '퀴즈 등수', kind: 'rank', points: [100, 50, 0, 0], gameId: 'photo-quiz' },
    ],
  };
  const rounds = validateScoreboardDefaults(raw, { games }).rounds;
  assert.equal(rounds[0].per, 50);
  assert.ok(validateScoreboardDefaults({ schemaVersion: 1, rounds: [{ id: 'x', name: 'x', kind: 'count' }] }).errors.length > 0, 'per 없으면 오류');
  // 게임 화면에 점수를 보여 줄 라운드 — 카테고리 연결이 없는 정답 수 라운드
  assert.equal(SB.perCorrectRound(rounds, 'photo-quiz').id, 'quiz');
  assert.equal(SB.perCorrectRound(rounds, 'emoji-quiz'), null);
  assert.equal(SB.perCorrectRound(SB_DEFAULTS.rounds, 'photo-quiz'), null, '등수 라운드만 있으면 정답 수 표시 그대로');
  // 칸 점수 · 표시
  assert.equal(SB.cellScore(rounds[0], { count: 3 }), 150);
  assert.equal(SB.cellLabel(rounds[0], { count: 3 }), '3개 150');
  assert.equal(SB.cellScore(rounds[0], { count: 0 }), 0);
  assert.equal(SB.roundSummary(rounds[0]), '1개당 50');
  assert.ok(!SB.isOverridden(rounds[0], { count: 3, value: 7 }), '정답 수 칸은 점수 직접 수정 없음');
  // 1라운드(a) 2문제 모두 팀1 — 팀2 · 팀3 은 0개로 동점
  let s = S.confirmPick(start(game, { rounds: 1, questionsPerRound: 2 }), game, 'a').session;
  for (const t of [0, 0]) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, t).session; }
  s = S.next(s, game).session;
  const rows = fillRows(s, rounds);
  assert.deepEqual(rows.map((r) => r.round.id), ['quiz', 'quiz-a', 'quiz-rank']);
  assert.deepEqual(rows[0].counts, [2, 0, 0]);
  assert.deepEqual(SB.fillCells(rows[0]), [{ count: 2 }, { count: 0 }, { count: 0 }]);
  let sb = SB.applyFill(SB.blankScoreState(), rows, 'photo-quiz', '2026-10-29T17:30:00+09:00');
  assert.deepEqual(sb.entries.quiz, [{ count: 2 }, { count: 0 }, { count: 0 }]);
  assert.deepEqual(sb.entries['quiz-rank'], [{ ranks: [1] }, { ranks: [2] }, { ranks: [2] }]);
  assert.deepEqual(SB.totals(rounds, sb.entries, 3).totals, [100 + 20 + 100, 0 + 0 + 50, 0 + 0 + 50]);
  // 1개당 점수를 바꾸면 이미 채운 칸도 다시 계산
  sb = SB.setPoints(sb, rounds, 'quiz', { per: 30 });
  assert.deepEqual(SB.totals(SB.effectiveRounds(sb, rounds), sb.entries, 3).totals, [60 + 20 + 100, 50, 50]);
  // 직렬화 — per 는 정답 수 라운드에만, 칸의 count 는 남는다
  assert.ok(serializeScoreboard(raw).includes('"per": 50'));
  assert.ok(!serializeScoreboard({ schemaVersion: 1, rounds: [{ id: 'r', name: 'r', kind: 'rank', points: [1, 0, 0, 0], per: 5 }] }).includes('"per"'));
  assert.ok(serializeState('scoreboard', sb).includes('"count": 2'));
});

test('라운드마다 반영 — 등수 행은 라운드별 등수의 배점 합, 정답 수 행은 합, 다시 계산 (R-57, W-56 ~ W-59 · T-40 · T-41)', () => {
  const game = fixture({ perCat: 6, cats: ['a', 'b'] });
  const rounds = validateScoreboardDefaults({ schemaVersion: 1, rounds: [
    { id: 'photo', name: '사진', kind: 'rank', points: [100, 50, 0, 0], gameId: 'photo-quiz' },
    { id: 'cnt', name: '정답 수', kind: 'count', per: 50, gameId: 'photo-quiz' },
    { id: 'cat-b', name: 'B', kind: 'rank', points: [10, 5, 0, 0], gameId: 'photo-quiz', categoryId: 'b' },
  ] }, { games: { 'photo-quiz': game } }).rounds;
  let s = S.confirmPick(start(game, { rounds: 3, questionsPerRound: 3, questionOrder: 'fixed' }), game, 'a').session;
  // ROUND 1 (a): 팀1 2 · 팀2 1 · 팀3 0
  for (const t of [0, 0, 1]) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, t).session; }
  s = S.next(s, game).session; assert.equal(s.screen, 'roundEnd');
  let sb = SB.setCell(SB.blankScoreState(), 'photo', 2, { rank: 1 }, 3); // 리허설 때 넣은 값
  let pv = SB.reflectPreview(s, rounds, sb);
  assert.equal(pv.done, false);
  assert.deepEqual(pv.rows[0].cells.map((c) => [c.rank, c.add]), [[1, 100], [2, 50], [3, 0]], '이번 라운드 등수 · 더하는 점수');
  assert.deepEqual(pv.rows[1].cells.map((c) => [c.count, c.add]), [[2, 100], [1, 50], [0, 0]], '정답 수 × 50');
  assert.equal(pv.rows[2].skip, '이번 라운드는 해당 없음', '다른 카테고리 행');
  assert.equal(pv.rows[0].overwrite, true, '다른 진행이 넣은 값 → 덮어쓰기 경고');
  assert.deepEqual(pv.added, [200, 100, 0]);
  assert.deepEqual(pv.totalsAfter, [200, 100, 0]);
  sb = SB.applyFill(sb, pv.fill, 'photo-quiz', 'now', s.startedAt);
  s = S.setReflected(s, pv.idxs).session;
  assert.deepEqual(sb.entries.photo, [{ ranks: [1] }, { ranks: [2] }, { ranks: [3] }]);
  assert.equal(sb.entries['cat-b'], undefined, '나오지 않은 카테고리 행은 그대로');
  pv = SB.reflectPreview(s, rounds, sb);
  assert.equal(pv.done, true); assert.equal(pv.stale, false);
  assert.equal(pv.rows[0].overwrite, false, '같은 진행이 쓴 값은 경고 없음');
  // 두 번 반영해도 같은 값 — 다시 계산해서 쓴다
  assert.deepEqual(SB.applyFill(sb, pv.fill, 'photo-quiz', 'now', s.startedAt).entries, sb.entries);
  // 반영 뒤 맞힌 팀을 고치면 "점수가 바뀌었습니다"
  let back = S.prev(s, game).session; back = S.credit(back, 2).session; back = S.next(back, game).session;
  assert.equal(SB.reflectPreview(back, rounds, sb).stale, true);
  // ROUND 2 (b): 정답 없음 → 등수 없음 (0점)
  s = S.next(s, game).session; s = S.confirmPick(s, game, 'b').session;
  for (let q = 0; q < 3; q++) { s = S.next(s, game).session; s = S.next(s, game).session; s = S.credit(s, null).session; }
  s = S.next(s, game).session;
  pv = SB.reflectPreview(s, rounds, sb);
  assert.deepEqual(pv.rows[0].cells.map((c) => [c.rank, c.add]), [[null, 0], [null, 0], [null, 0]]);
  assert.equal(pv.rows[2].skip, undefined, 'B 카테고리 라운드는 그 행도');
  sb = SB.applyFill(sb, pv.fill, 'photo-quiz', 'now', s.startedAt);
  s = S.setReflected(s, pv.idxs).session;
  assert.deepEqual(sb.entries.photo, [{ ranks: [1, null] }, { ranks: [2, null] }, { ranks: [3, null] }], '라운드별 등수 목록');
  assert.deepEqual(sb.entries.cnt, [{ count: 2 }, { count: 1 }, { count: 0 }], '정답 수는 반영한 라운드 합');
  assert.equal(SB.cellLabel(rounds[0], sb.entries.photo[0]), '1·-등 100');
  assert.equal(SB.cellLabel(rounds[0], { ranks: [null] }), '등수 없음 0');
  // 게임 결과 채우기는 같은 계산 — 모두 반영했으면 값이 같다 (결과 창을 띄우지 않음)
  assert.ok(SB.rowsMatch(sb, fillRows(s, rounds), 3));
  // 칸 점수 · 직접 수정 · 배점 변경
  assert.equal(SB.cellScore(rounds[0], { ranks: [1, 2] }), 150);
  assert.ok(SB.isOverridden(rounds[0], { ranks: [1, 2], value: 90 }));
  assert.equal(SB.cellScore(rounds[0], { ranks: [1, 2], value: 90 }), 90);
  const sb2 = SB.setPoints(sb, rounds, 'photo', { points: [200, 50, 0, 0] });
  assert.equal(SB.cellScore(SB.effectiveRounds(sb2, rounds)[0], sb2.entries.photo[0]), 200, '배점을 바꾸면 라운드마다 새 배점');
  assert.equal(SB.roundSummary(rounds[0]), '100/50/0 라운드마다');
  // 직렬화 — 칸의 ranks · 자동 입력의 session · 세션의 reflectedRounds
  const saved = JSON.parse(serializeState('scoreboard', sb));
  assert.deepEqual(saved.entries.photo[0], { ranks: [1, null] });
  assert.equal(saved.filled.photo.session, s.startedAt);
  assert.deepEqual(JSON.parse(serializeState('session', s)).reflectedRounds, [0, 1]);
  assert.deepEqual(S.repairSession(s, game).session.reflectedRounds, [0, 1]);
});

test('종합 점수 추이 기록 — 합계가 바뀔 때마다, 같은 행은 3분 안에 합침, 초기화하면 비움 (R-58, L-2 · L-3)', () => {
  const rounds = validateScoreboardDefaults(SB_DEFAULTS, { games: { 'chain-talk': rouletteFixture(), 'photo-quiz': fixture() } }).rounds;
  const opt = (at, what = null) => ({ defaults: rounds, teamCount: 3, at, what });
  let sb = SB.blankScoreState();
  const set = (team, rank, at) => { sb = SB.withLog(sb, SB.setCell(sb, 'ten-seconds', team, { rank }, 3), opt(at)); };
  set(0, 1, '2026-10-29T15:00:00+09:00');
  set(1, 2, '2026-10-29T15:01:00+09:00');
  set(2, 3, '2026-10-29T15:02:00+09:00');
  assert.equal(sb.log.length, 1, '같은 행을 이어 입력하면 한 점');
  assert.deepEqual(sb.log[0], { at: '2026-10-29T15:02:00+09:00', what: '10초 안에 성공하라', totals: [200, 100, 50] });
  // 이름을 정해 준 기록 (라운드 반영) · 합계가 그대로면 기록 없음
  sb = SB.withLog(sb, SB.setCell(sb, 'team-forming', 0, { rank: 1 }, 3), opt('2026-10-29T15:03:00+09:00', '사진 보고 맞추기 ROUND 1'));
  assert.equal(sb.log.at(-1).what, '사진 보고 맞추기 ROUND 1');
  const same = SB.withLog(sb, SB.setCell(sb, 'team-forming', 1, { rank: 3 }, 3), opt('2026-10-29T15:04:00+09:00'));
  assert.equal(same.log.length, 2, '0점 칸 — 합계 그대로');
  // 3분이 지나면 같은 행도 새 점
  sb = SB.withLog(sb, SB.setCell(sb, 'ten-seconds', 0, { rank: 2 }, 3), opt('2026-10-29T15:10:00+09:00'));
  sb = SB.withLog(sb, SB.setCell(sb, 'ten-seconds', 1, { rank: 1 }, 3), opt('2026-10-29T15:20:00+09:00'));
  assert.equal(sb.log.length, 4);
  // 배점 변경도 합계가 바뀌면 기록
  sb = SB.withLog(sb, SB.setPoints(sb, rounds, 'ten-seconds', { points: [300, 100, 50, 0] }), opt('2026-10-29T15:30:00+09:00'));
  assert.equal(sb.log.at(-1).what, '배점 변경');
  // 직렬화 · 형식 검사
  const saved = JSON.parse(serializeState('scoreboard', sb));
  assert.equal(saved.log.length, 5);
  assert.deepEqual(Object.keys(saved.log[0]), ['at', 'what', 'totals']);
  assert.equal(checkStateFile('scoreboard', saved), null);
  assert.ok(checkStateFile('scoreboard', { ...saved, log: [{ what: 1 }] }));
  // 추이 — 처음 0점 + 기록마다
  const tr = scoreTrend(sb, rounds, 3);
  assert.equal(tr.points.length, 6);
  assert.deepEqual(tr.points[0], { what: '시작', totals: [0, 0, 0] });
  assert.deepEqual(tr.points.at(-1).totals, tr.now.totals, '마지막 점 = 지금 합계');
  // 점수는 있는데 기록이 없으면 "지금" 한 점, 초기화하면 비움
  assert.deepEqual(scoreTrend({ ...sb, log: undefined }, rounds, 3).points.map((p) => p.what), ['시작', '지금']);
  sb = SB.withLog(sb, SB.clearEntries(sb), opt('2026-10-29T16:00:00+09:00'));
  assert.deepEqual(sb.log, []);
  assert.deepEqual(scoreTrend(sb, rounds, 3).points, []);
});

test('문제 기록 · 팀별 통계 — 안 낸 문제와 공개 전 정답은 감춤 (R-58, L-4 ~ L-6)', () => {
  const game = fixture({ perCat: 6, cats: ['a', 'b'] });
  let s = S.confirmPick(start(game, { rounds: 2, questionsPerRound: 3, questionOrder: 'fixed' }), game, 'a').session;
  // 라운드 소개 — 아무것도 안 보임
  assert.deepEqual(questionLog(s, game).rounds, []);
  s = S.next(s, game).session; // Q1 문제 (공개 전)
  let log = questionLog(s, game);
  assert.equal(log.rounds[0].questions.length, 1);
  assert.deepEqual(log.rounds[0].questions[0], { n: 1, id: 'a-q0', answer: null, live: true, team: null, rep: null, none: false }, '공개 전 — 정답 없음');
  s = S.reveal(s, game).session; s = S.credit(s, 0).session;
  s = S.next(s, game).session; s = S.reveal(s, game).session; s = S.credit(s, null).session; // Q2 정답자 없음
  log = questionLog(s, game);
  assert.deepEqual(log.rounds[0].questions.map((q) => [q.answer, q.team, q.none]), [['a0', 0, false], ['a1', null, true]]);
  assert.ok(!log.rounds[0].questions.some((q) => q.id === 'a-q2'), '뽑아 둔 남은 문제(Q3)는 안 보임');
  s = S.next(s, game).session; s = S.reveal(s, game).session; s = S.credit(s, 1).session;
  s = S.next(s, game).session; // 라운드 종료
  s = S.next(s, game).session; s = S.confirmPick(s, game, 'b').session; // ROUND 2 소개
  log = questionLog(s, game);
  assert.equal(log.rounds.length, 1, 'ROUND 2 는 아직 없음');
  assert.equal(log.rounds[0].questions.length, 3);
  // ROUND 2 Q1 팀3 → [종료] 를 Q2 문제 화면에서 → 결과: Q2 는 판정 기록이 없으니 안 보임
  s = S.next(s, game).session; s = S.reveal(s, game).session; s = S.credit(s, 2).session;
  s = S.next(s, game).session;
  const ended = S.endEarly(s).session;
  log = questionLog(ended, game);
  assert.deepEqual(log.rounds.map((r) => r.questions.length), [3, 1]);
  // 팀별 통계 — 끝난 라운드만 라운드 1위 (ROUND 1: 팀1 1 · 팀2 1 · 팀3 0 → 공동 1위)
  const st = gameStats(s, game);
  assert.deepEqual(st.counts, [1, 1, 1]);
  assert.deepEqual(st.roundWins, [1, 1, 0], '진행 중인 ROUND 2 는 세지 않음');
  assert.equal(st.rounds[0].top, null, '공동이면 강조 없음');
  assert.equal(st.rounds[1].done, false);
  assert.equal(st.asked, 4, '공개 전 Q2 는 세지 않음');
  assert.equal(st.noneCount, 1);
  assert.deepEqual(gameStats(ended, game).roundWins, [1, 1, 1], '결과 화면에서는 마지막 라운드도 (팀3 단독 1위)');
});

test('정답 기록 고치기 — 낸 문제만, 맞힌 팀 지정과 같은 규칙, 추가 문제는 동점 팀, 결과는 다시 공개 (R-60, W-60 ~ W-64)', () => {
  const game = fixture({ perCat: 6, cats: ['a', 'b'] });
  let s = S.confirmPick(start(game, { rounds: 1, questionsPerRound: 3, questionOrder: 'fixed' }), game, 'a').session;
  s = S.next(s, game).session; s = S.reveal(s, game).session; s = S.credit(s, 0).session; // Q1 팀1
  s = S.next(s, game).session; // Q2 문제 (공개 전)
  // 고칠 수 있는 문제 = 이 게임에서 낸 · 공개한 문제
  assert.deepEqual(creditTarget(s, game, 'a-q0'), { group: null });
  assert.match(creditTarget(s, game, 'a-q1').error, /정답 공개 뒤/, '공개 전 지금 문제');
  assert.match(creditTarget(s, game, 'a-q2').error, /낸 문제가 아닙니다/, '뽑아 둔 남은 문제');
  assert.match(creditTarget(s, game, 'b-q0').error, /낸 문제가 아닙니다/);
  assert.match(creditTarget(s, game, 42).error, /낸 문제가 아닙니다/);
  // 지난 문제 고치기 — 화면은 그대로, 교체 · 같은 팀 · 없음 · 없는 팀
  let f = S.setCredit(s, 'a-q0', 1);
  assert.equal(f.toast, undefined, '토스트 없음');
  f = f.session;
  assert.equal(f.screen, 'question'); assert.equal(f.questionIndex, 1);
  assert.deepEqual(teamCounts(f), [0, 1, 0]);
  assert.equal(S.setCredit(f, 'a-q0', 1).session, f, '같은 팀은 변화 없음');
  f = S.setCredit(f, 'a-q0', null).session;
  assert.deepEqual(teamCounts(f), [0, 0, 0]);
  assert.ok(replay(f.history).none.has('a-q0'), '정답자 없음으로');
  assert.match(S.setCredit(f, 'a-q0', 7).error, /없는 팀/);
  // 결과 화면에서 고치면 순위 공개 · 점수판 채우기를 다시
  s = S.reveal(s, game).session; s = S.credit(s, 1).session; // Q2 팀2
  s = S.next(s, game).session; s = S.reveal(s, game).session; s = S.credit(s, null).session; // Q3 없음 → 1 · 1 · 0 동점
  s = S.next(s, game).session; s = S.next(s, game).session; // 라운드 종료 → 결과
  assert.equal(s.screen, 'result');
  while (s.resultRevealCount < ranking(s).groups.length) s = S.next(s, game).session;
  s = S.setFill(s, 'filled').session;
  const r = S.setCredit(s, 'a-q2', 2).session;
  assert.equal(r.resultRevealCount, 0); assert.equal(r.scoreboardFill, null);
  assert.deepEqual(teamCounts(r), [1, 1, 1]);
  // 추가 문제 — 공개 전은 진행 중, 공개 뒤에는 그 동점 팀만
  let t = S.openTiebreak(s, game).session;
  const key = 'tb:' + t.tiebreak.used[0];
  assert.match(creditTarget(t, game, key).error, /정답 공개 뒤/);
  t = S.reveal(t, game).session;
  const target = creditTarget(t, game, key);
  assert.deepEqual(target, { group: [0, 1] });
  assert.match(S.setCredit(t, key, 2, target).error, /동점 팀만/);
  t = S.setCredit(t, key, 1, target).session;
  assert.equal(replay(t.history).scored.get(key), 1);
  assert.equal(t.screen, 'tiebreakAnswer', '화면 그대로');
});

// ── 릴레이 (R-62) ─────────────────────────────────────────
const relayStart = (game, options = {}) => start(game, { relay: 2, questionOrder: 'fixed', ...options });
/** 정답 화면에서 맞힌 팀(null = 없음) 지정 */
const answer = (s, game, team) => S.credit(S.next(s, game).session, team).session;

test('릴레이 라운드 등수 — 대표를 모두 내보낸 순서, 못 끝낸 팀은 맞힌 수, 다 내보낸 뒤 기록은 안 셈 (R-62, Y-1)', () => {
  const sc = (pairs) => new Map(pairs);
  const ids = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
  let r = relayRound(ids, sc([['q1', 1], ['q2', 0], ['q3', 1], ['q4', 0]]), 3, 2);
  assert.deepEqual(r.finish, [1, 0]); assert.deepEqual(r.ranks, [2, 1, 3]); assert.equal(r.decided, true, '한 팀만 남으면 순위가 모두 정해짐');
  r = relayRound(ids, sc([['q1', 0], ['q2', 0], ['q3', 0], ['q4', 2]]), 3, 2);
  assert.deepEqual(r.counts, [2, 0, 1], '다 내보낸 뒤 또 맞힌 기록은 세지 않음');
  assert.deepEqual(r.ranks, [1, 3, 2], '못 끝낸 팀은 맞힌 대표 수로');
  assert.equal(r.decided, false);
  assert.deepEqual(relayRound(ids, sc([['q1', 0]]), 3, 2).ranks, [1, 2, 2], '못 끝낸 팀끼리 같으면 공동');
  assert.equal(relayRound(ids, sc([]), 3, 2).ranks, null, '정답이 없으면 등수 없음');
  assert.deepEqual(relayRound(ids, sc([['q1', 0], ['q2', 0]]), 3, 2, 1).counts, [1, 0, 0], 'upTo — 앞 문제만');
  assert.equal(relayRound(ids, sc([['q1', 1]]), 2, 1).decided, true, '2팀이면 한 팀만 끝내도');
  assert.equal(relayNeed(3, 2), 4); assert.equal(relayNeed(4, 2), 6);
});

test('릴레이 진행 — 최소 수만 뽑고 모자라면 하나씩 더, 한 팀만 남으면 라운드 종료, 빠진 팀은 못 맞힘 (R-62, Y-2 ~ Y-4)', () => {
  const game = fixture({ perCat: 7, cats: ['a', 'b'] });
  let s = S.confirmPick(relayStart(game), game, 'a').session;
  assert.deepEqual(s.picks[0].questionIds, ['a-q0', 'a-q1', 'a-q2', 'a-q3'], '(팀 수 − 1) × 대표 수 = 4문제만');
  s = S.next(s, game).session; // 소개 → Q1
  s = answer(s, game, 0); // Q1 팀1
  s = S.next(s, game).session; s = answer(s, game, 0); // Q2 팀1 — 대표 2명 모두 → 1등
  assert.deepEqual(S.relayStatus(s, game).finish, [0]);
  s = S.next(s, game).session; s = S.next(s, game).session; // Q3 정답 공개
  const blocked = S.credit(s, 0, ['A', 'B', 'C']);
  assert.ok(blocked.ignored, '대표를 모두 내보낸 팀은 맞힌 팀이 될 수 없다');
  assert.match(blocked.toast, /A — 대표가 모두 맞혀/);
  assert.deepEqual(S.relayStatus(s, game).out, [0]);
  s = S.credit(s, 1).session; // Q3 팀2
  s = S.next(s, game).session; s = answer(s, game, null); // Q4 정답자 없음
  assert.equal(S.relayStatus(s, game).ending, false, '아직 두 팀이 남음 — 다음 문제');
  s = S.next(s, game).session;
  assert.equal(s.screen, 'question'); assert.equal(s.questionIndex, 4);
  assert.deepEqual(s.picks[0].questionIds.slice(4), ['a-q4'], '뽑아 둔 문제를 다 내서 같은 카테고리에서 하나 더 (작성 순서)');
  s = S.reveal(s, game).session; s = S.credit(s, 1).session; // Q5 팀2 — 2등, 팀3 혼자 남음
  const st = S.relayStatus(s, game);
  assert.equal(st.decided, true); assert.equal(st.ending, true); assert.equal(st.short, false);
  assert.deepEqual(st.ranks, [1, 2, 3]);
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roundEnd', '한 팀만 남으면 라운드 종료');
  assert.equal(s.picks[0].questionIds.length, 5);
  assert.deepEqual(roundRanksAt(s, 0), [1, 2, 3]);
  assert.equal(S.remainingQuestions(game, s, 'a').length, 2);
});

test('릴레이 — 문제가 떨어지면 거기서 라운드 종료, 안 낸 문제는 돌려놓기, 정답 기록 고치기도 같은 규칙 (R-62, Y-5 · Y-6)', () => {
  const game = fixture({ perCat: 4, cats: ['a', 'b'] });
  let s = S.confirmPick(relayStart(game), game, 'a').session;
  s = S.next(s, game).session; s = answer(s, game, 0); // Q1 팀1
  s = S.next(s, game).session; s = answer(s, game, null); // Q2 없음
  s = S.next(s, game).session; s = answer(s, game, 0); // Q3 팀1 → 1등
  s = S.next(s, game).session; s = answer(s, game, 2); // Q4 팀3 — 카테고리 끝
  const st = S.relayStatus(s, game);
  assert.equal(st.ending, true); assert.equal(st.short, true, '순위가 다 안 정해진 채 끝남');
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roundEnd');
  assert.deepEqual(roundRanksAt(s, 0), [1, 3, 2], '못 끝낸 팀은 맞힌 대표 수로');
  // 정답 기록 고치기 — 그 문제 전에 대표를 모두 내보낸 팀은 안 됨, 앞 문제를 바꾸면 순서도 다시
  assert.match(S.setCredit(s, 'a-q3', 0).error, /대표가 모두 맞힌 팀/);
  const fixed = S.setCredit(s, 'a-q0', 2).session; // Q1 → 팀3: 팀3 Q1 · Q4 로 끝냄, 팀1 은 Q3 하나
  assert.deepEqual(roundRanksAt(fixed, 0), [2, 3, 1]);
  // 일찍 끝내면 뽑아 둔 안 낸 문제가 남지만 등수는 낸 문제로
  let e = S.confirmPick(relayStart(game), game, 'b').session;
  e = S.next(e, game).session; e = answer(e, game, 1);
  e = S.endEarly(e).session;
  assert.equal(e.screen, 'result');
  assert.deepEqual(roundRanksAt(e, 0), [2, 1, 2]);
});

test('릴레이 — 남은 문제가 한 라운드에 모자란 카테고리는 원판 · 게임 홈 후보에서 빠짐 (R-62, Y-7 · Y-8)', () => {
  const game = validateGame({
    schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진',
    categories: [['a', 6], ['b', 3], ['c', 0]].map(([c, n]) => ({
      id: c, name: c, questions: Array.from({ length: n }, (_, i) => ({ id: `${c}-q${i}`, answer: `${c}${i}`, image: `assets/photo-quiz/${c}/${c}-q${i}.jpg` })),
    })),
  }, { fileId: 'photo-quiz' }).game;
  assert.deepEqual(S.homeCandidates(game, [], S.needPerRound(3, 2)), ['a'], '3팀 × 2명 → 4문제 필요');
  assert.deepEqual(S.homeCandidates(game, [], S.needPerRound(2, 2)), ['a', 'b'], '2팀 × 2명 → 2문제');
  assert.deepEqual(S.homeCandidates(game, [], S.needPerRound(3, 0)), ['a', 'b'], '릴레이를 끄면 1문제부터');
  let s = relayStart(game, { rounds: 1 });
  const b = S.wheelList(game, s).find((i) => i.id === 'b');
  assert.equal(b.short, true); assert.equal(b.need, 4); assert.equal(b.exhausted, false);
  assert.deepEqual(S.wheelCandidates(game, s), ['a'], '모자란 카테고리는 원판에 안 들어감');
  assert.equal(S.toggleWheel(s, game, 'b').session, s, '넣기 · 빼기 무시');
  assert.deepEqual(S.includeAll(s, game).session.wheel, ['a'], '모두 넣기도');
  // a 를 한 라운드 하고 2문제만 남으면 a 도 모자람 → 더 낼 라운드가 없음
  s = S.confirmPick(s, game, 'a').session;
  for (const t of [0, 0, 1, 1]) { s = S.next(s, game).session; s = answer(s, game, t); }
  s = S.next(s, game).session; assert.equal(s.screen, 'roundEnd');
  assert.equal(S.anyRemaining(game, s), false);
  assert.match(S.moreRound(s, game).error, /더 출제할 문제가 없습니다/);
});

test('릴레이 결과 — 라운드 배점 합으로 순위, 점수판 채우기 · 반영은 라운드 등수 (R-62, Y-9 · Y-10)', () => {
  const game = fixture({ perCat: 8, cats: ['a', 'b'] });
  let s = S.createScoreSession({ game, teamCount: 3, options: { rounds: 2, questionsPerRound: 5, questionOrder: 'fixed', relay: 2 }, candidates: ['a', 'b'], points: [100, 60, 0] });
  assert.deepEqual(s.snapshot.points, [100, 60, 0]);
  const playRound = (cat, order) => {
    s = S.confirmPick(s, game, cat).session;
    for (const t of order) { s = S.next(s, game).session; s = answer(s, game, t); }
    s = S.next(s, game).session;
    assert.equal(s.screen, 'roundEnd');
  };
  playRound('a', [0, 1, 0, 1]); // 1 · 2 · 3등
  s = S.next(s, game).session;
  playRound('b', [2, 1, 2, 1]); // 3등 · 2등 · 1등
  assert.deepEqual(relayScores(s), [100, 120, 100], '라운드마다 배점(100 / 60 / 0)을 더함');
  s = S.next(s, game).session;
  assert.equal(s.screen, 'result');
  const rank = ranking(s);
  assert.deepEqual(rank.counts, [100, 120, 100]); assert.deepEqual(rank.ranks, [2, 1, 2]);
  assert.equal(rank.ties.length, 1, '점수가 같으면 추가 문제로 가린다');
  const rows = fillRows(s, SB_DEFAULTS.rounds);
  const photo = rows.find((r) => r.round.gameId === 'photo-quiz' && !r.skip);
  assert.deepEqual(photo.byRound, [[1, 2, 3], [3, 2, 1]], '점수판은 라운드마다 대표를 모두 내보낸 순서');
  // 배점표 행이 없으면 기본 100 / 50 / 0
  const plain = { ...s, snapshot: { ...s.snapshot, points: undefined } };
  assert.deepEqual(relayScores(plain), [100, 100, 100]);
});

test('릴레이 옵션 — 사진은 기본 2명, 이모티콘은 끔, 0 = 끔도 저장 · 검증 (R-62, Y-11)', () => {
  const photo = fixture();
  assert.equal(S.effectiveOptions(photo, {}).relay, 2, '데이터에 없으면 사진은 2명');
  assert.equal(S.effectiveOptions(photo, { relay: 0 }).relay, 0, '게임 홈에서 끔');
  assert.equal(S.effectiveOptions(photo, { relay: 9 }).relay, 2, '범위 밖은 무시');
  assert.equal(S.effectiveOptions({ ...photo, defaults: { ...photo.defaults, relay: 3 } }, {}).relay, 3, '데이터 기본값');
  const emoji = { ...photo, type: 'emoji', defaults: {} };
  assert.equal(S.effectiveOptions(emoji, {}).relay, 0);
  const v = validateGame({ schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진', defaults: { relay: 8 }, categories: [{ id: 'a', name: 'A', questions: [] }] }, { fileId: 'photo-quiz' });
  assert.equal(v.game.defaults.relay, 6); assert.ok(v.warnings.some((w) => w.path.endsWith('defaults.relay')));
  assert.ok(serializeGame({ ...v.game, defaults: { relay: 0 } }).includes('"relay": 0'), '0 = 끔도 저장');
  const settings = serializeState('settings', { version: 1, teams: [], games: { 'photo-quiz': { excludedCategories: [], relay: 0 } } });
  assert.ok(settings.includes('"relay": 0'));
  // 릴레이가 아닌 세션 (R-62 전) — 정답 수 방식 그대로
  const old = S.confirmPick(start(photo, { questionsPerRound: 2 }), photo, 'a').session;
  assert.equal(old.picks[0].questionIds.length, 2); assert.equal(S.relayStatus(old, photo), null);
});

// ── 이모티콘 퀴즈 — 진행자가 문제를 고름 (R-90) ─────────────
function emojiFixture({ perCat = 2, cats = ['movie', 'song'] } = {}) {
  return validateGame({
    schemaVersion: 1, id: 'emoji-quiz', type: 'emoji', title: '이모티콘 퀴즈',
    categories: cats.map((c) => ({
      id: c, name: c.toUpperCase(),
      questions: Array.from({ length: perCat }, (_, i) => ({ id: `${c}-q${i}`, answer: `${c}${i}`, emojis: '🪱🏠' })),
    })),
  }, { fileId: 'emoji-quiz' }).game;
}

test('이모티콘 퀴즈 — 룰렛 · 라운드 없이 진행자가 고른 문제를 바로, 카테고리마다 한 묶음 (R-90, E-34)', () => {
  const game = emojiFixture();
  let s = start(game);
  assert.equal(s.screen, 'roulette', '시작은 문제 고르기 (모니터 카테고리 목록)');
  assert.ok(S.pickMode(s)); assert.ok(!S.pickMode(start(fixture())), '사진 퀴즈는 룰렛 그대로');
  assert.deepEqual(S.pickChoices(game, s), [{ categoryId: 'movie', questionIds: ['movie-q0', 'movie-q1'] }, { categoryId: 'song', questionIds: ['song-q0', 'song-q1'] }]);
  assert.equal(S.resumeLabel(s, game), '이모티콘 퀴즈 · 문제 0개 냄');

  s = S.pickQuestion(s, game, 'movie-q1').session;
  assert.equal(s.screen, 'question', '라운드 소개 없이 바로 문제');
  assert.deepEqual(s.picks, [{ categoryId: 'movie', questionIds: ['movie-q1'] }]);
  assert.equal(S.currentQuestion(s).id, 'movie-q1'); assert.equal(S.askedCount(s), 1);
  assert.match(S.pickQuestion(s, game, 'song-q0').error, /정답을 공개한 뒤/, '문제 화면에서는 못 고름');

  s = S.credit(S.reveal(s, game).session, 0).session;
  s = S.pickQuestion(s, game, 'song-q0').session; // 정답 화면에서 바로 다음 문제
  assert.equal(s.screen, 'question');
  assert.deepEqual(s.picks.map((p) => p.categoryId), ['movie', 'song']);
  assert.deepEqual([s.roundIndex, s.questionIndex, S.askedCount(s)], [1, 0, 2]);
  assert.equal(S.resumeLabel(s, game), '이모티콘 퀴즈 · 2번째 문제');

  s = S.reveal(s, game).session;
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roulette', '정답 화면 다음은 문제 고르기 — 라운드 종료 화면 없음');
  assert.equal(s.roundIndex, 2);
  s = S.pickQuestion(s, game, 'movie-q0').session;
  assert.deepEqual(s.picks[0].questionIds, ['movie-q1', 'movie-q0'], '같은 카테고리는 그 묶음 뒤에');
  assert.deepEqual([s.roundIndex, s.questionIndex], [0, 1]);
  s = S.credit(S.reveal(s, game).session, 0).session;
  assert.match(S.pickQuestion(s, game, 'movie-q1').error, /이미 낸 문제/);
  assert.match(S.pickQuestion(s, game, 'nope').error, /없는 문제/);
  assert.deepEqual(S.pickChoices(game, s), [{ categoryId: 'song', questionIds: ['song-q1'] }], '낸 문제 · 다 낸 카테고리는 빠짐');
  assert.deepEqual(roundCounts(s), [[2, 0, 0], [0, 0, 0]], '라운드별 정답 수 = 카테고리별');

  s = S.pickQuestion(s, game, 'song-q1').session;
  s = S.next(S.reveal(s, game).session, game).session;
  assert.equal(S.anyRemaining(game, s), false);
  s = S.next(s, game).session;
  assert.equal(s.screen, 'result', '다 냈으면 문제 고르기 다음은 결과');
  assert.match(S.pickQuestion(start(fixture()), fixture(), 'a-q0').error, /문제를 고르는 게임이 아닙니다/);
});

test('이모티콘 퀴즈 — 게임 화면 카테고리 카드 클릭: 그 카테고리 문제를 문제 순서 옵션대로 (R-91, E-35)', () => {
  const game = emojiFixture({ perCat: 3 });
  let s = start(game, { questionOrder: 'fixed' });
  s = S.pickInCategory(s, game, 'song').session;
  assert.equal(s.screen, 'question');
  assert.equal(S.currentQuestion(s).id, 'song-q0', '작성 순서면 남은 문제의 첫 번째');
  s = S.next(S.reveal(s, game).session, game).session;
  assert.equal(S.currentQuestion(S.pickInCategory(s, game, 'song').session).id, 'song-q1', '낸 문제는 건너뜀');
  const rnd = S.pickInCategory(start(game), game, 'movie').session;
  assert.ok(['movie-q0', 'movie-q1', 'movie-q2'].includes(S.currentQuestion(rnd).id), '랜덤이면 그 카테고리 안에서');
  assert.match(S.pickInCategory(s, game, 'nope').error, /없는 카테고리/);
  let done = start(game, { questionOrder: 'fixed' });
  for (let i = 0; i < 3; i++) done = S.next(S.reveal(S.pickInCategory(done, game, 'movie').session, game).session, game).session;
  assert.match(S.pickInCategory(done, game, 'movie').error, /남은 문제가 없습니다/);
});

test('이모티콘 퀴즈 — 예전(룰렛) 진행에서 뽑아 두고 안 낸 문제는 후보로 돌아온다 (R-90)', () => {
  const game = emojiFixture({ perCat: 3 });
  let s = S.confirmPick(start(game), game, 'movie').session; // R-90 전 진행 기록 — 라운드 소개에 2문제
  assert.equal(s.screen, 'round');
  s = S.next(s, game).session; // 첫 문제
  const first = S.currentQuestion(s).id;
  s = S.next(S.reveal(s, game).session, game).session;
  assert.equal(s.screen, 'roulette');
  assert.deepEqual(s.picks[0].questionIds, [first], '안 낸 문제는 묶음에서 빠짐');
  assert.equal(S.pickChoices(game, s)[0].questionIds.length, 2);
  // 라운드 종료 화면에서 이어 와도 문제 고르기로
  const ended = { ...S.reveal(S.next(S.confirmPick(start(game), game, 'song').session, game).session, game).session, screen: 'roundEnd' };
  assert.equal(S.next(ended, game).session.screen, 'roulette');
});

// ── 인당 문제 (R-64) ──────────────────────────────────────
test('인당 문제 2 — 팀은 대표 × 인당 문제만큼 맞혀야 끝, 카테고리 최소 수 · 처음 뽑는 수는 그대로 (R-64, Y-16)', () => {
  const game = fixture({ perCat: 12, cats: ['a', 'b'] });
  let s = S.confirmPick(relayStart(game, { perRep: 2 }), game, 'a').session;
  assert.equal(relayGoal(s), 4); assert.equal(relayPerOf(s), 2);
  assert.equal(s.picks[0].questionIds.length, 4, '처음 뽑는 수는 (팀 수 − 1) × 대표 수 — 인당 문제는 곱하지 않는다');
  s = S.next(s, game).session; // 소개 → Q1
  s = answer(s, game, 0); // Q1 팀1
  s = S.next(s, game).session; s = answer(s, game, 0); // Q2 팀1 — 대표1 이 2문제
  let st = S.relayStatus(s, game);
  assert.equal(st.goal, 4); assert.equal(st.per, 2); assert.equal(st.relay, 2);
  assert.deepEqual(st.counts, [2, 0, 0]); assert.deepEqual(st.finish, [], '대표 한 명만 끝남 — 팀은 아직');
  s = S.next(s, game).session; s = S.reveal(s, game).session;
  assert.deepEqual(S.relayStatus(s, game).out, [], '대표1 이 끝나도 팀은 다음 문제를 맞힐 수 있다');
  s = S.credit(s, 0).session; // Q3 팀1
  s = S.next(s, game).session; s = answer(s, game, 0); // Q4 팀1 — 4/4 → 1등
  st = S.relayStatus(s, game);
  assert.deepEqual(st.finish, [0]); assert.equal(st.ending, false);
  s = S.next(s, game).session; s = S.reveal(s, game).session; // Q5 — 하나 더 뽑음
  assert.equal(s.picks[0].questionIds.length, 5);
  assert.ok(S.credit(s, 0, ['A', 'B', 'C']).ignored, '대표를 모두 내보낸 팀은 못 맞힘');
  s = S.credit(s, 1).session;
  for (let i = 0; i < 3; i++) { s = S.next(s, game).session; s = answer(s, game, 1); } // Q6 ~ Q8 팀2 — 4/4 → 2등
  st = S.relayStatus(s, game);
  assert.equal(st.decided, true); assert.deepEqual(st.ranks, [1, 2, 3]);
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roundEnd');
  assert.deepEqual(roundRanksAt(s, 0), [1, 2, 3]);
});

test('인당 문제 — 카테고리를 더 막지 않고, 문제가 떨어지면 거기서 라운드 종료 · 맞힌 수로 등수 (R-64, Y-17)', () => {
  const game = fixture({ perCat: 4, cats: ['a', 'b'] });
  let s = relayStart(game, { perRep: 2 });
  assert.deepEqual(S.wheelCandidates(game, s), ['a', 'b'], '4문제 카테고리도 그대로 후보 (최소 수는 대표 수 기준)');
  assert.deepEqual(S.homeCandidates(game, [], S.sessionNeed(s)), ['a', 'b']);
  s = S.confirmPick(s, game, 'a').session;
  s = S.next(s, game).session;
  s = answer(s, game, 0); s = S.next(s, game).session; s = answer(s, game, 1);
  s = S.next(s, game).session; s = answer(s, game, 0); s = S.next(s, game).session; s = answer(s, game, null);
  const st = S.relayStatus(s, game);
  assert.equal(st.ending, true); assert.equal(st.short, true, '낼 문제가 없어 순위가 다 안 정해진 채 끝남');
  assert.deepEqual(st.ranks, [1, 2, 3], '못 끝낸 팀은 맞힌 수로');
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roundEnd');
});

test('맞힌 사람 — 팀 · 대표 번호까지 기록, 인당 문제를 채운 대표는 빠짐, 대표 없이 오면 남은 첫 대표 (R-94, Y-20 · Y-21)', () => {
  const game = fixture({ perCat: 12, cats: ['a', 'b'] });
  const names = ['A', 'B', 'C'];
  let s = S.confirmPick(relayStart(game, { perRep: 2 }), game, 'a').session;
  s = S.next(s, game).session; s = S.reveal(S.next(s, game).session, game).session; // 소개 → Q1 정답
  s = S.credit(s, 0, names, 1).session; // Q1 팀1 대표2
  let st = S.relayStatus(s, game);
  assert.equal(s.history.at(-1).rep, 1, '기록에 대표 번호');
  assert.equal(st.scoredRep, 1); assert.deepEqual(st.reps[0], [0, 1], '대표마다 맞힌 수');
  const moved = S.credit(s, 0, names, 0);
  assert.equal(moved.toast, '맞힌 사람 변경: A 대표2 → 대표1', '같은 팀 다른 대표로 바꾸기');
  assert.deepEqual(S.relayStatus(moved.session, game).reps[0], [1, 0]);
  assert.equal(S.credit(s, 0, names, 1).session, s, '같은 사람이면 그대로');
  assert.equal(S.credit(s, 0, names).session, s, '대표 없이(게임 화면 숫자키) 같은 팀이면 그대로');
  assert.ok(S.credit(s, 1, names, 5).ignored, '없는 대표');
  s = S.next(s, game).session; s = S.reveal(s, game).session;
  s = S.credit(s, 0, names, 1).session; // Q2 팀1 대표2 — 2/2 빠짐
  st = S.relayStatus(s, game);
  assert.deepEqual(st.reps[0], [0, 2]); assert.deepEqual(st.finish, [], '한 사람만 빠짐 — 팀은 아직');
  s = S.next(s, game).session; s = S.reveal(s, game).session; // Q3
  assert.deepEqual(S.relayStatus(s, game).repsBefore[0], [0, 2], '이 문제 전 — 대표2 는 빠짐');
  const blocked = S.credit(s, 0, names, 1);
  assert.ok(blocked.ignored); assert.equal(blocked.toast, 'A 대표2 — 2문제를 다 맞혀 빠졌습니다');
  s = S.credit(s, 0, names).session; // 대표 없이 — 남은 첫 대표(대표1)
  st = S.relayStatus(s, game);
  assert.equal(st.scoredRep, 0); assert.deepEqual(st.reps[0], [1, 2]); assert.equal(s.history.at(-1).rep, 0);
  assert.deepEqual(questionLog(s, game).rounds[0].questions.map((q) => q.rep), [1, 1, 0], '문제 기록에 맞힌 대표');
  // R-94 전 기록(대표 번호 없음)은 그때 남은 첫 대표로 센다 — 팀 맞힌 수 · 등수는 그대로
  const legacy = { ...s, history: s.history.map(({ rep, ...op }) => op) };
  assert.deepEqual(S.relayStatus(legacy, game).reps[0], [2, 1]);
  assert.deepEqual(S.relayStatus(legacy, game).counts, st.counts);
});

test('맞힌 사람 — 정답 기록 고치기도 대표까지, 다 채운 대표로 남은 뒤 기록은 남은 대표로 센다 (R-94, Y-22)', () => {
  const game = fixture({ perCat: 12, cats: ['a', 'b'] });
  const names = ['A', 'B', 'C'];
  let s = S.confirmPick(relayStart(game, { perRep: 2 }), game, 'a').session;
  s = S.next(s, game).session;
  const pickRep = (x, team, rep) => S.credit(S.reveal(S.next(x, game).session, game).session, team, names, rep).session;
  s = pickRep(s, 0, 0); s = pickRep(s, 0, 1); s = pickRep(s, 0, 0); // Q1 대표1 · Q2 대표2 · Q3 대표1 — 팀1 [2, 1]
  assert.deepEqual(S.relayStatus(s, game).reps[0], [2, 1]);
  assert.equal(S.setCredit(s, 'a-q0', 0, { rep: 0, teamNames: names }).session, s, '같은 사람이면 그대로');
  // Q2 를 대표1 로 — Q2 전에는 대표1 이 1개라 된다. 그러면 Q3(대표1 기록)은 다 채운 대표라 남은 대표2 로 센다
  const fixed = S.setCredit(s, 'a-q1', 0, { rep: 0, teamNames: names }).session;
  assert.deepEqual(questionLog(fixed, game).rounds[0].questions.map((q) => q.rep), [0, 0, 1]);
  assert.deepEqual(S.relayStatus(fixed, game).counts, [3, 0, 0], '팀 맞힌 수는 그대로');
  assert.equal(S.setCredit(fixed, 'a-q2', 0, { rep: 0, teamNames: names }).error, 'A 대표1 — 2문제를 다 맞혀 빠졌습니다', '그 문제 전에 다 채운 대표는 고를 수 없다');
  assert.equal(S.setCredit(fixed, 'a-q2', 1, { teamNames: names }).session.history.at(-1).rep, 0, '대표 없이 다른 팀 — 그 팀의 남은 첫 대표');
});

test('팀당 대표 방식도 라운드당 문제 수만큼 뽑는다 — 순위가 정해지면 남은 문제는 돌려놓고, 최소 수보다 적게는 안 뽑음 (R-95, Y-24)', () => {
  const game = fixture({ perCat: 14, cats: ['a', 'b'] });
  let s = S.confirmPick(relayStart(game, { perRep: 2, questionsPerRound: 12 }), game, 'a').session;
  assert.equal(s.picks[0].questionIds.length, 12, '라운드당 문제 12 → 12개');
  s = S.next(s, game).session;
  for (let i = 0; i < 4; i++) { if (i) s = S.next(s, game).session; s = answer(s, game, 0); } // Q1 ~ Q4 팀1 → 1등
  for (let i = 0; i < 4; i++) { s = S.next(s, game).session; s = answer(s, game, 1); } // Q5 ~ Q8 팀2 → 2등, 순위 정해짐
  s = S.next(s, game).session;
  assert.equal(s.screen, 'roundEnd', '12개를 다 내지 않아도 순위가 정해지면 라운드 종료');
  assert.equal(s.picks[0].questionIds.length, 8, '안 낸 4개는 돌려놓음');
  assert.equal(S.remainingQuestions(game, s, 'a').length, 6);
  const few = S.confirmPick(relayStart(game, { questionsPerRound: 2 }), game, 'b').session;
  assert.equal(few.picks[0].questionIds.length, 4, '라운드당 문제가 최소 수((팀 수 − 1) × 대표 수)보다 적으면 최소 수');
  const short = fixture({ perCat: 5, cats: ['a'] });
  assert.equal(S.confirmPick(relayStart(short, { questionsPerRound: 12 }), short, 'a').session.picks[0].questionIds.length, 5, '카테고리에 있는 만큼만');
});

test('인당 문제 옵션 — 기본 1, 관리 페이지 데이터 기본값, 1 ~ 5 검증, 1 은 저장 안 함 (R-64, Y-19)', () => {
  const photo = fixture();
  assert.equal(S.effectiveOptions(photo, {}).perRep, 1);
  assert.equal(S.effectiveOptions({ ...photo, defaults: { ...photo.defaults, perRep: 2 } }, {}).perRep, 2, '데이터 기본값');
  assert.equal(S.effectiveOptions({ ...photo, defaults: { perRep: 2 } }, { perRep: 9 }).perRep, 2, '범위 밖은 무시');
  const v = validateGame({ schemaVersion: 1, id: 'photo-quiz', type: 'photo', title: '사진', defaults: { perRep: 8 }, categories: [{ id: 'a', name: 'A', questions: [] }] }, { fileId: 'photo-quiz' });
  assert.equal(v.game.defaults.perRep, 5); assert.ok(v.warnings.some((w) => w.path.endsWith('defaults.perRep')));
  assert.ok(!serializeGame({ ...v.game, defaults: { relay: 2, perRep: 1 } }).includes('perRep'), '1 은 기본값이라 저장하지 않음');
  assert.ok(serializeGame({ ...v.game, defaults: { relay: 2, perRep: 2 } }).includes('"perRep": 2'));
  // 인당 문제 전 세션 — 옵션에 없으면 1 (R-62 그대로)
  const old = S.confirmPick(relayStart(photo), photo, 'a').session;
  delete old.snapshot.options.perRep;
  assert.equal(relayPerOf(old), 1); assert.equal(relayGoal(old), 2);
});

test('이모티콘 퀴즈 기본 배점 — 게임 전체 정답 수 라운드 1행, 정답 1개당 50 (R-49)', () => {
  const emoji = validateGame(JSON.parse(read('data/games/emoji-quiz.json')), { fileId: 'emoji-quiz' }).game;
  const { rounds, errors } = validateScoreboardDefaults(JSON.parse(read('data/scoreboard.json')), { games: { 'emoji-quiz': emoji } });
  assert.deepEqual(errors, []);
  const linked = rounds.filter((r) => r.gameId === 'emoji-quiz');
  assert.equal(linked.length, 1);
  assert.equal(SB.perCorrectRound(rounds, 'emoji-quiz').per, 50);
});

// ── 사진 확대 — 보이는 범위 (docs/08-tech.md 7-2) ─────────────
test('확대: focus 가 화면 가운데, 가장자리는 이미지 밖이 안 보이게 보정 (E-5 · E-7)', async () => {
  const { zoomView } = await import('../app/ui/render-photo.js');
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let v = zoomView([50, 50], 2);
  assert.ok(near(v.left, 25) && near(v.top, 25) && near(v.size, 50));
  v = zoomView([32, 41], 6); // 가운데 정렬: 32 − 50/6
  assert.ok(near(v.left, 32 - 50 / 6) && near(v.top, 41 - 50 / 6));
  v = zoomView([0, 0], 5); // 모서리 → 이미지 안쪽으로
  assert.ok(near(v.left, 0) && near(v.top, 0) && near(v.size, 20));
  v = zoomView([100, 97], 4);
  assert.ok(near(v.left, 75) && near(v.top, 75));
  v = zoomView([12, 88], 1); // 원래 크기 — 이동 없음
  assert.ok(near(v.left, 0) && near(v.top, 0) && near(v.size, 100));
});

// ── 줄줄이 말해요 문제 (R-44) ────────────────────────────
function chainFixture() {
  return validateGame({
    schemaVersion: 1, id: 'chain-talk', type: 'roulette', title: '줄줄이 말해요',
    categories: [
      {
        id: 'prefix', name: '앞 두 글자', rule: '앞 두 글자로 네 글자 낱말', questions: [
          { id: 'prefix-a2b3', prompt: '코스○○', answers: ['코스모스', '코스요리', '코스피아'], note: '세 글자 불인정' },
          { id: 'prefix-c4d5', prompt: '노발○○', answers: ['노발대발'] },
          { id: 'prefix-e6f7', prompt: '숨김○○', answers: ['숨김문제'], disabled: true },
        ],
      },
      { id: 'snack', name: '봉지과자', rule: '돌아가며 과자 이름 말하기', examples: ['새우깡'] },
    ],
  }, { fileId: 'chain-talk' }).game;
}

test('줄줄이 말해요 문제 검증 — 문제 글자 · 정답 후보 필수, 겹침 경고, id 중복 (R-44, 02-data-schema 4-3)', () => {
  const base = (questions) => ({ schemaVersion: 1, id: 'chain-talk', type: 'roulette', title: '줄줄이', categories: [{ id: 'a', name: '가', rule: '규칙', questions }] });
  const ok = validateGame(base([{ id: 'a-2345', prompt: '코스○○', answers: [' 코스모스 ', ''] }]), { fileId: 'chain-talk' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.game.categories[0].questions[0].answers, ['코스모스'], '앞뒤 공백 · 빈 후보 정리');
  const codes = (q) => validateGame(base([q]), { fileId: 'chain-talk' });
  assert.ok(codes({ id: 'a-2345', answers: ['x'] }).errors.some((e) => e.code === 'E03' && e.path.endsWith('prompt')));
  assert.ok(codes({ id: 'a-2345', prompt: '코스○○', answers: [] }).errors.some((e) => e.code === 'E03' && e.path.endsWith('answers')));
  assert.ok(codes({ id: 'a-2345', prompt: '코스○○' }).errors.some((e) => e.code === 'E03'));
  assert.ok(codes({ id: 'a-2345', prompt: '코스○○', answers: '코스모스' }).errors.some((e) => e.code === 'E04'));
  assert.ok(codes({ id: 'a-2345', prompt: '코스○○', answers: ['코스 모스', '코스모스'] }).warnings.some((w) => w.code === 'W07'));
  const twice = validateGame(base([{ id: 'a-2345', prompt: '코스○○', answers: ['x'] }, { id: 'a-2345', prompt: '코스 ○○', answers: ['y'] }]), { fileId: 'chain-talk' });
  assert.ok(twice.errors.some((e) => e.code === 'E05'));
  assert.ok(twice.warnings.some((w) => w.code === 'W07'), '같은 문제 글자');
  // 문제 없는 주제는 그대로 (예전 파일)
  assert.deepEqual(rouletteFixture().categories[0].questions, []);
});

test('줄줄이 말해요 문제 직렬화 — 키 순서 · 후보 한 줄 · 문제 없으면 키 없음 (R-44)', () => {
  const out = serializeGame({
    schemaVersion: 1, id: 'chain-talk', type: 'roulette', title: '줄줄이',
    categories: [
      { id: 'a', name: '가', rule: '규칙', questions: [{ addedAt: '2026-10-12', disabled: false, note: ' 메모 ', answers: ['코스모스', ' 코스요리 ', ''], prompt: ' 코스○○ ', id: 'a-2345' }] },
      { id: 'b', name: '나', rule: '규칙', questions: [] },
    ],
  });
  assert.ok(out.includes('"answers": ["코스모스", "코스요리"]'));
  assert.ok(out.includes('"prompt": "코스○○"'));
  assert.ok(!out.includes('"disabled"'));
  const q = JSON.parse(out).categories[0].questions[0];
  assert.deepEqual(Object.keys(q), ['id', 'prompt', 'answers', 'note', 'addedAt']);
  assert.equal(JSON.parse(out).categories[1].questions, undefined, '빈 questions 는 저장하지 않음');
  assert.equal(serializeGame(JSON.parse(out)), out, '다시 저장해도 같은 글자');
});

test('줄줄이 말해요 — 주제 카드 → 첫 문제 · 다음 문제 · 취소 · 정답 후보 (H-11 ~ H-17)', () => {
  const game = chainFixture();
  let s = S.createRouletteSession({ game, candidates: S.homeCandidates(game) });
  s = S.confirmPick(s, game, 'prefix').session;
  assert.equal(s.screen, 'topic');
  assert.equal(S.topicQuestionId(s), null, '먼저 주제 카드 (D-25)');
  assert.equal(S.toggleAnswers(s).session, s, '주제 카드에서는 정답 후보 토글 없음');
  s = S.topicQuestion(s, game).session;
  const first = S.topicQuestionId(s);
  assert.ok(['prefix-a2b3', 'prefix-c4d5'].includes(first), '숨긴 문제는 안 나옴');
  s = S.toggleAnswers(s).session;
  assert.equal(s.answersVisible, true);
  s = S.topicQuestion(s, game).session;
  const second = S.topicQuestionId(s);
  assert.notEqual(second, first);
  assert.equal(s.answersVisible, false, '문제가 바뀌면 정답 후보 다시 숨김');
  const none = S.topicQuestion(s, game);
  assert.equal(none.error, '이 주제에 남은 문제가 없습니다');
  // ← : 방금 문제 취소 → 직전 문제 → 주제 카드 → 주제 취소
  s = S.topicPrev(s).session;
  assert.equal(S.topicQuestionId(s), first);
  assert.equal(S.remainingQuestions(game, s, 'prefix').length, 1, '취소한 문제는 다시 나올 수 있음');
  s = S.topicPrev(s).session;
  assert.equal(S.topicQuestionId(s), null); assert.equal(s.screen, 'topic');
  s = S.topicPrev(s).session;
  assert.equal(s.screen, 'roulette'); assert.equal(s.picks.length, 0);
  // 문제 없는 주제
  s = S.confirmPick(s, game, 'snack').session;
  assert.equal(S.topicQuestion(s, game).error, '문제가 없는 주제입니다');
});

test('줄줄이 말해요 주제 고르기 — 진행자가 고르면 주제 카드, 문제는 진행자가 [첫 문제 ▶] 로 시작 (R-65, H-24 · H-25)', () => {
  const game = chainFixture();
  let s = S.createRouletteSession({ game, candidates: S.homeCandidates(game), options: { questionOrder: 'fixed' } });
  s = S.pickTopic(s, game, 'prefix').session;
  assert.deepEqual([s.screen, S.topicQuestionId(s)], ['topic', null], '문제가 있는 주제도 먼저 주제 카드 — 첫 문제가 바로 나오지 않음');
  assert.equal(S.pickTopic(s, game, 'snack').session, s, '주제 고르기 화면에서만');
  s = S.topicQuestion(s, game).session;
  assert.equal(S.topicQuestionId(s), 'prefix-a2b3', '진행자가 시작하면 첫 문제 (작성 순서)');
  // ← 두 번: 첫 문제 취소 → 주제 카드 → 주제 취소
  s = S.topicPrev(S.topicPrev(s).session).session;
  assert.deepEqual([s.screen, s.picks.length, S.remainingQuestions(game, s, 'prefix').length], ['roulette', 0, 2]);
  // 문제가 없는 주제도 주제 카드
  s = S.pickTopic(s, game, 'snack').session;
  assert.deepEqual([s.screen, S.topicQuestionId(s)], ['topic', null]);
  s = S.topicNext(s, game).session;
  // 없는 주제 · 숨긴 주제
  assert.equal(S.pickTopic(s, game, 'nope').error, '없는 주제입니다');
  const hidden = { ...game, categories: game.categories.map((c) => (c.id === 'snack' ? { ...c, disabled: true } : c)) };
  assert.equal(S.pickTopic(s, hidden, 'snack').error, '없는 주제입니다');
  // 점수형 세션은 해당 없음
  const photo = fixture();
  const score = start(photo);
  assert.equal(S.pickTopic(score, photo, 'a').session, score);
});

test('줄줄이 말해요 무작위 주제 — 게임 홈에서 넣은 주제 중 문제를 다 내지 않은 것만, 없으면 거절 (R-65, H-26)', () => {
  const game = chainFixture();
  let s = S.createRouletteSession({ game, candidates: ['prefix'], options: { questionOrder: 'fixed' } });
  assert.deepEqual(S.topicPool(game, s), ['prefix'], '후보에 없는 주제(snack — 보완 전 게임 홈에서 뺀 진행 기록)는 무작위에 없음');
  assert.deepEqual(S.homeCandidates(game, []), ['prefix', 'snack'], '게임 홈은 제외 없이 숨김 아닌 주제 전부 (R-65 보완)');
  s = S.pickTopic(s, game).session;
  assert.equal(s.picks.at(-1).categoryId, 'prefix');
  s = S.topicQuestion(s, game).session;
  s = S.topicQuestion(s, game).session; // 마지막 문제
  s = S.topicNext(s, game).session;
  assert.deepEqual(S.topicPool(game, s), [], '문제를 다 낸 주제는 무작위에서 빠짐');
  assert.equal(S.pickTopic(s, game).error, '무작위로 고를 주제가 없습니다 — 목록에서 직접 고르세요');
  // 직접 고르면 다 낸 주제 · 뺀 주제도 된다 (주제 카드로)
  s = S.pickTopic(s, game, 'prefix').session;
  assert.deepEqual([s.screen, S.topicQuestionId(s)], ['topic', null]);
  s = S.topicNext(s, game).session;
  s = S.pickTopic(s, game, 'snack').session;
  assert.equal(s.picks.at(-1).categoryId, 'snack');
});

test('줄줄이 말해요 — 낸 문제는 다시 안 나오고, 다 낸 주제는 다시 추첨 때 원판에서 빠진다 · 다시 넣기 (H-16, H-20 ~ H-22, D-26)', () => {
  const game = chainFixture();
  let s = S.createRouletteSession({ game, candidates: S.homeCandidates(game) });
  s = S.confirmPick(s, game, 'prefix').session;
  s = S.topicQuestion(s, game).session;
  const first = S.topicQuestionId(s);
  // 아직 남았으면 다시 추첨해도 원판에 그대로 · 낸 문제는 다시 안 나옴
  s = S.topicNext(s, game).session;
  assert.ok(s.wheel.includes('prefix'));
  s = S.confirmPick(s, game, 'prefix').session;
  s = S.topicQuestion(s, game).session;
  assert.notEqual(S.topicQuestionId(s), first);
  // 마지막 문제를 낸 뒤 다시 추첨 → 자동으로 빠짐
  s = S.topicNext(s, game).session;
  const item = S.wheelList(game, s).find((i) => i.id === 'prefix');
  assert.deepEqual([item.remaining, item.included, item.exhausted], [0, false, false]);
  assert.ok(!S.wheelCandidates(game, s).includes('prefix'));
  assert.equal(S.wheelList(game, s).find((i) => i.id === 'snack').remaining, null, '문제 없는 주제는 남은 수 없음');
  // 모두 넣기로는 안 들어가고, 하나씩은 넣을 수 있음
  s = S.includeAll(s, game).session;
  assert.deepEqual(s.wheel, ['snack']);
  s = S.toggleWheel(s, game, 'prefix').session;
  assert.deepEqual(s.wheel, ['prefix', 'snack']);
  // 다시 넣은 주제가 문제 없이 뽑혔다 넘어가면 그대로 (자동으로 빼는 것은 다 낸 그때 한 번)
  s = S.confirmPick(s, game, 'prefix').session;
  assert.equal(S.topicQuestion(s, game).error, '이 주제에 남은 문제가 없습니다');
  s = S.topicNext(s, game).session;
  assert.ok(s.wheel.includes('prefix'));
  // 세션 파일 형식 · 직렬화
  assert.equal(checkStateFile('session', s, { gameId: 'chain-talk' }), null);
  const text = serializeState('session', s);
  assert.ok(text.includes('"questionIds"'));
  assert.ok(text.includes('"questionOrder": "random"'));
});

test('줄줄이 말해요 문제 고르기 — 작성 순서 · 진행자가 고른 문제 · 거절 (H-23, W-37, D-24)', () => {
  const game = chainFixture();
  let s = S.createRouletteSession({ game, candidates: S.homeCandidates(game), options: { questionOrder: 'fixed' } });
  assert.equal(S.topicOrder(s), 'fixed');
  s = S.confirmPick(s, game, 'prefix').session;
  assert.equal(S.topicNextId(game, s), 'prefix-a2b3');
  s = S.topicQuestion(s, game).session;
  assert.equal(S.topicQuestionId(s), 'prefix-a2b3', '작성 순서 — 첫 번째');
  assert.equal(S.topicNextId(game, s), 'prefix-c4d5');
  // 진행자가 고름 — 낸 문제 · 다른 주제 · 숨긴 문제는 거절
  assert.equal(S.topicQuestion(s, game, 'prefix-a2b3').error, '이미 낸 문제입니다');
  assert.equal(S.topicQuestion(s, game, 'snack-zzzz').error, '이 주제의 문제가 아닙니다');
  assert.equal(S.topicQuestion(s, game, 'prefix-e6f7').error, '숨긴 문제입니다');
  s = S.topicQuestion(s, game, 'prefix-c4d5').session;
  assert.equal(S.topicQuestionId(s), 'prefix-c4d5');
  // 주제 카드에서도 골라서 첫 문제로
  let t = S.createRouletteSession({ game, candidates: S.homeCandidates(game) });
  assert.equal(S.topicOrder(t), 'random');
  t = S.confirmPick(t, game, 'prefix').session;
  assert.equal(S.topicNextId(game, t), null, '랜덤이면 다음 문제 표시 없음');
  t = S.topicQuestion(t, game, 'prefix-c4d5').session;
  assert.equal(S.topicQuestionId(t), 'prefix-c4d5');
  // 예전 세션 (options 비어 있음) → 랜덤
  assert.equal(S.topicOrder({ snapshot: { options: {} } }), 'random');
});

test('줄줄이 말해요 진행 기본값 — 문제 순서만 저장 (R-45)', () => {
  const base = { schemaVersion: 1, id: 'chain-talk', type: 'roulette', title: '줄줄이', categories: [{ id: 'a', name: '가', rule: '규칙' }] };
  const fixed = serializeGame({ ...base, defaults: { rounds: 3, questionsPerRound: 4, questionOrder: 'fixed' } });
  assert.deepEqual(JSON.parse(fixed).defaults, { questionOrder: 'fixed' });
  assert.equal(validateGame(JSON.parse(fixed), { fileId: 'chain-talk' }).game.defaults.questionOrder, 'fixed');
  assert.equal(JSON.parse(serializeGame({ ...base, defaults: { questionOrder: 'random' } })).defaults, undefined, '기본값(랜덤)은 저장하지 않음');
});

test('줄줄이 말해요 복원 — 지운 문제 건너뛰기 · 예전 세션(questionIds 없음) (R-44)', () => {
  const game = chainFixture();
  let s = S.createRouletteSession({ game, candidates: S.homeCandidates(game) });
  s = S.confirmPick(s, game, 'prefix').session;
  s = S.topicQuestion(s, game).session;
  const gone = S.topicQuestionId(s);
  const trimmed = JSON.parse(JSON.stringify(game));
  trimmed.categories[0].questions = trimmed.categories[0].questions.filter((q) => q.id !== gone);
  const res = S.repairSession(s, trimmed);
  assert.ok(res.notice);
  assert.equal(S.topicQuestionId(res.session), null, '지운 문제 → 주제 카드');
  const old = { version: 1, gameId: 'chain-talk', type: 'roulette', status: 'active', screen: 'topic', wheel: ['prefix'], picks: [{ categoryId: 'prefix' }], snapshot: { teamCount: 0, candidates: ['prefix'], options: {} }, examplesVisible: false };
  const fixed = S.repairSession(old, game).session;
  assert.equal(fixed.answersVisible, false);
  assert.equal(S.topicQuestionId(fixed), null);
  assert.ok(S.topicQuestion(fixed, game).session.picks[0].questionIds.length === 1);
});

test('이미지 요청은 한 번에 4장씩 — 없는 이미지 확인 · 미리 받기 (R-55, X-51)', async () => {
  const qs = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, answer: `${i}`, image: `assets/p/c1/q${i}.png`, ...(i < 2 ? { answerImage: `assets/p/c1/a${i}.png` } : {}) }));
  const game = { categories: [{ id: 'c1', questions: qs }, { id: 'c2', questions: [{ id: 'x', answer: 'x', image: 'assets/p/c2/x.png' }] }] };
  const realFetch = globalThis.fetch;
  let running = 0;
  let peak = 0;
  globalThis.fetch = async (url) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return { ok: !url.endsWith('/q3.png') };
  };
  try {
    assert.deepEqual(await missingImages(game, ['c1']), ['assets/p/c1/q3.png'], '제외한 카테고리(c2)는 묻지 않음');
    assert.equal(peak, IMAGE_AT_ONCE);
  } finally { globalThis.fetch = realFetch; }

  const imgs = [];
  globalThis.Image = class { set src(v) { this.url = v; imgs.push(this); } };
  try {
    preloadImages(game, ['c1']);
    assert.equal(imgs.length, IMAGE_AT_ONCE, '처음엔 4장만 요청');
    for (let n = 0; n < 12; n++) {
      const img = imgs.find((x) => !x.done);
      img.done = true;
      (n % 3 ? img.onload : img.onerror)(); // 실패한 이미지도 자리를 비운다
      await new Promise((r) => setTimeout(r, 0));
      assert.ok(imgs.filter((x) => !x.done).length <= IMAGE_AT_ONCE);
    }
    assert.deepEqual(imgs.map((x) => x.url).sort(), [...qs.map((q) => `/${q.image}`), '/assets/p/c1/a0.png', '/assets/p/c1/a1.png'].sort(), '12장 모두 한 번씩');
  } finally { delete globalThis.Image; }
});

test('이미지 주소 — 표가 있으면 Blob 주소 · 없는 이미지는 요청 없이, 표가 없으면 /assets/… (R-70, X-58)', async () => {
  const { assetUrl, assetKnown, setAssetUrl, setAssetUrlsForTest } = await import('../app/core/assets.js');
  const { missingImages } = await import('../app/core/data.js');
  const game = { categories: [{ id: 'c', questions: [{ id: 'q1', image: 'assets/g/c/q1.png', answerImage: 'assets/g/c/q1-answer.png' }, { id: 'q2', image: 'assets/g/c/q2.png' }] }] };
  setAssetUrlsForTest(null);
  assert.equal(assetUrl('assets/g/c/q1.png'), '/assets/g/c/q1.png', '노트북 모드');
  assert.equal(assetKnown('assets/g/c/q1.png'), undefined);
  setAssetUrlsForTest({ 'assets/g/c/q1.png': 'https://blob.test/q1-x.png', 'assets/g/c/q2.png': 'https://blob.test/q2-x.png' });
  assert.equal(assetUrl('assets/g/c/q1.png'), 'https://blob.test/q1-x.png');
  assert.equal(assetKnown('assets/g/c/q1-answer.png'), false);
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('요청하면 안 됨'); };
  try {
    assert.deepEqual(await missingImages(game, ['c']), ['assets/g/c/q1-answer.png'], '표로 판단 — 요청 없음');
  } finally {
    globalThis.fetch = realFetch;
  }
  setAssetUrl('assets/g/c/q1-answer.png', 'https://blob.test/q1-answer-y.png');
  assert.equal(assetUrl('assets/g/c/q1-answer.png'), 'https://blob.test/q1-answer-y.png', '막 올린 이미지');
  setAssetUrlsForTest(null);
});
