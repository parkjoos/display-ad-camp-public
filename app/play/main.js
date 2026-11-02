// 공개 모드 `/play` — 누구나 게임을 한 번씩 해 보기 (R-96 · R-97 · R-98 · R-99 · R-102 · R-103, docs/05-screens.md 7장, docs/06-controls.md 10장)
// 로그인 · 팀 · 점수 · 룰렛 · 진행자 화면 없이 이 브라우저에서만 진행한다 — 서버의 현장 상태 · 종합 점수판은 건드리지 않는다.
// 게임 목록 → 카테고리 목록 → 그 카테고리 문제 전부(관리 페이지의 문제 순서 — 작성 순서 · 무작위) → 카테고리 목록. 화면 위치는 주소(#게임/카테고리)에 남긴다.
// 키보드와 마우스 둘 다로 끝까지 진행한다: Enter = 화면의 주 버튼, H = 힌트, Esc = 한 단계 위 (목록은 방향키로 고른다)
import { h, replace, fitText, josa } from '../ui/dom.js';
import { setAssetUrls, assetUrl } from '../core/assets.js';
import { stageRange } from '../core/state.js';
import { planRun, restoreRun, questionCount } from '../core/public-play.js';
import { createPhoto } from '../ui/render-photo.js';
import { createEmoji } from '../ui/render-emoji.js';
import { createClip } from '../ui/clip.js';
import { clipSpec } from '../core/youtube.js';

const root = document.getElementById('app');
const P = { data: null, focus: { games: 0 } }; // focus — 목록마다 방향키로 고른 카드 (게임 목록 · 게임 id 별 카테고리 목록)
let current = null;

const isEnter = (e) => e.code === 'Enter' || e.code === 'NumpadEnter';
// 마우스로 눌러도 포커스를 남기지 않는다 — 남으면 다음 Enter 를 브라우저가 그 버튼에 보낸다 (Tab 으로 고른 버튼은 그대로)
const noFocus = (e) => e.preventDefault();

/** 버튼 — 오른쪽에 키 이름 */
function btn(label, { key = null, primary = false, onClick }) {
  return h(`button.btn.pp-btn${primary ? '.primary' : ''}`, { onmousedown: noFocus, onclick: onClick }, label, key && h('kbd', key));
}

function show(view) {
  current?.destroy?.();
  current = view;
  view.el.classList.add('screen');
  root.replaceChildren(view.el);
  view.mounted?.();
}

/** 게임 설명 — 데이터의 설명은 행사용("가장 먼저 맞혀 보세요")이라 혼자 하는 문구로 (R-99) */
function describe(game) {
  if (game.type === 'photo') return '사진을 보고 무엇인지 맞혀 보세요!';
  const names = game.categories.map((c) => c.name).join(' · ');
  return `이모지를 보고 ${names}${josa(names, '을', '를')} 맞혀 보세요!`;
}

/**
 * 카드 목록 — ← ↑ 앞 · → ↓ 뒤 (끝에서 처음으로 돈다), Enter 로 연다. 고른 카드는 강조 테두리 (게임 목록 · 카테고리 목록)
 * @returns 화면의 onKey 에서 부를 키 처리 — 처리했으면 true
 */
function cardKeys(cards, focusKey, open) {
  const n = cards.length;
  P.focus[focusKey] = Math.max(0, Math.min(P.focus[focusKey] ?? 0, n - 1));
  const paint = () => cards.forEach((c, i) => c.classList.toggle('focus', i === P.focus[focusKey]));
  paint();
  return (e) => {
    if (!n) return false;
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.code];
    if (step) {
      P.focus[focusKey] = (P.focus[focusKey] + step + n) % n;
      paint();
      cards[P.focus[focusKey]].scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (isEnter(e)) { open(P.focus[focusKey]); return true; }
    return false;
  };
}

