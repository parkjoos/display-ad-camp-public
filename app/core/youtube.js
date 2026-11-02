// 정답 영상 — 유튜브 주소 · 시간 읽기 (docs/02-data-schema.md 4-1, docs/games/photo-quiz.md 5-5, R-61)
// 관리 페이지 · 게임 화면 · 서버 · 검증이 같이 쓴다

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/**
 * 시간 글자 → 초 (소수 1자리). "83" · "83.5" · "1:23" · "1:02:03" · "83s" · "1m23s" · "1h2m3s" (유튜브 t= 형식)
 * @returns {number|null} 읽을 수 없으면 null
 */
export function parseTime(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  let sec = null;
  if (/^\d+(\.\d+)?$/.test(t)) sec = Number(t);
  else if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(t)) {
    const parts = t.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return null;
    sec = parts.reduce((acc, p) => acc * 60 + p, 0);
  } else {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(t);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    sec = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  return Number.isFinite(sec) ? Math.round(sec * 10) / 10 : null;
}

/** 초 → "1:23" · "1:23.5" · "1:02:03" */
export function formatTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) * 10) / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = Math.round((s % 60) * 10) / 10;
  const ss = `${rest < 10 ? '0' : ''}${rest}`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * 유튜브 주소 → 영상 id · 시작 · 끝.
 * youtube.com/watch?v= · youtu.be/ · /shorts/ · /embed/ · /live/ · /v/ 를 받는다. 시작은 t= · start=, 끝은 end=.
 * 클립 주소(youtube.com/clip/…)는 원본 영상을 주소만으로 알 수 없어 받지 않는다.
 * @returns {{ id: string, start: number|null, end: number|null } | { error: string }}
 */
export function parseYouTube(text) {
  let raw = String(text ?? '').trim();
  if (!raw) return { error: '주소가 비어 있습니다' };
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try { u = new URL(raw); } catch { return { error: '주소 형식이 아닙니다' }; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') id = parts[0] ?? null;
  else if (HOSTS.has(host)) {
    if (parts[0] === 'clip') return { error: '클립 주소(youtube.com/clip/…)는 쓸 수 없습니다 — 원본 영상 주소와 시작 · 끝 시간을 넣으세요' };
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] ?? null;
  } else return { error: '유튜브 주소가 아닙니다' };
  if (!id || !ID_RE.test(id)) return { error: '영상 주소를 읽을 수 없습니다 (영상 id 없음)' };
  const start = parseTime(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '');
  const end = parseTime(u.searchParams.get('end') ?? '');
  return { id, start: start || null, end: end || null };
}

/** 저장하는 주소 모양 — 시작 · 끝은 따로 (clipStart · clipEnd) */
export const clipUrl = (id) => `https://youtu.be/${id}`;

/**
 * 문제의 정답 영상 — { id, start, end } (없거나 읽을 수 없으면 null).
 * 검증을 거친 문제는 answerClip 이 정리돼 있고, 관리 페이지 미리보기처럼 거치지 않은 값도 같은 결과
 */
export function clipSpec(q) {
  if (!q?.answerClip) return null;
  const p = parseYouTube(q.answerClip);
  if (p.error) return null;
  const start = typeof q.clipStart === 'number' ? q.clipStart : p.start ?? 0;
  const endRaw = typeof q.clipEnd === 'number' ? q.clipEnd : p.end;
  return { id: p.id, start, end: endRaw !== null && endRaw !== undefined && endRaw > start ? endRaw : null };
}

/** "1:23 – 1:35 (12초)" · "1:23 부터 끝까지" */
export function clipRangeText({ start, end }) {
  if (end === null || end === undefined) return `${formatTime(start)} 부터 끝까지`;
  const len = Math.round((end - start) * 10) / 10;
  return `${formatTime(start)} – ${formatTime(end)} (${len}초)`;
}
