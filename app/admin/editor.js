// 문제 편집 · 여러 장 추가 · 표 붙여넣기 (docs/04-admin.md 3-6 ~ 3-9)
import { h, replace } from '../ui/dom.js';
import { A, loadGame, saveGame, go, toast } from './main.js';
import { api } from './api.js';
import { prepareImage, answerFromFileName } from './image.js';
import { parseEmojiRows, parseRouletteRows, findCat, EMOJI_HEADER, ROULETTE_HEADER, splitAnswers, addAnswers } from './paste.js';
import { clipboardImage, pasteAction, NO_IMAGE_MESSAGE } from './clipboard.js';
import { newQuestionId, suggestCategoryId } from '../core/random.js';
import { emojiUnits, isEmoji, SLUG_RE, normKey, charCount } from '../core/validate.js';
import { createPhoto, zoomView } from '../ui/render-photo.js';
import { createEmoji } from '../ui/render-emoji.js';
import { createClip } from '../ui/clip.js';
import { assetUrl } from '../core/assets.js';
import { parseYouTube, parseTime, formatTime, clipUrl, clipRangeText } from '../core/youtube.js';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const MASK_MAX = 8;
const MASK_MIN = 2; // %
/** 일괄 추가한 가림 문제의 "아직 안 그림" 표시 — 숨김 상태로 저장 (3-7) */
export const MASK_PLACEHOLDER = [0, 0, 100, 100];

/**
 * 여러 장 한 번에 추가한 뒤 확대 지점 · 가림 상자를 아직 안 정한 문제 (목록에 "⚠ 설정 필요", 숨김 상태).
 * 확대 = 중심이 기본값(가운데) 그대로, 가림 = 이미지 전체를 덮는 표시용 상자 하나.
 */
export function needsSetup(q) {
  if (!q.disabled) return false;
  if (q.effect === 'zoom') return !q.focus || (q.focus[0] === 50 && q.focus[1] === 50);
  if (q.effect === 'mask') return q.masks?.length === 1 && q.masks[0].join() === MASK_PLACEHOLDER.join();
  return false;
}

const r1 = (n) => Math.round(n * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const normAnswer = normKey;
const allQuestionIds = (d) => new Set(d.categories.flatMap((c) => (c.questions ?? []).map((q) => q.id)));
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fitMask([x, y, w, hh]) {
  x = clamp(r1(x), 0, 100);
  y = clamp(r1(y), 0, 100);
  return [x, y, clamp(r1(w), 0, r1(100 - x)), clamp(r1(hh), 0, r1(100 - y))];
}

/** 파일 고르기 창 — 취소하면 빈 배열 */
function pickFiles({ multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,.heic,.heif', multiple: multiple || undefined, style: { display: 'none' } });
    const done = (files) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done([...input.files]));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}

/** 파일을 페이지 밖에 떨어뜨려도 브라우저가 그 파일로 이동하지 않게 */
function guardFileDrop() {
  const stop = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  document.addEventListener('dragover', stop);
  document.addEventListener('drop', stop);
  return () => { document.removeEventListener('dragover', stop); document.removeEventListener('drop', stop); };
}

function dropZone(el, onFiles) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
}

/** 클립보드 붙여넣기 `⌘V` → 이미지 (3-6, R-34). 편집 화면에 있는 동안만 — 해제 함수를 돌려준다 */
function pasteImage(onImage) {
  const onPaste = (e) => {
    if (document.querySelector('.overlay')) return; // 확인 창이 떠 있을 때는 붙여넣지 않는다
    const file = clipboardImage(e.clipboardData);
    const hasText = !!e.clipboardData?.types?.includes('text/plain');
    const action = pasteAction({ hasImage: !!file, hasText, typing: isTyping(e.target) });
    if (action === 'text') return;
    e.preventDefault();
    if (action === 'none') toast(NO_IMAGE_MESSAGE);
    else onImage(file);
  };
  document.addEventListener('paste', onPaste);
  return () => document.removeEventListener('paste', onPaste);
}

/**
 * 게임 화면과 같은 비율의 작은 미리보기 — 실제 문제 화면(가운데 영역)을 그 크기 그대로 그린 뒤 줄여 보인다.
 * 화면 글자 크기가 vh 기준이라 이렇게 해야 실제와 같은 모습이 된다.
 */
function previewFrame({ full = false, side = false } = {}) {
  const inner = h('div.pv-inner');
  const outer = h(`div.preview-box${full ? '.full' : side ? '.side' : ''}`, inner);
  const fit = () => {
    // 문제 화면 가운데 영역 (머리 8vh · 점수 막대 16vh 제외). 사진 문제는 점수가 오른쪽 열(폭 16vh)이라 폭에서 뺀다 (R-53).
    // 줄줄이 말해요 문제는 화면 전체 (R-44)
    const W = window.innerHeight * (16 / 9 - (side ? 0.16 : 0));
    const H = window.innerHeight * (full ? 1 : side ? 0.92 : 0.76);
    Object.assign(inner.style, { width: `${W}px`, height: `${H}px`, transform: `scale(${outer.clientWidth / W})` });
  };
  const ro = new ResizeObserver(fit);
  ro.observe(outer);
  return { outer, inner, fit, destroy: () => ro.disconnect() };
}

/**
 * 미리보기 재생기 — 질문 문구 → 단계 진행 → 정답 공개
 * @param make (stageBox) => renderer
 */
function createPlayer(frame, { make, promptText, answerText, showAnswerText = () => true, total, firstStage = 0 }) {
  let timer = null;
  let renderer = null;
  function build() {
    clearTimeout(timer);
    renderer?.destroy?.();
    const stage = h('div.stage-box');
    const prompt = promptText() ? h('div.prompt', promptText()) : null;
    const main = h('div.play-main', prompt, stage);
    replace(frame.inner, main);
    frame.fit();
    renderer = make(stage);
    renderer?.set({ stage: firstStage, revealed: false });
    return main;
  }
  return {
    show() { build(); },
    play() {
      const main = build();
      if (!renderer) return;
      let k = firstStage;
      const n = total();
      const tick = () => {
        if (k < n) { k += 1; renderer.set({ stage: k, revealed: false }); timer = setTimeout(tick, 1000); return; }
        renderer.set({ stage: k, revealed: true });
        if (showAnswerText()) main.append(h('div.answer-band', { style: { '--delay': `${renderer.revealDelay()}s` } }, h('div.answer-text', answerText() || '(정답)')));
      };
      timer = setTimeout(tick, 1200);
    },
    destroy() { clearTimeout(timer); renderer?.destroy?.(); },
  };
}

/** 정답 글자 숨기기 — 정답 이미지와 상관없이 켤 수 있다 (R-41 · R-47) */
function hideTextToggle(f, onChange) {
  return h('label.small-note', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px', cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked: f.hideAnswerText || undefined, onchange: (e) => { f.hideAnswerText = e.target.checked; onChange(); } }),
    '정답 글자 숨기기 — 정답 공개 때 글자 띠 없이 이미지만 (정답 이미지가 없으면 원래 사진. 포스터 · 확대 과자처럼 사진이 곧 정답일 때)');
}

/**
 * 정답 영상 (R-61) — 유튜브 주소 + 시작 · 끝. 주소에 t= 가 있으면 시작 칸을 채운다. [▶ 구간 미리보기] 로 게임 화면과 같은 플레이어 재생.
 * @returns { el, read } — read() 는 저장할 값 { answerClip, clipStart, clipEnd } (빈 칸이면 {}) 또는 { error }
 */
