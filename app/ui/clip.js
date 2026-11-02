// 정답 영상 — 유튜브 구간 재생 (docs/games/photo-quiz.md 5-5, docs/05-screens.md 4-7, R-61)
// 게임 화면은 정답 공개 때 사진 위에 덮어 재생하고 끝나면 걷어낸다. 관리 페이지는 구간 미리보기에 쓴다
import { h } from './dom.js';

const API_URL = 'https://www.youtube.com/iframe_api';
const NO_NET = '유튜브에 연결할 수 없습니다 (인터넷 연결 확인)';
let apiPromise = null;

/** 유튜브 IFrame API — 처음 한 번만 불러온다. 실패하면 다음에 다시 시도 */
export function loadYouTubeApi(timeoutMs = 10_000) {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const fail = () => { clearTimeout(timer); apiPromise = null; reject(new Error(NO_NET)); };
    const timer = setTimeout(fail, timeoutMs);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); clearTimeout(timer); resolve(window.YT); };
    document.head.append(h('script', { src: API_URL, onerror: fail }));
  });
  return apiPromise;
}

/** 유튜브 오류 코드 → 진행자 · 관리 페이지에 보일 이유 */
export function clipErrorText(code) {
  if (code === 2) return '영상 주소가 올바르지 않습니다';
  if (code === 5) return '이 브라우저에서 재생할 수 없는 영상입니다';
  if (code === 100) return '영상이 없거나 비공개입니다';
  // 퍼가기 금지 영상 — 유튜브는 없는 영상에도 이 코드를 주곤 한다
  if (code === 101 || code === 150) return '다른 사이트에서 재생할 수 없는 영상입니다 (퍼가기 금지 · 삭제 · 비공개) — 다른 영상으로 바꾸세요';
  if (code === 153) return '유튜브가 재생을 거절했습니다 (페이지 주소 정보 없음)';
  return `재생할 수 없습니다 (유튜브 오류 ${code})`;
}

const PLAYING = 1;
const BUFFERING = 3;
const ENDED = 0;
const START_WAIT_MS = 1500; // 재생을 눌렀는데 이만큼 안 움직이면 자동 재생이 막힌 것으로 본다
const BUFFER_WAIT_MS = 12_000; // 불러오는 중이면 이만큼까지 기다린다
const ON_SCREEN = ['loading', 'playing', 'paused'];

/**
 * @param box 영상을 덮을 상자 (.stage-box) — 사진 위에 같은 크기로
 * @param clip { id, start, end } (core/youtube.js clipSpec) — end 가 null 이면 영상 끝까지
 * @param onChange 상태가 바뀔 때 — status() 와 같은 값
 * 상태: idle(안 보임) · loading · playing · paused · done(끝 — 걷어냄) · error(걷어냄, error 에 이유).
 * 재생 전에 유튜브가 오류를 알려 오면 idle 그대로 error 에 이유만 (진행자 화면에 미리 경고)
 */
