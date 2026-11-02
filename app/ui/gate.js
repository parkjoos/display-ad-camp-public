// 게임 화면 입장 관문 — PIN 입장 (docs/08-tech.md 11-2) · 게임 화면은 하나만 (docs/12-host-view.md 6-3, R-46)
import { h } from './dom.js';
import { login, pinHint } from './session.js';

const W = { 'Content-Type': 'application/json', 'X-Camp-App': '1' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** PIN 입력 — 맞으면 resolve. message 가 있으면 제목 아래에 (이전 창이 멈춘 이유 등) */
export function loginGate(root, { server = true, message = null } = {}) {
  return new Promise((resolve) => {
    const input = h('input.input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', placeholder: '••••••' });
    const err = h('div.field-error');
    const submit = async () => {
      const pin = input.value.trim();
      if (!/^\d{6}$/.test(pin)) { err.textContent = '6자리 숫자를 입력하세요'; return; }
      const problem = await login(pin);
      if (problem) { err.textContent = problem; input.value = ''; input.focus(); return; }
      root.replaceChildren(h('div.boot', '불러오는 중…'));
      resolve();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    root.replaceChildren(h('div.login-screen', h('div.panel.login-panel',
      h('h1', `🏕️ ${document.title}`),
      message && h('p', { style: { color: 'var(--accent)' } }, message),
      h('p', pinHint(server)),
      input, err,
      h('button.btn.primary.big', { onclick: submit }, '입장'))));
    setTimeout(() => input.focus(), 50);
  });
}

/** 다른 게임 화면이 연결돼 있는지 — 확인할 수 없으면(비상용 python 서버 등) null = 그냥 연다 */
async function peers(clientId) {
  try {
    const res = await fetch(`/api/live/peers?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function takeover(clientId) {
  try {
    const res = await fetch('/api/live/takeover', { method: 'POST', headers: W, body: JSON.stringify({ clientId }) });
    return res.status === 204 ? 'ok' : res.status === 423 ? 'locked' : 'error';
  } catch {
    return 'error';
  }
}

/** 다른 창 열기 막기 켜기 · 끄기 (메뉴) */
export async function setLock(on) {
  try {
    const res = await fetch('/api/live/lock', { method: 'POST', headers: W, body: JSON.stringify({ on }) });
    return res.status === 204;
  } catch {
    return false;
  }
}

function panel(root, ...children) {
  root.replaceChildren(h('div.login-screen', h('div.panel.login-panel', h('h1', `🏕️ ${document.title}`), ...children)));
}

/**
 * 화면을 하나 그리고, 버튼을 누르거나 주기 확인(check)이 값을 돌려주면 끝낸다.
 * @param check (p) => 결과 | undefined — 다시 확인할 때마다 부른다
 */
function screen(root, clientId, { every, check, render }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    render(finish);
    (async () => {
      while (!done) {
        await wait(every);
        if (done) return;
        const v = check(await peers(clientId));
        if (v !== undefined) finish(v);
      }
    })();
  });
}

const free = (p) => !p || p.others === 0;

/**
 * 게임 화면은 하나만 (R-46). 열어도 되면 resolve.
 * - 다른 게임 화면 없음 → 바로
 * - 있음 · 막기 켜짐 → 진입이 안 되는 화면 (3초마다 다시 확인)
 * - 있음 · 막기 꺼짐 → 이전 창을 닫을지 묻는다 (2초마다 다시 확인 — 이전 창이 사라지면 바로 연다)
 */
export async function windowGate(root, clientId) {
  for (;;) {
    const p = await peers(clientId);
    if (free(p)) return;
    if (p.locked) {
      await screen(root, clientId, {
        every: 3000,
        check: (q) => (free(q) || !q.locked ? 'again' : undefined),
        render: () => panel(root,
          h('p', { style: { fontSize: 'max(20px, 2.6vh)', color: 'var(--text)' } }, '🔒 다른 게임 화면에서 진행 중이라 열 수 없습니다'),
          h('p', '진행 중인 창의 ☰ 메뉴에서 [🔓 다른 창 열기 허용] 을 누르거나 그 창을 닫으면 자동으로 열립니다')),
      });
      continue;
    }
    const choice = await screen(root, clientId, {
      every: 2000,
      check: (q) => (free(q) ? 'open' : q.locked ? 'again' : undefined),
      render: (finish) => panel(root,
        h('p', { style: { fontSize: 'max(20px, 2.6vh)', color: 'var(--text)' } }, '다른 게임 화면이 열려 있습니다'),
        h('p', '게임 화면은 하나만 써야 진행자 화면이 끊기지 않습니다. 이전 창을 닫으면 그 창은 PIN 입력 화면으로 바뀝니다 — 진행 기록은 그대로 이어집니다.'),
        h('button.btn.primary.big', { onclick: () => finish('takeover') }, '이전 창 닫고 여기서 진행'),
        h('button.btn', { onclick: () => finish('idle') }, '이 창 쓰지 않기')),
    });
    if (choice === 'open') return;
    if (choice === 'takeover') {
      if ((await takeover(clientId)) === 'ok') return;
      continue; // 그 사이 막기가 켜졌거나 연결 실패 — 처음부터 다시 확인
    }
    if (choice === 'idle') {
      await new Promise((resolve) => panel(root,
        h('p', { style: { fontSize: 'max(20px, 2.6vh)', color: 'var(--text)' } }, '이 창은 사용하지 않습니다'),
        h('p', '다른 게임 화면에서 진행하세요. 이 탭은 닫아도 됩니다.'),
        h('button.btn', { onclick: resolve }, '다시 확인')));
    }
  }
}
