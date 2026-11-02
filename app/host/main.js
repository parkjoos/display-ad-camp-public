// 진행자 화면 — 정답지 + 진행 조작 패널 (docs/12-host-view.md, R-19 · R-26 · R-29)
import { h, replace } from '../ui/dom.js';
import { getSession, pinHint, serverDownHint } from '../ui/session.js';
import { guideBody } from '../ui/guide.js';
import { ranksText } from '../core/scoreboard.js';
import { clipRangeText } from '../core/youtube.js';
import { loadAssetUrls, assetUrl } from '../core/assets.js';
import { reportDisconnect, flushBeacons } from '../ui/beacon.js';

const root = document.getElementById('host');
// server: 서버 모드 (고정 PIN · 휴대폰 접속, R-36) — 안내 문구만 다르다
// rig: 룰렛 결과 지정 (R-48) — 이 창 메모리에만. 다른 진행자 화면 · 게임 화면 · 기록에는 없다 (D-27)
const st = { state: null, blurred: false, es: null, streamOk: false, pending: new Map(), fillEdit: null, retry: 0, server: false, rig: null, bye: false, tbCat: null, pickCat: null, record: false };
// 이 탭의 id — 다시 붙어도 서버가 같은 진행자 화면으로 센다 (docs/08-tech.md 11-4)
const tabId = `h-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const toastBox = h('div.toasts');
document.body.append(toastBox);

function toast(msg) {
  const t = h('div.toast', msg);
  toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
}

function confirmBox({ title, message, buttons }) {
  return new Promise((resolve) => {
    const layer = h('div.overlay');
    const done = (v) => { layer.remove(); resolve(v); };
    layer.append(h('div.dialog', h('h2', title), message && h('p', message),
      h('div.dialog-actions', buttons.map((b) => h(`button.btn.hb${b.primary ? '.primary' : ''}`, { onclick: () => done(b.value) }, b.label)))));
    document.body.append(layer);
  });
}

// ── 입장 (5장) ───────────────────────────────────────
function showLogin(message = '') {
  st.es?.close();
  const input = h('input.input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', placeholder: '••••••' });
  const err = h('div.field-error', message);
  const submit = async () => {
    const pin = input.value.trim();
    if (!/^\d{6}$/.test(pin)) { err.textContent = '6자리 숫자를 입력하세요'; return; }
    const res = await fetch('/api/host/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1' }, body: JSON.stringify({ pin }) }).catch(() => null);
    if (!res) { err.textContent = serverDownHint(st.server); return; }
    if (res.status === 204) { start(); return; }
    const body = await res.json().catch(() => null);
    // 401 · 429 가 아니면 이 앱 서버가 아닌 곳(python http.server 비상 대안 등)이 응답한 것
    err.textContent = res.status === 401 || res.status === 429 ? body?.error ?? 'PIN 이 맞지 않습니다' : st.server ? serverDownHint(true) : '게임 서버가 켜져 있지 않습니다 — start.command 로 서버를 켜세요';
    input.value = '';
    input.focus();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  replace(root, h('div.h-login', h('div.panel',
    h('h1', '🎤 진행자 화면'),
    h('p', { style: { color: 'var(--text-dim)' } }, pinHint(st.server)),
    input, err,
    h('button.btn.primary.hb', { onclick: submit }, '입장'),
    h('button.btn.small', { style: { marginTop: '14px' }, onclick: openGuide }, '❓ 설명서'))));
  setTimeout(() => input.focus(), 50);
}

// ── 연결 (6-1) ───────────────────────────────────────
async function start() {
  const res = await fetch('/api/host/state', { cache: 'no-store' }).catch(() => null);
  if (!res) { showLogin(serverDownHint(st.server)); return; }
  if (res.status === 401) { showLogin(); return; }
  await loadAssetUrls(); // 문제 썸네일을 Blob 주소로 바로 (R-70)
  st.state = await res.json();
  render();
  connect();
}

function connect() {
  st.es?.close();
  const es = new EventSource(`/api/host/stream?id=${tabId}`);
  st.es = es;
  // 서버가 실행 시간 상한 전에 먼저 끊음 (Vercel) — 끊김 표시 없이 곧바로 다시 붙는다
  es.addEventListener('bye', () => { st.bye = true; });
  es.addEventListener('state', (ev) => {
    if (!st.streamOk) flushBeacons(); // 끊긴 동안 못 보낸 비콘 (R-66)
    st.streamOk = true;
    st.retry = 0;
    st.state = JSON.parse(ev.data);
    handleCommandResult();
    render();
  });
  es.onerror = async () => {
    if (st.bye) {
      st.bye = false;
      es.close();
      connect();
      return;
    }
    // "○ 재연결 중" 이 뜨는 순간 — 그때 응답 시간과 함께 서버 로그에 비콘 (R-66)
    if (st.streamOk) reportDisconnect('host', 'stream', tabId);
    st.streamOk = false;
    render();
    es.close();
    const res = await fetch('/api/host/state', { cache: 'no-store' }).catch(() => null);
    if (res && res.status === 401) { showLogin(st.server ? 'PIN 이 바뀌었습니다 — 다시 입장하세요' : '서버가 다시 켜졌습니다 — 새 PIN 을 입력하세요'); return; }
    const delay = [1000, 2000, 5000][Math.min(st.retry++, 2)];
    setTimeout(connect, delay);
  };
}

// 창을 닫거나 새로고침할 때 — 서버에 알려 진행자 수에서 바로 뺀다 (Vercel 은 닫힌 연결을 서버가 모른다 — docs/08-tech.md 11-4)
window.addEventListener('pagehide', () => {
  if (!st.es) return;
  st.es.close();
  fetch('/api/live/leave', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1' }, body: JSON.stringify({ hostId: tabId }) }).catch(() => {});
});
window.addEventListener('pageshow', (e) => { if (e.persisted && st.es) connect(); });

// ── 명령 (6-2) ───────────────────────────────────────
let cmdSeq = 0;
async function send(cmd, args = {}) {
  if (!st.state?.connected) { toast('게임 화면과 연결되지 않았습니다'); return; }
  const id = `h${Date.now().toString(36)}${(cmdSeq++).toString(36)}`;
  st.pending.set(id, { cmd, args });
  const res = await fetch('/api/host/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Camp-App': '1' },
    body: JSON.stringify({ id, cmd, args, basedOn: st.state?.seq ?? null }),
  }).catch(() => null);
  if (!res) { toast('서버에 연결할 수 없습니다'); return; }
  if (res.status === 401) { showLogin('다시 입장하세요'); return; }
  if (res.status === 409) toast('게임 화면과 연결되지 않았습니다');
}

async function handleCommandResult() {
  const lc = st.state?.lastCommand;
  if (!lc || !st.pending.has(lc.id)) return;
  const sent = st.pending.get(lc.id);
  st.pending.delete(lc.id);
  if (lc.ok) return;
  if (lc.needConfirm === 'skipReveal') {
    const v = await confirmBox({ title: '다음 문제', message: '정답을 공개하지 않고 넘어갈까요?', buttons: [{ label: '정답 먼저 공개', value: 'reveal', primary: true }, { label: '넘어가기', value: 'skip' }, { label: '취소', value: null }] });
    if (v === 'reveal') send('question.reveal');
    if (v === 'skip') send('question.next', { skipReveal: true });
    return;
  }
  if (lc.needConfirm === 'noCredit') {
    // 맞힌 팀 미지정 (R-87) — 다시 보낼 때 지금 문제 키를 붙여, 그 사이 넘어갔으면 게임 화면이 거절하게.
    // 이모티콘 퀴즈 [내기] (question.pick, R-90) 도 같은 확인 — 보낸 명령을 그대로 다시
    const key = st.state?.questionId ?? null;
    const v = await confirmBox({ title: '맞힌 팀 확인', message: lc.message, buttons: [{ label: '넘어가기', value: true, primary: true }, { label: '취소', value: false }] });
    if (v) send(sent?.cmd ?? 'question.next', { ...(sent?.args ?? { skipReveal: true }), noCredit: true, key });
    return;
  }
  if (lc.message) toast(lc.message);
  else if (sent) toast('적용하지 않았습니다');
}

// ── 그리기 (4장) ─────────────────────────────────────
const teamName = (t) => st.state?.teams?.[t]?.name ?? `팀${t + 1}`;
const teamColor = (t) => st.state?.teams?.[t]?.color ?? '#888';
const btn = (label, cmd, args, cls = '') => h(`button.btn.hb${cls}`, { onclick: () => send(cmd, args), disabled: !st.state?.connected ? true : undefined }, label);

function header(s) {
  const g = s.game;
  let where = '';
  if (s.view === 'play' && g) {
    if (s.type !== 'roulette' && typeof s.roundIndex === 'number' && s.picks?.[s.roundIndex] && !['roulette', 'result'].includes(s.screen) && !String(s.screen).startsWith('tiebreak')) {
      const p = s.picks[s.roundIndex];
      // 이모티콘 퀴즈는 라운드가 없다 — 카테고리만 (R-90)
      where = s.pickMode ? ` · ${p.icon} ${p.name}` : ` · ROUND ${s.roundIndex + 1}${extraRound(s, s.roundIndex + 1)} · ${p.icon} ${p.name}`;
    }
  }
  return h('div.h-head',
    h('span.title', g ? `${g.icon} ${g.title}${where}` : '🎤 진행자 화면'),
    h(`span.h-status${st.streamOk ? '' : '.off'}`, st.streamOk ? '● 실시간' : '○ 재연결 중'),
    // 정답 기록 고치기 (R-60) — 득점형 진행 중
    s.view === 'play' && s.record && h(`button.btn.small${st.record ? '.primary' : ''}`, { onclick: toggleRecord }, '📝 정답 기록'),
    h('button.btn.small', { onclick: openGuide }, '❓ 설명서'),
    h('button.btn.small', { onclick: toggleBlur }, st.blurred ? '보이기 (B)' : '가리기 (B)'),
    h('button.btn.small', { onclick: logout }, '나가기'));
}

/** 계획한 라운드 수를 넘긴 라운드 표시 — "(추가 · 계획 3)" (R-40) */
const extraRound = (s, n) => (s.type !== 'roulette' && s.plannedRounds && n > s.plannedRounds ? ` (추가 · 계획 ${s.plannedRounds})` : '');

function scores(s) {
  if (!Array.isArray(s.scores)) return null;
  // 릴레이 (R-62) — 라운드 중에는 맞힌 대표 수 · 등수, 그 밖에는 게임 점수(라운드 배점 합)
  if (s.relay && s.screen !== 'roundEnd') {
    return h('div.h-scores', s.scores.map((_, t) => h('span', h('span.dot', { style: { '--c': teamColor(t) } }), ` ${teamName(t)}`, h('span.num', relayText(s.relay, t)))));
  }
  if (Array.isArray(s.gamePoints)) return h('div.h-scores', s.gamePoints.map((n, t) => h('span', h('span.dot', { style: { '--c': teamColor(t) } }), ` ${teamName(t)}`, h('span.num', `${n}점`))));
  // 정답 수 방식 라운드가 연결된 게임은 점수 (정답 수 × 1개당 점수, R-49)
  const per = typeof s.per === 'number' ? s.per : null;
  return h('div.h-scores', s.scores.map((n, t) => h('span', h('span.dot', { style: { '--c': teamColor(t) } }), ` ${teamName(t)}`, h('span.num', per === null ? n : `${n * per}점`))));
}

const MEDAL = ['🥇', '🥈', '🥉'];
/** 대표 한 명이 맞힌 수 — "●○" (인당 문제만큼, R-94) */
const repDots = (n, per) => '●'.repeat(Math.min(n, per)) + '○'.repeat(Math.max(0, per - n));

/** 릴레이 한 팀 — "1/2 · ● ○", 대표를 모두 내보냈으면 "2/2 🥇1등" (R-62). 대표마다 맞힌 수 "3/4 · ●● ●○" (R-94) */
function relayText(r, t) {
  const f = r.finish.indexOf(t);
  const c = r.counts[t];
  if (f >= 0) return `${c}/${r.goal} ${MEDAL[f] ?? ''}${f + 1}등`;
  return `${c}/${r.goal}${r.reps ? ` · ${r.reps[t].map((n) => repDots(n, r.per)).join(' ')}` : ''}`;
}

/** 릴레이 규칙 한 줄 — "팀당 대표 2명", 인당 문제가 2 이상이면 "대표 2명 × 2문제" (R-64) */
const relayRule = (r) => (r.per > 1 ? `대표 ${r.relay}명 × ${r.per}문제` : `팀당 대표 ${r.relay}명`);

/** 빠짐 안내 (R-94) — 이 문제로 맞힌 대표가 인당 문제를 다 채웠고 팀에 대표가 남았을 때. 진행자가 말로 알린다 */
function repOutHint(s) {
  const r = s.relay;
  const t = s.scoredTeam;
  const k = r?.scoredRep;
  if (!r || s.screen !== 'answer' || t === null || t === undefined || k === null || k === undefined) return null;
  if (r.reps[t][k] < r.per || r.finish.includes(t)) return null;
  return h('div.h-swap', `🚪 ${teamName(t)} 대표${k + 1} — ${r.per > 1 ? `${r.per}문제를 다 맞혀` : '맞혀서'} 빠집니다`);
}

/**
 * 맞힌 사람 버튼 (R-94) — 팀마다 대표 수만큼 "대표1 ●○". 이 문제 전에 인당 문제를 다 채운 대표는 "빠짐" 으로 꺼지고,
 * 대표를 모두 내보낸 팀은 메달 · 빠짐. 누르면 그 팀 · 대표가 맞힌 것으로
 */
function repCredit(s) {
  const r = s.relay;
  return h('div.h-reps', s.teams.map((t, i) => {
    const f = r.out.includes(i) ? r.finish.indexOf(i) : -1;
    return h('div.h-rep-team', { style: { '--c': t.color } },
      h('span.h-rep-name', f >= 0 ? `${t.name} ${MEDAL[f] ?? ''}${f + 1}등 · 빠짐` : t.name),
      f < 0 && Array.from({ length: r.relay }, (_, k) => {
        const on = s.scoredTeam === i && r.scoredRep === k;
        const out = r.repsBefore[i][k] >= r.per;
        return h(`button.btn.hb.team.rep${on ? '.on' : ''}`, {
          style: { '--c': t.color }, onclick: () => send('answer.credit', { team: i, rep: k }), disabled: !s.connected || out ? true : undefined,
        }, `${on ? '✔ ' : ''}대표${k + 1} ${repDots(r.reps[i][k], r.per)}${out ? ' 빠짐' : ''}`);
      }));
  }));
}

function questionCard(s) {
  const q = s.question;
  if (!q) return h('div.h-card', h('div.h-empty', '문제 정보를 찾을 수 없습니다'));
  const revealed = !!s.revealed;
  let stage = '';
  if (q.effect === 'zoom') stage = `확대 ${s.stage}/${s.stageFinal} 단계`;
  // 마지막 상자는 정답 공개 때만 벗겨진다 (R-42)
  else if (q.effect === 'mask') stage = s.stageFinal > 0 ? `가림 힌트 ${s.stage}/${s.stageFinal} · 마지막 상자는 정답 공개 때` : '가림 — 정답 공개 때 벗겨짐';
  else if (q.emojis && s.stageFinal > 0 && s.stageInitial !== s.stageFinal) stage = `이모지 ${s.stage}/${s.stageFinal} 공개`;
  const thumb = q.image ? h('img', { src: assetUrl(q.image), alt: '' }) : q.emojis ? h('span.emoji', q.emojis.slice(0, 8)) : '';
  return h('div.h-card',
    h('div.h-row', h(`span.h-badge${revealed ? '.on' : ''}`, revealed ? '정답 공개됨' : '문제 진행 중'), stage && h('span.h-badge', stage),
      // 릴레이는 순위가 정해질 때까지 내므로 문제 수 대신 대표 수 (R-62)
      // 이모티콘 퀴즈는 진행자가 고르므로 문제 수 대신 몇 번째 문제 (R-90)
      !q.tb && typeof s.questionIndex === 'number' && s.picks?.[s.roundIndex] && h('span.h-badge', s.pickMode ? `${s.askedCount}번째 문제` : s.relay ? `Q ${s.questionIndex + 1} · ${relayRule(s.relay)}` : `Q ${s.questionIndex + 1} / ${s.picks[s.roundIndex].questionCount}`),
      q.tb && h('span.h-badge.on', `추가 문제 — ${(s.tiebreakGroup ?? []).map(teamName).join(' · ')} 동점`),
      q.hideAnswerText && h('span.h-badge', q.answerImage ? '모니터: 정답 이미지만 (글자 숨김)' : '모니터: 정답 글자 숨김'),
      q.clip && h('span.h-badge', '🎬 정답 영상')),
    h('div.h-q',
      h('div.h-thumb.secret', thumb),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        q.prompt && h('div.h-prompt', q.prompt),
        h('div.h-answer.secret', q.answer),
        h('div.h-meta.secret', q.note && h('span', h('b', '메모'), q.note), q.hint && h('span', h('b', '힌트'), q.hint)))));
}

function creditRow(s) {
  if (!s.revealed) return null;
  const allowed = s.screen === 'tiebreakAnswer' ? (s.tiebreakGroup ?? []) : s.teams.map((_, i) => i);
  // 릴레이 — 이 문제 전에 대표를 모두 내보낸 팀은 이번 라운드에서 빠졌다 (R-62)
  const out = s.screen === 'answer' ? (s.relay?.out ?? []) : [];
  // 팀당 대표 방식 — 팀 대신 맞힌 사람(팀 · 대표)을 누른다 (R-94)
  const reps = s.screen === 'answer' && s.relay;
  const none = h(`button.btn.hb${s.noneMarked && s.scoredTeam === null ? '.primary' : ''}`, { onclick: () => send('answer.credit', { team: null }), disabled: !s.connected ? true : undefined }, '없음');
  const scoredRep = reps && s.scoredTeam !== null && s.scoredTeam !== undefined && s.relay.scoredRep !== null ? ` 대표${s.relay.scoredRep + 1}` : '';
  return h('div.h-card',
    h('h3', reps ? '맞힌 사람 — 정답 공개 후 팀 · 대표를 누름 (R-94)' : '맞힌 팀 — 정답 공개 후 지정 (R-29)'),
    reps ? [repCredit(s), h('div.h-row', none)]
      : h('div.h-row', s.teams.map((t, i) => allowed.includes(i) && h(`button.btn.hb.team${s.scoredTeam === i ? '.on' : ''}`, {
        style: { '--c': t.color }, onclick: () => send('answer.credit', { team: i }), disabled: !s.connected || out.includes(i) ? true : undefined,
      }, out.includes(i) ? `${t.name} ${MEDAL[s.relay.finish.indexOf(i)] ?? ''}${s.relay.finish.indexOf(i) + 1}등 · 빠짐` : `${s.scoredTeam === i ? '✔ ' : ''}${t.name}`)), none),
    h('div', { style: { color: 'var(--text-dim)', fontSize: '14px' } }, s.scoredTeam !== null && s.scoredTeam !== undefined ? `지금: ${teamName(s.scoredTeam)}${scoredRep} ✔ — 다른 ${reps ? '사람' : '팀'}을 누르면 바뀜` : s.noneMarked ? '지금: 정답자 없음' : '아직 지정 안 함'),
    reps && dim(`${relayRule(s.relay)} — ${s.teams.map((_, t) => `${teamName(t)} ${relayText(s.relay, t)}`).join(' · ')}`),
    repOutHint(s));
}

const CLIP_ON_SCREEN = ['loading', 'playing', 'paused'];

/** 정답 영상 (R-61, 12-host-view 4-2) — 정답 공개 때 모니터에서 자동 재생, 끝나면 정답 글자. 일시정지 · 영상 끝내기 · 다시 재생 */
function clipCard(s) {
  const spec = s.question?.clip;
  if (!spec) return null;
  const c = s.clip ?? {};
  const warn = (text) => h('div.field-error', { style: { fontSize: '15px', fontWeight: 700 } }, text);
  const head = h('h3', `🎬 정답 영상 — ${clipRangeText(spec)}`);
  if (!s.revealed) {
    return h('div.h-card', head, dim('정답 공개 때 모니터에서 자동으로 재생되고, 영상이 끝나면 정답 글자가 나옵니다'),
      c.error ? warn(`⚠ ${c.error} — 정답 공개 때 영상 없이 정답 글자를 바로 보입니다`)
        : c.soundReady === false && warn('⚠ 게임 화면을 아직 한 번도 클릭하지 않아 브라우저가 영상 소리를 막을 수 있습니다 — 게임 화면(모니터)을 한 번 클릭하세요'));
  }
  const state = c.state ?? 'idle';
  const label = {
    loading: '⏳ 모니터에서 영상을 불러오는 중',
    playing: '▶ 모니터에서 재생 중 — 영상이 끝나면 정답 글자가 나옵니다',
    paused: '⏸ 일시정지 — 정답 글자는 영상이 끝나면',
    done: '✔ 영상 끝 — 정답 글자 표시 중',
    idle: '정답 글자 표시 중 — 영상은 아직 틀지 않았습니다',
    error: `⚠ ${c.error ?? '재생할 수 없습니다'} — 정답 글자를 바로 보였습니다`,
  }[state] ?? '';
  const on = CLIP_ON_SCREEN.includes(state);
  return h('div.h-card', head,
    h('div', { style: { fontSize: '18px', fontWeight: 700 } }, label),
    c.muted && on && warn('🔇 브라우저가 소리를 막아 소리 없이 재생 중입니다 — 게임 화면(모니터)을 한 번 클릭하면 소리가 켜집니다'),
    h('div.h-row',
      state === 'playing' && btn('⏸ 일시정지', 'clip.pause'),
      state === 'paused' && btn('▶ 계속', 'clip.play', {}, '.primary'),
      on ? btn('⏭ 영상 끝내기 (정답 글자 보이기)', 'clip.skip') : btn(state === 'idle' ? '▶ 영상 재생' : '↺ 영상 다시 재생', 'clip.play')));
}

function roundList(s) {
  if (!Array.isArray(s.roundList)) return null;
  // 다음 차례 — 라운드 소개면 첫 문제, 문제 · 정답 화면이면 지금 문제 바로 뒤. 그 뒤 문제는 [다음으로] 로 당겨 온다 (R-35)
  const intro = s.screen === 'round';
  const nextAt = intro ? 0 : s.questionIndex + 1;
  return h('div.h-card', h('h3', '이번 라운드 — [다음으로] 를 누르면 그 문제가 바로 다음에 나옵니다'),
    h('div.h-list.secret', s.roundList.map((r, i) => {
      const cur = r.current && !intro;
      return h(`div.it${cur ? '.cur' : ''}${i < nextAt && !cur ? '.past' : ''}`,
        h('span.n', cur ? '▶' : r.n), h('span', r.answer),
        r.scoredTeam !== null && h('span.h-badge', { style: { color: teamColor(r.scoredTeam) } }, `✔ ${teamName(r.scoredTeam)}`),
        i === nextAt && h('span.h-badge.on.h-next', '다음'),
        i > nextAt && h('button.btn.small.h-next', { onclick: () => send('question.setNext', { questionId: r.id }), disabled: !s.connected ? true : undefined }, '다음으로'));
    })),
    candidateList(s, nextAt));
}

/** 라운드에 안 뽑힌 후보 (R-52) — 같은 카테고리에서 아직 안 낸 문제. 고르면 바로 다음에 나오고 이번 라운드의 마지막 문제가 후보로 돌아간다 */
function candidateList(s, nextAt) {
  const list = s.roundCandidates ?? [];
  if (!list.length) return null;
  const grows = nextAt >= s.roundList.length; // 라운드 마지막 — 고르면 한 문제 더 (R-43)
  return h('div.h-cand',
    h('div.h-cand-head', `후보 — 이번 라운드에 안 뽑힌 문제 ${list.length}개 · [다음으로] 를 누르면 바로 다음에 나오고, ${grows ? '이번 라운드에 한 문제 더 붙습니다' : '이번 라운드의 마지막 문제가 후보로 돌아갑니다 (문제 수 그대로)'}`),
    h('div.h-list.secret', list.map((c) => h('div.it.cand',
      h('span.n', '·'), h('span', c.answer),
      h('button.btn.small.h-next', { onclick: () => send('question.setNext', { questionId: c.id }), disabled: !s.connected ? true : undefined }, '다음으로')))));
}

function progressRow(s) {
  const screen = s.screen;
  const items = [];
  if (screen === 'question' || screen === 'tiebreakQuestion') {
    items.push(h('div.h-row', h('span.label', '화면'),
      s.stageFinal !== s.stageInitial && btn('◀', 'question.stage', { dir: -1 }),
      s.stageFinal !== s.stageInitial && btn('힌트 단계 ▶', 'question.stage', { dir: 1 }),
      s.question?.hint && btn(s.hintVisible ? '💡 힌트 숨기기' : '💡 힌트', 'question.hint')));
  }
  const prog = [];
  if (screen === 'question' || screen === 'tiebreakQuestion') prog.push(btn('정답 공개', 'question.reveal', {}, '.primary.big'));
  if (s.pickMode && (screen === 'question' || screen === 'answer')) {
    // 이모티콘 퀴즈 (R-90) — 다음 문제는 아래 목록 [내기]. 정답 화면 [카테고리 목록 ▶] 은 모니터를 문제 고르기로
    if (screen === 'answer') prog.push(btn('카테고리 목록 ▶', 'question.next', { skipReveal: true }));
    prog.push(endButton(s));
    items.push(h('div.h-row', h('span.label', '진행'), prog));
    return h('div.h-card', items);
  }
  if (screen === 'question') prog.push(h('button.btn.hb', { onclick: () => send('question.next', { skipReveal: false }), disabled: !s.connected ? true : undefined }, '다음 문제 ▶'));
  // 라운드 마지막 문제의 정답 화면은 [다음 문제 ▶] 대신 라운드 종료 안내 카드의 버튼 (R-56) — 릴레이는 한 팀만 남았거나 낼 문제가 없을 때 (R-62)
  if (screen === 'answer' && !(s.roundEnding ?? s.isLastInRound)) prog.push(btn('다음 문제 ▶', 'question.next', { skipReveal: true }, '.primary.big'));
  if (screen === 'tiebreakAnswer') prog.push(btn('결과로 ▶', 'question.next', { skipReveal: true }, '.primary.big'));
  // [↶ 되돌리기] 는 없다 — 정답 화면은 맞힌 팀 버튼으로, 지난 문제는 머리줄 [📝 정답 기록] 으로 고친다 (R-60)
  if (['round', 'question', 'answer'].includes(screen)) prog.push(endButton(s));
  if (prog.length) items.push(h('div.h-row', h('span.label', '진행'), prog));
  return items.length ? h('div.h-card', items) : null;
}

const endButton = (s) => h('button.btn.hb.end', { onclick: endGame, disabled: !s.connected ? true : undefined }, '종료');

/** 점수 칸 — 정답 수, 점수를 주는 게임은 "150점 (3개)" (R-49) */
const scoreText = (n, per) => (per === null ? `${n}개` : `${n * per}점 (${n}개)`);

/**
 * 라운드 종료 안내 (R-56, 12-host-view 4-9) — 라운드 마지막 문제의 정답 화면에서 먼저 알리고 문제를 더 낼지 끝낼지 묻는다.
 * 창으로 띄우지 않는다 — 맞힌 팀을 먼저 골라야 하므로 맞힌 팀 구역 바로 아래 카드
 */
function roundEndPrompt(s) {
  if (s.screen !== 'answer' || !(s.roundEnding ?? s.isLastInRound)) return null;
  const p = s.picks?.[s.roundIndex];
  const picked = s.scoredTeam !== null && s.scoredTeam !== undefined;
  if (s.relay) return relayEndPrompt(s, p, picked);
  return h('div.h-card.h-round-end',
    h('h2', '🏁 라운드가 종료되었습니다'),
    h('div.h-prompt', `ROUND ${s.roundIndex + 1}${extraRound(s, s.roundIndex + 1)} · ${p?.icon ?? ''} ${p?.name ?? ''} — ${p?.questionCount ?? s.questionIndex + 1}문제를 모두 냈습니다`),
    !picked && !s.noneMarked && h('div.field-error', '↑ 맞힌 팀(또는 [없음])을 먼저 고르세요'),
    h('div', { style: { fontSize: '18px', fontWeight: 700 } }, '문제를 더 낼까요, 여기서 종료할까요?'),
    h('div.h-row',
      s.canMoreQuestion ? btn('한 문제 더 ▶', 'question.more') : dim('이 카테고리에 남은 문제가 없습니다'),
      btn('라운드 종료 ▶', 'question.next', { skipReveal: true }, '.primary.big')));
}

/**
 * 릴레이 라운드 종료 안내 (R-62) — 한 팀만 남아 순위가 정해졌거나, 이 카테고리에 낼 문제가 없을 때.
 * [한 문제 더] 는 없다 — 순위가 안 정해졌으면 [다음 문제 ▶] 가 같은 카테고리에서 하나씩 더 뽑는다
 */
function relayEndPrompt(s, p, picked) {
  const r = s.relay;
  const order = (r.ranks ?? []).map((rank, t) => ({ rank, t })).sort((a, b) => a.rank - b.rank || a.t - b.t);
  return h('div.h-card.h-round-end',
    h('h2', r.decided ? '🏁 순위가 정해졌습니다' : '🏁 이 카테고리에 낼 문제가 없습니다'),
    h('div.h-prompt', `ROUND ${s.roundIndex + 1}${extraRound(s, s.roundIndex + 1)} · ${p?.icon ?? ''} ${p?.name ?? ''} — `,
      r.ranks ? order.map(({ rank, t }) => `${MEDAL[rank - 1] ?? ''}${rank}등 ${teamName(t)}${r.finish.includes(t) ? '' : ` (${r.counts[t]}/${r.goal})`}`).join(' · ') : '맞힌 팀이 없습니다'),
    !r.decided && dim(`대표를 다 내보내지 못한 팀은 맞힌 ${r.per > 1 ? '문제' : '대표'} 수로 등수를 정합니다`),
    !picked && !s.noneMarked && h('div.field-error', '↑ 맞힌 팀(또는 [없음])을 먼저 고르세요'),
    h('div.h-row', btn('라운드 종료 ▶', 'question.next', { skipReveal: true }, '.primary.big')));
}

/** 라운드 종료 화면 (R-56) — 게임 화면에 라운드 점수. 이번 라운드 · 누적 표 → 종합 점수판 반영 (R-57) → 다음 라운드 · 결과 보기 · 한 라운드 더 */
function roundEndPanel(s) {
  const p = s.picks?.[s.roundIndex];
  const per = typeof s.per === 'number' ? s.per : null;
  const round = s.roundScores ?? [];
  const total = s.scores ?? [];
  const n = s.roundIndex + 1;
  const r = s.reflect;
  const relay = s.relay;
  // 반영할 행이 있는데 아직 안 했거나 값이 달라졌으면 [팀 점수에 반영] 이 가장 큰 버튼 (R-57)
  const reflectPending = !!r && r.rows.some((row) => !row.skip) && (!r.done || r.stale);
  return [h('div.h-card',
    h('h3', `ROUND ${n}${extraRound(s, n)} 종료 — 게임 화면에 라운드 ${relay ? '순위' : '점수'} 표시 중`),
    h('div.h-big', `${p?.icon ?? ''} ${p?.name ?? ''}`),
    // 릴레이 — 대표를 모두 내보낸 순서 · 맞힌 대표 · 게임 점수 (R-62)
    relay
      ? h('table.h-table', h('tr', h('th', '팀'), h('th', '이번 라운드'), h('th', relay.per > 1 ? '맞힌 문제' : '맞힌 대표'), h('th', '게임 점수')),
        s.teams.map((_, t) => h('tr', h('td', h('span.dot', { style: { '--c': teamColor(t) } }), ` ${teamName(t)}`),
          h('td', relay.ranks ? `${MEDAL[relay.ranks[t] - 1] ?? ''}${relay.ranks[t]}등` : '등수 없음'), h('td', `${relay.counts[t]}/${relay.goal}`), h('td', `${s.gamePoints?.[t] ?? 0}점`))))
      : h('table.h-table', h('tr', h('th', '팀'), h('th', '이번 라운드'), h('th', '누적')),
        s.teams.map((_, t) => h('tr', h('td', h('span.dot', { style: { '--c': teamColor(t) } }), ` ${teamName(t)}`),
          h('td', scoreText(round[t] ?? 0, per)), h('td', scoreText(total[t] ?? 0, per))))),
    dim(s.isLastRound ? `계획한 ${s.plannedRounds}라운드를 모두 했습니다` : `계획 ${s.plannedRounds}라운드 중 ${n}번째`)),
  reflectCard(s),
  h('div.h-card', h('div.h-row',
      btn(s.isLastRound ? '결과 보기 ▶' : '다음 라운드 ▶', 'question.next', { skipReveal: true }, reflectPending ? '' : '.primary.big'),
      // 라운드 수는 계획값 — 다 해도 한 라운드 더 (R-40)
      s.canMoreRound && btn('한 라운드 더 ▶', 'round.more'),
      btn('◀ 라운드로 돌아가기', 'round.back'),
      endButton(s)))];
}

/** 종합 점수판 반영 (R-57, 12-host-view 4-9) — 이번 라운드가 더하는 점수 미리보기 + [팀 점수에 반영] */
function reflectCard(s) {
  const r = s.reflect;
  if (!r) return null;
  if (!r.rows.some((row) => !row.skip)) return h('div.h-card', h('h3', '종합 점수판에 반영'), dim('점수판에 연결된 라운드가 없습니다 — 종합 점수판에서 직접 입력하세요'));
  const ok = r.done && !r.stale;
  const cell = (row, c) => (row.kind === 'count' ? `${c.count}개 +${c.add}` : `${Number.isInteger(c.rank) ? `${c.rank}등` : '등수 없음'} +${c.add}`);
  return h(`div.h-card${ok ? '' : '.h-round-end'}`,
    h('h3', '종합 점수판에 반영 — 이번 라운드가 더하는 점수'),
    h('table.h-table', h('tr', h('th', '점수판'), s.teams.map((_, t) => h('th', teamName(t)))),
      r.rows.map((row) => h('tr',
        h('td', row.name, row.overwrite && !r.done && h('div', { style: { color: 'var(--accent)', fontSize: '13px' } }, '이미 입력된 값을 덮어씁니다')),
        row.skip ? h('td', { colspan: s.teams.length, style: { color: 'var(--text-dim)' } }, row.skip) : row.cells.map((c) => h('td', cell(row, c))))),
      h('tr', h('td', h('b', ok ? '종합 합계' : '반영 뒤 종합 합계')), r.totalsAfter.map((v, t) => h('td', h('b', String(v)), ` (${r.ranksAfter[t]}위)`)))),
    ok ? h('div', { style: { color: 'var(--ok)', fontWeight: 700 } }, '✔ 반영했습니다 — 게임 화면에 종합 점수 표시 중')
      : r.stale ? h('div.field-error', '점수가 바뀌었습니다 — 다시 반영하세요') : null,
    !ok && h('div.h-row', btn(r.stale ? '다시 반영' : '팀 점수에 반영', 'round.reflect', {}, '.primary.big')));
}

async function endGame() {
  const v = await confirmBox({ title: '게임 종료', message: '게임을 종료하고 결과를 볼까요? (팀별 맞힌 개수 · 1 · 2 · 3등)', buttons: [{ label: '종료', value: true, primary: true }, { label: '취소', value: false }] });
  if (v) send('game.end');
}

function roulettePanel(s) {
  const scoring = s.type !== 'roulette';
  if (s.roulettePhase === 'spinning') return h('div.h-card', h('div.h-empty', scoring ? '카테고리 추첨 중…' : '주제 추첨 중…'));
  if (s.roulettePhase === 'stopped') {
    return h('div.h-card',
      h('h3', '당첨'),
      h('div.h-big', `${s.spinResult?.icon ?? ''} ${s.spinResult?.name ?? ''}`),
      h('div.h-row', btn('확정', 'roulette.confirm', {}, '.primary.big'), btn('다시 돌리기', 'roulette.respin')));
  }
  const list = s.wheelList ?? [];
  // 릴레이 — 남은 문제가 한 라운드에 모자란 카테고리는 원판에 못 넣는다 (R-62)
  const usable = (i) => !i.exhausted && !i.short;
  const n = list.filter((i) => i.included && usable(i)).length;
  if (scoring && list.length > 0 && !list.some(usable)) {
    // 더 출제할 문제가 없음 — 게임 화면도 룰렛 준비 대신 안내 (01-app-flow 5장)
    return h('div.h-card',
      h('h3', `ROUND ${s.roundNo}`),
      h('div.h-big', '더 출제할 문제가 없습니다'),
      list.some((i) => i.short) && dim(`한 라운드(${list.find((i) => i.short).need}문제)를 낼 만큼 문제가 남은 카테고리가 없습니다`),
      h('div.h-row', btn('결과 보기 ▶', 'question.next', { skipReveal: true }, '.primary.big')));
  }
  return h('div.h-card',
    h('h3', scoring ? `ROUND ${s.roundNo}${extraRound(s, s.roundNo)} 카테고리 고르기 — 이번 판에 넣을 것` : '주제 고르기 — 이번 판에 넣을 것'),
    h('div.h-cats', list.map((i) => h(`button.h-cat${i.included && usable(i) ? '.on' : '.off'}`, {
      onclick: () => send('roulette.toggle', { categoryId: i.id }), disabled: (i.exhausted && !i.included) || i.short || !s.connected ? true : undefined,
    }, h('span', i.included && usable(i) ? '●' : '○'), h('span.emoji', i.icon), h('span', i.name),
    h('span.meta', i.empty ? '문제 없음' : i.exhausted ? '모두 출제함' : i.short ? `부족 · 남은 ${i.remaining}/${i.need}` : scoring ? `남은 ${i.remaining}` : topicMeta(i), i.wins ? ` · ×${i.wins}` : '')))),
    n === 0 && h('div.field-error', scoring ? '카테고리를 1개 이상 넣으세요' : '주제를 1개 이상 넣으세요'),
    !scoring && list.some((i) => i.remaining === 0) && dim('문제를 다 낸 주제는 자동으로 빠집니다 — 다시 넣으면 뽑혔을 때 주제 카드(규칙)만으로 진행 · [모두 넣기] 로는 안 들어감'),
    scoring && list.some((i) => i.short) && dim(`팀당 대표 ${s.relayReps}명 — 남은 문제가 ${list.find((i) => i.short).need}개보다 적은 카테고리는 이 게임에서 쓰지 않습니다`),
    n >= 2 && rigRow(s, list.filter((i) => i.included && usable(i))),
    h('div.h-row', btn('모두 넣기', 'roulette.all'), btn(`룰렛 돌리기 (${n}개)`, 'roulette.spin', st.rig ? { categoryId: st.rig } : {}, '.primary.big'),
      !scoring && btn('끝내기', 'game.end')));
}

/**
 * 줄줄이 말해요 주제 고르기 (R-65, 12-host-view 4-2) — 원판 없이 진행자가 고르면 모니터에 바로 그 주제 카드가 나온다.
 * 모니터에는 고르기 전까지 후보가 보이지 않아 팀이 답을 미리 준비할 수 없다. 문제는 진행자 화면에만
 */
function topicPickPanel(s) {
  const list = s.wheelList ?? [];
  // 무작위 후보 — 게임 홈에서 넣은 주제 중 문제를 다 내지 않은 것 (state.topicPool 과 같은 기준)
  const inPool = (i) => i.included && i.remaining !== 0;
  const n = list.filter(inPool).length;
  return h('div.h-card',
    h('h3', '주제 고르기 — 누르면 바로 모니터에 공개됩니다'),
    dim('누르면 모니터에 그 주제 카드(이름 · 규칙)가 나옵니다. 문제가 있는 주제는 규칙을 설명한 뒤 [첫 문제 ▶] — 문제는 이 화면에만 보입니다'),
    h('div.h-cats.secret', list.map((i) => h(`button.h-cat${inPool(i) ? '.on' : '.off'}`, {
      onclick: () => send('topic.pick', { categoryId: i.id }), disabled: !s.connected ? true : undefined,
    }, h('span.emoji', i.icon), h('span', i.name),
    h('span.meta', [topicMeta(i), !i.included && '무작위 제외', i.wins && `×${i.wins}`].filter(Boolean).join(' · '))))),
    h('div.h-row', btn(n ? `🎲 무작위 (${n}개 중)` : '🎲 무작위 — 고를 주제 없음', 'topic.pick', {}, '.primary.big'), btn('끝내기', 'game.end')));
}

/**
 * 이모티콘 퀴즈 문제 고르기 (R-90, 12-host-view 4-11) — 카테고리 → 문제 [내기] 를 누르면 게임 화면에 바로 그 문제.
 * 문제 고르기 화면(모니터 카테고리 목록)과 정답 화면에서. 고른 카테고리는 이 화면에만 (st.pickCat)
 */
function pickPanel(s) {
  const choices = (s.pickChoices ?? []).filter((c) => Array.isArray(c.questions));
  const off = !s.connected ? true : undefined;
  if (!choices.length) {
    if (s.screen !== 'roulette') return h('div.h-card', h('h3', '다음 문제'), dim('더 낼 문제가 없습니다 — [카테고리 목록 ▶] 뒤 [결과 보기 ▶], 또는 [종료]'));
    return h('div.h-card',
      h('div.h-big', '더 출제할 문제가 없습니다'),
      h('div.h-row', btn('결과 보기 ▶', 'question.next', { skipReveal: true }, '.primary.big')));
  }
  const cur = choices.find((c) => c.id === st.pickCat) ?? null;
  const tabs = h('div.h-cats', choices.map((c) => h(`button.h-cat${cur?.id === c.id ? '.on' : ''}`, { onclick: () => { st.pickCat = cur?.id === c.id ? null : c.id; render(); } },
    h('span.emoji', c.icon), h('span', c.name), h('span.meta', `남은 ${c.questions.length}`))));
  const list = cur && h('div.h-list.secret', cur.questions.map((q, i) => h('div.it',
    h('span.n', String(i + 1)),
    h('span.emoji', q.emojis ? q.emojis : q.image ? '🖼' : ''),
    h('span', q.answer),
    h('button.btn.small.h-next', { onclick: () => send('question.pick', { questionId: q.id }), disabled: off }, '내기'))));
  return h('div.h-card',
    h('h3', s.screen === 'roulette' ? `문제 고르기 — 모니터: 카테고리 목록 · 낸 문제 ${s.askedCount ?? 0}개` : '다음 문제 고르기 — [내기] 를 누르면 바로 다음 문제'),
    tabs,
    cur ? list : dim('카테고리를 누르면 남은 문제가 나옵니다 (이 게임에서 낸 문제는 빠짐)'),
    s.screen === 'roulette' && h('div.h-row', endButton(s)));
}

/** 문제 고르기의 카테고리 선택 — 이모티콘 퀴즈 진행 중에만, 그 카테고리에 남은 문제가 없어지면 처음으로 */
function syncPickCat(s) {
  if (!st.pickCat) return;
  const keep = s?.live && s.view === 'play' && s.pickMode && (s.pickChoices ?? []).some((c) => c.id === st.pickCat);
  if (!keep) st.pickCat = null;
}

/** 룰렛 결과 지정 (R-48, 12-host-view 4-8) — 원판 후보 중 하나를 고르면 [룰렛 돌리기] 가 그 조각에 멈춘다. 모니터에는 표시 없음 */
function rigRow(s, cands) {
  const what = s.type === 'roulette' ? '주제' : '카테고리';
  const cur = cands.find((i) => i.id === st.rig);
  const pick = (id) => { st.rig = st.rig === id ? null : id; render(); };
  const off = !s.connected ? true : undefined;
  return h('div.secret', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    h('div.h-row.h-pick-row', h('span.label', '결과 지정'),
      h('div.h-picks',
        h(`button.h-pick${cur ? '' : '.on'}`, { onclick: () => { st.rig = null; render(); }, disabled: off }, '🎲 무작위'),
        cands.map((i) => h(`button.h-pick${cur?.id === i.id ? '.on' : ''}`, { onclick: () => pick(i.id), disabled: off }, h('span.emoji', i.icon), h('span', i.name))))),
    dim(cur ? `지정: ${cur.icon} ${cur.name} — 이번 한 번만, 모니터엔 안 보임` : `돌리기 전에 고르면 그 ${what}에 멈춥니다 — 이번 한 번만, 모니터엔 안 보임`));
}

/** 결과 지정은 룰렛 준비에서 한 번만 (D-27) — 회전이 시작되거나 지정한 것이 원판 후보에서 빠지면 무작위로 */
function syncRig(s) {
  if (!st.rig) return;
  const keep = s?.live && s.view === 'play' && s.screen === 'roulette' && s.roulettePhase === 'setup'
    && (s.wheelList ?? []).some((i) => i.id === st.rig && i.included && !i.exhausted && !i.short);
  if (!keep) st.rig = null;
}

function roundIntro(s) {
  const p = s.picks?.[s.roundIndex];
  return [
    h('div.h-card', h('h3', `ROUND ${s.roundIndex + 1}`), h('div.h-big', `${p?.icon ?? ''} ${p?.name ?? ''}`), h('div.h-row', btn('첫 문제 ▶', 'round.start', {}, '.primary.big'))),
    roundList(s),
  ];
}

function resultPanel(s) {
  const r = s.result;
  if (!r) return null;
  const order = r.ranks.map((rank, t) => ({ rank, t })).sort((a, b) => a.rank - b.rank);
  const revealed = new Set(r.revealedTeams);
  // 점수를 주는 게임(R-49)은 점수 열을 더하고, 동점이어도 점수가 같으니 추가 문제를 권하지 않는다
  const per = typeof s.per === 'number' ? s.per : null;
  const tieAction = r.allRevealed && r.ties.length > 0 && per === null;
  // 릴레이는 순위 기준이 게임 점수 — 라운드마다 등수의 배점 합 (R-62)
  const relay = !!s.relayReps;
  const parts = [
    h('div.h-card',
      h('h3', `결과 — 공개 ${Math.min(r.revealCount, r.groupCount)} / ${r.groupCount}`),
      h('table.h-table', h('tr', h('th', '순위'), h('th', '팀'), h('th', relay ? '게임 점수 (라운드 배점 합)' : '정답 수'), per !== null && h('th', '점수'), h('th', '게임 화면')),
        order.map(({ rank, t }) => h('tr', h('td', `${rank}위`), h('td', h('span.dot', { style: { '--c': teamColor(t) } }), ` ${teamName(t)}`), h('td', relay ? `${r.counts[t]}점` : r.counts[t], r.decided[t] ? ' (추가 문제로 결정)' : ''), per !== null && h('td', r.counts[t] * per), h('td', revealed.has(t) ? '공개됨' : '가림')))),
      h('div.h-row',
        !r.allRevealed && btn('다음 순위 공개 ▶', 'result.next', {}, '.primary.big'),
        tieAction && !r.tiebreakAvailable && h('span.field-error', '추가 문제가 없어 공동 순위로 정합니다'),
        r.allRevealed && !s.fill && btn('점수판에 채우기', 'result.fillOpen'),
        // 라운드마다 모두 반영했거나 채웠으면 (R-57) — 다시 채우려면 [점수판에 채우기]
        r.allRevealed && !s.fill && r.fillState === 'filled' && dim('✔ 종합 점수판에 반영돼 있습니다'))),
  ];
  if (tieAction && r.tiebreakAvailable) parts.push(tiebreakPicker(s, r));
  if (r.perRound?.length && r.allRevealed) {
    // 릴레이는 라운드 등수 (R-62)
    const cell = (row, t) => (!relay ? row.counts[t] : row.ranks ? `${row.ranks[t]}등` : '-');
    parts.push(h('div.h-card', h('h3', relay ? '라운드별 순위' : '라운드별 정답 수'), h('table.h-table',
      h('tr', h('th', '라운드'), s.teams.map((t) => h('th', t.name))),
      r.perRound.map((row, i) => h('tr', h('td', `ROUND ${i + 1} · ${s.picks[i]?.icon ?? ''} ${s.picks[i]?.name ?? row.categoryId}`), s.teams.map((_, t) => h('td', cell(row, t))))))));
  }
  if (s.fill) parts.unshift(fillPanel(s));
  return parts;
}

/**
 * 추가 문제 고르기 (D-3 · R-54) — 카테고리 → 문제 [내기]. 이 게임에 포함된 카테고리의 아직 안 낸 문제만, 무작위 버튼 없음
 * (게임 창 S 가 비상용 무작위). 고른 카테고리는 이 화면에만 (st.tbCat)
 */
function tiebreakPicker(s, r) {
  const choices = r.tiebreakChoices ?? [];
  const cur = choices.find((c) => c.id === st.tbCat) ?? null;
  const off = !s.connected ? true : undefined;
  const group = (r.ties[0] ?? []).map(teamName).join(' · ');
  const body = cur
    ? [
      h('div.h-row', h('button.btn.small', { onclick: () => { st.tbCat = null; render(); } }, '◀ 카테고리'), h('span.h-prompt', `${cur.icon} ${cur.name} — 남은 ${cur.questions.length}문제`)),
      h('div.h-list.secret', cur.questions.map((q, i) => h('div.it',
        h('span.n', String(i + 1)), h('span', q.answer),
        h('button.btn.small.h-next', { onclick: () => { st.tbCat = null; send('result.tiebreak', { questionId: q.id }); }, disabled: off }, '내기')))),
    ]
    : h('div.h-cats', choices.map((c) => h('button.h-cat', { onclick: () => { st.tbCat = c.id; render(); } },
      h('span.emoji', c.icon), h('span', c.name), h('span.meta', `남은 ${c.questions.length}`))));
  return h('div.h-card',
    h('h3', `추가 문제 — ${group} 동점 · ${cur ? '문제를 골라 [내기]' : '카테고리를 고르세요'}`),
    body,
    h('div.h-cand-head', '이 게임에서 낸 문제는 목록에 없습니다. [내기] 를 누르면 게임 화면에 바로 나옵니다'));
}

/** 추가 문제 고르기의 카테고리 선택은 결과 화면에서만 — 화면이 바뀌거나 그 카테고리 후보가 없어지면 처음으로 */
function syncTiebreakPick(s) {
  if (!st.tbCat) return;
  const keep = s?.live && s.view === 'play' && s.screen === 'result' && (s.result?.tiebreakChoices ?? []).some((c) => c.id === st.tbCat);
  if (!keep) st.tbCat = null;
}

/** 라운드별 등수 목록의 배점 합 (R-57) */
const ranksPoints = (row, ranks) => ranks.reduce((sum, r) => sum + (Number.isInteger(r) ? (row.points[r - 1] ?? 0) : 0), 0);

/** 종합 점수판 채우기 창 (D-18) — 진행자 화면에 뜬다 */
function fillPanel(s) {
  const f = s.fill;
  const teams = s.teams;
  if (st.fillEdit) {
    const work = st.fillEdit;
    return h('div.h-card',
      h('h3', '점수 고치기 — 점수 칸에 숫자를 넣으면 그 칸만 직접 수정 (등수 행의 라운드별 등수는 그대로), 정답 수 행은 정답 수를 고침'),
      h('table.h-table', h('tr', h('th', '라운드'), teams.map((t) => h('th', t.name))),
        f.rows.map((row, ri) => h('tr', h('td', row.name), row.skip ? h('td', { colspan: teams.length }, row.skip)
          : row.kind === 'count'
            // 정답 수 행 — 정답 수를 고친다, 점수는 1개당 점수로 (R-49)
            ? work[ri].map((cell) => h('td',
              h('input', { type: 'number', min: 0, value: cell.count, oninput: (e) => { const v = e.target.value.trim(); if (/^\d+$/.test(v)) cell.count = Number(v); } }),
              ` 개 × ${row.per ?? 0}`))
            // 등수 행 — 라운드별 등수는 그대로, 점수만 직접 수정 (R-57)
            : work[ri].map((cell, t) => h('td', `${ranksText(row.ranks[t])} `,
              h('input', { type: 'number', placeholder: String(ranksPoints(row, row.ranks[t])), value: Number.isInteger(cell.value) ? cell.value : '', oninput: (e) => { const v = e.target.value.trim(); if (/^-?\d+$/.test(v)) cell.value = Number(v); else delete cell.value; } })))))),
      h('div.h-row',
        h('button.btn.hb.primary', { onclick: () => { send('result.fill', { mode: 'edit', cells: work }); st.fillEdit = null; render(); } }, '입력'),
        h('button.btn.hb', { onclick: () => { st.fillEdit = null; render(); } }, '취소')));
  }
  return h('div.h-card', { style: { borderColor: 'var(--accent)' } },
    h('h2', { style: { margin: 0 } }, '종합 점수판에 채울까요?'),
    // 릴레이는 대표를 다 내보내지 못한 팀끼리만 같은 등수가 될 수 있다 (R-62)
    f.tie && h('div.field-error', s.relayReps ? '같은 라운드에서 대표를 다 내보내지 못한 팀끼리 맞힌 대표 수가 같으면 같은 등수로 채워집니다' : '같은 라운드에서 정답 수가 같은 팀은 같은 등수로 채워집니다'),
    h('table.h-table', h('tr', h('th', '라운드'), teams.map((t) => h('th', t.name))),
      f.rows.map((row) => h('tr', h('td', row.name, row.overwrite && h('div', { style: { color: 'var(--accent)', fontSize: '13px' } }, '이미 입력된 값을 덮어씁니다')),
        row.skip ? h('td', { colspan: teams.length, style: { color: 'var(--text-dim)' } }, row.skip)
          : row.kind === 'count'
            ? (row.counts ?? []).map((n) => h('td', `${n}개 (${n * (row.per ?? 0)})`))
            : row.ranks.map((ranks) => h('td', `${ranksText(ranks)} (${ranksPoints(row, ranks)})`))))), // 라운드별 등수 (R-57)
    h('div.h-row',
      btn('확인', 'result.fill', { mode: 'auto' }, '.primary.big'),
      h('button.btn.hb', { onclick: () => { st.fillEdit = f.rows.map((row) => (row.skip ? null : row.kind === 'count' ? (row.counts ?? []).map((count) => ({ count })) : row.ranks.map(() => ({})))); render(); } }, '점수 고치기'),
      btn('취소', 'result.fillSkip')));
}

/** 룰렛형 준비 목록 — 문제가 있는 주제만 남은 수 (R-44, D-26 — 다 냈어도 넣을 수 있음) */
const topicMeta = (i) => (typeof i.remaining !== 'number' ? '' : i.remaining > 0 ? `문제 ${i.remaining}` : '문제 모두 냄');
const dim = (text) => h('div', { style: { color: 'var(--text-dim)', fontSize: '14px' } }, text);
/** 정답 후보는 가나다순 — 팀원이 말한 답을 빨리 찾게 (게임 화면과 같은 순서) */
const sortedKo = (list) => [...list].sort((a, b) => a.localeCompare(b, 'ko'));

function topicPanel(s) {
  const t = s.topic;
  if (!t) return [];
  const q = t.question;
  const more = typeof t.remaining === 'number' && t.remaining > 0;
  const how = t.order === 'fixed' ? '순서대로' : '랜덤';
  const picked = s.picks?.length > 0 && dim(`이번 게임에서 고른 주제: ${s.picks.map((p) => p.name).join(' · ')}`);
  if (!q) {
    // 주제 카드 — 문제가 있는 주제면 [첫 문제 ▶] (D-25) 또는 목록에서 골라 [내기] (R-45)
    return [h('div.h-card',
      h('div.h-big', `${t.icon} ${t.name}`),
      h('div.h-prompt', t.rule),
      h('div.h-row.secret', t.examples.map((x) => h('span.chip', x))),
      t.questionCount > 0 && dim(more ? `이 주제 남은 문제 ${t.remaining}개 — 규칙을 설명한 뒤 [첫 문제 ▶] (${how}) 또는 아래 목록에서 [내기]. 문제는 이 화면에만 보입니다 (게임 화면은 주제 카드 그대로)` : '이 주제의 문제를 다 냈습니다 — 주제 카드로 진행하거나 [다음 주제 ▶] (이 주제는 무작위에서 빠짐)'),
      h('div.h-row',
        more && btn(`첫 문제 ▶ · ${how}`, 'topic.question', {}, '.primary.big'),
        btn(s.examplesVisible ? '예시 숨기기 (게임 화면)' : '예시 표시 (게임 화면)', 'topic.examples'),
        btn('다음 주제 ▶', 'topic.next', {}, more ? '' : '.primary.big'), btn('끝내기', 'game.end')),
      picked), topicList(s)];
  }
  // 문제 — 문제 글자 + 정답 후보 전체 (R-44). 진행자 화면에만 — 진행자가 읽어 준다 (R-65)
  return [h('div.h-card',
    h('div.h-row', h('span.h-badge', `${t.icon} ${t.name}`), h('span.h-badge.on', `이 주제 ${q.no}번째 문제`),
      h('span.h-badge', more ? `남은 ${t.remaining}개` : '남은 문제 없음'), h('span.h-badge', '게임 화면: 주제 카드 (문제는 여기만)')),
    h('div.h-prompt', t.rule),
    h('div.h-chain-q', q.prompt),
    h('h3', `정답 후보 ${q.answers.length}개 (가나다순) — 목록에 없어도 맞으면 인정`),
    h('div.h-answers.secret', sortedKo(q.answers).map((x) => h('span.chip', x))),
    q.note && h('div.h-meta.secret', h('span', h('b', '메모'), q.note)),
    h('div.h-row',
      more ? btn(`다음 문제 ▶ · ${how}`, 'topic.question', {}, '.primary.big') : h('span.field-error', '이 주제의 문제를 다 냈습니다 — [다음 주제 ▶] 하면 이 주제는 무작위에서 빠집니다'),
      btn('다음 주제 ▶', 'topic.next', {}, more ? '' : '.primary.big'), btn('끝내기', 'game.end')),
    picked), topicList(s)];
}

/** 이 주제 문제 목록 — 진행자가 골라 낸다 (R-45). 문제 글자만, 관리 페이지 순서 */
function topicList(s) {
  const list = s.topic?.list ?? [];
  if (!list.length) return null;
  return h('div.h-card', h('h3', `이 주제 문제 ${list.length}개 — [내기] 를 누르면 그 문제가 바로 나옵니다`),
    h('div.h-list.secret', list.map((it) => h(`div.it${it.state === 'current' ? '.cur' : ''}${it.state === 'asked' ? '.past' : ''}`,
      h('span.n', it.state === 'current' ? '▶' : it.n), h('span', it.prompt),
      it.state === 'asked' && h('span.h-badge', '냄'),
      it.next && h('span.h-badge.on', '다음'),
      it.state === 'left' && h('button.btn.small.h-next', { onclick: () => send('topic.question', { questionId: it.id }), disabled: !s.connected ? true : undefined }, '내기')))));
}

function render() {
  const s = st.state;
  if (!s) return;
  syncRig(s);
  syncTiebreakPick(s);
  syncPickCat(s);
  const blocks = [header(s)];
  if (!s.connected) blocks.push(h('div.h-banner', '게임 화면과 연결되지 않았습니다 — 게임 창을 열어 두세요'));
  if (st.record && s.live && s.view === 'play' && s.record) blocks.push(recordCard(s));
  if (!s.live || s.view !== 'play' || !s.screen) {
    blocks.push(h('div.h-card', h('div.h-empty', '진행 중인 문제가 없습니다', s.game && h('div', { style: { fontSize: '15px', marginTop: '8px' } }, `마지막 게임: ${s.game.title}`))));
  } else if (s.screen === 'roulette' && s.type === 'roulette') {
    blocks.push(topicPickPanel(s)); // 줄줄이 말해요 — 원판 없이 진행자가 고름 (R-65)
  } else if (s.screen === 'roulette' && s.pickMode) {
    blocks.push(pickPanel(s), h('div.h-card', scores(s))); // 이모티콘 퀴즈 — 룰렛 없이 진행자가 문제를 고름 (R-90)
  } else if (s.pickMode && (s.screen === 'question' || s.screen === 'answer')) {
    blocks.push(questionCard(s), creditRow(s), progressRow(s), s.screen === 'answer' && pickPanel(s), h('div.h-card', scores(s)));
  } else if (s.screen === 'roulette') {
    blocks.push(roulettePanel(s), scores(s));
  } else if (s.screen === 'round') {
    blocks.push(...roundIntro(s), scores(s), progressRow(s));
  } else if (['question', 'answer', 'tiebreakQuestion', 'tiebreakAnswer'].includes(s.screen)) {
    blocks.push(questionCard(s), creditRow(s), clipCard(s), roundEndPrompt(s), progressRow(s), roundList(s), h('div.h-card', scores(s)));
  } else if (s.screen === 'roundEnd') {
    blocks.push(...roundEndPanel(s));
  } else if (s.screen === 'result') {
    blocks.push(...(resultPanel(s) ?? []), h('div.h-card', scores(s)));
  } else if (s.screen === 'topic') {
    blocks.push(...topicPanel(s));
  }
  const keepScroll = window.scrollY;
  replace(root, h(`div${st.blurred ? '.blurred' : ''}`, { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, blocks));
  window.scrollTo(0, keepScroll);
}

function toggleBlur() { st.blurred = !st.blurred; render(); }
function toggleRecord() { st.record = !st.record; render(); }

/**
 * 정답 기록 고치기 (R-60, 12-host-view 4-10) — 이 게임에서 낸 문제마다 팀 버튼 · [없음]. 누르면 바로 바뀌고 게임 화면은 그대로.
 * 공개 전 지금 문제는 "진행 중", 추가 문제는 그 동점 팀만
 */
function recordCard(s) {
  const r = s.record;
  const off = !s.connected ? true : undefined;
  // 팀당 대표 방식의 라운드 문제는 팀마다 대표 버튼 "팀A 1 2" — 맞힌 사람까지 고친다 (R-94)
  const repBtns = (q, key, t) => h('span.h-rec-reps', { style: { '--c': teamColor(t) } }, teamName(t),
    Array.from({ length: r.reps.relay }, (_, k) => h(`button.btn.small.h-rec-team${q.team === t && q.rep === k ? '.on' : ''}`, {
      style: { '--c': teamColor(t) }, onclick: () => send('history.credit', { questionId: key, team: t, rep: k }), disabled: off,
    }, `${q.team === t && q.rep === k ? '✔ ' : ''}대표${k + 1}`)));
  const row = (label, q, key, group) => h('div.h-rec-q',
    h('span.n', label), h('span.h-rec-ans.secret', q.answer ?? '—'),
    q.live ? h('span.h-rec-live', '진행 중 — 정답 공개 뒤 맞힌 팀 버튼으로')
      : h('div.h-rec-btns',
        (group ?? s.teams.map((_, i) => i)).map((t) => (r.reps && !group ? repBtns(q, key, t) : h(`button.btn.small.h-rec-team${q.team === t ? '.on' : ''}`, {
          style: { '--c': teamColor(t) }, onclick: () => send('history.credit', { questionId: key, team: t }), disabled: off,
        }, `${q.team === t ? '✔ ' : ''}${teamName(t)}`))),
        h(`button.btn.small${q.none && q.team === null ? '.primary' : ''}`, { onclick: () => send('history.credit', { questionId: key, team: null }), disabled: off }, '없음')));
  return h('div.h-card.h-record',
    h('div.h-row', h('h3', '📝 정답 기록 — 누르면 바로 고쳐집니다 (게임 화면은 그대로)'), h('button.btn.small', { style: { marginLeft: 'auto' }, onclick: toggleRecord }, '✕ 닫기')),
    !r.rounds.length && !r.tiebreak.length && dim('아직 낸 문제가 없습니다'),
    r.rounds.map((rd) => h('div.h-rec-round',
      h('div.h-rec-head', `ROUND ${rd.index + 1} · ${rd.icon} ${rd.name}`, h('span.meta', rd.counts.map((c, t) => `${teamName(t)} ${c}`).join(' · '))),
      rd.questions.map((q) => row(`Q${q.n}`, q, q.id, null)))),
    r.tiebreak.length > 0 && h('div.h-rec-round', h('div.h-rec-head', '추가 문제 (동점)'),
      r.tiebreak.map((q) => row(`+${q.n}`, q, `tb:${q.id}`, q.group))));
}

// ── 설명서 (4-7, R-38) — 진행자 화면 위에 겹쳐 연다. 실시간 연결 · 그리기는 그대로 ──
let guideLayer = null;
function openGuide() {
  if (guideLayer) return;
  guideLayer = h('div.overlay.guide-layer', { onclick: (e) => { if (e.target === guideLayer) closeGuide(); } },
    h('div.guide-sheet',
      h('div.guide-top', h('h2', '📖 진행자 설명서'), h('button.btn.small', { onclick: closeGuide }, '✕ 닫기')),
      guideBody({ server: st.server })));
  document.body.append(guideLayer);
}
function closeGuide() { guideLayer?.remove(); guideLayer = null; }

async function logout() {
  // 서버 모드는 게임 화면 · 관리 페이지와 입장 쿠키를 함께 쓴다 — 같은 브라우저의 게임 화면도 잠긴다 (12-host-view 5-4)
  if (st.server) {
    const ok = await confirmBox({
      title: '나가기',
      message: '이 브라우저에서 연 게임 화면 · 관리 페이지도 함께 잠깁니다 (다시 PIN 필요).\n모니터 게임 화면을 띄운 노트북이면 누르지 마세요.',
      buttons: [{ label: '취소', value: false }, { label: '나가기', value: true, primary: true }],
    });
    if (!ok) return;
  }
  await fetch('/api/host/logout', { method: 'POST', headers: { 'X-Camp-App': '1' } }).catch(() => {});
  st.es?.close();
  showLogin();
}

window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Escape' && guideLayer) { closeGuide(); e.preventDefault(); return; }
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.code === 'KeyB' && st.state) { toggleBlur(); e.preventDefault(); }
});

getSession().then((s) => { st.server = s.server; start(); });
