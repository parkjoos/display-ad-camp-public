// 이미지 저장 규칙 (docs/04-admin.md 4장) — 브라우저에서 축소 · 방향 반영 후 업로드
const MAX_SIDE = 2400;
// 서버가 받는 이미지는 4MB 까지 (Vercel 요청 상한 4.5MB — R-51 · DEP-18)
const MAX_BYTES = 4 * 1024 * 1024;
const GIF_MAX = MAX_BYTES;
// 500KB 넘는 PNG · JPEG 는 JPEG 0.85 로 다시 저장 — 화면 캡처 PNG 가 1 ~ 3MB 그대로 올라가던 것 (D-35, R-67). 투명한 PNG · gif 는 그대로
export const REENCODE_BYTES = 500 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export class ImageError extends Error {}

function isHeic(file) {
  return /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
}

/**
 * 줄일지 정하기 — { scale(1 이면 크기 그대로), tooBig(크기 · 용량 상한을 넘음), jpeg(JPEG 로 다시 저장), quality(첫 화질) }.
 * 화면 없이 테스트한다 (test/admin.test.js). gif 는 부르지 않는다
 */
export function shrinkPlan({ ext, size, width, height }) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const tooBig = scale < 1 || size > MAX_BYTES;
  const heavy = (ext === 'png' || ext === 'jpg') && size > REENCODE_BYTES;
  return { scale, tooBig, jpeg: tooBig || heavy, quality: tooBig ? 0.9 : 0.85 };
}

/** 투명한 곳이 있는지 (그린 캔버스) */
function hasAlpha(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * 업로드할 이미지 준비.
 * @returns {Promise<{blob: Blob, ext: string, width: number, height: number, info: string}>}
 */
export async function prepareImage(input) {
  if (isHeic(input)) throw new ImageError('HEIC(아이폰 사진)는 지원하지 않습니다. jpg 로 변환해 올려 주세요 (Mac 미리보기 → 내보내기 → JPEG)');
  // 형식 정보가 빈 파일은 확장자로 판단
  const type = input.type || BY_EXT[/\.([a-z0-9]+)$/i.exec(input.name ?? '')?.[1]?.toLowerCase()] || '';
  const ext = TYPES[type];
  if (!ext) throw new ImageError(`지원하지 않는 형식입니다 (${input.type || input.name}) — jpg · png · webp · gif`);
  const file = input.type === type ? input : new Blob([input], { type });
  if (ext === 'gif') {
    if (file.size > GIF_MAX) throw new ImageError('gif 는 4MB 이하만 올릴 수 있습니다');
    const dim = await dimensions(file);
    return { blob: file, ext, ...dim, info: `${dim.width}×${dim.height} · ${mb(file.size)}` };
  }
  // 휴대폰 사진 방향(EXIF)을 반영해 그린다
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bitmap;
  const plan = shrinkPlan({ ext, size: file.size, width, height });
  if (!plan.jpeg) {
    bitmap.close?.();
    return { blob: file, ext, width, height, info: `${width}×${height} · ${mb(file.size)}` };
  }
  const w = Math.round(width * plan.scale), h = Math.round(height * plan.scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  // 투명한 PNG 는 상한 안이면 그대로 (JPEG 는 투명한 곳을 흰색으로 칠한다)
  if (ext === 'png' && !plan.tooBig && hasAlpha(ctx, w, h)) {
    return { blob: file, ext, width, height, info: `${width}×${height} · ${mb(file.size)} (투명 — PNG 그대로)` };
  }
  ctx.globalCompositeOperation = 'destination-over'; // 투명한 곳은 흰 바탕
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // 그래도 4MB 가 넘으면 화질을 조금씩 낮춘다
  let blob = null;
  for (const quality of [plan.quality, 0.8, 0.7, 0.6]) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob.size <= MAX_BYTES) break;
  }
  if (blob.size > MAX_BYTES) throw new ImageError(`줄여도 4MB 가 넘습니다 (${mb(blob.size)}) — 더 작은 이미지로 올려 주세요`);
  // 상한 안인데 다시 저장해도 작아지지 않으면 원본 그대로
  if (!plan.tooBig && blob.size >= file.size) return { blob: file, ext, width, height, info: `${width}×${height} · ${mb(file.size)}` };
  return { blob, ext: 'jpg', width: w, height: h, info: `${width}×${height} · ${mb(file.size)} → 저장 시 ${w}×${h} JPEG ${mb(blob.size)}` };
}

function dimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

const mb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

/** 파일명에서 정답 제안 — 확장자 · 숫자 · 밑줄 제거 (docs/04-admin.md 3-7) */
export function answerFromFileName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
}
