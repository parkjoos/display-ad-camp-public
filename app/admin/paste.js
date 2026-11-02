// 표 붙여넣기 (docs/02-data-schema.md 6장, docs/04-admin.md 3-9) — 구글 시트 · 엑셀에서 복사한 탭 구분 텍스트
import { emojiUnits, charCount, isSingleEmoji, graphemes, isEmoji, normKey } from '../core/validate.js';

export const EMOJI_HEADER = ['카테고리', '이모지', '정답', '힌트', '메모', '순차공개'];
export const ROULETTE_HEADER = ['주제 이름', '아이콘', '규칙', '예시 (쉼표 구분)'];

const YES = new Set(['o', 'y', '1', '예', 'yes', 'true', 'ㅇ', '○', 'v', '✔', '✓']);

/** 시트에서 복사한 칸이 따옴표로 감싸져 있으면 벗긴다 ("" → ") */
const unquote = (c) => (c.length >= 2 && c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c);

function rows(text) {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.split('\t').map((c) => unquote(c.trim()).trim()))
    .filter((r) => r.some((c) => c !== ''));
}

const isHeader = (row, header) => row[0] === header[0] && (row[1] ?? '') === header[1];
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();

export function findCat(game, nameOrId) {
  const key = String(nameOrId).trim();
  return game.categories.find((c) => c.id === key || c.name.trim() === key) ?? null;
}

/**
 * 이모티콘 문제 붙여넣기 해석.
 * ✕(skip) 은 등록 제외, ⚠(warn) 은 체크박스로 고름 — 이미 있는 정답 · 표 안 중복은 처음에 빼 둔다.
 * @returns {{status:'ok'|'warn'|'skip', reason:string, category:string, emojis, answer, hint, note, sequential, include:boolean}[]}
 */
export function parseEmojiRows(text, game) {
  const list = rows(text);
  if (list.length && isHeader(list[0], EMOJI_HEADER)) list.shift();
  const existing = new Map();
  for (const c of game.categories) for (const q of c.questions ?? []) existing.set(`${c.id}|${norm(q.answer)}`, q.id);
  const pasted = new Set();
  return list.map(([category = '', emojis = '', answer = '', hint = '', note = '', seq = '']) => {
    const out = { category, emojis: emojis.replace(/\s+/g, ' ').trim(), answer, hint, note, sequential: YES.has(seq.toLowerCase()), status: 'ok', reason: '', include: true };
    if (!category) return { ...out, status: 'skip', reason: '카테고리가 없습니다', include: false };
    if (!emojis) return { ...out, status: 'skip', reason: '이모지가 없습니다', include: false };
    if (!answer) return { ...out, status: 'skip', reason: '정답이 없습니다', include: false };
    const reasons = [];
    let include = true;
    const units = emojiUnits(out.emojis);
    if (units.length > 12) reasons.push('이모지가 12개를 넘습니다');
    if (units.some((u) => !isEmoji(u))) reasons.push('이모지가 아닌 글자가 있습니다');
    if (charCount(answer) > 60) reasons.push('정답이 60자를 넘습니다');
    if (charCount(hint) > 30) reasons.push('힌트가 30자를 넘습니다');
    if (charCount(note) > 100) reasons.push('메모가 100자를 넘습니다');
    const cat = findCat(game, category);
    const key = `${cat ? cat.id : `new:${category}`}|${norm(answer)}`;
    if (existing.has(key)) { reasons.push(`이미 있는 문제입니다 (${existing.get(key)})`); include = false; }
    else if (pasted.has(key)) { reasons.push('표 안에서 같은 정답이 겹칩니다'); include = false; }
    pasted.add(key);
    return { ...out, status: reasons.length ? 'warn' : 'ok', reason: reasons.join(' · '), include };
  });
}

/** 줄줄이 말해요 주제 붙여넣기 해석 */
export function parseRouletteRows(text, game) {
  const list = rows(text);
  if (list.length && isHeader(list[0], ROULETTE_HEADER)) list.shift();
  const names = new Set(game.categories.map((c) => norm(c.name)));
  const pasted = new Set();
  return list.map(([name = '', icon = '', rule = '', examples = '']) => {
    const out = {
      name, icon: isSingleEmoji(icon) ? icon : (graphemes(icon).find(isEmoji) ?? '❓'), rule,
      examples: examples.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      status: 'ok', reason: '', include: true,
    };
    if (!name) return { ...out, status: 'skip', reason: '주제 이름이 없습니다', include: false };
    if (!rule) return { ...out, status: 'skip', reason: '규칙이 없습니다', include: false };
    const reasons = [];
    let include = true;
    if (icon && !isSingleEmoji(icon)) reasons.push(`아이콘은 이모지 1개 — ${out.icon} 로 씁니다`);
    if (charCount(name) > 16) reasons.push('이름이 16자를 넘습니다');
    if (charCount(rule) > 60) reasons.push('규칙이 60자를 넘습니다');
    if (out.examples.length > 20) reasons.push('예시는 20개까지 권장합니다');
    if (names.has(norm(name))) { reasons.push('같은 이름의 주제가 있습니다'); include = false; }
    else if (pasted.has(norm(name))) { reasons.push('표 안에서 이름이 겹칩니다'); include = false; }
    pasted.add(norm(name));
    return { ...out, status: reasons.length ? 'warn' : 'ok', reason: reasons.join(' · '), include };
  });
}

// ── 줄줄이 말해요 정답 후보 입력 (docs/04-admin.md 3-13, R-44) ──
/** 정답 후보 입력 글을 나눈다 — 쉼표(전각 · 읽점 포함) · 줄바꿈 · 탭 */
export const splitAnswers = (text) => String(text ?? '').split(/[,，、\n\r\t]/).map((x) => x.trim()).filter(Boolean);

/**
 * 후보 목록에 더하기 — 띄어쓰기 · 대소문자를 무시하고 이미 있는 것은 뺀다.
 * @returns {{list: string[], added: string[], dup: string[]}}
 */
export function addAnswers(list, incoming) {
  const out = [...list];
  const keys = new Set(out.map(normKey));
  const added = [];
  const dup = [];
  for (const a of incoming) {
    const key = normKey(a);
    if (!key) continue;
    if (keys.has(key)) { dup.push(a); continue; }
    keys.add(key);
    out.push(a);
    added.push(a);
  }
  return { list: out, added, dup };
}
