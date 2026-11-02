// 게임 화면 시작점 (docs/08-tech.md 3장)
import { loadAllData } from './core/data.js';
import { createStore } from './core/store.js';
import { createApp } from './ui/app.js';
import { startLive, clientId } from './ui/live-publisher.js';
import { h } from './ui/dom.js';
import { getSession } from './ui/session.js';
import { loginGate, windowGate } from './ui/gate.js';

async function boot() {
  const root = document.getElementById('app');
  const session = await getSession();
  // 서버 모드에서 로그인 전이면 PIN 입력 — 정답이 든 데이터는 로그인 뒤에만 받는다 (docs/08-tech.md 11-2)
  if (session.server && !session.loggedIn) await loginGate(root);
  // 게임 화면은 하나만 — 다른 창이 열려 있으면 묻거나 막는다 (docs/12-host-view.md 6-3, R-46)
  await windowGate(root, clientId);
  root.replaceChildren(h('div.boot', '불러오는 중…'));
  const data = await loadAllData();
  if (data.fatal) {
    root.replaceChildren(h('div.boot', h('div', { style: { textAlign: 'center', lineHeight: 1.6 } },
      h('div', { style: { fontSize: '4vh', color: '#fca5a5', fontWeight: 900 } }, '⚠ 시작할 수 없습니다'),
      h('div', data.fatal),
      h('div', { style: { fontSize: '2vh' } }, session.server ? '인터넷 연결을 확인한 뒤 새로고침하세요' : 'start.command 로 서버를 켠 뒤 새로고침하세요'))));
    return;
  }
  let app = null;
  const store = createStore({
    onRemote: (name, value, why) => app?.onRemote(name, value, why),
    onStatus: (status) => app?.setConn(status),
  });
  const { notes } = await store.init(data.order);
  app = createApp({ root, data, store, notes });
  window.__camp = app; // 개발 · 디버깅용
  window.addEventListener('keydown', (e) => { if (!app.stopped) app.onKey(e); });
  // 다른 창이 이 창을 닫음(kick) → PIN 입력 / 막기 중 다시 붙으려다 거절됨(blocked) → 진입 안 됨 화면. 둘 다 끝나면 새로고침 (R-46)
  app.onStopped = async (kind) => {
    if (kind === 'kick') await loginGate(root, { server: session.server, message: '다른 창에서 게임 화면을 열어 이 창은 멈췄습니다 — 이 창에서 다시 진행하려면 PIN 을 입력하세요' });
    else await windowGate(root, clientId);
    location.reload();
  };
  startLive(app);
  app.render();
}

window.addEventListener('error', () => {
  showError();
});
window.addEventListener('unhandledrejection', () => {
  showError();
});
let errShown = 0;
function showError() {
  if (Date.now() - errShown < 3000) return;
  errShown = Date.now();
  const app = window.__camp;
  if (app?.stopped) return;
  app?.toast?.('오류가 발생했습니다 — 새로고침하면 이어서 진행할 수 있습니다');
}

boot();
