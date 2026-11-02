// 서버 모드 확인 · PIN 입장 (docs/08-tech.md 11-2, docs/12-host-view.md 5-4, R-36)
// 게임 화면 · 진행자 화면 · 관리 페이지 공용

/**
 * 서버 모드인지 · 로그인했는지.
 * 확인할 수 없으면(비상용 python 서버 등) 노트북 모드로 본다 — 지금까지처럼 바로 시작.
 * @returns {Promise<{ server: boolean, loggedIn: boolean }>}
 */
export async function getSession() {
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    if (!res.ok) return { server: false, loggedIn: true };
    const body = await res.json();
    return { server: body?.mode === 'server', loggedIn: body?.loggedIn !== false };
  } catch {
    return { server: false, loggedIn: true };
  }
}

/** PIN 안내 문구 — 노트북 모드는 터미널에 표시된 PIN, 서버 모드는 운영자가 정해 둔 고정 PIN */
export const pinHint = (server) => (server ? '운영자에게 받은 6자리 PIN 을 입력하세요' : '서버 터미널에 표시된 6자리 PIN 을 입력하세요');

/** 서버를 켜라는 안내 — 서버 모드에서는 켤 사람이 운영자 */
export const serverDownHint = (server) => (server ? '서버에 연결할 수 없습니다 — 인터넷 연결을 확인하세요' : '서버에 연결할 수 없습니다 — start.command 로 서버를 켜세요');

/** 게임 화면 입장 (서버 모드) — 성공하면 null, 아니면 안내 문구 */
export async function login(pin) {
  let res;
  try {
    res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1' }, body: JSON.stringify({ pin }) });
  } catch {
    return serverDownHint(true);
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  return body?.error ?? 'PIN 이 맞지 않습니다';
}
