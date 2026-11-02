// 데이터 검증 (docs/02-data-schema.md 5 · 7장). 브라우저와 서버가 같은 모듈을 쓴다.
// 오류(E) = 그 게임을 쓸 수 없음 / 저장 불가. 경고(W) = 보정해서 사용 / 저장 가능.
import { parseYouTube, clipUrl } from './youtube.js';

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const GAME_TYPES = ['photo', 'emoji', 'roulette'];
export const SCORE_TYPES = ['photo', 'emoji'];
export const EFFECTS = ['none', 'zoom', 'mask'];
export const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
export const TEAM_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
export const TEAM_COLOR_NAMES = ['파랑', '빨강', '노랑', '초록', '보라', '분홍', '청록', '주황'];

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;

/** 사람이 보는 글자 단위 (이모지 · 한글 1자 = 1) */
export function graphemes(str) {
  if (typeof str !== 'string') return [];
  if (segmenter) return Array.from(segmenter.segment(str), (s) => s.segment);
  return Array.from(str);
}
export const charCount = (str) => graphemes(str).length;

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
export const isEmoji = (g) => EMOJI_RE.test(g);
export const isSingleEmoji = (str) => {
  const g = graphemes(str);
  return g.length === 1 && isEmoji(g[0]);
};
/** emojis 문자열에서 이모지 묶음만 (공백 제외) */
export const emojiUnits = (str) => graphemes(str).filter((g) => g.trim() !== '');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (v) => JSON.parse(JSON.stringify(v));

class Report {
  constructor(prefix) { this.prefix = prefix; this.errors = []; this.warnings = []; }
  err(code, path, message) { this.errors.push({ code, path: path ? `${this.prefix}.${path}` : this.prefix, message: `${this.prefix}: ${message}` }); }
  warn(code, path, message) { this.warnings.push({ code, path: path ? `${this.prefix}.${path}` : this.prefix, message: `${this.prefix}: ${message}` }); }
}

/** 파일 글자 → JSON. 실패하면 E01 메시지 (git 충돌 표시가 남아 있으면 그 안내) */
export function parseJsonText(text, fileLabel) {
  try {
    return { value: JSON.parse(text) };
  } catch {
    const conflict = /^(<<<<<<<|=======|>>>>>>>)/m.test(text);
    return { error: { code: 'E01', path: fileLabel, message: conflict ? `${fileLabel}: git 충돌이 해결되지 않았습니다` : `${fileLabel} 을 읽을 수 없습니다 (문법 오류)` } };
  }
}

function checkLen(rep, path, value, max, label) {
  if (isStr(value) && charCount(value) > max) rep.warn('W05', path, `${label} 이(가) ${max}자를 넘습니다 (화면에서 자동 축소)`);
}

function checkPath(rep, path, value, expectedPrefix) {
  if (!isStr(value) || !value) { rep.err('E04', path, `${path} 경로가 올바르지 않습니다`); return false; }
  if (value.startsWith('/') || value.startsWith('./') || value.split('/').includes('..') || value.includes('\\')) {
    rep.err('E04', path, `${path} '${value}' 는 허용되지 않는 경로입니다`); return false;
  }
  if (!IMAGE_EXT_RE.test(value)) { rep.err('E04', path, `${path} '${value}' 는 지원하지 않는 이미지 형식입니다`); return false; }
  if (expectedPrefix && !value.startsWith(expectedPrefix)) rep.warn('W06', path, `${path} '${value}' 가 저장 규칙(${expectedPrefix}…)과 다릅니다`);
  return true;
}

// ── app.json ─────────────────────────────────────────────
export function validateApp(raw) {
  const rep = new Report('app.json');
  if (!isObj(raw)) { rep.err('E01', '', 'data/app.json 형식이 올바르지 않습니다'); return { ...rep, app: null }; }
  if (raw.schemaVersion !== 1) rep.err('E02', 'schemaVersion', `schemaVersion ${raw.schemaVersion} 는 지원하지 않습니다`);
  if (!isStr(raw.title) || !raw.title.trim()) rep.err('E03', 'title', 'title 이 없습니다');
  if (!Array.isArray(raw.games) || !raw.games.every((g) => isStr(g) && SLUG_RE.test(g))) rep.err('E04', 'games', 'games 는 게임 id 배열이어야 합니다');
  return { errors: rep.errors, warnings: rep.warnings, app: rep.errors.length ? null : { title: raw.title, subtitle: isStr(raw.subtitle) ? raw.subtitle : '', games: [...new Set(raw.games)] } };
}

