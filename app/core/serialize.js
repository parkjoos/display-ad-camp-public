// 데이터 · 상태 파일 고정 직렬화 (docs/02-data-schema.md 2-2, docs/08-tech.md 4-6-1)
// 같은 데이터는 항상 같은 글자로 저장한다: 키 순서 고정 · 기본값 생략 · 들여쓰기 2칸 · LF · \u 이스케이프 없음.
// 브라우저(관리 페이지 · 게임 창)와 서버가 같이 쓴다.

// ── 키 순서 ─────────────────────────────────────────────
const ORDER = {
  app: ['schemaVersion', 'title', 'subtitle', 'games'],
  game: ['schemaVersion', 'id', 'type', 'title', 'icon', 'description', 'order', 'rules', 'defaults', 'categories'],
  defaults: ['rounds', 'questionsPerRound', 'questionOrder', 'relay', 'perRep'],
  category: ['id', 'name', 'icon', 'description', 'prompt', 'defaultEffect', 'disabled', 'rule', 'examples', 'questions'],
  photo: ['id', 'answer', 'image', 'effect', 'zoom', 'focus', 'steps', 'masks', 'answerImage', 'hideAnswerText', 'answerClip', 'clipStart', 'clipEnd', 'credit', 'prompt', 'hint', 'note', 'disabled', 'addedAt'],
  emoji: ['id', 'answer', 'emojis', 'image', 'reveal', 'answerImage', 'hideAnswerText', 'prompt', 'hint', 'note', 'disabled', 'addedAt'],
  chain: ['id', 'prompt', 'answers', 'note', 'disabled', 'addedAt'], // 줄줄이 말해요 문제 (R-44)
  scoreboard: ['schemaVersion', 'rounds'],
  round: ['id', 'name', 'kind', 'points', 'pass', 'fail', 'per', 'gameId', 'categoryId'],
  // 상태 파일
  settings: ['version', 'teams', 'display', 'games', 'updatedAt'],
  team: ['name', 'color'],
  display: ['title', 'subtitle'],
  gameSettings: ['excludedCategories', 'rounds', 'questionsPerRound', 'questionOrder', 'relay'],
  route: ['version', 'route', 'updatedAt'],
  routeValue: ['view', 'gameId'],
  scoreState: ['version', 'rounds', 'entries', 'filled', 'log', 'updatedAt'],
  logEntry: ['at', 'what', 'totals'], // 종합 점수 추이 (R-58)
  entry: ['rank', 'ranks', 'pass', 'count', 'value'],
  filled: ['from', 'at', 'session'],
  session: ['version', 'gameId', 'type', 'status', 'startedAt', 'updatedAt', 'snapshot', 'wheel', 'picks', 'screen',
    'roundIndex', 'questionIndex', 'stage', 'hintVisible', 'resultRevealCount', 'scoreboardFill', 'reflectedRounds', 'history', 'tiebreak',
    'examplesVisible', 'answersVisible'],
  snapshot: ['teamCount', 'candidates', 'options', 'points'],
  pick: ['categoryId', 'questionIds'],
  op: ['op', 'q', 'from', 'team', 'none', 'at'],
  tiebreak: ['used', 'groups'],
};

// 값이 이것과 같으면 저장하지 않는다 (선택 필드)
const GAME_DEFAULTS = { icon: '🎮', order: 999 };
const DEFAULTS_DEFAULTS = { rounds: 3, questionsPerRound: 5, questionOrder: 'random', perRep: 1 };
const CATEGORY_DEFAULTS = { icon: '❓', defaultEffect: 'none', disabled: false };
const QUESTION_DEFAULTS = { effect: 'none', steps: 3, reveal: 'all', disabled: false, hideAnswerText: false };

// 타이머를 없앴다 (R-33) — 예전 파일에 남은 제한시간은 저장할 때 뺀다 (모르는 키는 보통 그대로 두므로 따로)
const withoutTimer = (o) => {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
  const { timerSeconds, ...rest } = o;
  return rest;
};

// ── 출력 ─────────────────────────────────────────────────
const isPrimitive = (v) => v === null || typeof v !== 'object';
const isInlineArray = (v) => Array.isArray(v) && v.every(isPrimitive);