function clipField(f, cleanups) {
  const status = h('div.small-note');
  const box = h('div.clip-preview', { hidden: true });
  let player = null;
  const stop = () => { player?.destroy(); player = null; box.hidden = true; };
  cleanups.push(stop);

  /** 칸 → { id, start, end } · { error } · null(주소 없음) */
  function read() {
    if (!f.clipUrl.trim()) return null;
    const p = parseYouTube(f.clipUrl);
    if (p.error) return { error: p.error };
    const start = f.clipStart.trim() ? parseTime(f.clipStart) : 0;
    const end = f.clipEnd.trim() ? parseTime(f.clipEnd) : null;
    if (start === null) return { error: '시작 시간을 읽을 수 없습니다 (예: 83 · 1:23)' };
    if (f.clipEnd.trim() && end === null) return { error: '끝 시간을 읽을 수 없습니다 (예: 95 · 1:35)' };
    if (end !== null && end <= start) return { error: '끝 시간이 시작 시간보다 뒤여야 합니다' };
    return { id: p.id, start, end };
  }
  function showStatus() {
    const r = read();
    status.style.color = r?.error ? 'var(--accent)' : '';
    status.textContent = !r ? '없음 — 정답 공개 때 이 구간을 모니터에서 자동 재생하고, 끝나면 정답 글자가 나옵니다 (선택)'
      : r.error ? `⚠ ${r.error}` : `✔ ${clipRangeText(r)}${r.end === null ? ' — 끝 시간을 넣으면 그 자리에서 멈춥니다' : ''}`;
  }
  const start = h('input.input', { value: f.clipStart, placeholder: '0:00', style: { width: '7em' }, oninput: (e) => { f.clipStart = e.target.value; stop(); showStatus(); } });
  const end = h('input.input', { value: f.clipEnd, placeholder: '끝까지', style: { width: '7em' }, oninput: (e) => { f.clipEnd = e.target.value; stop(); showStatus(); } });
  const url = h('input.input', {
    value: f.clipUrl, placeholder: 'https://youtu.be/… 또는 youtube.com/watch?v=…',
    oninput: (e) => {
      f.clipUrl = e.target.value;
      // 주소의 t= · end= 로 빈 칸을 채운다 (공유 → 시작 시간 체크로 복사한 주소)
      const p = parseYouTube(f.clipUrl);
      if (!p.error && p.start && !f.clipStart.trim()) { f.clipStart = formatTime(p.start); start.value = f.clipStart; }
      if (!p.error && p.end && !f.clipEnd.trim()) { f.clipEnd = formatTime(p.end); end.value = f.clipEnd; }
      stop();
      showStatus();
    },
  });
  const previewBtn = h('button.btn.small', {
    onclick: () => {
      const r = read();
      if (!r || r.error) { showStatus(); return; }
      stop();
      box.hidden = false;
      player = createClip(box, r, {
        onChange: (st) => {
          if (st.error) status.textContent = `⚠ ${st.error}`;
          status.style.color = st.error ? 'var(--accent)' : '';
          if (st.state === 'done') { status.textContent = `✔ ${clipRangeText(r)} — 끝까지 재생했습니다`; box.hidden = true; }
          if (st.muted && st.state === 'playing') status.textContent = '🔇 소리 없이 재생 중 — 미리보기 칸을 클릭하면 소리가 켜집니다';
        },
      });
      player.play();
    },
  }, '▶ 구간 미리보기');
  const clear = h('button.btn.small.danger', { onclick: () => { f.clipUrl = ''; f.clipStart = ''; f.clipEnd = ''; url.value = ''; start.value = ''; end.value = ''; stop(); showStatus(); } }, '빼기');
  showStatus();
  return {
    el: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      url,
      h('div.a-row', '시작', start, '끝', end, previewBtn, clear),
      h('div.small-note', '시간은 초(83) 또는 분:초(1:23). 퍼가기를 막아 둔 영상은 재생되지 않으니 미리보기로 확인하세요'),
      status, box),
    read,
  };
}

function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// ── 문제 추가 · 편집 (3-6 · 3-8) ─────────────────────────
export async function questionEditor(body, v) {
  const g = A.games[v.gameId] ?? await loadGame(v.gameId);
  const d = g.data;
  const cat = d.categories.find((c) => c.id === v.categoryId);
  if (!cat) { go({ page: 'game', gameId: v.gameId }); return null; }
  const existing = v.questionId ? (cat.questions ?? []).find((q) => q.id === v.questionId) : null;
  if (v.questionId && !existing) {
    toast('문제를 찾을 수 없습니다 (다른 곳에서 지워졌을 수 있음)');
    go({ page: 'questions', gameId: v.gameId, categoryId: cat.id });
    return null;
  }
  const qid = existing?.id ?? newQuestionId(cat.id, allQuestionIds(d));
  const ctx = { gameId: v.gameId, d, cat, existing, qid };
  if (d.type === 'roulette') return chainEditor(body, ctx);
  return d.type === 'photo' ? photoEditor(body, ctx) : emojiEditor(body, ctx);
}

/** 두 편집기 공통 — 정답 · 질문 · 힌트 · 메모 · 숨김 · id */
function commonForm(f, { cat, existing, qid, onChange }) {
  const dup = h('div.hint.warn-accent', { style: { display: 'none' } });
  const checkDup = () => {
    const key = normAnswer(f.answer);
    const other = key && cat.questions.find((q) => q.id !== existing?.id && normAnswer(q.answer) === key);
    dup.textContent = other ? `⚠ 같은 정답의 문제가 있습니다 (${other.id}) — 저장은 됩니다` : '';
    dup.style.display = other ? '' : 'none';
  };
  const answer = h('input.input', { value: f.answer, maxlength: 60, placeholder: '필수', oninput: (e) => { f.answer = e.target.value; checkDup(); onChange(); } });
  checkDup();
  const fields = [
    h('label', '정답'), answer, dup,
    h('label', '질문 문구'), h('input.input', { value: f.prompt, maxlength: 30, placeholder: cat.prompt ? `(카테고리 기본) ${cat.prompt}` : '(없음)', oninput: (e) => { f.prompt = e.target.value; onChange(); } }),
    h('label', '힌트'), h('input.input', { value: f.hint, maxlength: 30, placeholder: 'H 키로 표시 (선택)', oninput: (e) => { f.hint = e.target.value; } }),
    h('label', '메모'), h('textarea.input', { rows: 2, maxlength: 100, placeholder: '진행자 화면 전용 — 정답 인정 기준 등 (선택)', style: { minHeight: '56px', fontFamily: 'inherit', fontSize: '14px' }, oninput: (e) => { f.note = e.target.value; } }, f.note),
  ];
  const tail = [
    h('label', '숨김'), h('label', h('input', { type: 'checkbox', checked: f.disabled || undefined, onchange: (e) => { f.disabled = e.target.checked; } }), ' 출제에서 빼기'),
    h('label', 'id'), h('div', h('code', qid), existing ? '' : h('span.small-note', '  (자동 발급)')),
  ];
  return { fields, tail, focus: () => answer.focus() };
}

function commonQuestion(f, { id, existing }) {
  const q = { id, answer: f.answer.trim() };
  if (f.prompt.trim()) q.prompt = f.prompt.trim();
  if (f.hint.trim()) q.hint = f.hint.trim();
  if (f.note.trim()) q.note = f.note.trim();
  if (f.disabled) q.disabled = true;
  // 추가한 날짜 — 새 문제만 기록하고, 편집은 원래 값을 그대로 둔다
  if (!existing) q.addedAt = today();
  else if (existing.addedAt) q.addedAt = existing.addedAt;
  return q;
}

/** 저장 — 이미지 먼저 올리고 데이터 파일 한 번 저장 (5-1) */
async function storeQuestion({ gameId, cat, existing }, q) {
  return saveGame(gameId, (x) => {
    const c = x.categories.find((k) => k.id === cat.id);
    if (!c) { toast('카테고리가 다른 곳에서 지워졌습니다'); return false; }
    c.questions = c.questions ?? [];
    if (existing) {
      const i = c.questions.findIndex((k) => k.id === existing.id);
      if (i < 0) { toast('문제가 다른 곳에서 지워졌습니다'); return false; }
      c.questions[i] = q;
    } else c.questions.push(q);
    return true;
  }, { message: existing ? '저장했습니다' : '문제를 추가했습니다' });
}

/** 아래 버튼 줄 — 취소는 저장하지 않고 목록으로 */
function footer({ existing, save }) {
  const buttons = [
    h('button.btn', { onclick: () => save('back') }, '취소'),
    !existing && h('button.btn', { onclick: () => save('again') }, '저장하고 새 문제'),
    h('button.btn.primary', { onclick: () => save('save') }, '저장 (⌘S)'),
  ].filter(Boolean);
  return { el: h('div.a-row.a-foot', buttons), buttons };
}

