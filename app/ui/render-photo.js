// 사진 문제 표시 — 원본 · 확대 · 가림 · 정답 이미지 (docs/games/photo-quiz.md 5장, docs/08-tech.md 7-2)
import { h } from './dom.js';
import { assetUrl } from '../core/assets.js';

/**
 * 배율 s 에서 화면에 보이는 범위 (이미지 기준 %). focus 를 화면 가운데에 두되,
 * 이미지 밖 빈 공간이 보이지 않게 중심을 [50/s, 100 − 50/s] 로 보정한다 (08-tech 7-2). 관리 페이지 미리보기도 같은 계산.
 * @returns {{left:number, top:number, size:number}} size = 보이는 폭 · 높이 (100/s %)
 */
export function zoomView(focus = [50, 50], s = 1) {
  const half = 50 / s;
  const c = (v) => Math.min(100 - half, Math.max(half, v));
  return { left: c(focus[0]) - half, top: c(focus[1]) - half, size: 100 / s };
}

/**
 * @param box 표시할 상자 (.stage-box)
 * @param q 문제 (effect · zoom · focus · steps · masks · image · answerImage)
 * @param urls 저장 전 이미지 미리보기용 주소 (관리 페이지) — 없으면 `/<image>`
 */
export function createPhoto(box, q, urls = {}) {
  const frame = h('div.photo-frame');
  const wrap = h('div.photo-wrap');
  const img = h('img', { alt: '', draggable: 'false' });
  // 정답 이미지는 자기 비율의 액자에 따로 — 문제 사진 액자 안에 넣으면 문제 사진 비율로 늘어난다 (R-59)
  const ansImg = q.answerImage ? h('img', { alt: '', draggable: 'false' }) : null;
  const ansFrame = ansImg ? h('div.photo-frame.answer-frame', ansImg) : null;
  const masks = (q.effect === 'mask' ? q.masks ?? [] : []).map(([x, y, w, hh]) => h('div.mask-box', {
    style: { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${hh}%` },
  }, '?'));
  const badge = h('div.zoom-badge', { style: { display: 'none' } });
  const spinner = h('div.spinner');
  wrap.append(img, ...masks);
  frame.append(wrap, badge);
  box.append(spinner, frame, ...(ansFrame ? [ansFrame] : []));
  frame.style.visibility = 'hidden';
  if (ansFrame) ansFrame.style.visibility = 'hidden';

  let natural = null;
  let ansNatural = null; // 정답 이미지 원본 크기 — 불러오기 전 · 실패면 null (그때는 문제 사진을 그대로 둔다)
  let current = { stage: null, revealed: null };

  /** 상자 안에 원본 비율 그대로 가장 크게, 가운데 */
  function fit(el, size, W, H) {
    const s = Math.min(W / size.w, H / size.h);
    const fw = size.w * s, fh = size.h * s;
    Object.assign(el.style, { width: `${fw}px`, height: `${fh}px`, left: `${(W - fw) / 2}px`, top: `${(H - fh) / 2}px`, visibility: 'visible' });
    return { fw, fh };
  }

  function layout() {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    if (ansNatural) fit(ansFrame, ansNatural, W, H);
    if (!natural) return;
    const { fh } = fit(frame, natural, W, H);
    const maxQ = (160 / 1080) * window.innerHeight;
    (q.masks ?? []).forEach(([, , , mh], i) => {
      if (masks[i]) masks[i].style.fontSize = `${Math.min(maxQ, fh * (mh / 100) * 0.6)}px`;
    });
  }

  img.addEventListener('load', () => {
    natural = { w: img.naturalWidth, h: img.naturalHeight };
    spinner.remove();
    layout();
  });
  img.addEventListener('error', () => {
    spinner.remove();
    frame.remove();
    box.append(h('div.img-missing', h('div', '⚠ 이미지를 불러올 수 없습니다'), h('code', q.image)));
  });
  img.src = urls.image ?? assetUrl(q.image);
  if (ansImg) {
    ansImg.addEventListener('load', () => {
      ansNatural = { w: ansImg.naturalWidth, h: ansImg.naturalHeight };
      layout();
      if (current.revealed !== null) showAnswer(current.revealed); // 공개 뒤에 다 불러왔으면 지금 바꾼다
    });
    ansImg.addEventListener('error', () => { ansFrame.remove(); });
    ansImg.src = urls.answerImage ?? assetUrl(q.answerImage);
  }

  const ro = new ResizeObserver(layout);
  ro.observe(box);

  /** 확대 배율 — 단계 k: zoom ^ (1 − k / steps) */
  const scaleAt = (stage) => (q.effect === 'zoom' ? Math.pow(q.zoom, 1 - Math.min(stage, q.steps) / q.steps) : 1);

  function set({ stage, revealed }) {
    if (current.stage === stage && current.revealed === revealed) return;
    const first = current.stage === null;
    current = { stage, revealed };
    if (first) wrap.style.transition = 'none';
    if (q.effect === 'zoom') {
      const sc = revealed ? 1 : scaleAt(stage);
      const v = zoomView(q.focus ?? [50, 50], sc);
      // 보이는 범위의 왼쪽 위가 화면 왼쪽 위에 오도록 — 이동량(%)은 래퍼 자기 크기 기준
      wrap.style.transformOrigin = '0 0';
      wrap.style.transform = `translate(${-v.left * sc}%, ${-v.top * sc}%) scale(${sc})`;
      badge.style.display = sc > 1.001 ? '' : 'none';
      badge.textContent = `🔍 ×${sc.toFixed(1)}`;
    }
    // 마지막 상자는 정답 공개 때만 — 예전 진행 기록에 stage 가 상자 수만큼 남아 있어도 덮어 둔다 (R-42)
    masks.forEach((m, i) => m.classList.toggle('gone', revealed || i < Math.min(stage, masks.length - 1)));
    showAnswer(revealed, first);
    if (first) { void wrap.offsetWidth; wrap.style.transition = ''; }
  }

  /** 정답 이미지 — 확대 해제 · 가림 제거가 끝난 뒤 문제 사진은 사라지고 정답 이미지가 제 비율로 (교차 페이드) */
  function showAnswer(revealed, instant = false) {
    if (!ansFrame || !ansNatural) return;
    const delay = revealed && !instant ? `${q.effect === 'zoom' ? 0.6 : q.effect === 'mask' ? 0.4 : 0}s` : '0s';
    for (const el of [ansFrame, frame]) {
      el.style.transition = instant ? 'none' : '';
      el.style.transitionDelay = delay;
    }
    ansFrame.classList.toggle('show', !!revealed);
    frame.classList.toggle('faded', !!revealed);
    if (instant) { void frame.offsetWidth; ansFrame.style.transition = ''; frame.style.transition = ''; }
  }

  /** 정답 공개 연출이 끝나는 시간 (초) — 정답 띠를 그 뒤에 띄운다 */
  const revealDelay = () => (q.effect === 'zoom' ? 0.6 : q.effect === 'mask' ? 0.4 : 0) + (q.answerImage ? 0.4 : 0);

  return { set, revealDelay, destroy: () => ro.disconnect() };
}
