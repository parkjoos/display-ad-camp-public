// 관리 페이지 순수 로직 테스트 — 표 붙여넣기 해석 (docs/02-data-schema.md 6장, docs/04-admin.md 3-9), 클립보드 이미지 (3-6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseEmojiRows, parseRouletteRows, findCat, EMOJI_HEADER } from '../app/admin/paste.js';
import { clipboardImage, pasteAction } from '../app/admin/clipboard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('템플릿 파일 — 머리글이 붙여넣기 형식과 같고 예시 행이 모두 ✔ (DATA-3)', () => {
  const text = readFileSync(join(ROOT, 'docs/templates/emoji-quiz-template.tsv'), 'utf8');
  assert.deepEqual(text.split('\n')[0].split('\t'), EMOJI_HEADER);
  const rows = parseEmojiRows(text, { categories: [] });
  assert.ok(rows.every((r) => r.status === 'ok')); // 예시 행 수는 바뀔 수 있어 세지 않는다
});

const emojiGame = {
  categories: [
    { id: 'movie', name: '영화', questions: [{ id: 'movie-a2b3', answer: '기생충' }] },
    { id: 'proverb', name: '속담', questions: [] },
  ],
};

test('이모티콘 붙여넣기 — 머리글 건너뜀 · ✔ / ✕ 사유 (I-20)', () => {
  const lines = [EMOJI_HEADER.join('\t')];
  for (let i = 0; i < 9; i++) lines.push(`속담\t🐦🐦🪨\t정답${i}\t\t\t`);
  lines.push('속담\t🐦\t\t힌트\t\t'); // 정답 누락
  const rows = parseEmojiRows(lines.join('\n'), emojiGame);
  assert.equal(rows.length, 10);
  assert.equal(rows.filter((r) => r.status === 'ok' && r.include).length, 9);
  const bad = rows.find((r) => r.status === 'skip');
  assert.equal(bad.reason, '정답이 없습니다');
  assert.equal(bad.include, false);
});

test('이모티콘 붙여넣기 — 순차공개 · 공백 정리 · 시트 따옴표 · CRLF', () => {
  const rows = parseEmojiRows('영화\t🦁👑   🌍\t라이온 킹\t디즈니\t"메모 ""따옴표"""\tO\r\n영화\t🦈\t죠스\t\t\t', emojiGame);
  assert.equal(rows[0].emojis, '🦁👑 🌍');
  assert.equal(rows[0].sequential, true);
  assert.equal(rows[0].note, '메모 "따옴표"');
  assert.equal(rows[1].sequential, false);
});

test('이모티콘 붙여넣기 — 이미 있는 정답 · 표 안 중복은 ⚠ 로 처음에 빼 둠, 그 밖 ⚠ 는 포함', () => {
  const rows = parseEmojiRows([
    '영화\t🪱🏠💰\t기 생 충\t\t\t', // 공백 · 대소문자 무시하고 같은 정답
    '속담\t🐦🐦🪨\t일석이조\t\t\t',
    '속담\t🐦🐦\t일석이조\t\t\t',
    '속담\t가나다\t테스트\t\t\t',
  ].join('\n'), emojiGame);
  assert.equal(rows[0].status, 'warn');
  assert.match(rows[0].reason, /movie-a2b3/);
  assert.equal(rows[0].include, false);
  assert.equal(rows[1].include, true);
  assert.equal(rows[2].status, 'warn');
  assert.equal(rows[2].include, false);
  assert.equal(rows[3].status, 'warn');
  assert.match(rows[3].reason, /이모지가 아닌 글자/);
  assert.equal(rows[3].include, true);
});

test('이모티콘 붙여넣기 — 없는 카테고리는 그대로 두고 이름 · id 로 찾기 (I-21)', () => {
  const rows = parseEmojiRows('드라마\t📺\t오징어 게임\t\t\t\nmovie\t🦈\t죠스\t\t\t', emojiGame);
  assert.equal(rows[0].status, 'ok');
  assert.equal(findCat(emojiGame, rows[0].category), null);
  assert.equal(findCat(emojiGame, rows[1].category)?.id, 'movie');
  assert.equal(findCat(emojiGame, ' 영화 ')?.id, 'movie');
});

test('줄줄이 말해요 붙여넣기 — 예시 쉼표 구분 · 아이콘 보정 · 같은 이름은 빼 둠', () => {
  const game = { categories: [{ id: 'girl-group', name: '걸그룹 이름 대기' }] };
  const rows = parseRouletteRows([
    '주제 이름\t아이콘\t규칙\t예시 (쉼표 구분)',
    '라면 이름 대기\t🍜🍜\t라면 이름을 하나씩\t신라면, 진라면，짜파게티',
    '걸그룹 이름 대기\t🎤\t중복\t',
    '\t🎮\t규칙만\t',
    '이름만\t\t\t',
  ].join('\n'), game);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].icon, '🍜');
  assert.deepEqual(rows[0].examples, ['신라면', '진라면', '짜파게티']);
  assert.equal(rows[0].status, 'warn');
  assert.equal(rows[0].include, true);
  assert.equal(rows[1].include, false);
  assert.equal(rows[2].status, 'skip');
  assert.equal(rows[3].status, 'skip');
  assert.equal(rows[3].reason, '규칙이 없습니다');
});