// ── 사진 문제 (3-6) ────────────────────────────────────
function photoEditor(body, ctx) {
  const { gameId, cat, existing, qid } = ctx;
  const setup = existing ? needsSetup(existing) : false;
  // 손으로 고친 파일처럼 주소에 t= · end= 만 있으면 그것을 시작 · 끝 칸으로 (R-61)
  const clip0 = existing?.answerClip ? parseYouTube(existing.answerClip) : {};
  const clipSec = (v, fromUrl) => (typeof v === 'number' ? formatTime(v) : fromUrl ? formatTime(fromUrl) : '');
  const f = {
    answer: existing?.answer ?? '', prompt: existing?.prompt ?? '', hint: existing?.hint ?? '', note: existing?.note ?? '',
    disabled: setup ? false : existing?.disabled === true,
    effect: existing ? (existing.effect ?? 'none') : (cat.defaultEffect ?? 'none'),
    zoom: existing?.zoom ?? 5, focus: existing?.focus ? [...existing.focus] : [50, 50], steps: existing?.steps ?? 3,
    masks: existing?.effect === 'mask' && !setup ? existing.masks.map((m) => [...m]) : [],
    credit: existing?.credit,
    image: existing?.image ?? null, imageFile: null, imageUrl: null, imageInfo: '',
    answerImage: existing?.answerImage ?? null, answerFile: null, answerUrl: null, hideAnswerText: existing?.hideAnswerText === true,
    clipUrl: existing?.answerClip ?? '', clipStart: clipSec(existing?.clipStart, clip0.start), clipEnd: clipSec(existing?.clipEnd, clip0.end),
  };
  const cleanups = [guardFileDrop()];
  let sel = -1;
  let drag = null;
  let natural = null;
  let saving = false;
  const clipInput = clipField(f, cleanups);

  // 왼쪽: 이미지 · 확대 지점 · 가림 상자
  const img = h('img', { alt: '', draggable: 'false' });
  const layer = h('div.img-layer');
  const stage = h('div.img-stage', img, layer);
  const imgBox = h('div.img-box', h('div.img-empty', '이미지를 여기로 끌어다 놓거나 ⌘V 로 붙여넣기 · [파일 선택]', h('br'), 'jpg · png · webp · gif'));
  const info = h('span.small-note');
  const guide = h('div.small-note');
  const focusNote = h('span.small-note');
  const pickBtn = h('button.btn', { onclick: async () => { const [file] = await pickFiles(); if (file) chooseImage(file); } }, f.image ? '이미지 교체' : '파일 선택');

  img.addEventListener('load', () => {
    natural = { w: img.naturalWidth, h: img.naturalHeight };
    if (!stage.isConnected) replace(imgBox, stage);
    if (!f.imageFile) info.textContent = `${natural.w}×${natural.h} · ${f.image}`;
    fitImage();
    drawLayer();
  });
  img.addEventListener('error', () => {
    natural = null;
    replace(imgBox, h('div.img-empty', '⚠ 이미지를 불러올 수 없습니다', h('br'), h('code', f.image ?? '')));
  });
  const fitImage = () => {
    if (!natural) return;
    const maxW = Math.max(200, imgBox.clientWidth - 30); // 상자 안쪽 여백 · 크기 손잡이 자리
    const maxH = Math.max(240, window.innerHeight * 0.62);
    const s = Math.min(maxW / natural.w, maxH / natural.h);
    img.style.width = `${Math.round(natural.w * s)}px`;
    img.style.height = `${Math.round(natural.h * s)}px`;
  };
  const ro = new ResizeObserver(fitImage);
  ro.observe(imgBox);
  cleanups.push(() => ro.disconnect());
  const setSrc = () => { const src = f.imageUrl ?? (f.image ? assetUrl(f.image) : null); if (src) img.src = src; };

  async function chooseImage(file) {
    try {
      const p = await prepareImage(file);
      if (f.imageUrl) URL.revokeObjectURL(f.imageUrl);
      f.imageFile = p;
      f.imageUrl = URL.createObjectURL(p.blob);
      info.textContent = p.info;
      pickBtn.textContent = '이미지 교체';
      setSrc();
      preview.show();
      return true;
    } catch (e) { toast(e.message); return false; }
  }
  dropZone(imgBox, ([file]) => chooseImage(file));

  const pct = (e) => {
    const r = img.getBoundingClientRect();
    return [clamp(((e.clientX - r.left) / r.width) * 100, 0, 100), clamp(((e.clientY - r.top) / r.height) * 100, 0, 100)];
  };
  function drawLayer() {
    const items = [];
    if (f.effect === 'zoom') {
      const [fx, fy] = f.focus;
      // 처음(가장 확대) 화면에 보이는 범위 — 게임 화면과 같은 계산
      const v = zoomView(f.focus, f.zoom);
      items.push(h('div.zoom-view', { style: { left: `${v.left}%`, top: `${v.top}%`, width: `${v.size}%`, height: `${v.size}%` } }));
      items.push(h('div.focus', { style: { left: `${fx}%`, top: `${fy}%` } }));
    }
    if (f.effect === 'mask') {
      f.masks.forEach(([x, y, w, hh], i) => items.push(h(`div.mbox${i === sel ? '.sel' : ''}`, {
        dataset: { i: String(i) }, style: { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${hh}%` },
      }, CIRCLED[i], i === sel && h('div.handle'))));
    }
    replace(layer, items);
    stage.classList.toggle('drawable', f.effect !== 'none');
    stage.dataset.effect = f.effect;
    focusNote.textContent = `확대 중심 x ${f.focus[0]} · y ${f.focus[1]}`;
    guide.textContent = f.effect === 'zoom' ? '이미지를 클릭한 곳이 확대 중심입니다 · 점선 = 처음 화면에 보이는 범위'
      : f.effect === 'mask' ? `이미지 위를 드래그해 가림 상자를 그리세요 (최대 ${MASK_MAX}개) · 번호 순서대로 진행자 [힌트 단계 ▶] 로 하나씩 벗겨집니다 (마지막 번호는 정답 공개 때만 — 정답 글자 상자를 마지막에) · 상자 안 드래그 = 이동, 모서리 = 크기, Delete = 삭제`
        : '';
  }
  stage.addEventListener('pointerdown', (e) => {
    if (!natural || e.button !== 0) return;
    const p = pct(e);
    if (f.effect === 'zoom') {
      f.focus = [r1(p[0]), r1(p[1])];
      drag = { kind: 'focus' };
    } else if (f.effect === 'mask') {
      const handle = e.target.closest('.handle');
      const box = e.target.closest('.mbox');
      if (handle || box) {
        const i = Number((handle ? handle.parentElement : box).dataset.i);
        sel = i;
        drag = { kind: handle ? 'resize' : 'move', i, start: p, orig: [...f.masks[i]] };
      } else {
        if (f.masks.length >= MASK_MAX) { toast(`가림 상자는 ${MASK_MAX}개까지입니다`); return; }
        drag = { kind: 'new', i: f.masks.length, start: p };
        f.masks.push([r1(p[0]), r1(p[1]), 0, 0]);
        sel = drag.i;
      }
    } else return;
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
    drawLayer();
    drawMasks();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pct(e);
    if (drag.kind === 'focus') f.focus = [r1(p[0]), r1(p[1])];
    else if (drag.kind === 'new') {
      const [sx, sy] = drag.start;
      f.masks[drag.i] = fitMask([Math.min(sx, p[0]), Math.min(sy, p[1]), Math.abs(p[0] - sx), Math.abs(p[1] - sy)]);
    } else if (drag.kind === 'move') {
      const [ox, oy, w, hh] = drag.orig;
      f.masks[drag.i] = fitMask([clamp(ox + p[0] - drag.start[0], 0, 100 - w), clamp(oy + p[1] - drag.start[1], 0, 100 - hh), w, hh]);
    } else {
      const [x, y, w, hh] = drag.orig;
      f.masks[drag.i] = fitMask([x, y, Math.max(MASK_MIN, w + p[0] - drag.start[0]), Math.max(MASK_MIN, hh + p[1] - drag.start[1])]);
    }
    drawLayer();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.kind === 'new') {
      const m = f.masks[drag.i];
      if (m[2] < MASK_MIN || m[3] < MASK_MIN) { f.masks.splice(drag.i, 1); sel = -1; } // 클릭만 했으면 상자 없음
    }
    drag = null;
    drawLayer();
    drawMasks();
    preview.show();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // 정답 이미지
  const ansBox = h('div');
  async function chooseAnswerImage(file) {
    try {
      const p = await prepareImage(file);
      if (f.answerUrl) URL.revokeObjectURL(f.answerUrl);
      f.answerFile = p;
      f.answerUrl = URL.createObjectURL(p.blob);
      drawAnswerImage();
      preview.show();
      return true;
    } catch (e) { toast(e.message); return false; }
  }
  function drawAnswerImage() {
    const src = f.answerUrl ?? (f.answerImage ? assetUrl(f.answerImage) : null);
    replace(ansBox, h('div', h('div.a-row',
      src ? h('img.a-thumb.big', { src, alt: '' }) : h('span.small-note', '없음 — 정답 공개 때 바꿔 보여줄 이미지 (선택). 이 칸을 누르고 ⌘V 로 붙여넣기도 됩니다'),
      h('button.btn.small', {
        onclick: async () => {
          const [file] = await pickFiles();
          if (file) chooseAnswerImage(file);
        },
      }, src ? '교체' : '파일 선택'),
      src && h('button.btn.small.danger', {
        onclick: () => {
          if (f.answerUrl) URL.revokeObjectURL(f.answerUrl);
          f.answerFile = null; f.answerUrl = null; f.answerImage = null;
          drawAnswerImage();
          preview.show();
        },
      }, '빼기')), hideTextToggle(f, () => preview.show())));
  }

  // 오른쪽: 연출
  const effectBox = h('div');
  const maskList = h('div.mask-list');
  function drawMasks() {
    if (f.effect !== 'mask') return;
    replace(maskList, f.masks.length === 0 ? h('div.small-note', '아직 상자가 없습니다 — 왼쪽 이미지 위를 드래그하세요')
      : f.masks.map((m, i) => h(`div.it${i === sel ? '.sel' : ''}`, { onclick: () => { sel = i; drawLayer(); drawMasks(); } },
        h('b', CIRCLED[i]),
        h('span.small-note', { style: { flex: '1' } }, `x ${m[0]} · y ${m[1]} · ${m[2]} × ${m[3]}`),
        h('button.btn.small', { disabled: i === 0 || undefined, onclick: (e) => { e.stopPropagation(); moveMask(i, -1); } }, '▲'),
        h('button.btn.small', { disabled: i === f.masks.length - 1 || undefined, onclick: (e) => { e.stopPropagation(); moveMask(i, 1); } }, '▼'),
        h('button.btn.small.danger', { onclick: (e) => { e.stopPropagation(); removeMask(i); } }, '삭제'))));
  }
  const moveMask = (i, dd) => {
    const j = i + dd;
    if (j < 0 || j >= f.masks.length) return;
    [f.masks[i], f.masks[j]] = [f.masks[j], f.masks[i]];
    sel = j;
    drawLayer(); drawMasks(); preview.show();
  };
  const removeMask = (i) => { f.masks.splice(i, 1); sel = -1; drawLayer(); drawMasks(); preview.show(); };

  function drawEffect() {
    const zoomVal = h('b', `×${f.zoom.toFixed(1)}`);
    replace(effectBox,
      f.effect === 'zoom' && h('div.effect-panel',
        h('div.a-row', '배율', h('input', { type: 'range', min: 1.5, max: 10, step: 0.5, value: f.zoom, oninput: (e) => { f.zoom = Number(e.target.value); zoomVal.textContent = `×${f.zoom.toFixed(1)}`; drawLayer(); schedule(); } }), zoomVal,
          h('span.small-note', '쉬움 3~4 · 보통 5~6 · 어려움 7~8')),
        h('div.a-row', '단계', h('select.input', { onchange: (e) => { f.steps = Number(e.target.value); schedule(); } },
          [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n), selected: n === f.steps || undefined }, `${n}단계`))),
        focusNote)),
      f.effect === 'mask' && h('div.effect-panel', maskList));
    drawMasks();
  }

  const radios = h('div.a-row.radio-row', [['none', '원본'], ['zoom', '확대'], ['mask', '가림']].map(([val, label]) => h('label',
    h('input', { type: 'radio', name: 'effect', value: val, checked: f.effect === val || undefined, onchange: () => { f.effect = val; sel = -1; drawEffect(); drawLayer(); preview.show(); } }),
    ` ${label}`)));
  const setupNote = setup ? h('div.a-msg.warn', '여러 장 한 번에 추가로 숨김 상태인 문제입니다 — 연출을 설정하고 저장하면 사용으로 바뀝니다') : null;

  // 미리보기
  const frame = previewFrame({ side: true });
  cleanups.push(frame.destroy);
  const preview = createPlayer(frame, {
    make: (box) => ((f.imageUrl || f.image) ? createPhoto(box, questionNow(), { image: f.imageUrl ?? undefined, answerImage: f.answerUrl ?? undefined }) : (replace(box, h('div.img-missing', '이미지를 고르면 미리보기가 나옵니다')), null)),
    promptText: () => f.prompt.trim() || cat.prompt || '',
    answerText: () => f.answer.trim(),
    showAnswerText: () => !f.hideAnswerText,
    total: () => (f.effect === 'zoom' ? f.steps : f.effect === 'mask' ? Math.max(0, f.masks.length - 1) : 0),
  });
  cleanups.push(() => preview.destroy());
  const schedule = debounce(() => preview.show(), 300);
  cleanups.push(() => schedule.cancel());
  function questionNow() {
    const q = { image: f.image ?? 'x.png', effect: f.effect };
    if (f.effect === 'zoom') Object.assign(q, { zoom: f.zoom, focus: f.focus, steps: f.steps });
    if (f.effect === 'mask') q.masks = f.masks;
    if (f.answerUrl || f.answerImage) q.answerImage = f.answerImage ?? 'x-answer.png';
    return q;
  }

  const common = commonForm(f, { cat, existing, qid, onChange: schedule });
  const err = h('div.field-error');
  const save = async (mode) => {
    if (mode === 'back') { go({ page: 'questions', gameId, categoryId: cat.id }); return; }
    if (saving) return;
    err.textContent = '';
    if (!f.answer.trim()) { err.textContent = '정답을 입력하세요'; common.focus(); return; }
    if (!f.image && !f.imageFile) { err.textContent = '문제 이미지를 고르세요'; return; }
    if (f.effect === 'mask' && f.masks.length === 0) { err.textContent = '가림 상자를 1개 이상 그리세요 (또는 연출을 바꾸세요)'; return; }
    const clip = clipInput.read();
    if (clip?.error) { err.textContent = `정답 영상 — ${clip.error}`; return; }
    saving = true;
    foot.buttons.forEach((b) => { b.disabled = true; });
    try {
      let image = f.image;
      let answerImage = f.answerImage;
      if (f.imageFile) image = (await api.upload(gameId, cat.id, `${qid}.${f.imageFile.ext}`, f.imageFile.blob)).path;
      if (f.answerFile) answerImage = (await api.upload(gameId, cat.id, `${qid}-answer.${f.answerFile.ext}`, f.answerFile.blob)).path;
      // 올린 뒤에는 저장 실패 후 다시 눌러도 같은 파일을 쓴다
      if (f.imageFile) { f.image = image; f.imageFile = null; }
      if (f.answerFile) { f.answerImage = answerImage; f.answerFile = null; }
      const q = commonQuestion(f, { id: qid, existing });
      q.image = image;
      q.effect = f.effect;
      if (f.effect === 'zoom') Object.assign(q, { zoom: f.zoom, focus: [...f.focus], steps: f.steps });
      if (f.effect === 'mask') q.masks = f.masks.map(fitMask);
      if (answerImage) q.answerImage = answerImage;
      if (f.hideAnswerText) q.hideAnswerText = true;
      if (clip) {
        q.answerClip = clipUrl(clip.id);
        if (clip.start > 0) q.clipStart = clip.start;
        if (clip.end !== null) q.clipEnd = clip.end;
      }
      if (f.credit) q.credit = f.credit;
      if (await storeQuestion(ctx, q)) {
        go(mode === 'again' ? { page: 'qedit', gameId, categoryId: cat.id } : { page: 'questions', gameId, categoryId: cat.id });
      }
    } catch (e) {
      toast(e.message);
    } finally {
      saving = false;
      foot.buttons.forEach((b) => { b.disabled = false; });
    }
  };
  const foot = footer({ existing, save });

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save('save'); return; }
    if (isTyping(e.target) || document.querySelector('.overlay')) return;
    if (f.effect === 'mask' && sel >= 0 && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeMask(sel); }
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
  cleanups.push(() => { for (const u of [f.imageUrl, f.answerUrl]) if (u) URL.revokeObjectURL(u); });

  // ⌘V 로 붙여넣을 칸 — 문제 이미지(기본) / 정답 이미지. 누른 칸으로 바뀌고 테두리로 보인다 (R-34)
  const imageSection = h('div.a-section', h('h2', existing ? `문제 편집 — ${existing.answer}` : `${cat.icon ?? ''} ${cat.name} — 문제 추가`),
    imgBox, h('div.a-row', pickBtn, info), guide);
  const answerSection = h('div.a-section', h('h3', '정답 이미지 (선택)'), ansBox);
  const clipSection = h('div.a-section', h('h3', '🎬 정답 영상 — 유튜브 (선택)'), clipInput.el);
  let pasteTo = 'image';
  const setPasteTo = (to) => {
    pasteTo = to;
    imageSection.classList.toggle('paste-target', to === 'image');
    answerSection.classList.toggle('paste-target', to === 'answer');
  };
  imageSection.addEventListener('pointerdown', () => setPasteTo('image'));
  answerSection.addEventListener('pointerdown', () => setPasteTo('answer'));
  setPasteTo('image');
  cleanups.push(pasteImage(async (file) => {
    const ok = pasteTo === 'answer' ? await chooseAnswerImage(file) : await chooseImage(file);
    if (ok) toast('클립보드 이미지를 넣었습니다');
  }));

  replace(body,
    h('div.q-edit',
      h('div', imageSection, answerSection, clipSection),
      h('div',
        h('div.a-section',
          setupNote,
          h('div.a-form', common.fields, h('label', '연출'), radios, h('div', { style: { gridColumn: '1 / -1' } }, effectBox), common.tail)),
        h('div.a-section', h('div.a-row', h('h3', { style: { flex: '1' } }, '미리보기'), h('button.btn.small', { onclick: () => preview.play() }, '▶ 재생')), frame.outer))),
    err, foot.el);

  setSrc();
  drawEffect();
  drawLayer();
  drawAnswerImage();
  preview.show();
  if (!existing) setTimeout(() => common.focus(), 50);
  return () => cleanups.forEach((fn) => fn());
}

// ── 이모티콘 문제 (3-8) ────────────────────────────────
const EMOJI_GROUPS = [
  ['사람', '😀 😂 🥲 😍 😎 🤔 😱 😭 😡 🥶 🤮 😴 🤫 🤥 👻 💀 🤖 👽 👶 👧 👦 👩 👨 👵 👴 👮 🧑‍🍳 👰 🤴 👸 🧙 🧛 🧟 🧜 🙏 👏 👍 👎 ✌️ 💪 👀 👂 👃 👄 🦷 ❤️ 💔 💋'],
  ['동물 · 자연', '🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦅 🦉 🐴 🦄 🐝 🐛 🪱 🦋 🐌 🐢 🐍 🐙 🦀 🐟 🐬 🐳 🦈 🐊 🦒 🐘 🌸 🌹 🌻 🌲 🍀 🍂 🌙 ⭐ ☀️ ☁️ ⛈️ ❄️ 🔥 💧 🌊 🌈'],
  ['음식', '🍎 🍌 🍇 🍓 🍑 🍉 🍋 🥕 🌽 🥔 🍄 🍞 🧀 🍗 🍖 🍔 🍟 🍕 🌭 🍜 🍝 🍣 🍙 🍚 🥟 🍰 🎂 🍦 🍩 🍪 🍫 🍬 ☕ 🍺 🍷 🍶 🥤 🧂'],
  ['사물 · 장소', '🏠 🏫 🏥 🏢 🗼 🗽 🏰 ⛺ 🚗 🚌 🚓 🚑 🚒 🚲 ✈️ 🚀 🚢 🚂 ⏰ 📱 💻 📺 📷 🎥 💡 🔑 🔒 💰 💎 🎁 📚 ✏️ ✂️ 🔨 🪨 ⚽ ⚾ 🏀 🎾 🎮 🎲 🎤 🎧 🎸 🎹 🥁 🎬 🎨 👑 👓 👗 👟 🎩 ☂️ 💌'],
  ['기호', '❓ ❗ ⭕ ❌ ✅ 💯 🆕 🔟 1️⃣ 2️⃣ 3️⃣ ➕ ➖ ✖️ ➗ ⬆️ ⬇️ ⬅️ ➡️ 🔴 🟢 🔵 ⚫ ⚪ 💤 💢 💬 🎵'],
];

function emojiEditor(body, ctx) {
  const { gameId, cat, existing, qid } = ctx;
  const f = {
    answer: existing?.answer ?? '', prompt: existing?.prompt ?? '', hint: existing?.hint ?? '', note: existing?.note ?? '',
    disabled: existing?.disabled === true,
    emojis: existing?.emojis ?? '', sequential: existing?.reveal === 'sequential',
    image: existing?.image ?? null, imageFile: null, imageUrl: null,
    answerImage: existing?.answerImage ?? null, answerFile: null, answerUrl: null, hideAnswerText: existing?.hideAnswerText === true,
  };
  const cleanups = [guardFileDrop()];
  let saving = false;

  const emojiInput = h('input.input.emoji-input', { value: f.emojis, placeholder: '예: 🪱🏠💰  (공백은 줄바꿈 위치 힌트)', oninput: (e) => { f.emojis = e.target.value; checkEmoji(); schedule(); } });
  const emojiNote = h('div.hint');
  function checkEmoji() {
    const units = emojiUnits(f.emojis.trim());
    const msgs = [];
    if (units.length > 12) msgs.push(`이모지 ${units.length}개 — 12개까지 권장`);
    if (units.some((u) => !isEmoji(u))) msgs.push('이모지가 아닌 글자가 있습니다');
    emojiNote.className = msgs.length ? 'hint warn-accent' : 'hint';
    emojiNote.textContent = msgs.length ? `⚠ ${msgs.join(' · ')} (저장은 됩니다)` : units.length ? `이모지 ${units.length}개` : 'macOS: Ctrl + Cmd + Space 로 이모지 창';
  }
  function insertEmoji(e) {
    const el = emojiInput;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + e + el.value.slice(end);
    const pos = start + e.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    f.emojis = el.value;
    checkEmoji();
    schedule();
  }
  const palette = h('div.emoji-palette', { style: { display: 'none' } }, EMOJI_GROUPS.map(([name, list]) => [
    h('div.grp', name),
    h('div.emoji-pick', list.split(' ').map((e) => h('button', { type: 'button', onclick: () => insertEmoji(e) }, e))),
  ]));
  const paletteBtn = h('button.btn.small', { onclick: () => { palette.style.display = palette.style.display === 'none' ? '' : 'none'; } }, '😀 선택기');
  const seqBox = h('input', { type: 'checkbox', checked: f.sequential || undefined, onchange: (e) => { f.sequential = e.target.checked; schedule(); } });

  // 이미지로 등록
  const imgRow = h('div');
  const hasImage = () => !!(f.image || f.imageFile);
  function drawImage() {
    const src = f.imageUrl ?? (f.image ? assetUrl(f.image) : null);
    emojiInput.disabled = hasImage();
    seqBox.disabled = hasImage();
    paletteBtn.disabled = hasImage();
    replace(imgRow, h('div.a-row',
      src ? h('img.a-thumb.big', { src, alt: '' }) : h('span.small-note', '카톡 이모티콘 캡처처럼 이미지로 낼 때 (이모지 입력은 쓰지 않음). ⌘V 로 붙여넣기도 됩니다'),
      h('button.btn.small', { onclick: async () => { const [file] = await pickFiles(); if (file) chooseImage(file); } }, src ? '이미지 교체' : '파일 선택'),
      src && h('button.btn.small.danger', { onclick: () => { if (f.imageUrl) URL.revokeObjectURL(f.imageUrl); f.image = null; f.imageFile = null; f.imageUrl = null; drawImage(); preview.show(); } }, '이미지 빼기')));
  }
  async function chooseImage(file) {
    try {
      const p = await prepareImage(file);
      if (f.imageUrl) URL.revokeObjectURL(f.imageUrl);
      f.imageFile = p;
      f.imageUrl = URL.createObjectURL(p.blob);
      drawImage();
      preview.show();
      return true;
    } catch (e) { toast(e.message); return false; }
  }
  dropZone(imgRow, ([file]) => chooseImage(file));

  // 정답 이미지 — 정답 공개 때 이모지 대신 보여줄 포스터 · 앨범 표지 등 (R-39, 3-8)
  const ansRow = h('div');
  async function chooseAnswerImage(file) {
    try {
      const p = await prepareImage(file);
      if (f.answerUrl) URL.revokeObjectURL(f.answerUrl);
      f.answerFile = p;
      f.answerUrl = URL.createObjectURL(p.blob);
      drawAnswerImage();
      preview.show();
      return true;
    } catch (e) { toast(e.message); return false; }
  }
  function drawAnswerImage() {
    const src = f.answerUrl ?? (f.answerImage ? assetUrl(f.answerImage) : null);
    replace(ansRow, h('div', h('div.a-row',
      src ? h('img.a-thumb.big', { src, alt: '' }) : h('span.small-note', '없음 — 정답 공개 때 이모지 대신 보여줄 이미지 (포스터 · 앨범 표지 등, 선택). 이 칸을 누르고 ⌘V 로 붙여넣기도 됩니다'),
      h('button.btn.small', { onclick: async () => { const [file] = await pickFiles(); if (file) chooseAnswerImage(file); } }, src ? '교체' : '파일 선택'),
      src && h('button.btn.small.danger', {
        onclick: () => {
          if (f.answerUrl) URL.revokeObjectURL(f.answerUrl);
          f.answerFile = null; f.answerUrl = null; f.answerImage = null;
          drawAnswerImage();
          preview.show();
        },
      }, '빼기')), hideTextToggle(f, () => preview.show())));
  }
  dropZone(ansRow, ([file]) => chooseAnswerImage(file));

  // ⌘V 로 붙여넣을 칸 — 이미지로 등록(기본) / 정답 이미지. 누른 칸으로 바뀌고 테두리로 보인다.
  // 이모지 칸에서 이모지 글자를 붙여넣는 것은 그대로 (R-34)
  const imageSection = h('div.a-section', h('h3', '또는 이미지로 등록'), imgRow);
  const answerSection = h('div.a-section', h('h3', '정답 이미지 (선택)'), ansRow);
  let pasteTo = 'image';
  const setPasteTo = (to) => {
    pasteTo = to;
    imageSection.classList.toggle('paste-target', to === 'image');
    answerSection.classList.toggle('paste-target', to === 'answer');
  };
  imageSection.addEventListener('pointerdown', () => setPasteTo('image'));
  answerSection.addEventListener('pointerdown', () => setPasteTo('answer'));
  setPasteTo('image');
  cleanups.push(pasteImage(async (file) => {
    const ok = pasteTo === 'answer' ? await chooseAnswerImage(file) : await chooseImage(file);
    if (ok) toast('클립보드 이미지를 넣었습니다');
  }));

  const frame = previewFrame();
  cleanups.push(frame.destroy);
  const units = () => emojiUnits(f.emojis.trim()).length;
  const hasAnswerImage = () => !!(f.answerImage || f.answerUrl);
  const preview = createPlayer(frame, {
    make: (box) => {
      const answer = hasAnswerImage() ? { answerImage: f.answerImage ?? 'x-answer.png' } : {};
      const urls = { answerImage: f.answerUrl ?? undefined };
      if (hasImage()) return createEmoji(box, { image: f.image ?? 'x.png', reveal: 'all', ...answer }, { image: f.imageUrl ?? undefined, ...urls });
      if (!units()) { replace(box, h('div.img-missing', '이모지를 입력하면 미리보기가 나옵니다')); return null; }
      return createEmoji(box, { emojis: f.emojis.trim(), reveal: f.sequential ? 'sequential' : 'all', ...answer }, urls);
    },
    promptText: () => f.prompt.trim() || cat.prompt || '',
    answerText: () => f.answer.trim(),
    showAnswerText: () => !f.hideAnswerText,
    total: () => (!hasImage() && f.sequential ? units() : 1),
    firstStage: 1,
  });
  cleanups.push(() => preview.destroy());
  const schedule = debounce(() => preview.show(), 250);
  cleanups.push(() => schedule.cancel());

  const common = commonForm(f, { cat, existing, qid, onChange: schedule });
  const err = h('div.field-error');
  const save = async (mode) => {
    if (mode === 'back') { go({ page: 'questions', gameId, categoryId: cat.id }); return; }
    if (saving) return;
    err.textContent = '';
    if (!hasImage() && !units()) { err.textContent = '이모지를 입력하세요 (또는 이미지로 등록)'; emojiInput.focus(); return; }
    if (!f.answer.trim()) { err.textContent = '정답을 입력하세요'; common.focus(); return; }
    saving = true;
    foot.buttons.forEach((b) => { b.disabled = true; });
    try {
      let image = f.image;
      let answerImage = f.answerImage;
      if (f.imageFile) {
        image = (await api.upload(gameId, cat.id, `${qid}.${f.imageFile.ext}`, f.imageFile.blob)).path;
        f.image = image;
        f.imageFile = null;
      }
      // 올린 뒤에는 저장 실패 후 다시 눌러도 같은 파일을 쓴다
      if (f.answerFile) {
        answerImage = (await api.upload(gameId, cat.id, `${qid}-answer.${f.answerFile.ext}`, f.answerFile.blob)).path;
        f.answerImage = answerImage;
        f.answerFile = null;
      }
      const q = commonQuestion(f, { id: qid, existing });
      if (image) q.image = image;
      else {
        q.emojis = f.emojis.trim().replace(/\s+/g, ' ');
        if (f.sequential) q.reveal = 'sequential';
      }
      if (answerImage) q.answerImage = answerImage;
      if (f.hideAnswerText) q.hideAnswerText = true;
      if (await storeQuestion(ctx, q)) {
        go(mode === 'again' ? { page: 'qedit', gameId, categoryId: cat.id } : { page: 'questions', gameId, categoryId: cat.id });
      }
    } catch (e) {
      toast(e.message);
    } finally {
      saving = false;
      foot.buttons.forEach((b) => { b.disabled = false; });
    }
  };
  const foot = footer({ existing, save });
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save('save'); } };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
  cleanups.push(() => { for (const u of [f.imageUrl, f.answerUrl]) if (u) URL.revokeObjectURL(u); });

  replace(body,
    h('div.q-edit',
      h('div',
        h('div.a-section', h('h2', existing ? `문제 편집 — ${existing.answer}` : `${cat.icon ?? ''} ${cat.name} — 문제 추가`),
          h('div.a-row', h('span', { style: { fontWeight: '700', color: 'var(--text-dim)' } }, '이모지'), paletteBtn),
          emojiInput, emojiNote, palette,
          h('label', seqBox, ' 순차 공개 — 진행자 [힌트 단계 ▶] 로 하나씩 보여 줌')),
        imageSection,
        answerSection,
        h('div.a-section', h('div.a-row', h('h3', { style: { flex: '1' } }, '미리보기'), h('button.btn.small', { onclick: () => preview.play() }, '▶ 재생')), frame.outer)),
      h('div',
        h('div.a-section', h('div.a-form', common.fields, common.tail)))),
    err, foot.el);

  checkEmoji();
  drawImage();
  drawAnswerImage();
  preview.show();
  setTimeout(() => (existing ? null : (hasImage() ? common.focus() : emojiInput.focus())), 50);
  return () => cleanups.forEach((fn) => fn());
}

// ── 줄줄이 말해요 문제 (3-13, R-44) — 문제 글자 + 정답 후보 목록 ─────
function chainEditor(body, ctx) {
  const { gameId, cat, existing, qid } = ctx;
  const f = {
    prompt: existing?.prompt ?? '', answers: [...(existing?.answers ?? [])], note: existing?.note ?? '',
    disabled: existing?.disabled === true,
  };
  const cleanups = [];
  let saving = false;
  const others = (cat.questions ?? []).filter((q) => q.id !== existing?.id);

  // 문제 글자 — [○ 넣기] 는 커서 자리에 (맥에서 ○ 치기가 번거로워서)
  const promptNote = h('div.small-note', { style: { marginTop: '6px' } });
  const promptInput = h('input.input', { value: f.prompt, maxlength: 40, placeholder: '예: 코스○○ — 빈칸은 ○', style: { fontSize: '22px', flex: '1' }, oninput: (e) => { f.prompt = e.target.value; checkPrompt(); preview(); } });
  function checkPrompt() {
    const key = normKey(f.prompt);
    const same = key && others.find((q) => normKey(q.prompt) === key);
    const msgs = [];
    if (same) msgs.push(`같은 문제가 있습니다 (${same.id}) — 저장은 됩니다`);
    if (charCount(f.prompt.trim()) > 20) msgs.push('20자를 넘습니다 — 진행자가 읽기에 길 수 있습니다');
    promptNote.style.color = msgs.length ? 'var(--accent)' : '';
    promptNote.textContent = msgs.length ? `⚠ ${msgs.join(' · ')}` : '진행자 화면에 이 글자 그대로 나옵니다 — 게임 화면에는 주제 카드만 (R-65)';
  }
  const circleBtn = h('button.btn.small', {
    type: 'button',
    onclick: () => {
      const el = promptInput;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = `${el.value.slice(0, start)}○${el.value.slice(end)}`;
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
      f.prompt = el.value;
      checkPrompt();
      preview();
    },
  }, '○ 넣기');

  // 정답 후보 — Enter 로 하나씩, 쉼표 · 줄바꿈이 섞인 글은 한 번에 여러 개. 겹치면 하나만
  const chips = h('div.a-row.answer-chips');
  const countNote = h('div.small-note');
  const answerInput = h('input.input', { placeholder: '쓰고 Enter (쉼표 · 줄바꿈으로 여러 개 한 번에)', style: { width: '100%' } });
  function addFrom(text) {
    const r = addAnswers(f.answers, splitAnswers(text));
    f.answers = r.list;
    if (r.dup.length) toast(`이미 있음: ${r.dup.join(', ')}`);
    drawAnswers();
    return r;
  }
  answerInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return; // 한글 조합 중 Enter 는 글자 확정
    e.preventDefault();
    if (!answerInput.value.trim()) return;
    addFrom(answerInput.value);
    answerInput.value = '';
  });
  answerInput.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/[,，、\n\r\t]/.test(text)) return; // 한 개면 평소처럼 칸에 붙여넣기
    e.preventDefault();
    const r = addFrom(`${answerInput.value},${text}`);
    answerInput.value = '';
    if (r.added.length) toast(`정답 후보 ${r.added.length}개를 넣었습니다`);
  });
  function drawAnswers() {
    replace(chips, f.answers.map((a, i) => h('span.chip', a, ' ', h('button.link', { type: 'button', title: '빼기', onclick: () => { f.answers.splice(i, 1); drawAnswers(); } }, '✕'))));
    const long = f.answers.filter((a) => charCount(a) > 30);
    const msgs = [];
    if (f.answers.length > 50) msgs.push('50개까지 권장');
    if (long.length) msgs.push(`30자를 넘는 후보 ${long.length}개`);
    countNote.style.color = msgs.length ? 'var(--accent)' : '';
    countNote.textContent = `후보 ${f.answers.length}개${msgs.length ? ` — ⚠ ${msgs.join(' · ')} (저장은 됩니다)` : ''} · 진행자 화면에는 가나다순으로 보입니다`;
  }

  // 미리보기 — 진행자가 읽어 줄 문제 글자 (R-65 — 게임 화면에는 문제가 나오지 않고 주제 카드만)
  const frame = previewFrame({ full: true });
  cleanups.push(frame.destroy);
  const previewPrompt = h('div.tq-prompt');
  const previewEl = h('div.topic.topic-q.pv-screen',
    h('div.tq-head', h('span.emoji', cat.icon ?? '❓'), ` ${cat.name}`),
    cat.rule && h('div.tq-rule', cat.rule),
    h('div.tq-main', previewPrompt));
  replace(frame.inner, previewEl);
  function preview() {
    const text = f.prompt.trim();
    previewPrompt.textContent = text || '문제 글자';
    previewPrompt.style.opacity = text ? '' : '0.3';
    previewPrompt.style.setProperty('--n', String(Math.max(1, charCount(text || '문제 글자'))));
    frame.fit();
  }

  const err = h('div.field-error');
  const save = async (mode) => {
    if (mode === 'back') { go({ page: 'questions', gameId, categoryId: cat.id }); return; }
    if (saving) return;
    err.textContent = '';
    // Enter 를 안 누르고 남겨 둔 후보도 넣는다
    if (answerInput.value.trim()) { addFrom(answerInput.value); answerInput.value = ''; }
    if (!f.prompt.trim()) { err.textContent = '문제를 입력하세요'; promptInput.focus(); return; }
    if (!f.answers.length) { err.textContent = '정답 후보를 1개 이상 넣으세요'; answerInput.focus(); return; }
    saving = true;
    foot.buttons.forEach((b) => { b.disabled = true; });
    try {
      const q = { id: qid, prompt: f.prompt.trim(), answers: [...f.answers] };
      if (f.note.trim()) q.note = f.note.trim();
      if (f.disabled) q.disabled = true;
      if (!existing) q.addedAt = today();
      else if (existing.addedAt) q.addedAt = existing.addedAt;
      if (await storeQuestion(ctx, q)) {
        go(mode === 'again' ? { page: 'qedit', gameId, categoryId: cat.id } : { page: 'questions', gameId, categoryId: cat.id });
      }
    } catch (e) {
      toast(e.message);
    } finally {
      saving = false;
      foot.buttons.forEach((b) => { b.disabled = false; });
    }
  };
  const foot = footer({ existing, save });
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save('save'); } };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  replace(body,
    h('div.q-edit',
      h('div',
        h('div.a-section',
          h('h2', existing ? `문제 편집 — ${existing.prompt}` : `${cat.icon ?? ''} ${cat.name} — 문제 추가`),
          h('div.a-form',
            h('label', '문제'), h('div', h('div.a-row', promptInput, circleBtn), promptNote),
            h('label', '정답 후보'), h('div', answerInput, chips, countNote),
            h('label', '메모'), h('textarea.input', { rows: 2, maxlength: 100, placeholder: '진행자 화면 전용 — 인정 기준 등 (선택)', style: { minHeight: '56px', fontFamily: 'inherit', fontSize: '14px' }, oninput: (e) => { f.note = e.target.value; } }, f.note),
            h('label', '숨김'), h('label', h('input', { type: 'checkbox', checked: f.disabled || undefined, onchange: (e) => { f.disabled = e.target.checked; } }), ' 출제에서 빼기'),
            h('label', 'id'), h('div', h('code', qid), existing ? '' : h('span.small-note', '  (자동 발급)'))))),
      h('div',
        h('div.a-section', h('h3', '미리보기 (진행자가 읽어 줄 문제)'), frame.outer,
          h('div.small-note', '문제 · 정답 후보는 진행자 화면에만 나옵니다 — 게임 화면(모니터)에는 주제 카드만 (R-65)')))),
    err, foot.el);

  checkPrompt();
  drawAnswers();
  preview();
  setTimeout(() => (existing ? null : promptInput.focus()), 50);
  return () => cleanups.forEach((fn) => fn());
}

// ── 여러 장 한 번에 추가 (3-7) ──────────────────────────
export async function bulkAdd(body, v) {
  const g = A.games[v.gameId] ?? await loadGame(v.gameId);
  const d = g.data;
  const cat = d.categories.find((c) => c.id === v.categoryId);
  if (!cat || d.type !== 'photo') { go({ page: 'game', gameId: v.gameId }); return null; }
  const rows = [];
  const cleanups = [guardFileDrop()];
  let saving = false;
  const tbody = h('tbody');
  const table = h('table.a-table.bulk-table', { style: { display: 'none' } },
    h('thead', h('tr', h('th', '이미지'), h('th', '파일'), h('th', '정답'), h('th', '연출'), h('th', '상태'), h('th', ''))), tbody);
  const status = h('div.small-note');
  const saveBtn = h('button.btn.primary', { onclick: () => saveAll() }, '모두 저장');
  const drop = h('div.img-box.bulk-drop', h('div.img-empty', '이미지 여러 장을 여기로 끌어다 놓거나 [파일 선택]', h('br'), `연출 기본값: ${({ none: '원본', zoom: '확대', mask: '가림' })[cat.defaultEffect ?? 'none']}`));

  // 행은 한 번만 만들고 칸만 고친다 — 다른 파일을 읽는 동안 정답을 입력해도 끊기지 않게
  function makeRow(file) {
    const r = { name: file.name, answer: answerFromFileName(file.name), effect: cat.defaultEffect ?? 'none', prepared: null, url: null, error: null, uploaded: null, state: '' };
    r.thumb = h('td');
    r.info = h('div.small-note');
    r.stateCell = h('td');
    r.answerInput = h('input.input', { value: r.answer, maxlength: 60, placeholder: '정답', oninput: (e) => { r.answer = e.target.value; } });
    r.effectSelect = h('select.input', { onchange: (e) => { r.effect = e.target.value; } },
      [['none', '원본'], ['zoom', '확대'], ['mask', '가림']].map(([val, l]) => h('option', { value: val, selected: r.effect === val || undefined }, l)));
    r.removeBtn = h('button.btn.small', { onclick: () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); if (r.url) URL.revokeObjectURL(r.url); draw(); } }, '빼기');
    r.el = h('tr', r.thumb, h('td', h('div', r.name), r.info), h('td', r.answerInput), h('td', r.effectSelect), r.stateCell, h('td', r.removeBtn));
    return r;
  }
  function drawRow(r) {
    replace(r.thumb, r.url ? h('img.a-thumb', { src: r.url, alt: '' }) : h('span.small-note', r.error ? '✕' : '…'));
    r.info.textContent = r.prepared?.info ?? '';
    replace(r.stateCell, r.error ? h('span.err-badge', r.error) : r.state ? h('span.ok-badge', r.state) : r.prepared ? '✔' : '읽는 중…');
    r.answerInput.disabled = !!r.error || saving;
    r.effectSelect.disabled = !!r.error || saving;
    r.removeBtn.disabled = saving;
  }

  async function addFiles(files) {
    for (const file of files) {
      const row = makeRow(file);
      rows.push(row);
      tbody.append(row.el);
      draw();
      try {
        row.prepared = await prepareImage(file);
        row.url = URL.createObjectURL(row.prepared.blob);
      } catch (e) {
        row.error = e.message;
      }
      draw();
    }
  }
  dropZone(drop, addFiles);
  cleanups.push(() => rows.forEach((r) => r.url && URL.revokeObjectURL(r.url)));

  const valid = () => rows.filter((r) => r.prepared && !r.error);
  function draw() {
    const n = valid().length;
    saveBtn.textContent = `모두 저장 (${n}개)`;
    saveBtn.disabled = n === 0 || saving;
    status.textContent = rows.length ? `${rows.length}장 중 ${n}장 저장 가능 · 확대 · 가림은 저장 뒤 각 문제에서 지정 (그 전까지 숨김)` : '';
    table.style.display = rows.length ? '' : 'none';
    rows.forEach(drawRow);
  }

  async function saveAll() {
    const list = valid();
    if (!list.length || saving) return;
    const empty = list.find((r) => !r.answer.trim());
    if (empty) { toast(`정답을 입력하세요 — ${empty.name}`); return; }
    saving = true;
    draw();
    try {
      const taken = allQuestionIds(d);
      for (const r of list) if (r.uploaded) taken.add(r.uploaded.id); // 지난번 저장 실패 때 이미 올린 것
      for (const r of list) {
        if (r.uploaded) continue;
        const id = newQuestionId(cat.id, taken);
        taken.add(id);
        r.state = '올리는 중…';
        draw();
        const { path } = await api.upload(v.gameId, cat.id, `${id}.${r.prepared.ext}`, r.prepared.blob);
        r.uploaded = { id, path };
        r.state = '올림';
        draw();
      }
      const at = today();
      const questions = list.map((r) => {
        const q = { id: r.uploaded.id, answer: r.answer.trim(), image: r.uploaded.path, effect: r.effect, addedAt: at };
        // 확대 지점 · 가림 상자는 각 문제 편집에서 — 그때까지 숨김 (설정 필요)
        if (r.effect === 'zoom') Object.assign(q, { zoom: 5, focus: [50, 50], disabled: true });
        if (r.effect === 'mask') Object.assign(q, { masks: [MASK_PLACEHOLDER], disabled: true });
        return q;
      });
      const ok = await saveGame(v.gameId, (x) => {
        const c = x.categories.find((k) => k.id === cat.id);
        if (!c) { toast('카테고리가 다른 곳에서 지워졌습니다'); return false; }
        c.questions = [...(c.questions ?? []), ...questions];
        return true;
      }, { message: `${questions.length}개를 추가했습니다` });
      if (ok) go({ page: 'questions', gameId: v.gameId, categoryId: cat.id });
    } catch (e) {
      toast(e.message);
    } finally {
      saving = false;
      if (body.isConnected) draw();
    }
  }

  replace(body, h('div.a-section',
    h('h2', `${cat.icon ?? ''} ${cat.name} — 여러 장 한 번에 추가`),
    drop,
    h('div.a-row', h('button.btn', { onclick: async () => addFiles(await pickFiles({ multiple: true })) }, '파일 선택'), status),
    table,
    h('div.a-row.a-foot', h('button.btn', { onclick: () => go({ page: 'questions', gameId: v.gameId, categoryId: cat.id }) }, '취소'), saveBtn)));
  draw();
  return () => cleanups.forEach((fn) => fn());
}

// ── 표 붙여넣기 (3-9) ──────────────────────────────────
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const STATUS_MARK = { ok: '✔', warn: '⚠', skip: '✕' };

export async function pastePage(body, v) {
  const g = A.games[v.gameId] ?? await loadGame(v.gameId);
  const d = g.data;
  const emoji = d.type === 'emoji';
  if (!emoji && d.type !== 'roulette') { go({ page: 'game', gameId: v.gameId }); return; }
  const header = emoji ? EMOJI_HEADER : ROULETTE_HEADER;
  const sample = emoji
    ? '카테고리\t이모지\t정답\t힌트\t메모\t순차공개\n영화\t🪱🏠💰\t기생충\t봉준호\t\tO\n속담\t🐦🐦🪨\t일석이조\t\t사자성어도 인정\t'
    : '주제 이름\t아이콘\t규칙\t예시 (쉼표 구분)\n걸그룹 이름 대기\t🎤\t걸그룹 이름을 하나씩, 중복 금지\t리센느, 소녀시대, 뉴진스';
  let parsed = [];
  let newCats = new Map(); // 이름 → { id, create }
  const preview = h('div');
  const ta = h('textarea.input', { placeholder: `구글 시트 · 엑셀에서 표를 복사해 붙여넣으세요 (첫 줄이 머리글이면 건너뜀)\n\n${sample}`, style: { minHeight: '160px' } });
  const parse = debounce(() => {
    parsed = emoji ? parseEmojiRows(ta.value, d) : parseRouletteRows(ta.value, d);
    if (emoji) {
      const names = [...new Set(parsed.filter((r) => r.status !== 'skip' && !findCat(d, r.category)).map((r) => r.category.trim()))];
      const taken = new Set(d.categories.map((c) => c.id));
      for (const n of newCats.values()) taken.add(n.id);
      const next = new Map();
      for (const name of names) {
        let entry = newCats.get(name);
        if (!entry) { entry = { id: suggestCategoryId(taken), create: true }; taken.add(entry.id); }
        next.set(name, entry);
      }
      newCats = next;
    }
    draw();
  }, 200);
  ta.addEventListener('input', parse);

  const rowAllowed = (r) => r.status !== 'skip' && r.include && (!emoji || findCat(d, r.category) || newCats.get(r.category.trim())?.create);
  function draw() {
    const count = parsed.filter(rowAllowed).length;
    const newBlock = emoji && newCats.size > 0 && h('div.a-msg.warn',
      h('div', '없는 카테고리 — 새로 만들까요? (id 는 추가한 뒤 바꿀 수 없음)'),
      [...newCats].map(([name, entry]) => h('div.a-row', { style: { marginTop: '6px' } },
        h('label', h('input', { type: 'checkbox', checked: entry.create || undefined, onchange: (e) => { entry.create = e.target.checked; draw(); } }), ` 새 카테고리 '${name}'`),
        h('span.small-note', 'id'),
        h('input.input', { value: entry.id, style: { width: '16em' }, onchange: (e) => { entry.id = e.target.value.trim(); } }))));
    const cols = emoji ? ['카테고리', '이모지', '정답', '힌트', '메모', '순차'] : ['주제 이름', '아이콘', '규칙', '예시'];
    replace(preview,
      parsed.length === 0 ? null : [
        newBlock,
        h('table.a-table.paste-table',
          h('tr', h('th', ''), h('th', '포함'), cols.map((c) => h('th', c)), h('th', '사유')),
          parsed.map((r) => {
            const cells = emoji
              ? [r.category, h('span.emoji', { style: { fontSize: '20px' } }, r.emojis), r.answer, r.hint, r.note, r.sequential ? 'O' : '']
              : [r.name, h('span.emoji', { style: { fontSize: '20px' } }, r.icon), r.rule, r.examples.join(', ')];
            return h(`tr${rowAllowed(r) ? '' : '.hidden'}`,
              h('td.st', { class: r.status === 'skip' ? 'err-badge' : r.status === 'warn' ? 'warn-badge' : 'ok-badge' }, STATUS_MARK[r.status]),
              h('td', r.status === 'warn' ? h('input', { type: 'checkbox', checked: r.include || undefined, onchange: (e) => { r.include = e.target.checked; draw(); } }) : r.status === 'ok' ? '✔' : ''),
              cells.map((c) => h('td', c)),
              h('td.small-note', r.reason ?? ''));
          })),
        h('div.small-note', `✔ ${parsed.filter((r) => r.status === 'ok').length} · ⚠ ${parsed.filter((r) => r.status === 'warn').length} · ✕ ${parsed.filter((r) => r.status === 'skip').length}`),
      ]);
    regBtn.textContent = `${count}개 등록`;
    regBtn.disabled = count === 0;
  }

  const regBtn = h('button.btn.primary', { disabled: true, onclick: () => register() }, '0개 등록');
  async function register() {
    const list = parsed.filter(rowAllowed);
    if (!list.length) return;
    let ok;
    if (emoji) {
      const usedNew = [...newCats].filter(([name, e]) => e.create && list.some((r) => r.category.trim() === name));
      const ids = new Set(d.categories.map((c) => c.id));
      for (const [name, e] of usedNew) {
        if (!SLUG_RE.test(e.id) || e.id.length < 2 || e.id.length > 32) { toast(`'${name}' id 는 영문 소문자 · 숫자 · 하이픈 (2~32자)`); return; }
        if (ids.has(e.id)) { toast(`'${name}' id '${e.id}' 가 이미 있습니다`); return; }
        ids.add(e.id);
      }
      ok = await saveGame(v.gameId, (x) => {
        for (const [name, e] of usedNew) if (!x.categories.some((c) => c.id === e.id)) x.categories.push({ id: e.id, name, questions: [] });
        const taken = allQuestionIds(x);
        const at = today();
        for (const r of list) {
          const c = findCat(x, r.category);
          if (!c) continue;
          const id = newQuestionId(c.id, taken);
          taken.add(id);
          const q = { id, answer: r.answer.trim(), emojis: r.emojis };
          if (r.sequential) q.reveal = 'sequential';
          if (r.hint) q.hint = r.hint;
          if (r.note) q.note = r.note;
          q.addedAt = at;
          c.questions = [...(c.questions ?? []), q];
        }
        return true;
      }, { message: `${list.length}개를 등록했습니다` });
    } else {
      ok = await saveGame(v.gameId, (x) => {
        const taken = new Set(x.categories.map((c) => c.id));
        for (const r of list) {
          const id = suggestCategoryId(taken);
          taken.add(id);
          const c = { id, name: r.name.trim(), icon: r.icon, rule: r.rule.trim() };
          if (r.examples.length) c.examples = r.examples.slice(0, 20);
          x.categories.push(c);
        }
        return true;
      }, { message: `주제 ${list.length}개를 등록했습니다` });
    }
    if (ok) go({ page: 'game', gameId: v.gameId });
  }

  replace(body, h('div.a-section',
    h('h2', `${d.icon ?? ''} ${d.title} — 표 붙여넣기`),
    h('div.a-row',
      h('span.small-note', '열 순서:'), h('code', header.join(' | ')),
      h('button.btn.small', { onclick: async () => toast((await copyText(`${header.join('\t')}\n`)) ? '머리글을 복사했습니다 — 구글 시트 첫 행에 붙여넣으세요' : '복사하지 못했습니다') }, '템플릿 복사'),
      emoji && h('a.btn.small', { href: '/docs/templates/emoji-quiz-template.tsv', download: 'emoji-quiz-template.tsv' }, '템플릿 파일 받기')),
    emoji && h('div.small-note', '이모지 열에는 이모지만 · 순차공개 열은 O / Y / 1 / 예 · 없는 카테고리 이름은 새로 만들 수 있음 · 이미 있는 정답은 처음에 빼 둠'),
    ta,
    preview,
    h('div.a-row.a-foot', h('button.btn', { onclick: () => go({ page: 'game', gameId: v.gameId }) }, '취소'), regBtn)));
  setTimeout(() => ta.focus(), 50);
}