function print(value, indent, opts) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // 숫자 · 문자열 배열과 그것들의 배열(가림 상자 좌표 등)은 한 줄로
    if (value.every((v) => isPrimitive(v) || isInlineArray(v))) {
      return '[' + value.map((v) => print(v, indent, opts)).join(', ') + ']';
    }
    const inner = indent + '  ';
    return '[\n' + value.map((v) => inner + print(v, inner, opts)).join(',\n') + '\n' + indent + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    if (opts.inlineObjects && keys.every((k) => isPrimitive(value[k]))) {
      const one = '{ ' + keys.map((k) => JSON.stringify(k) + ': ' + JSON.stringify(value[k])).join(', ') + ' }';
      if (one.length <= opts.inlineObjects) return one;
    }
    const inner = indent + '  ';
    return '{\n' + keys.map((k) => inner + JSON.stringify(k) + ': ' + print(value[k], inner, opts)).join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}

/** 정렬 · 정리가 끝난 값을 파일 글자로. 끝 줄바꿈 1개. */
export function stringify(value, { inlineObjects = 0 } = {}) {
  return print(value, '', { inlineObjects }) + '\n';
}

// ── 정렬 도구 ────────────────────────────────────────────
const isEmptyValue = (v) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** order 순서대로 키를 다시 꽂는다. 모르는 키는 이름순으로 뒤에. omitIf 와 같은 값 · 빈 값 · undefined 는 뺀다. */
function ordered(obj, order, { omit = {}, keepEmpty = [] } = {}) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  const known = new Set(order);
  const extra = Object.keys(obj).filter((k) => !known.has(k)).sort();
  for (const key of [...order, ...extra]) {
    if (!(key in obj)) continue;
    const v = obj[key];
    if (v === undefined) continue;
    if (key in omit && sameValue(v, omit[key])) continue;
    if (isEmptyValue(v) && !keepEmpty.includes(key)) continue;
    out[key] = v;
  }
  return out;
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

const trimStr = (v) => (typeof v === 'string' ? v.trim() : v);

// ── 데이터 파일 ──────────────────────────────────────────
export function normalizeApp(app) {
  return ordered({ ...app, title: trimStr(app.title), subtitle: trimStr(app.subtitle) }, ORDER.app, { keepEmpty: ['games'] });
}

export function normalizeQuestion(q, type) {
  const src = withoutTimer({ ...q });
  for (const k of ['answer', 'prompt', 'hint', 'credit', 'emojis']) if (k in src) src[k] = trimStr(src[k]);
  if (typeof src.note === 'string') src.note = src.note.trim();
  if (type === 'photo') {
    const effect = src.effect ?? 'none';
    // 연출과 상관없는 필드는 저장할 때 정리 (W09)
    if (effect !== 'zoom') { delete src.zoom; delete src.focus; delete src.steps; }
    if (effect !== 'mask') delete src.masks;
    const omit = { ...QUESTION_DEFAULTS, focus: [50, 50] };
    return ordered(src, ORDER.photo, { omit });
  }
  if (type === 'emoji') {
    if (src.image) delete src.reveal;
    return ordered(src, ORDER.emoji, { omit: QUESTION_DEFAULTS });
  }
  if (type === 'roulette') {
    // 정답 후보 — 앞뒤 공백 · 빈 칸 정리 (R-44)
    if (Array.isArray(src.answers)) src.answers = src.answers.map(trimStr).filter((a) => a);
    return ordered(src, ORDER.chain, { omit: QUESTION_DEFAULTS });
  }
  return ordered(src, ORDER.photo, { omit: QUESTION_DEFAULTS });
}

export function normalizeCategory(c, type) {
  const src = { ...c, name: trimStr(c.name), description: trimStr(c.description), prompt: trimStr(c.prompt), rule: trimStr(c.rule) };
  if (Array.isArray(src.examples)) src.examples = src.examples.map(trimStr).filter((s) => s);
  if (type === 'roulette') {
    delete src.prompt; delete src.defaultEffect;
    // 주제별 문제는 선택 — 없으면 키도 두지 않는다 (R-44)
    src.questions = (src.questions ?? []).map((q) => normalizeQuestion(q, type));
    return ordered(src, ORDER.category, { omit: CATEGORY_DEFAULTS });
  } else {
    delete src.rule; delete src.examples;
    if (type !== 'photo') delete src.defaultEffect;
    src.questions = (src.questions ?? []).map((q) => normalizeQuestion(q, type));
  }
  return ordered(src, ORDER.category, { omit: CATEGORY_DEFAULTS, keepEmpty: ['questions'] });
}

