// 연결 끊김 비콘 — 화면에 "연결 끊김" 이 뜨면 그때의 응답 시간을 재어 서버 로그에 한 줄 (R-66, docs/08-tech.md 11-4)
// 게임 화면 · 진행자 화면 · 관리 페이지 공용. 서버 상태 확인(/api/health)을 한 번 보내 구간별 시간(DNS · 연결 · 요청→첫 응답)을 잰 뒤
// 그 값을 실어 보낸다. 못 보내면(네트워크 오류) 들고 있다가 다시 붙을 때 — 뜬 시각은 그대로

const MEASURE_TIMEOUT_MS = 30_000;
const MIN_GAP_MS = 10_000; // 붙었다 끊겼다를 되풀이해도 10초에 한 번만
const KEEP = 5; // 못 보낸 것은 이만큼만 들고 있는다
const pending = [];
let lastAt = 0;

/** 응답 시간 한 번 — 전체(ms)와 구간별. 못 받으면 err (timeout · network) */
export async function measure() {
  const url = `/api/health?beacon=${Date.now()}`;
  // 이미지 등으로 버퍼(250개)가 차 있으면 이번 요청이 기록되지 않는다 — 비우고 잰다 (앱은 Resource Timing 을 쓰지 않는다)
  performance.clearResourceTimings?.();
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(MEASURE_TIMEOUT_MS) });
    await res.text();
    const out = { rtt: Math.round(performance.now() - t0) };
    const e = performance.getEntriesByName(new URL(url, location.href).href).pop();
    if (e && e.requestStart > 0) {
      out.dns = Math.round(e.domainLookupEnd - e.domainLookupStart);
      out.conn = Math.round(e.connectEnd - e.connectStart);
      out.wait = Math.round(e.responseStart - e.requestStart);
    }
    return out;
  } catch (err) {
    return { rtt: Math.round(performance.now() - t0), err: err?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

function send(report) {
  fetch('/api/live/beacon', {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1' },
    body: JSON.stringify(report),
  }).catch(() => { if (pending.length < KEEP) pending.push(report); });
}

/**
 * "연결 끊김" 이 떴다 — 뜬 시각 · 화면 · 이유 · 그때 응답 시간을 서버 로그로
 * @param screen 'game' | 'host' | 'admin'
 * @param reason 'stream'(실시간 연결 오류) | 'save'(상태 저장 실패) | 'health'(서버 확인 실패) | 'request'(요청 실패)
 * @param id 창 id (게임 화면 clientId · 진행자 화면 탭 id)
 */
export async function reportDisconnect(screen, reason, id = null) {
  const at = Date.now();
  if (at - lastAt < MIN_GAP_MS) return;
  lastAt = at;
  const vis = document.visibilityState;
  const online = navigator.onLine;
  send({ screen, reason, id, at, vis, online, ...(await measure()) });
}

/** 다시 붙었다 — 못 보낸 비콘을 보낸다 */
export function flushBeacons() {
  for (const report of pending.splice(0)) send(report);
}