// ── 진행 — 이 브라우저에만 (카테고리마다 문제 순서 · 위치, 다 풀었으면 done) ──
const RUN_PREFIX = 'camp-game:play:v2:';
const runKey = (game, cat) => `${RUN_PREFIX}${game.id}:${cat.id}`;
function readRun(game, cat) {
  try { return JSON.parse(localStorage.getItem(runKey(game, cat))); } catch { return null; }
}
function saveRun(game, cat, value) {
  try { localStorage.setItem(runKey(game, cat), JSON.stringify(value)); } catch { /* 사생활 보호 창 — 이어하기만 안 됨 */ }
}
/** 이어서 풀 판 — 없거나 다 풀었거나 문제 순서 설정이 바뀌었으면 null */
const loadRun = (game, cat) => restoreRun(cat, readRun(game, cat), game.questionOrder);
const isDone = (game, cat) => readRun(game, cat)?.done === true;
/** 새 판 — 다 푼 카테고리 다시 풀기 · [처음부터] */
function freshRun(game, cat) {
  const run = planRun(cat, game.questionOrder);
  saveRun(game, cat, run);
  return run;
}
/** 이 브라우저에 남은 진행 (이어하기 · 다 풂) — [이어하기 초기화] 가 지운다 (R-103) */
function savedRunKeys() {
  try { return Object.keys(localStorage).filter((k) => k.startsWith(RUN_PREFIX)); } catch { return []; }
}
function clearRuns() {
  for (const k of savedRunKeys()) {
    try { localStorage.removeItem(k); } catch { /* 지울 수 없으면 그대로 */ }
  }
}

// ── 주소 — /play · #<게임 id> · #<게임 id>/<카테고리 id> (R-99) ──
// 화면을 바꿀 때 주소를 남겨 브라우저 뒤로 가기가 한 단계 위로 가고, 새로고침해도 그 화면으로 돌아온다.
// 문제 → 다음 문제는 주소가 그대로 (뒤로 가기는 문제마다가 아니라 카테고리 목록으로)
const hashOf = (game = null, cat = null) => (game ? `#${game.id}${cat ? `/${cat.id}` : ''}` : '');
const urlOf = (hash) => hash || location.pathname;

/** 아래로 — 목록에서 고른 화면. 돌아올 곳(지금 주소)을 기록에 함께 남긴다 */
function goDown(game, cat = null) {
  history.pushState({ up: location.hash }, '', urlOf(hashOf(game, cat)));
  route();
}

/** 위로 — 바로 위 화면에서 들어왔으면 뒤로 가기와 같게(기록이 쌓이지 않게), 아니면(새로고침 · 주소로 바로 들어옴) 주소만 바꾼다 */
function goUp(game = null) {
  const target = hashOf(game);
  if (history.state?.up === target) { history.back(); return; }
  history.replaceState(null, '', urlOf(target));
  route();
}

/** 주소대로 화면 — 없는 게임 · 카테고리(숨김 · 공개 끔)면 한 단계 위로 */
function route() {
  const [gid, cid] = decodeURIComponent(location.hash.slice(1)).split('/');
  const gi = P.data.games.findIndex((g) => g.id === gid);
  if (gi < 0) {
    if (gid) history.replaceState(null, '', location.pathname);
    show(homeView());
    return;
  }
  const game = P.data.games[gi];
  P.focus.games = gi;
  const ci = cid ? game.categories.findIndex((c) => c.id === cid) : -1;
  if (ci < 0) {
    if (cid) history.replaceState(history.state, '', urlOf(hashOf(game)));
    show(gameView(game));
    return;
  }
  const cat = game.categories[ci];
  P.focus[game.id] = ci;
  const run = loadRun(game, cat);
  if (run) show(playView(game, cat, run));
  else if (isDone(game, cat)) show(endView(game, cat)); // 다 풀고 새로고침
  else show(playView(game, cat, freshRun(game, cat)));
}