// ── 게임 데이터 ──────────────────────────────────────────
/**
 * 게임 데이터 검증 + 실행용 정리(기본값 채움, W01 보정, W09 무시).
 * @returns {{errors, warnings, game}} game 은 오류가 없을 때만.
 */
export function validateGame(raw, { fileId } = {}) {
  const id = isObj(raw) && isStr(raw.id) ? raw.id : fileId ?? 'game';
  const rep = new Report(id);
  if (!isObj(raw)) { rep.err('E01', '', `data/games/${fileId}.json 형식이 올바르지 않습니다`); return { errors: rep.errors, warnings: rep.warnings, game: null }; }
  const g = clone(raw);

  if (g.schemaVersion !== 1) rep.err('E02', 'schemaVersion', `schemaVersion ${g.schemaVersion} 는 지원하지 않습니다`);
  if (!isStr(g.id)) rep.err('E03', 'id', 'id 가 없습니다');
  else if (!SLUG_RE.test(g.id)) rep.err('E04', 'id', `id '${g.id}' 은 슬러그 형식이 아닙니다`);
  if (fileId && isStr(g.id) && g.id !== fileId) rep.err('E06', 'id', `data/games/${fileId}.json 의 id 가 '${g.id}' 입니다`);
  if (!isStr(g.type)) rep.err('E03', 'type', 'type 이 없습니다');
  else if (!GAME_TYPES.includes(g.type)) rep.err('E07', 'type', `type '${g.type}' 은 지원하지 않습니다`);
  if (!isStr(g.title) || !g.title.trim()) rep.err('E03', 'title', 'title 이 없습니다');
  checkLen(rep, 'title', g.title, 20, '게임 이름');
  if (g.icon !== undefined && !isSingleEmoji(g.icon)) rep.warn('W05', 'icon', '게임 아이콘은 이모지 1개여야 합니다');
  checkLen(rep, 'description', g.description, 60, '게임 설명');
  if (g.order !== undefined && !isInt(g.order)) rep.err('E04', 'order', 'order 는 정수여야 합니다');
  if (g.rules !== undefined) {
    if (!Array.isArray(g.rules) || !g.rules.every(isStr)) rep.err('E04', 'rules', 'rules 는 문자열 배열이어야 합니다');
    else {
      if (g.rules.length > 6) rep.warn('W05', 'rules', '규칙 요약은 6줄까지 권장합니다');
      g.rules.forEach((r, i) => checkLen(rep, `rules[${i}]`, r, 40, '규칙 문구'));
    }
  }

  const type = g.type;
  const scoring = SCORE_TYPES.includes(type);

  // 진행 옵션 기본값 — 예전 파일의 timerSeconds 는 무시 (R-33, 타이머 없음)
  const d = isObj(g.defaults) ? g.defaults : {};
  const defaults = { rounds: 3, questionsPerRound: 5, questionOrder: 'random' };
  if (g.defaults !== undefined && !isObj(g.defaults)) rep.err('E04', 'defaults', 'defaults 는 객체여야 합니다');
  // 인당 문제 (R-64) — 1 ~ 5, 없으면 1
  for (const [key, lo, hi] of [['rounds', 1, 20], ['questionsPerRound', 1, 20], ['perRep', 1, 5]]) {
    if (d[key] === undefined) continue;
    if (!isInt(d[key])) { rep.err('E04', `defaults.${key}`, `defaults.${key} 는 정수여야 합니다`); continue; }
    const v = clamp(d[key], lo, hi);
    if (v !== d[key]) rep.warn('W01', `defaults.${key}`, `defaults.${key} ${d[key]} → ${v} 로 보정`);
    defaults[key] = v;
  }
  if (d.questionOrder !== undefined) {
    if (!['random', 'fixed'].includes(d.questionOrder)) rep.err('E04', 'defaults.questionOrder', `questionOrder '${d.questionOrder}' 는 지원하지 않습니다`);
    else defaults.questionOrder = d.questionOrder;
  }
  // 팀당 대표 수 (릴레이, R-62) — 0 = 끔. 없으면 게임 종류 기본값 (사진 2명)이라 그대로 비워 둔다
  if (d.relay !== undefined) {
    if (!isInt(d.relay)) rep.err('E04', 'defaults.relay', 'defaults.relay 는 정수여야 합니다');
    else {
      const v = clamp(d.relay, 0, 6);
      if (v !== d.relay) rep.warn('W01', 'defaults.relay', `defaults.relay ${d.relay} → ${v} 로 보정`);
      defaults.relay = v;
    }
  }

  // 카테고리
  if (!Array.isArray(g.categories) || g.categories.length === 0) {
    rep.err('E03', 'categories', 'categories 가 없습니다 (1개 이상)');
  }
  const categories = Array.isArray(g.categories) ? g.categories : [];
  const catIds = new Set();
  const qIds = new Set();
  const outCats = [];
  categories.forEach((c, ci) => {
    const cp = `categories[${ci}]`;
    if (!isObj(c)) { rep.err('E04', cp, `${cp} 형식이 올바르지 않습니다`); return; }
    if (!isStr(c.id)) rep.err('E03', `${cp}.id`, `${cp}.id 가 없습니다`);
    else if (!SLUG_RE.test(c.id) || c.id.length > 32) rep.err('E04', `${cp}.id`, `${cp}.id '${c.id}' 은 슬러그 형식이 아닙니다`);
    else if (catIds.has(c.id)) rep.err('E05', `${cp}.id`, `카테고리 id '${c.id}' 가 중복됩니다`);
    else catIds.add(c.id);
    if (!isStr(c.name) || !c.name.trim()) rep.err('E03', `${cp}.name`, `${cp}.name 이 없습니다`);
    checkLen(rep, `${cp}.name`, c.name, 16, '카테고리 이름');
    let icon = c.icon;
    if (icon !== undefined && !isSingleEmoji(icon)) {
      rep.warn('W05', `${cp}.icon`, `${cp}.icon 은 이모지 1개여야 합니다`);
      icon = graphemes(String(icon))[0] ?? '❓';
    }
    checkLen(rep, `${cp}.description`, c.description, 40, '카테고리 설명');
    if (c.disabled !== undefined && typeof c.disabled !== 'boolean') rep.err('E04', `${cp}.disabled`, `${cp}.disabled 는 true / false 여야 합니다`);
    const cat = {
      id: c.id, name: c.name, icon: icon ?? '❓', description: isStr(c.description) ? c.description : '',
      disabled: c.disabled === true,
    };
    if (type === 'roulette') {
      if (!isStr(c.rule) || !c.rule.trim()) rep.err('E03', `${cp}.rule`, `${cp}.rule 이 없습니다`);
      checkLen(rep, `${cp}.rule`, c.rule, 60, '규칙 문구');
      if (c.examples !== undefined && (!Array.isArray(c.examples) || !c.examples.every(isStr))) rep.err('E04', `${cp}.examples`, `${cp}.examples 는 문자열 배열이어야 합니다`);
      const examples = Array.isArray(c.examples) ? c.examples.filter(isStr) : [];
      if (examples.length > 20) rep.warn('W05', `${cp}.examples`, '예시는 20개까지 권장합니다');
      examples.forEach((e, ei) => checkLen(rep, `${cp}.examples[${ei}]`, e, 20, '예시'));
      cat.rule = c.rule ?? '';
      cat.examples = examples;
      // 주제별 문제 — 선택 (R-44). 문제 글자 + 정답 후보 목록
      cat.questions = [];
      if (c.questions !== undefined && !Array.isArray(c.questions)) rep.err('E04', `${cp}.questions`, `${cp}.questions 는 배열이어야 합니다`);
      else if (Array.isArray(c.questions)) {
        const prompts = new Map();
        c.questions.forEach((q, qi) => {
          const qp = `${cp}.questions[${qi}]`;
          const out = validateChainQuestion(rep, qp, q);
          if (!out) return;
          if (isStr(out.id)) {
            if (qIds.has(out.id)) rep.err('E05', `${qp}.id`, `문제 id '${out.id}' 가 중복됩니다`);
            qIds.add(out.id);
          }
          if (isStr(out.prompt)) {
            const key = normKey(out.prompt);
            if (prompts.has(key)) rep.warn('W07', `${qp}.prompt`, `같은 문제가 있습니다 (${prompts.get(key)})`);
            else prompts.set(key, out.id);
          }
          cat.questions.push(out);
        });
      }
    } else if (scoring) {
      checkLen(rep, `${cp}.prompt`, c.prompt, 30, '질문 문구');
      cat.prompt = isStr(c.prompt) && c.prompt.trim() ? c.prompt : null;
      if (type === 'photo') {
        if (c.defaultEffect !== undefined && !EFFECTS.includes(c.defaultEffect)) rep.err('E04', `${cp}.defaultEffect`, `defaultEffect '${c.defaultEffect}' 는 지원하지 않습니다`);
        cat.defaultEffect = EFFECTS.includes(c.defaultEffect) ? c.defaultEffect : 'none';
      }
      if (!Array.isArray(c.questions)) {
        rep.err('E03', `${cp}.questions`, `${cp}.questions 가 없습니다`);
        cat.questions = [];
      } else {
        const answers = new Map();
        cat.questions = [];
        c.questions.forEach((q, qi) => {
          const qp = `${cp}.questions[${qi}]`;
          const out = validateQuestion(rep, qp, q, type, g.id, c.id);
          if (!out) return;
          if (isStr(out.id)) {
            if (qIds.has(out.id)) rep.err('E05', `${qp}.id`, `문제 id '${out.id}' 가 중복됩니다`);
            qIds.add(out.id);
          }
          if (isStr(out.answer)) {
            const key = out.answer.replace(/\s+/g, '').toLowerCase();
            if (answers.has(key)) rep.warn('W07', `${qp}.answer`, `같은 정답의 문제가 있습니다 (${answers.get(key)})`);
            else answers.set(key, out.id);
          }
          cat.questions.push(out);
        });
        if (cat.questions.filter((q) => !q.disabled).length === 0) rep.warn('W03', cp, `카테고리 ${c.id} 에 문제가 없습니다`);
      }
    }
    outCats.push(cat);
  });

  const game = rep.errors.length ? null : {
    schemaVersion: 1, id: g.id, type, title: g.title, icon: isSingleEmoji(g.icon) ? g.icon : '🎮',
    description: isStr(g.description) ? g.description : '', order: isInt(g.order) ? g.order : 999,
    rules: Array.isArray(g.rules) ? g.rules.filter(isStr) : [], defaults, categories: outCats,
  };
  return { errors: rep.errors, warnings: rep.warnings, game };
}

