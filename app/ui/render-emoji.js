// 이모지 문제 표시 — 대형 · 순차 공개 · 정답 이미지 (docs/games/emoji-quiz.md 4장, R-39)
import { h } from './dom.js';
import { graphemes } from '../core/validate.js';
import { createPhoto } from './render-photo.js';
import { assetUrl } from '../core/assets.js';

/**
 * @param q 문제 (emojis · reveal · image · answerImage)
 * @param urls 저장 전 이미지 미리보기용 주소 (관리 페이지) — image · answerImage
 */
export function createEmoji(box, q, urls = {}) {
  if (q.image) {
    // 이모지를 이미지로 준비한 문제 — 사진처럼 (확대 없음, 정답 이미지 교차 페이드도 사진과 같다)
    return createPhoto(box, { ...q, effect: 'none' }, urls);
  }
  const parts = graphemes(q.emojis ?? '');
  const tokens = [];
  let unitIndex = 0;
  for (const g of parts) {
    if (g.trim() === '') { if (tokens.length && tokens.at(-1).gap !== true) tokens.push({ gap: true }); continue; }
    tokens.push({ unit: g, index: unitIndex++ });
  }
  const total = unitIndex;
  // 6개 초과면 두 줄 — 가운데에 가까운 공백에서 나눈다
  let lines = [tokens];
  if (total > 6) {
    const half = Math.ceil(total / 2);
    let cut = tokens.findIndex((t) => t.index === half);
    const gaps = tokens.map((t, i) => (t.gap ? i : -1)).filter((i) => i > 0);
    if (gaps.length) cut = gaps.reduce((best, i) => (Math.abs(i - cut) < Math.abs(best - cut) ? i : best), gaps[0]);
    lines = [tokens.slice(0, cut), tokens.slice(cut).filter((t, i) => !(i === 0 && t.gap))];
  }
  const stage = h('div.emoji-stage');
  const unitEls = [];
  for (const line of lines) {
    const row = h('div.emoji-line');
    for (const t of line) {
      if (t.gap) { row.append(h('span.emoji-gap')); continue; }
      const u = h('span.emoji-unit', t.unit);
      unitEls[t.index] = u;
      row.append(u);
    }
    stage.append(row);
  }
  box.append(stage);
  // 정답 이미지 — 정답 공개 때 이모지 대신 교차 페이드 (R-39)
  const ansImg = q.answerImage ? h('img.emoji-answer-img', { alt: '', draggable: 'false' }) : null;
  if (ansImg) {
    ansImg.src = urls.answerImage ?? assetUrl(q.answerImage);
    box.append(ansImg);
  }

  function layout() {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const perLine = Math.max(...lines.map((l) => l.reduce((n, t) => n + (t.gap ? 0.6 : 1.17), 0)));
    const base = H * (lines.length > 1 ? 0.36 : 0.4);
    const min = (120 / 1080) * window.innerHeight;
    const size = Math.max(Math.min(base, (W * 0.92) / Math.max(1, perLine)), Math.min(min, base));
    stage.style.fontSize = `${size}px`;
  }
  const ro = new ResizeObserver(layout);
  ro.observe(box);
  layout();

  let shown = null;
  let fadeDelay = 0;
  function set({ stage: st, revealed }) {
    const first = shown === null;
    const visible = revealed || q.reveal !== 'sequential' ? total : Math.max(1, st);
    // 순차 공개로 남은 이모지가 뒤집히는 동안(0.4초) 기다렸다가 정답 이미지로
    const flipping = !first && visible > shown;
    unitEls.forEach((u, i) => {
      const hide = i >= visible;
      const was = u.classList.contains('hidden');
      u.classList.toggle('hidden', hide);
      if (!first && was && !hide) { u.classList.remove('flip'); void u.offsetWidth; u.classList.add('flip'); }
    });
    shown = visible;
    if (ansImg) {
      fadeDelay = revealed && flipping ? 0.4 : 0;
      for (const el of [stage, ansImg]) {
        el.style.transition = first ? 'none' : '';
        el.style.transitionDelay = `${fadeDelay}s`;
      }
      stage.classList.toggle('faded', !!revealed);
      ansImg.classList.toggle('on', !!revealed);
      if (first) { void stage.offsetWidth; stage.style.transition = ''; ansImg.style.transition = ''; }
    }
  }
  /** 정답 공개 연출이 끝나는 시간 (초) — 정답 띠를 그 뒤에 띄운다 */
  const revealDelay = () => (ansImg ? fadeDelay + 0.4 : 0);
  return { set, revealDelay, destroy: () => ro.disconnect() };
}