// ── 게임 목록 ─────────────────────────────────────────
function homeView() {
  const games = P.data.games;
  const open = (i) => { P.focus.games = i; goDown(games[i]); };
  const cards = games.map((g, i) => {
    const done = g.categories.filter((c) => isDone(g, c)).length;
    return h('button.pick-cat.pp-card', { onmousedown: noFocus, onclick: () => open(i) },
      h('div.pc-icon', g.icon),
      h('div.pc-name', g.title),
      h('div.pc-desc', describe(g)),
      h('div.pc-meta', `카테고리 ${g.categories.length}개 · 문제 ${questionCount(g)}개`),
      done > 0 && h('div.pp-badge', `✔ 다 푼 카테고리 ${done} / ${g.categories.length}`));
  });
  const onKey = cardKeys(cards, 'games', open);
  // 이어하기 초기화 (R-103) — 남은 진행이 있을 때만. 확인 뒤 모든 카테고리를 처음부터 (키 없음)
  const reset = () => {
    if (!confirm('이 브라우저에 남은 이어하기 · 다 푼 기록을 모두 지울까요?\n모든 카테고리를 처음부터 풀게 됩니다.')) return;
    clearRuns();
    show(homeView());
  };
  const el = h('div.title-screen.pp-home',
    h('div.pp-title', `🏕️ ${P.data.title}`),
    h('div.pp-sub', '게임을 골라 혼자 해 보세요 — 점수는 세지 않습니다'),
    games.length ? h('div.pick-cats', cards) : h('div.pp-sub', '지금 공개된 게임이 없습니다'),
    games.length > 0 && h('div.pp-keys', '← → 고르기 · Enter 시작 — 마우스로 눌러도 됩니다'),
    games.length > 0 && savedRunKeys().length > 0 && btn('↺ 이어하기 초기화', { onClick: reset }));
  return { el, onKey };
}

// ── 카테고리 목록 (게임 소개를 겸함) ─────────────────────
function gameView(game) {
  const cats = game.categories;
  // 행사 규칙(rules — 팀 · 대표)은 혼자 하는 공개 모드에 맞지 않아 이것으로 대신한다
  const hint = game.type === 'photo'
    ? '막히면 💡 힌트 — 확대 사진은 한 단계씩 작아지고, 가린 상자는 하나씩 열립니다'
    : '막히면 💡 힌트 — 이모지가 하나씩 더 보이거나 힌트 글이 나옵니다';
  const open = (i) => {
    P.focus[game.id] = i;
    if (isDone(game, cats[i])) freshRun(game, cats[i]); // 다 푼 카테고리는 새 판으로
    goDown(game, cats[i]);
  };
  const cards = cats.map((c, i) => {
    const run = loadRun(game, c);
    const done = isDone(game, c);
    return h(`button.cat-card.pp-cat${done ? '.done' : ''}`, { onmousedown: noFocus, onclick: () => open(i) },
      h('div.cc-name', h('span.emoji', c.icon), c.name),
      c.description && h('div.cc-desc', c.description),
      h('div.cc-meta', h('span', `문제 ${c.questions.length}개`),
        run ? h('span.pp-badge', `이어하기 ${run.index + 1} / ${run.keys.length}`) : done && h('span.pp-badge.ok', '✔ 다 풂')));
  });
  const keys = cardKeys(cards, game.id, open);
  const el = h('div.home.pp-game',
    h('div.home-head', h('span.home-icon', game.icon), h('div', h('div.home-title', game.title), h('div.home-desc', describe(game)))),
    h('ul.home-rules', [`카테고리를 고르면 그 카테고리 문제가 모두 ${game.questionOrder === 'fixed' ? '정해진 순서대로' : '무작위 순서로'} 나옵니다`, hint, '정답을 보고 다음으로 넘어가며 혼자 풀어 보세요 — 점수는 세지 않습니다'].map((r) => h('li', r))),
    h('div.cat-grid.pp-cats', cards),
    h('div.home-foot', btn('☰ 게임 목록', { key: 'Esc', onClick: () => goUp() }), h('div.pp-keys', '← → 고르기 · Enter 시작')));
  return {
    el,
    mounted: () => cards[P.focus[game.id]]?.scrollIntoView({ block: 'nearest' }),
    onKey(e) {
      if (e.code === 'Escape') { goUp(); return true; }
      return keys(e);
    },
  };
}

