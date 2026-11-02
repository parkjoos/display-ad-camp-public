// 작은 DOM 도구 — 프레임워크 없음 (docs/08-tech.md 2장)

/**
 * h('div.card#id', { onclick, style: {...}, dataset: {...} }, ...children)
 * children: 문자열 · 숫자 · 노드 · 배열 · null/false(건너뜀)
 */
export function h(tag, props, ...children) {
  const parts = tag.split(/(?=[.#])/);
  const el = document.createElement(parts[0] && !/^[.#]/.test(parts[0]) ? parts.shift() : 'div');
  for (const p of parts) {
    if (p[0] === '.') el.classList.add(p.slice(1));
    else if (p[0] === '#') el.id = p.slice(1);
  }
  // 두 번째 인자가 속성 객체가 아니면 자식으로 (숫자 0 · 문자열 · 노드 · 배열)
  if (props !== undefined && props !== null && props !== false && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') { for (const c of String(v).split(/\s+/).filter(Boolean)) el.classList.add(c); }
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === undefined || sv === null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && !['list', 'form', 'type'].includes(k) && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

/**
 * 글자가 상자에 들어갈 때까지 줄인다 (maxLines 줄 이내). max · min 은 1080p 기준 px — 지금 화면 높이로 환산한다.
 * 창 크기가 바뀌면 다시 맞춘다 — 노트북에서 연 창을 외부 모니터로 옮겨 전체화면(F)으로 키워도 글자가 따라 커진다 (K-8)
 */
const fitting = new Map(); // el → 옵션
export function fitText(el, opts) {
  for (const old of fitting.keys()) if (!old.isConnected) fitting.delete(old);
  if (!el.isConnected) return;
  fitting.set(el, opts);
  fit(el, opts);
}

/** box = 칸 높이도 맞춘다 — 부모가 높이를 정해 칸이 내용보다 작을 수 있을 때 (스코어보드 오른쪽 열 대표 묶음, R-94) */
function fit(el, { max, min, maxLines = 1, box = false }) {
  const floor = vh(min);
  let size = vh(max);
  el.style.fontSize = `${size}px`;
  const lineHeight = () => parseFloat(getComputedStyle(el).lineHeight) || size * 1.2;
  const fits = () => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= lineHeight() * maxLines + 2 && (!box || el.scrollHeight <= el.clientHeight + 1);
  while (size > floor && !fits()) {
    size = Math.max(floor, Math.floor(size * 0.92));
    el.style.fontSize = `${size}px`;
  }
}

let refitTimer = null;
if (typeof window !== 'undefined') { // node 테스트가 이 모듈을 불러올 때는 창이 없다
  window.addEventListener('resize', () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      for (const [el, opts] of fitting) if (el.isConnected) fit(el, opts); else fitting.delete(el);
    }, 100);
  });
}

/** 화면 높이 비례 크기 (1080p 기준 px → 현재 화면 px) */
export const vh = (px1080) => (px1080 / 1080) * window.innerHeight;

/** 한국어 서수 (1 → 첫 번째) */
const ORD = ['', '첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두', '열세', '열네', '열다섯', '열여섯', '열일곱', '열여덟', '열아홉', '스무'];
export const ordinal = (n) => `${ORD[n] ?? n} 번째`;

/** 받침 유무에 따라 조사 (이/가, 은/는, 을/를 …) */
export function josa(word, withBatchim, without) {
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return without;
  return code % 28 ? withBatchim : without;
}

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function svgIcon(path, size = 24) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path); p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}