export function createClip(box, clip, { onChange = () => {} } = {}) {
  const src = `https://www.youtube.com/embed/${clip.id}?${new URLSearchParams({
    enablejsapi: '1', controls: '0', disablekb: '1', fs: '0', rel: '0', playsinline: '1', iv_load_policy: '3',
    hl: 'ko', cc_lang_pref: 'ko', // 자막이 켜지는 브라우저면 한국어 자막부터
    start: String(Math.floor(clip.start)), origin: location.origin,
  })}`;
  const spinner = h('div.spinner');
  const note = h('div.clip-note', { hidden: true }, '🔇 소리가 꺼져 있습니다 — 이 화면을 한 번 클릭하면 소리가 켜집니다');
  // 영상 위 투명 막 — 마우스에 유튜브 단추가 뜨지 않게. 클릭은 이 창이 받아 소리를 켠다 (자동 재생 정책)
  const shield = h('div.clip-shield');
  const frame = h('div.clip-frame');
  const layer = h('div.clip-layer', frame, shield, spinner, note);
  box.append(layer);

  let iframe = null;
  let player = null;
  let ready = false;
  let destroyed = false;
  let pending = null; // 준비되기 전에 누른 재생
  let badVideo = null; // 유튜브가 알려 온 오류 — 다시 눌러도 같다
  let watch = null; // 자동 재생 막힘 확인
  let poll = null; // 끝 시간 확인
  let triedMuted = false;
  let st = { state: 'idle', muted: false, error: null };

  const set = (patch) => {
    st = { ...st, ...patch };
    const on = ON_SCREEN.includes(st.state);
    layer.classList.toggle('on', on);
    spinner.hidden = st.state !== 'loading';
    note.hidden = !(st.muted && on);
    onChange({ ...st });
  };
  const stopTimers = () => { clearTimeout(watch); clearInterval(poll); };

  /** 플레이어를 미리 만들어 둔다 — 정답 공개 때 바로 재생되게 (문제 화면에서 부른다) */
  function prepare() {
    if (iframe || destroyed) return;
    iframe = h('iframe', { src, title: '정답 영상', allow: 'autoplay; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin', frameborder: '0' });
    frame.append(iframe);
    loadYouTubeApi().then((YT) => {
      if (destroyed) return;
      player = new YT.Player(iframe, {
        events: {
          onReady: () => { ready = true; const p = pending; pending = null; p?.(); },
          onStateChange: (e) => onState(e.data),
          onError: (e) => {
            badVideo = clipErrorText(e.data);
            if (ON_SCREEN.includes(st.state)) fail(badVideo); else set({ error: badVideo });
          },
        },
      });
    }).catch((e) => {
      // 다음 재생 때 처음부터 다시 — 재생 전이면 진행자 화면에 미리 알린다
      iframe?.remove();
      iframe = null;
      if (st.state === 'loading') fail(e.message); else set({ error: e.message });
    });
  }

  function onState(code) {
    if (code === PLAYING) {
      clearTimeout(watch);
      // 브라우저가 소리를 막아 유튜브가 스스로 소리 없이 틀었을 수도 있다
      set({ state: 'playing', muted: !!player.isMuted?.() });
      startPoll();
    } else if (code === ENDED) finish();
  }

  function startPoll() {
    clearInterval(poll);
    if (clip.end === null || clip.end === undefined) return;
    // 끝 시간에 직접 멈춘다 — 유튜브 end= 로 멈추면 다른 영상 추천 화면이 뜬다
    poll = setInterval(() => {
      if (st.state === 'playing' && (player.getCurrentTime?.() ?? 0) >= clip.end - 0.05) finish();
    }, 100);
  }

  /** 재생을 눌렀는데 안 움직이면 — 불러오는 중이면 더 기다리고, 아니면 소리 없이 다시 (자동 재생 정책), 그래도 안 되면 오류 */
  function armWatch(started = Date.now()) {
    clearTimeout(watch);
    watch = setTimeout(() => {
      if (st.state !== 'loading') return;
      const s = player?.getPlayerState?.();
      if (s === PLAYING) return;
      if (s === BUFFERING && Date.now() - started < BUFFER_WAIT_MS) { armWatch(started); return; }
      if (!triedMuted) {
        triedMuted = true;
        player.mute();
        player.playVideo();
        set({ muted: true });
        armWatch();
        return;
      }
      fail('재생이 시작되지 않습니다 — 게임 화면을 한 번 클릭한 뒤 다시 재생하세요');
    }, START_WAIT_MS);
  }

  function fail(message) {
    stopTimers();
    pending = null;
    try { player?.pauseVideo?.(); } catch { /* 이미 망가진 플레이어 */ }
    set({ state: 'error', error: message });
  }

  /** 처음부터 재생 */
  function play() {
    if (destroyed) return false;
    stopTimers();
    triedMuted = false;
    if (badVideo) { set({ state: 'error', error: badVideo }); return true; }
    prepare();
    set({ state: 'loading', error: null, muted: false });
    const go = () => {
      if (st.state !== 'loading') return;
      // 소리를 켠 채로 시작한다 — 막히면 armWatch 가 소리 없이 다시
      player.unMute();
      player.seekTo(clip.start, true);
      player.playVideo();
      armWatch();
    };
    if (ready) go(); else pending = go;
    return true;
  }

  function pause() {
    if (st.state !== 'playing') return false;
    clearInterval(poll);
    player.pauseVideo();
    set({ state: 'paused' });
    return true;
  }

  function resume() {
    if (st.state !== 'paused') return false;
    set({ state: 'loading' });
    player.playVideo();
    armWatch();
    return true;
  }

  /** 끝 — 영상을 걷어낸다 (끝 시간 · 영상 끝 · 진행자 [영상 끝내기]) */
  function finish() {
    if (!ON_SCREEN.includes(st.state)) return false;
    stopTimers();
    pending = null;
    try { player?.pauseVideo?.(); } catch { /* 준비 전 */ }
    set({ state: 'done' });
    return true;
  }

  /** 정답 숨김(←) — 처음 상태로 */
  function reset() {
    stopTimers();
    pending = null;
    try { player?.pauseVideo?.(); } catch { /* 준비 전 */ }
    set({ state: 'idle', error: badVideo ?? (iframe ? null : st.error) });
  }

  /** 소리 켜기 — 이 창에서 클릭 · 키를 받은 뒤라야 브라우저가 허락한다 */
  function unmute() {
    if (!st.muted || !player) return;
    player.unMute();
    player.setVolume?.(100);
    set({ muted: false });
  }
  const onGesture = () => { if (st.muted && ON_SCREEN.includes(st.state)) unmute(); };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);

  return {
    prepare, play, pause, resume, finish, reset,
    status: () => ({ ...st }),
    /** 영상이 화면을 덮고 있다 — 정답 띠를 아직 띄우지 않는다 */
    covering: () => ON_SCREEN.includes(st.state),
    destroy() {
      destroyed = true;
      stopTimers();
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      try { player?.destroy?.(); } catch { /* 이미 없음 */ }
      layer.remove();
    },
  };
}