// ── 진행 ─────────────────────────────────────────────
function playView(game, cat, run) {
  const q = cat.questions.find((x) => x.id === run.keys[run.index]);
  const nextQ = cat.questions.find((x) => x.id === run.keys[run.index + 1]) ?? null;
  const back = () => goUp(game);
  const next = () => {
    if (!nextQ) { saveRun(game, cat, { done: true }); show(endView(game, cat)); return; }
    run.index += 1;
    saveRun(game, cat, run);
    show(playView(game, cat, run));
  };
  const restart = () => show(playView(game, cat, freshRun(game, cat)));
  const part = questionPart(game, cat, q);
  // 정답을 본 문제는 다 푼 것으로 — 여기서 나가도 다음에 이 문제를 다시 내지 않는다 (R-99)
  part.onReveal = () => saveRun(game, cat, nextQ ? { ...run, index: run.index + 1 } : { done: true });
  const head = h('div.play-head',
    h('div.ph-left', h('span.emoji', game.icon), ' ', h('span.emoji', cat.icon ?? ''), ` ${cat.name}`),
    h('div.ph-right', h('span.num', `${run.index + 1} / ${run.keys.length}`)));
  const bar = h('div.pp-bar');
  const el = h('div.play.pp-play', head, part.main, bar);

  // 다음 문제 이미지를 미리 — 넘기자마자 보이게
  for (const p of [nextQ?.image, nextQ?.answerImage]) if (p) new Image().src = assetUrl(p);

  function paint() {
    const s = part.state();
    replace(bar,
      btn('☰ 카테고리 목록', { key: 'Esc', onClick: back }),
      run.index > 0 && btn('↺ 처음부터', { onClick: restart }),
      h('div.pp-gap'),
      s.hint && btn(s.hint, { key: 'H', onClick: hint }),
      btn(s.primary ?? (nextQ ? '다음 문제 ▶' : '끝 ▶'), { key: 'Enter', primary: true, onClick: primary }));
  }
  /** 주 버튼 — 정답 보기 · 영상 넘기기가 남았으면 그것, 아니면 다음 */
  function primary() {
    if (part.primary()) paint(); else next();
  }
  function hint() {
    if (part.hint()) paint();
  }
  part.onChange = paint;
  paint();
  return {
    el,
    mounted: () => part.mounted(),
    destroy: () => part.destroy(),
    onKey(e) {
      if (isEnter(e)) { primary(); return true; }
      if (e.code === 'KeyH' && part.state().hint) { hint(); return true; }
      if (e.code === 'Escape') { back(); return true; }
      return false;
    },
  };
}

/**
 * 사진 · 이모지 문제 — 게임 화면과 같은 표시(render-photo · render-emoji · 정답 영상).
 * 힌트는 한 단계씩(확대 축소 · 가림 상자 · 이모지 하나 더) 다 쓰면 힌트 글
 */
