// 룰렛 원판 그리기 · 회전 (docs/05-screens.md 4-4)
import { h } from './dom.js';

// 모닥불 · 숲 · 해 질 녘 색 8가지 — 흰 글자가 읽히는 진하기, 따뜻한 색 · 찬 색을 번갈아 (R-93)
export const PALETTE = ['#E7692A', '#3F6B4E', '#C08A3E', '#3E5F7A', '#B4513A', '#5E7F57', '#8C6239', '#2F6B62'];

/** 조각 색 — 8색 순환, 조각 수를 8로 나눈 나머지가 1이면 마지막 조각은 색 하나 건너뛰기 */
export function sliceColors(n) {
  const colors = Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length]);
  if (n > 1 && n % PALETTE.length === 1) colors[n - 1] = PALETTE[(n) % PALETTE.length];
  return colors;
}

/** 포인터(위) 아래 조각 — rot 는 원판 회전 각도(도, 시계 방향). 조각 i 는 위에서 시계 방향으로 [i·폭, (i+1)·폭] */
export function sliceAt(rot, count) {
  const w = ((-rot % 360) + 360) % 360;
  return Math.floor(w / (360 / count)) % count;
}

/**
 * 회전이 끝나는 각도 — 지금 각도(start)에서 plan.turns 바퀴 넘게 돌아 plan.index 조각의 plan.offset 지점이 포인터 아래에 온다.
 * 조각 수 · 지금 각도와 상관없이 끝 각도는 −(index + offset)·폭 (360 단위) 이다 (R-48 — 지정한 조각도 같은 계산)
 */
export function spinEnd(start, plan, count) {
  const target = (plan.index + plan.offset) * (360 / count); // 포인터 아래에 올 원판 각도
  const mod = (((-target - start) % 360) + 360) % 360;
  return start + plan.turns * 360 + mod;
}