function validateQuestion(rep, qp, q, type, gameId, catId) {
  if (!isObj(q)) { rep.err('E04', qp, `${qp} 형식이 올바르지 않습니다`); return null; }
  const out = { id: q.id, answer: q.answer };
  if (!isStr(q.id) || !q.id) rep.err('E03', `${qp}.id`, `${qp}.id 가 없습니다`);
  else if (!SLUG_RE.test(q.id)) rep.err('E04', `${qp}.id`, `${qp}.id '${q.id}' 형식이 올바르지 않습니다`);
  if (!isStr(q.answer) || !q.answer.trim()) rep.err('E03', `${qp}.answer`, `${qp}.answer 가 없습니다`);
  checkLen(rep, `${qp}.answer`, q.answer, 60, '정답');
  for (const [key, max, label] of [['prompt', 30, '질문 문구'], ['hint', 30, '힌트'], ['note', 100, '메모']]) {
    if (q[key] === undefined) continue;
    if (!isStr(q[key])) { rep.err('E04', `${qp}.${key}`, `${qp}.${key} 는 문자열이어야 합니다`); continue; }
    checkLen(rep, `${qp}.${key}`, q[key], max, label);
    if (q[key].trim()) out[key] = q[key];
  }
  if (q.disabled !== undefined && typeof q.disabled !== 'boolean') rep.err('E04', `${qp}.disabled`, `${qp}.disabled 는 true / false 여야 합니다`);
  out.disabled = q.disabled === true;
  if (isStr(q.addedAt)) out.addedAt = q.addedAt;
  const prefix = `assets/${gameId}/${catId}/`;

  if (type === 'photo') {
    if (q.image === undefined) rep.err('E03', `${qp}.image`, `${qp}.image 가 없습니다`);
    else if (checkPath(rep, `${qp}.image`, q.image, prefix)) out.image = q.image;
    if (q.answerImage !== undefined && checkPath(rep, `${qp}.answerImage`, q.answerImage, prefix)) out.answerImage = q.answerImage;
    checkHideAnswerText(rep, qp, q, out);
    checkClip(rep, qp, q, out);
    if (isStr(q.credit)) out.credit = q.credit;
    const effect = q.effect ?? 'none';
    if (!EFFECTS.includes(effect)) { rep.err('E04', `${qp}.effect`, `effect '${effect}' 는 지원하지 않습니다`); return out; }
    out.effect = effect;
    if (effect !== 'zoom' && (q.zoom !== undefined || q.focus !== undefined || q.steps !== undefined)) rep.warn('W09', qp, `${qp} 의 확대 설정은 연출이 확대가 아니라 무시합니다`);
    if (effect !== 'mask' && q.masks !== undefined) rep.warn('W09', qp, `${qp} 의 가림 상자는 연출이 가림이 아니라 무시합니다`);
    if (effect === 'zoom') {
      if (q.zoom === undefined) rep.err('E09', `${qp}.zoom`, `${qp} 는 effect "zoom" 인데 zoom 이 없습니다`);
      else if (!isNum(q.zoom)) rep.err('E04', `${qp}.zoom`, `${qp}.zoom 은 숫자여야 합니다`);
      else {
        const v = Math.round(clamp(q.zoom, 1.5, 10) * 2) / 2;
        if (v !== q.zoom) rep.warn('W01', `${qp}.zoom`, `zoom ${q.zoom} → ${v}`);
        out.zoom = v;
      }
      let focus = [50, 50];
      if (q.focus !== undefined) {
        if (!Array.isArray(q.focus) || q.focus.length !== 2 || !q.focus.every(isNum)) rep.err('E04', `${qp}.focus`, `${qp}.focus 는 [x, y] 여야 합니다`);
        else {
          focus = q.focus.map((n) => Math.round(clamp(n, 0, 100) * 10) / 10);
          if (focus[0] !== q.focus[0] || focus[1] !== q.focus[1]) rep.warn('W01', `${qp}.focus`, 'focus 를 0 ~ 100 으로 보정');
        }
      }
      out.focus = focus;
      let steps = 3;
      if (q.steps !== undefined) {
        if (!isInt(q.steps)) rep.err('E04', `${qp}.steps`, `${qp}.steps 는 정수여야 합니다`);
        else { steps = clamp(q.steps, 1, 6); if (steps !== q.steps) rep.warn('W01', `${qp}.steps`, `steps ${q.steps} → ${steps}`); }
      }
      out.steps = steps;
    }
    if (effect === 'mask') {
      if (q.masks === undefined) rep.err('E09', `${qp}.masks`, `${qp} 는 effect "mask" 인데 masks 가 없습니다`);
      else if (!Array.isArray(q.masks) || q.masks.length === 0) rep.err('E04', `${qp}.masks`, `${qp}.masks 는 상자 1개 이상이어야 합니다`);
      else {
        let masks = q.masks;
        if (masks.length > 8) { rep.warn('W01', `${qp}.masks`, '가림 상자는 8개까지 — 나머지는 무시'); masks = masks.slice(0, 8); }
        const fixed = [];
        masks.forEach((m, mi) => {
          if (!Array.isArray(m) || m.length !== 4 || !m.every(isNum)) { rep.err('E04', `${qp}.masks[${mi}]`, `${qp}.masks[${mi}] 는 [x, y, w, h] 여야 합니다`); return; }
          let [x, y, w, h] = m.map((n) => Math.round(n * 10) / 10);
          x = clamp(x, 0, 100); y = clamp(y, 0, 100);
          w = clamp(w, 0, 100 - x); h = clamp(h, 0, 100 - y);
          if (w <= 0 || h <= 0) { rep.err('E04', `${qp}.masks[${mi}]`, `${qp}.masks[${mi}] 의 크기가 0 입니다`); return; }
          if (x !== m[0] || y !== m[1] || w !== m[2] || h !== m[3]) rep.warn('W01', `${qp}.masks[${mi}]`, '가림 상자를 이미지 안으로 보정');
          fixed.push([x, y, w, h]);
        });
        out.masks = fixed;
      }
    }
  } else if (type === 'emoji') {
    const hasEmojis = isStr(q.emojis) && q.emojis.trim() !== '';
    if (q.emojis !== undefined && !isStr(q.emojis)) rep.err('E04', `${qp}.emojis`, `${qp}.emojis 는 문자열이어야 합니다`);
    if (q.image !== undefined) { if (checkPath(rep, `${qp}.image`, q.image, prefix)) out.image = q.image; }
    if (!hasEmojis && q.image === undefined) rep.err('E09', qp, `${qp} 에 emojis · image 둘 다 없습니다`);
    if (hasEmojis) {
      out.emojis = q.emojis.trim();
      const n = emojiUnits(out.emojis).length;
      if (n > 12) rep.warn('W05', `${qp}.emojis`, '이모지는 12개까지 권장합니다');
    }
    const reveal = q.reveal ?? 'all';
    if (!['all', 'sequential'].includes(reveal)) rep.err('E04', `${qp}.reveal`, `reveal '${reveal}' 는 지원하지 않습니다`);
    out.reveal = out.image ? 'all' : reveal;
    // 정답 공개 때 바꿔 보여줄 이미지 — 사진 문제와 같은 규칙 (R-39)
    if (q.answerImage !== undefined && checkPath(rep, `${qp}.answerImage`, q.answerImage, prefix)) out.answerImage = q.answerImage;
    checkHideAnswerText(rep, qp, q, out);
  }
  return out;
}