function questionPart(game, category, q) {
  const prompt = h('div.prompt', q.prompt ?? category.prompt ?? '');
  const box = h('div.stage-box');
  const main = h('div.play-main', prompt, box);
  if (!prompt.textContent) prompt.remove();
  const renderer = game.type === 'photo' ? createPhoto(box, q) : createEmoji(box, q);
  const range = stageRange(q, game.type);
  let stage = range.initial;
  let revealed = false;
  let hintShown = false;
  let hintEl = null;
  let answerEl = null;
  const part = {};
  // 정답 영상 (R-61) — 정답을 보면 사진 위에서 재생하고 끝나면 정답 띠
  const spec = game.type === 'photo' ? clipSpec(q) : null;
  const clip = spec ? createClip(box, spec, { onChange: () => { sync(); part.onChange?.(); } }) : null;

  function sync() {
    renderer.set({ stage, revealed });
    if (clip && !revealed) clip.prepare();
    if (hintShown && !hintEl) { hintEl = h('div.hint-band', `💡 ${q.hint}`); main.append(hintEl); }
    hintEl?.classList.toggle('top', revealed);
    // 정답 띠 — 영상이 화면을 덮는 동안은 띄우지 않는다. 정답 글자 숨기기(R-41)면 이미지만
    const want = revealed && !q.hideAnswerText && !clip?.covering();
    if (want && !answerEl) {
      const text = h('div.answer-text', q.answer);
      const delay = clip?.status().state === 'done' ? 0.4 : renderer.revealDelay?.() ?? 0;
      answerEl = h('div.answer-band', { style: { '--delay': `${delay}s` } }, text);
      main.append(answerEl);
      requestAnimationFrame(() => fitText(text, { max: 150, min: 64, maxLines: 2 }));
    }
    if (!want && answerEl) { answerEl.remove(); answerEl = null; }
  }
  const hintsLeft = () => (revealed ? 0 : range.final - stage + (q.hint && !hintShown ? 1 : 0));

  return Object.assign(part, {
    main,
    state: () => ({
      hint: hintsLeft() > 0 ? `💡 힌트 (${hintsLeft()})` : null,
      primary: !revealed ? '정답 보기' : clip?.covering() ? '⏭ 영상 넘기기' : null,
    }),
    primary() {
      if (!revealed) {
        revealed = true;
        part.onReveal?.();
        clip?.play(); // 먼저 — 영상이 덮는 동안 정답 띠가 잠깐 보이지 않게
        sync();
        return true;
      }
      return !!clip?.finish();
    },
    hint() {
      if (revealed) return false;
      if (stage < range.final) stage += 1;
      else if (q.hint && !hintShown) hintShown = true;
      else return false;
      sync();
      return true;
    },
    mounted: sync,
    destroy() {
      renderer.destroy?.();
      clip?.destroy();
    },
  });
}

// ── 카테고리 끝 ───────────────────────────────────────
function endView(game, cat) {
  const back = () => goUp(game);
  return {
    el: h('div.topic.pp-end',
      h('div.topic-icon', '🎉'),
      h('div.topic-name', '모두 풀었습니다'),
      h('div.topic-rule', `${game.icon} ${game.title} · ${cat.icon ?? ''} ${cat.name}`),
      h('div.start-btns',
        btn('다시 풀기', { onClick: () => show(playView(game, cat, freshRun(game, cat))) }),
        btn('카테고리 목록', { key: 'Enter', primary: true, onClick: back }))),
    onKey(e) {
      if (isEnter(e) || e.code === 'Escape') { back(); return true; }
      return false;
    },
  };
}

// ── 시작 ─────────────────────────────────────────────
function message(title, text, appTitle = '') {
  root.replaceChildren(h('div.login-screen', h('div.panel.login-panel',
    h('h1', `🏕️ ${appTitle || '게임 해 보기'}`),
    h('p', { style: { color: 'var(--text)', fontSize: 'max(18px, 2.6vh)' } }, title),
    h('p', text))));
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !current?.onKey) return;
  // Tab 으로 고른 버튼은 브라우저가 Enter · Space 로 누른다 — 화면 키가 한 번 더 움직이지 않게
  if ((isEnter(e) || e.code === 'Space') && e.target instanceof Element && e.target.closest('button')) return;
  if (current.onKey(e)) e.preventDefault();
});
// 브라우저 뒤로 · 앞으로 가기 — 주소대로 다시 그린다 (R-99)
window.addEventListener('popstate', () => { if (P.data) route(); });

async function boot() {
  let data;
  try {
    const res = await fetch('/api/public', { cache: 'no-store' });
    if (!res.ok) throw new Error(`public ${res.status}`);
    data = await res.json();
  } catch {
    message('불러오지 못했습니다', '인터넷 연결을 확인한 뒤 새로고침하세요');
    return;
  }
  if (data.title) document.title = `${data.title} · 게임 해 보기`;
  if (!data.on) {
    message('지금은 공개하지 않습니다', '운영자가 공개 모드를 켜면 이 주소에서 게임을 해 볼 수 있습니다.', data.title);
    return;
  }
  setAssetUrls(data.images ?? null);
  P.data = data;
  route(); // 새로고침 · 주소로 바로 들어와도 그 화면 (R-99)
}

boot();