// ── 클립보드 이미지 붙여넣기 (docs/04-admin.md 3-6, R-34) ──
const file = (name, type) => ({ name, type });

test('클립보드에서 이미지 파일 고르기 — 화면 캡처 · Finder 복사 · 이미지 아닌 것', () => {
  const shot = file('image.png', 'image/png');
  assert.equal(clipboardImage({ files: [shot], items: [] }), shot, '화면 캡처 · "이미지 복사"');
  const finder = file('사진.JPG', '');
  assert.equal(clipboardImage({ files: [finder], items: [] }), finder, '형식이 비어 있어도 확장자로 (Finder 복사)');
  assert.equal(clipboardImage({ files: [file('memo.pdf', 'application/pdf')], items: [] }), null);
  assert.equal(clipboardImage({ files: [], items: [{ kind: 'string', type: 'text/plain' }] }), null, '글자만');
  const fromItem = file('image.png', 'image/png');
  assert.equal(clipboardImage({ files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => fromItem }] }), fromItem, 'files 가 비고 items 에만 있는 경우');
  assert.equal(clipboardImage(null), null);
});

test('⌘V 처리 — 글자 칸의 글자 붙여넣기는 그대로, 이미지가 없으면 안내 (I-45 ~ I-49)', () => {
  assert.equal(pasteAction({ hasImage: true, hasText: false, typing: false }), 'image');
  assert.equal(pasteAction({ hasImage: true, hasText: false, typing: true }), 'image', '글자 칸이어도 글자가 없으면 이미지');
  assert.equal(pasteAction({ hasImage: true, hasText: true, typing: true }), 'text', '글자 칸 + 글자 → 글자 붙여넣기');
  assert.equal(pasteAction({ hasImage: true, hasText: true, typing: false }), 'image');
  assert.equal(pasteAction({ hasImage: false, hasText: true, typing: true }), 'text');
  assert.equal(pasteAction({ hasImage: false, hasText: true, typing: false }), 'none', '글자 칸 밖 + 이미지 없음 → 안내');
  assert.equal(pasteAction({ hasImage: false, hasText: false, typing: false }), 'none');
});

test('줄줄이 말해요 정답 후보 입력 — 쉼표 · 줄바꿈으로 나누고, 겹치면 하나만 (I-53, R-44)', async () => {
  const { splitAnswers, addAnswers } = await import('../app/admin/paste.js');
  assert.deepEqual(splitAnswers('코스모스, 코스요리\n코스피아，코스트코、 \t코스닥'), ['코스모스', '코스요리', '코스피아', '코스트코', '코스닥']);
  assert.deepEqual(splitAnswers('  '), []);
  const r = addAnswers(['코스모스'], ['코스 모스', '코스요리', '코스요리', 'ABC', 'abc']);
  assert.deepEqual(r.list, ['코스모스', '코스요리', 'ABC']);
  assert.deepEqual(r.added, ['코스요리', 'ABC']);
  assert.deepEqual(r.dup, ['코스 모스', '코스요리', 'abc']);
});

test('이미지 올릴 때 줄이기 — 500KB 넘는 PNG · JPEG 는 JPEG 0.85, 상한을 넘으면 0.9 로 줄여서 (D-35, R-67)', async () => {
  const { shrinkPlan, REENCODE_BYTES } = await import('../app/admin/image.js');
  const KB = 1024;
  assert.deepEqual(shrinkPlan({ ext: 'png', size: 400 * KB, width: 1600, height: 900 }), { scale: 1, tooBig: false, jpeg: false, quality: 0.85 }, '작은 PNG 는 그대로');
  assert.equal(shrinkPlan({ ext: 'png', size: REENCODE_BYTES + 1, width: 1600, height: 900 }).jpeg, true, '캡처 PNG');
  assert.equal(shrinkPlan({ ext: 'jpg', size: 2048 * KB, width: 1600, height: 900 }).quality, 0.85);
  assert.equal(shrinkPlan({ ext: 'webp', size: 2048 * KB, width: 1600, height: 900 }).jpeg, false, 'webp 는 크기 상한만');
  const big = shrinkPlan({ ext: 'png', size: 300 * KB, width: 4800, height: 2400 });
  assert.deepEqual(big, { scale: 0.5, tooBig: true, jpeg: true, quality: 0.9 }, '긴 변 2400 초과 — 줄여서');
  assert.equal(shrinkPlan({ ext: 'webp', size: 5 * 1024 * KB, width: 800, height: 600 }).tooBig, true, '4MB 초과');
});