/** 정답 · 문제 글자 비교 열쇠 — 띄어쓰기 · 대소문자 무시 (W07, 정답 후보 중복) */
export const normKey = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

/** 줄줄이 말해요 문제 — 문제 글자(`prompt`) + 정답 후보(`answers`) + 메모 (docs/02-data-schema.md 4-3, R-44) */
function validateChainQuestion(rep, qp, q) {
  if (!isObj(q)) { rep.err('E04', qp, `${qp} 형식이 올바르지 않습니다`); return null; }
  const out = { id: q.id, prompt: q.prompt, answers: [] };
  if (!isStr(q.id) || !q.id) rep.err('E03', `${qp}.id`, `${qp}.id 가 없습니다`);
  else if (!SLUG_RE.test(q.id)) rep.err('E04', `${qp}.id`, `${qp}.id '${q.id}' 형식이 올바르지 않습니다`);
  if (!isStr(q.prompt) || !q.prompt.trim()) rep.err('E03', `${qp}.prompt`, `${qp}.prompt (문제 글자) 가 없습니다`);
  checkLen(rep, `${qp}.prompt`, q.prompt, 20, '문제 글자');
  if (q.answers !== undefined && (!Array.isArray(q.answers) || !q.answers.every(isStr))) {
    rep.err('E04', `${qp}.answers`, `${qp}.answers 는 문자열 배열이어야 합니다`);
  } else {
    out.answers = (q.answers ?? []).map((a) => a.trim()).filter(Boolean);
    if (!out.answers.length) rep.err('E03', `${qp}.answers`, `${qp}.answers (정답 후보) 가 없습니다 (1개 이상)`);
    if (out.answers.length > 50) rep.warn('W05', `${qp}.answers`, '정답 후보는 50개까지 권장합니다');
    const seen = new Set();
    out.answers.forEach((a, ai) => {
      checkLen(rep, `${qp}.answers[${ai}]`, a, 30, '정답 후보');
      const key = normKey(a);
      if (seen.has(key)) rep.warn('W07', `${qp}.answers[${ai}]`, `정답 후보 '${a}' 가 겹칩니다`);
      seen.add(key);
    });
  }
  if (q.note !== undefined) {
    if (!isStr(q.note)) rep.err('E04', `${qp}.note`, `${qp}.note 는 문자열이어야 합니다`);
    else {
      checkLen(rep, `${qp}.note`, q.note, 100, '메모');
      if (q.note.trim()) out.note = q.note;
    }
  }
  if (q.disabled !== undefined && typeof q.disabled !== 'boolean') rep.err('E04', `${qp}.disabled`, `${qp}.disabled 는 true / false 여야 합니다`);
  out.disabled = q.disabled === true;
  if (isStr(q.addedAt)) out.addedAt = q.addedAt;
  return out;
}