const FONT = '"Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", system-ui, sans-serif';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function createWheel({ hubIcon = '🎯' } = {}) {
  const canvas = h('canvas');
  const pointer = h('div.wheel-pointer');
  const el = h('div.wheel-wrap', pointer, canvas);
  let items = [];
  let rotation = 0; // 도 (시계 방향)
  let highlight = null;
  let raf = null;
  let guard = null; // 회전 확정 예비 타이머

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(10, Math.round(Math.min(rect.width, rect.height) || 300));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const R = size / 2 - 4;
    const c = size / 2;
    const n = items.length;
    if (!n) {
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fillStyle = '#1B3225'; ctx.fill();
      ctx.fillStyle = '#93B089'; ctx.font = `700 ${Math.round(R * 0.09)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('넣은 것이 없습니다', c, c);
      return;
    }
    const colors = sliceColors(n);
    const step = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      // 조각 i: 위(포인터)에서 시계 방향으로 [i·step, (i+1)·step]
      const a0 = i * step - Math.PI / 2;
      slicePath(ctx, c, R, a0, step, n);
      ctx.fillStyle = colors[i]; ctx.fill();
      ctx.strokeStyle = 'rgba(15,17,21,0.55)'; ctx.lineWidth = Math.max(1, R * 0.006); ctx.stroke();
    }
    for (let i = 0; i < n; i++) drawLabel(ctx, items[i], i, n, c, R);
    if (highlight !== null && highlight < n) {
      for (let i = 0; i < n; i++) {
        if (i === highlight) continue;
        const a0 = i * step - Math.PI / 2;
        slicePath(ctx, c, R, a0, step, n);
        ctx.fillStyle = 'rgba(15,17,21,0.62)'; ctx.fill();
      }
      const a0 = highlight * step - Math.PI / 2;
      slicePath(ctx, c, R, a0, step, n);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(3, R * 0.02); ctx.stroke();
    }
    // 가운데 허브
    ctx.beginPath(); ctx.arc(c, c, R * 0.13, 0, Math.PI * 2); ctx.fillStyle = '#14271C'; ctx.fill();
    ctx.strokeStyle = '#FF8A3D'; ctx.lineWidth = Math.max(2, R * 0.012); ctx.stroke();
    ctx.font = `${Math.round(R * 0.12)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(hubIcon, c, c + R * 0.008);
  }

  /** 조각 경로 — 조각이 1개면 원 (부채꼴로 그리면 반지름 선이 생긴다) */
  function slicePath(ctx, c, R, a0, step, n) {
    ctx.beginPath();
    if (n === 1) { ctx.arc(c, c, R, 0, Math.PI * 2); return; }
    ctx.moveTo(c, c); ctx.arc(c, c, R, a0, a0 + step); ctx.closePath();
  }

  function drawLabel(ctx, item, i, n, c, R) {
    const step = (Math.PI * 2) / n;
    const mid = (i + 0.5) * step; // 위에서 시계 방향
    ctx.save();
    ctx.translate(c, c);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = R * 0.02; ctx.shadowOffsetY = R * 0.006;
    if (n <= 8) {
      // 아이콘(크게) 위 · 이름 아래 — 조각이 위에 왔을 때 바로 읽히게. 조각이 1개면 원판 전체라 위쪽에 바로 세워 그린다
      ctx.rotate(n === 1 ? 0 : mid);
      const iconSize = Math.min(R * 0.2, R * step * 0.42);
      ctx.font = `${Math.round(iconSize)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(item.icon, 0, -R * 0.7);
      const maxW = n === 1 ? R * 1.2 : 2 * R * 0.5 * Math.sin(step / 2) * 1.6;
      const lines = wrap(ctx, item.name, maxW, Math.max(R * 0.055, Math.min(R * 0.095, 48)), R);
      lines.forEach((ln, k) => ctx.fillText(ln.text, 0, -R * 0.5 + k * ln.size * 1.15 - (lines.length - 1) * ln.size * 0.3));
    } else {
      // 9칸 이상 — 이름을 반지름 방향으로 (바깥 → 가운데), 아이콘은 바깥 끝
      ctx.rotate(mid + Math.PI / 2);
      const thick = 2 * R * 0.62 * Math.sin(step / 2);
      const iconSize = Math.min(R * 0.11, thick * 0.8);
      ctx.font = `${Math.round(iconSize)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(item.icon, -R * 0.88, 0);
      let size = Math.min(thick * 0.62, R * 0.085);
      const maxLen = R * 0.6;
      ctx.textAlign = 'left';
      size = fitSize(ctx, item.name, maxLen, size, Math.max(R * 0.045, 11));
      ctx.font = `800 ${Math.round(size)}px ${FONT}`;
      ctx.fillText(ellipsize(ctx, item.name, maxLen), -R * 0.79, 0);
    }
    ctx.restore();
  }

  function fitSize(ctx, text, maxW, size, min) {
    let s = size;
    for (;;) {
      ctx.font = `800 ${Math.round(s)}px ${FONT}`;
      if (ctx.measureText(text).width <= maxW || s <= min) return s;
      s = Math.max(min, s * 0.9);
    }
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  /** 길면 2줄, 그래도 넘치면 말줄임 */
  function wrap(ctx, text, maxW, size, R) {
    let s = size;
    const min = Math.max(R * 0.045, 11);
    for (;;) {
      ctx.font = `800 ${Math.round(s)}px ${FONT}`;
      if (ctx.measureText(text).width <= maxW) return [{ text, size: s }];
      const words = text.split(' ');
      if (words.length > 1) {
        let best = null;
        for (let k = 1; k < words.length; k++) {
          const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
          const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
          if (w <= maxW && (!best || w < best.w)) best = { a, b, w };
        }
        if (best) return [{ text: best.a, size: s }, { text: best.b, size: s }];
      }
      if (s <= min) return [{ text: ellipsize(ctx, text, maxW), size: s }];
      s = Math.max(min, s * 0.9);
    }
  }

  function apply() {
    canvas.style.transform = `rotate(${rotation}deg)`;
  }

  /**
   * 회전 — 결과는 이미 정해져 있다 (plan.index · plan.offset — 무작위 또는 진행자 지정). 끝나면 onDone.
   */
  function spin(plan, onDone) {
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    highlight = null;
    draw();
    const n = items.length;
    const start = rotation;
    const end = spinEnd(start, plan, n);
    const t0 = performance.now();
    let lastIdx = sliceAt(start, n);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / plan.duration);
      const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
      rotation = start + (end - start) * e;
      apply();
      const idx = sliceAt(rotation, n);
      if (idx !== lastIdx) {
        lastIdx = idx;
        pointer.classList.remove('tick'); void pointer.offsetWidth; pointer.classList.add('tick');
      }
      if (t < 1) raf = requestAnimationFrame(frame);
      else finish();
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf); clearTimeout(guard);
      rotation = end % 360; apply(); onDone?.();
    };
    raf = requestAnimationFrame(frame);
    // 창이 가려져 화면 갱신(rAF)이 멈춰도 결과는 정해진 시간에 확정 — 진행자 화면 조작이 "추첨 중" 에 멈추지 않게
    guard = setTimeout(finish, plan.duration + 400);
  }

  return {
    el,
    setItems(list) { items = list; draw(); },
    setHighlight(i) { highlight = i; draw(); },
    redraw: draw,
    spin,
    stop() { cancelAnimationFrame(raf); clearTimeout(guard); },
    setRotation(r) { rotation = r; apply(); },
  };
}