export function normalizeGame(game) {
  const src = { ...game, title: trimStr(game.title), description: trimStr(game.description) };
  if (Array.isArray(src.rules)) src.rules = src.rules.map(trimStr).filter((s) => s);
  if (src.defaults && typeof src.defaults === 'object') {
    // 룰렛형은 문제 순서만 (R-45) — 라운드 · 문제 수는 쓰지 않는다
    const raw = src.type === 'roulette' ? { questionOrder: src.defaults.questionOrder } : withoutTimer(src.defaults);
    const d = ordered(raw, ORDER.defaults, { omit: DEFAULTS_DEFAULTS });
    if (Object.keys(d).length) src.defaults = d; else delete src.defaults;
  } else {
    delete src.defaults;
  }
  src.categories = (src.categories ?? []).map((c) => normalizeCategory(c, src.type));
  return ordered(src, ORDER.game, { omit: GAME_DEFAULTS, keepEmpty: ['categories'] });
}

export function normalizeScoreboard(sb) {
  return ordered({ ...sb, rounds: (sb.rounds ?? []).map(normalizeRound) }, ORDER.scoreboard, { keepEmpty: ['rounds'] });
}

export function normalizeRound(r) {
  const src = { ...r, name: trimStr(r.name) };
  if (src.kind !== 'rank') delete src.points;
  if (src.kind !== 'pass') { delete src.pass; delete src.fail; }
  if (src.kind !== 'count') delete src.per;
  if (!src.gameId) { delete src.gameId; delete src.categoryId; }
  if (!src.categoryId) delete src.categoryId;
  return ordered(src, ORDER.round);
}

export const serializeApp = (app) => stringify(normalizeApp(app));
export const serializeGame = (game) => stringify(normalizeGame(game));
export const serializeScoreboard = (sb) => stringify(normalizeScoreboard(sb));

// ── 상태 파일 (state/*.json) ─────────────────────────────
// 상태 파일도 같은 규칙 — 백업 파일을 풀어 비교할 때 읽기 쉽게 (R-37). 작은 객체(이력 한 줄 등)는 한 줄로 둔다.
const STATE_INLINE = 100;

function normalizeSettings(s) {
  const games = {};
  for (const id of Object.keys(s.games ?? {}).sort()) {
    games[id] = ordered(withoutTimer(s.games[id]), ORDER.gameSettings, { keepEmpty: ['excludedCategories'] });
  }
  return ordered({
    ...s,
    teams: (s.teams ?? []).map((t) => ordered(t, ORDER.team)),
    display: s.display ? ordered(s.display, ORDER.display, { keepEmpty: ['title', 'subtitle'] }) : undefined,
    games,
  }, ORDER.settings, { keepEmpty: ['teams'] });
}

function normalizeRouteState(r) {
  return ordered({ ...r, route: r.route ? ordered(r.route, ORDER.routeValue) : null }, ORDER.route, { keepEmpty: [] });
}

function normalizeScoreState(s) {
  const entries = {};
  for (const id of Object.keys(s.entries ?? {}).sort()) {
    entries[id] = (s.entries[id] ?? []).map((cell) => (cell ? ordered(cell, ORDER.entry) : null));
  }
  const filled = {};
  for (const id of Object.keys(s.filled ?? {}).sort()) filled[id] = ordered(s.filled[id], ORDER.filled);
  return ordered({
    ...s,
    rounds: Array.isArray(s.rounds) ? s.rounds.map(normalizeRound) : null,
    entries,
    filled,
    log: Array.isArray(s.log) ? s.log.map((e) => ordered(e, ORDER.logEntry)) : undefined,
  }, ORDER.scoreState);
}

function normalizeSession(s) {
  const out = { ...s };
  if (s.snapshot) {
    out.snapshot = ordered({ ...s.snapshot, options: ordered(withoutTimer(s.snapshot.options ?? {}), ORDER.defaults) }, ORDER.snapshot, { keepEmpty: ['candidates', 'options'] });
  }
  if (Array.isArray(s.picks)) out.picks = s.picks.map((p) => ordered(p, ORDER.pick, { keepEmpty: ['questionIds'] }));
  if (Array.isArray(s.history)) out.history = s.history.map((op) => ordered(op, ORDER.op));
  if (s.tiebreak) out.tiebreak = ordered(s.tiebreak, ORDER.tiebreak, { keepEmpty: ['used', 'groups'] });
  return ordered(out, ORDER.session, { keepEmpty: ['wheel', 'picks', 'history'] });
}

/** name: 'settings' | 'route' | 'scoreboard' | 'session' */
export function serializeState(name, data) {
  let norm;
  if (name === 'settings') norm = normalizeSettings(data);
  else if (name === 'route') norm = normalizeRouteState(data);
  else if (name === 'scoreboard') norm = normalizeScoreState(data);
  else if (name === 'session') norm = normalizeSession(data);
  else throw new Error(`알 수 없는 상태 파일: ${name}`);
  return stringify(norm, { inlineObjects: STATE_INLINE });
}