/** 정답 글자 숨기기 — 정답 이미지와 상관없는 문제별 옵션 (R-41 · R-47) */
function checkHideAnswerText(rep, qp, q, out) {
  if (q.hideAnswerText === undefined) return;
  if (typeof q.hideAnswerText !== 'boolean') { rep.err('E04', `${qp}.hideAnswerText`, `${qp}.hideAnswerText 는 true / false 여야 합니다`); return; }
  if (q.hideAnswerText) out.hideAnswerText = true;
}

/**
 * 정답 영상 (R-61) — 유튜브 주소 · 시작 · 끝 (초). 실행용은 주소를 `https://youtu.be/<id>` 로, 주소의 t= · end= 를 시작 · 끝으로 정리.
 * 주소를 읽을 수 없으면 영상 없이 쓴다 (W13 — 게임을 막지 않는다)
 */
function checkClip(rep, qp, q, out) {
  if (q.answerClip === undefined) {
    if (q.clipStart !== undefined || q.clipEnd !== undefined) rep.warn('W09', qp, `${qp} 의 영상 구간은 정답 영상이 없어 무시합니다`);
    return;
  }
  const p = isStr(q.answerClip) ? parseYouTube(q.answerClip) : { error: '주소는 문자열이어야 합니다' };
  if (p.error) { rep.warn('W13', `${qp}.answerClip`, `${qp}.answerClip — ${p.error} (영상 없이 사용)`); return; }
  const sec = (key) => {
    if (q[key] === undefined) return null;
    if (!isNum(q[key]) || q[key] < 0) { rep.warn('W01', `${qp}.${key}`, `${qp}.${key} 는 0 이상의 초여야 합니다 — 무시`); return null; }
    return Math.round(q[key] * 10) / 10;
  };
  const start = sec('clipStart') ?? p.start ?? 0;
  let end = sec('clipEnd') ?? p.end;
  if (end !== null && end <= start) { rep.warn('W01', `${qp}.clipEnd`, `${qp}.clipEnd 가 시작보다 앞이라 영상 끝까지 재생합니다`); end = null; }
  out.answerClip = clipUrl(p.id);
  if (start > 0) out.clipStart = start;
  if (end !== null) out.clipEnd = end;
}

// ── 점수판 기본값 (data/scoreboard.json) ──────────────────
export const ROUND_KINDS = ['rank', 'pass', 'count', 'manual'];

export function validateRounds(rounds, { games = {}, label = 'scoreboard.json' } = {}) {
  const rep = new Report(label);
  if (!Array.isArray(rounds)) { rep.err('E10', 'rounds', '점수판 기본값을 읽을 수 없습니다 (rounds 없음)'); return { errors: rep.errors, warnings: rep.warnings, rounds: null }; }
  const ids = new Set();
  const out = [];
  rounds.forEach((r, i) => {
    const p = `rounds[${i}]`;
    if (!isObj(r)) { rep.err('E10', p, `${p} 형식이 올바르지 않습니다`); return; }
    if (!isStr(r.id) || !SLUG_RE.test(r.id)) { rep.err('E10', `${p}.id`, `${p}.id 가 없거나 형식이 올바르지 않습니다`); return; }
    if (ids.has(r.id)) { rep.err('E10', `${p}.id`, `라운드 id '${r.id}' 가 중복됩니다`); return; }
    ids.add(r.id);
    if (!isStr(r.name) || !r.name.trim()) rep.err('E10', `${p}.name`, `${p}.name 이 없습니다`);
    if (!ROUND_KINDS.includes(r.kind)) { rep.err('E10', `${p}.kind`, `${p}.kind '${r.kind}' 는 지원하지 않습니다`); return; }
    const round = { id: r.id, name: r.name, kind: r.kind };
    if (r.kind === 'rank') {
      if (!Array.isArray(r.points) || !r.points.every(isInt)) { rep.err('E10', `${p}.points`, `${p}.points 는 정수 배열이어야 합니다`); return; }
      round.points = [0, 1, 2, 3].map((k) => r.points[k] ?? 0);
    }
    if (r.kind === 'pass') {
      if (!isInt(r.pass) || !isInt(r.fail)) { rep.err('E10', `${p}.pass`, `${p}.pass · fail 은 정수여야 합니다`); return; }
      round.pass = r.pass; round.fail = r.fail;
    }
    // 정답 수 — 정답 1개당 점수 (R-49)
    if (r.kind === 'count') {
      if (!isInt(r.per)) { rep.err('E10', `${p}.per`, `${p}.per 는 정수여야 합니다`); return; }
      round.per = r.per;
    }
    if (r.gameId !== undefined) {
      const game = games[r.gameId];
      if (!game) rep.warn('W11', `${p}.gameId`, `${p}.gameId '${r.gameId}' 는 없는 게임입니다 (연결 무시)`);
      else {
        round.gameId = r.gameId;
        if (r.categoryId !== undefined) {
          if (!game.categories?.some((c) => c.id === r.categoryId)) rep.warn('W11', `${p}.categoryId`, `${p}.categoryId '${r.categoryId}' 는 그 게임에 없는 카테고리입니다 (연결 무시)`);
          else round.categoryId = r.categoryId;
        }
      }
    }
    out.push(round);
  });
  return { errors: rep.errors, warnings: rep.warnings, rounds: rep.errors.length ? null : out };
}

export function validateScoreboardDefaults(raw, opts = {}) {
  if (!isObj(raw) || raw.schemaVersion !== 1) {
    return { errors: [{ code: 'E10', path: 'scoreboard.json', message: '점수판 기본값을 읽을 수 없습니다' }], warnings: [], rounds: null };
  }
  return validateRounds(raw.rounds, opts);
}

// ── 팀 설정 (docs/03-settings.md 2-3) ───────────────────
export function validateTeamName(name, otherNames = []) {
  const v = isStr(name) ? name.trim() : '';
  if (!v) return '팀 이름을 입력하세요';
  if (/[\r\n]/.test(v)) return '줄바꿈은 쓸 수 없습니다';
  if (charCount(v) > 10) return '10자 이내로 입력하세요';
  const key = v.toLowerCase();
  if (otherNames.some((o) => isStr(o) && o.trim().toLowerCase() === key)) return '다른 팀과 이름이 같습니다';
  return null;
}

// ── 상태 파일 형식 검사 (서버 저장 전, docs/08-tech.md 4-6-1) ──
const SCREENS = ['roulette', 'round', 'question', 'answer', 'roundEnd', 'result', 'tiebreakQuestion', 'tiebreakAnswer', 'topic'];

/** @returns {string|null} 오류 문구 */
export function checkStateFile(name, data, { gameId } = {}) {
  if (!isObj(data)) return '객체가 아닙니다';
  if (data.version !== 1) return `version ${data.version} 는 지원하지 않습니다`;
  if (name === 'settings') {
    if (data.teams !== undefined && (!Array.isArray(data.teams) || data.teams.length > 4 || !data.teams.every((t) => isObj(t) && isStr(t.name) && isStr(t.color)))) return 'teams 형식이 올바르지 않습니다';
    if (data.games !== undefined && !isObj(data.games)) return 'games 형식이 올바르지 않습니다';
    if (data.display !== undefined && data.display !== null && !isObj(data.display)) return 'display 형식이 올바르지 않습니다';
    return null;
  }
  if (name === 'route') {
    if (data.route !== null && data.route !== undefined && !(isObj(data.route) && isStr(data.route.view))) return 'route 형식이 올바르지 않습니다';
    return null;
  }
  if (name === 'scoreboard') {
    if (data.rounds !== null && data.rounds !== undefined && !Array.isArray(data.rounds)) return 'rounds 형식이 올바르지 않습니다';
    if (data.entries !== undefined && (!isObj(data.entries) || !Object.values(data.entries).every(Array.isArray))) return 'entries 형식이 올바르지 않습니다';
    if (data.filled !== undefined && !isObj(data.filled)) return 'filled 형식이 올바르지 않습니다';
    if (data.log !== undefined && !(Array.isArray(data.log) && data.log.every((e) => isObj(e) && isStr(e.what) && Array.isArray(e.totals)))) return 'log 형식이 올바르지 않습니다';
    return null;
  }
  if (name === 'session') {
    if (!isStr(data.gameId) || (gameId && data.gameId !== gameId)) return 'gameId 가 파일 이름과 다릅니다';
    if (data.empty === true) return null; // 초기화된 빈 세션
    if (!GAME_TYPES.includes(data.type)) return 'type 이 올바르지 않습니다';
    if (!['active', 'finished'].includes(data.status)) return 'status 가 올바르지 않습니다';
    if (!SCREENS.includes(data.screen)) return 'screen 이 올바르지 않습니다';
    if (!Array.isArray(data.picks) || !Array.isArray(data.wheel)) return 'picks · wheel 형식이 올바르지 않습니다';
    if (SCORE_TYPES.includes(data.type) && !Array.isArray(data.history)) return 'history 형식이 올바르지 않습니다';
    return null;
  }
  return '알 수 없는 상태 파일';
}

/** 초기화한 상태 — 파일을 지우지 않고 이 내용으로 덮어쓴다 (docs/08-tech.md 4-5) */
export const emptyState = {
  settings: () => ({ version: 1, teams: [], display: { title: null, subtitle: null }, games: {} }),
  route: () => ({ version: 1, route: null }),
  scoreboard: () => ({ version: 1, rounds: null, entries: {}, filled: {} }),
  session: (gameId) => ({ version: 1, gameId, empty: true }),
};
/** 초기화된 빈 세션인가 (진행 기록 없음과 같다) */
export const isEmptySession = (data) => !isObj(data) || data.empty === true;
