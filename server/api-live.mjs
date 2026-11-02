// 진행자 · 실시간 API (docs/08-tech.md 4-4 · 11-6, docs/12-host-view.md 5 · 6장, docs/07-state-model.md 10 · 11장)
// 게임 화면 → (POST /api/live) → 서버 → (SSE /api/host/stream) → 진행자 화면
// 진행자 화면 → (POST /api/host/command) → 서버 → (SSE /api/live/commands) → 게임 화면
// 상태 파일 저장 → 서버 → (SSE /api/live/changes) → 관리 페이지 점수 입력 (R-55)
// 서버가 여럿이면(Redis 저장소 — R-50) 연결은 각 서버에 있고, 같이 볼 상태(진행 상태 · 연결된 창 · 막기)와 알림은 Redis 로 —
// 알림은 번호를 붙여 저장하고(다시 붙은 창에 놓친 것을 — 11-4) 구독(pub/sub)으로 바로 받는다. 구독을 못 하는 저장소면 0.2초마다 번호 확인 (08-tech 11-6)
import { randomBytes } from 'node:crypto';
import { validateGame, parseJsonText } from '../app/core/validate.js';
import { clipSpec } from '../app/core/youtube.js';
import { readText, clock } from './files.mjs';
import { text } from './redis.mjs';
import { HttpError, readJson, sendJson, sendEmpty, LIMITS } from './guard.mjs';
import { parseBeacon, beaconLine } from './beacon.mjs';

/** 진행자 화면이 보낼 수 있는 명령 (docs/12-host-view.md 6-2) */
export const COMMANDS = new Set([
  'roulette.toggle', 'roulette.all', 'roulette.spin', 'roulette.confirm', 'roulette.respin',
  'round.start', 'answer.credit', 'question.reveal', 'question.next', 'question.stage', 'question.hint', 'clip.play', 'clip.pause', 'clip.skip', 'question.setNext', 'question.more', 'round.more', 'round.back', 'round.reflect', 'history.credit',
  'game.end', // score.undo(되돌리기)는 R-83 에서 없앰
  'result.next', 'result.tiebreak', 'result.fill', 'result.fillSkip', 'result.fillOpen',
  'topic.pick', 'topic.next', 'topic.examples', 'topic.question', 'topic.answers',
  'question.pick', // 이모티콘 퀴즈 — 진행자가 고른 문제 (R-90)
]);

const PING_MS = 15_000; // SSE 신호 · 연결 표시 갱신
const PRESENCE_MS = 45_000; // 신호가 세 번 안 오면 끊긴 것으로
const POLL_MS = 200; // 구독을 못 하는 저장소일 때 알림 확인 간격 — 진행자 버튼 → 게임 화면 300ms 이내 (08-tech 10장)
const EVENT_TTL_S = 60;
// 다시 붙은 게임 화면에 끊긴 사이의 알림을 다시 보낸다 (11-4) — 이보다 오래된 것은 버린다
const REPLAY_MS = 15_000;
// 서버가 여럿이면 알림 번호와 도착 순서가 조금 다를 수 있어 명령은 앞쪽도 조금 더 본다 (게임 화면이 명령 id 로 한 번만 실행)
const REPLAY_BACK = 20;

/** 같이 볼 상태 · 알림 — 서버 하나(메모리) */
function memoryShared() {
  let live = null; // 게임 화면이 마지막으로 보낸 상태
  let active = null; // 명령을 받을 게임 화면
  let lock = false; // 다른 창 열기 막기 (R-46) — 서버 메모리에만
  const games = new Map(); // clientId → 연결 id
  const hosts = new Map(); // 진행자 화면 id → 연결 id
  let seq = 0;
  const recent = []; // 최근 알림 — 다시 붙은 게임 화면에 (REPLAY_MS)
  let handler = () => {};
  return {
    getLive: async () => live,
    setLive: async (v) => { live = v; },
    getActive: async () => active,
    setActive: async (v) => { active = v; },
    getLock: async () => lock,
    setLock: async (on) => { lock = on; },
    addGame: async (id, conn) => { games.delete(id); games.set(id, conn); },
    touchGame: async () => {},
    removeGame: async (id, conn) => { if (conn === undefined || games.get(id) === conn) games.delete(id); },
    listGames: async () => [...games.keys()],
    addHost: async (id, conn) => { hosts.set(id, conn); },
    touchHost: async () => {},
    removeHost: async (id, conn) => { if (conn === undefined || hosts.get(id) === conn) hosts.delete(id); },
    countHosts: async () => hosts.size,
    async publish(ev) {
      const e = { ...ev, n: ++seq, t: Date.now() };
      recent.push(e);
      while (recent.length > 500 || e.t - recent[0].t > REPLAY_MS) recent.shift();
      handler(e);
    },
    /** 지금 알림 번호 · n 다음 알림들 */
    seq: async () => seq,
    since: async (n) => recent.filter((e) => e.n > n),
    onEvent(fn) { handler = fn; },
    start: async () => {},
    stop() {},
  };
}

/** 같이 볼 상태 · 알림 — Redis (서버 여럿, R-50). 키는 접두어 아래 live:* */
function redisShared(redis, prefix, log) {
  const K = (k) => `${prefix}live:${k}`;
  const origin = randomBytes(4).toString('hex'); // 이 서버 — 자기 알림은 바로 처리했으므로 받을 때 건너뜀
  const channel = K('ch');
  let handler = () => {};
  let timer = null; // 번호 확인(폴링) — 구독을 못 하는 저장소일 때만
  let sub = null; // 알림 받기 연결 (pub/sub — R-51 · DEP-16)
  let mode = 'sub'; // 'sub' | 'poll'
  let starting = null;
  let lastSeq = null; // 이 서버가 본 마지막 알림 번호
  let busy = false;
  let missingSince = 0;

  const json = (v) => { try { return v ? JSON.parse(text(v)) : null; } catch { return null; } };

  /** 연결 표시 HASH — 만료된 것은 지우고 연결 순서대로 */
  async function present(hash) {
    const flat = (await redis.call('HGETALL', K(hash))) ?? [];
    const now = Date.now();
    const out = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const id = text(flat[i]);
      const v = json(flat[i + 1]);
      if (v && v.e > now) out.push({ id, ...v });
      else await redis.call('HDEL', K(hash), id).catch(() => {});
    }
    return out.sort((a, b) => a.s - b.s);
  }

  const mark = (hash, id, conn, since) => redis.call('HSET', K(hash), id, JSON.stringify({ c: conn, s: since, e: Date.now() + PRESENCE_MS }));
  async function unmark(hash, id, conn) {
    if (conn !== undefined && json(await redis.call('HGET', K(hash), id))?.c !== conn) return; // 같은 창이 그 사이 다른 서버로 다시 붙음
    await redis.call('HDEL', K(hash), id);
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const seq = Number(text(await redis.call('GET', K('seq'))) ?? 0);
      if (lastSeq === null || seq < lastSeq) { lastSeq = seq; return; }
      while (lastSeq < seq) {
        const ids = [];
        for (let n = lastSeq + 1; n <= Math.min(seq, lastSeq + 50); n++) ids.push(K(`ev:${n}`));
        for (const v of await redis.call('MGET', ...ids)) {
          if (!v) {
            // 번호는 받았는데 아직 안 쓰인 알림 — 잠깐 기다렸다가, 계속 없으면 건너뜀
            if (!missingSince) missingSince = Date.now();
            if (Date.now() - missingSince < 2000) return;
          }
          missingSince = 0;
          lastSeq++;
          const ev = json(v);
          if (ev && ev.o !== origin) handler({ ...ev, n: lastSeq });
        }
      }
    } catch (err) {
      log(`⚠ 실시간 알림 확인 실패: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  const currentSeq = async () => Number(text(await redis.call('GET', K('seq'))) ?? 0);

  /** n 다음 알림들 — 최근 200개까지 (지난 것은 60초 뒤 사라진다) */
  async function since(n) {
    const seq = await currentSeq();
    const from = Math.max(n + 1, seq - 199);
    if (from > seq) return [];
    const ids = [];
    for (let i = from; i <= seq; i++) ids.push(K(`ev:${i}`));
    const out = [];
    (await redis.call('MGET', ...ids)).forEach((v, i) => { const ev = json(v); if (ev) out.push({ ...ev, n: from + i }); });
    return out;
  }

  /** 구독으로 받은 알림 — 다른 서버가 보낸 것만 (같은 번호를 두 번 받아도 창마다 한 번만 보낸다 — toGame) */
  function receive(raw) {
    const ev = json(raw);
    if (!ev || !Number.isInteger(ev.n)) return;
    if (lastSeq === null || ev.n > lastSeq) lastSeq = ev.n;
    if (ev.o !== origin) handler(ev);
  }

  /** 구독을 시작했거나 다시 붙었을 때 — 그 사이의 알림을 저장된 번호로 채운다 (pub/sub 은 기록이 없다) */
  async function catchUp() {
    if (lastSeq === null) return;
    for (const ev of await since(lastSeq)) {
      if (ev.n > lastSeq) lastSeq = ev.n;
      if (ev.o !== origin) handler(ev);
    }
  }

  function startPolling() {
    if (timer) return;
    timer = setInterval(tick, POLL_MS);
    timer.unref?.();
  }

  return {
    getLive: async () => json(await redis.call('GET', K('state'))),
    setLive: (v) => (v ? redis.call('SET', K('state'), JSON.stringify(v)) : redis.call('DEL', K('state'))),
    getActive: async () => text(await redis.call('GET', K('active'))),
    setActive: (v) => (v ? redis.call('SET', K('active'), v) : redis.call('DEL', K('active'))),
    getLock: async () => text(await redis.call('GET', K('lock'))) === '1',
    setLock: (on) => redis.call('SET', K('lock'), on ? '1' : '0'),
    addGame: (id, conn, since) => mark('games', id, conn, since),
    touchGame: (id, conn, since) => mark('games', id, conn, since),
    removeGame: (id, conn) => unmark('games', id, conn),
    listGames: async () => (await present('games')).map((v) => v.id),
    addHost: (id, conn, since) => mark('hosts', id, conn, since),
    touchHost: (id, conn, since) => mark('hosts', id, conn, since),
    removeHost: (id, conn) => unmark('hosts', id, conn),
    countHosts: async () => (await present('hosts')).length,
    /** 알림 — 번호를 붙여 저장(다시 붙은 창 · 구독이 끊긴 서버가 채울 수 있게)하고 구독한 서버들에 바로 보낸다 */
    async publish(ev) {
      const t = Date.now();
      const n = Number(await redis.call('INCR', K('seq')));
      const body = JSON.stringify({ ...ev, o: origin, t, n });
      await redis.call('SET', K(`ev:${n}`), body, 'EX', String(EVENT_TTL_S));
      if (mode === 'sub') await redis.call('PUBLISH', channel, body);
      handler({ ...ev, n, t });
    },
    seq: currentSeq,
    since,
    onEvent(fn) { handler = fn; },
    /** 이 서버에 SSE 연결이 있는 동안만 받는다 — 구독(pub/sub), 못 하면 0.2초마다 번호 확인 */
    start() {
      starting ??= (async () => {
        if (timer || sub) return;
        if (lastSeq === null) lastSeq = await currentSeq();
        if (mode === 'poll') { startPolling(); return; }
        sub = redis.subscribe(channel, {
          onMessage: receive,
          onReady: () => { catchUp().catch((err) => log(`⚠ 실시간 알림 채우기 실패: ${err.message}`)); },
          onUnsupported: (why) => {
            log(`실시간 알림 — 구독(pub/sub)을 쓸 수 없어 ${POLL_MS / 1000}초마다 확인합니다 (${why})`);
            mode = 'poll';
            sub = null;
            startPolling();
          },
        });
      })().finally(() => { starting = null; });
      return starting;
    },
    stop() {
      clearInterval(timer);
      timer = null;
      sub?.close();
      sub = null;
      lastSeq = null;
    },
  };
}

export function createLive(ctx) {
  const shared = ctx.redis ? redisShared(ctx.redis, ctx.prefix, ctx.log) : memoryShared();
  const hostClients = new Map(); // 이 서버의 진행자 화면 SSE — 탭 id → { res, conn, planned }
  const gameClients = new Map(); // 이 서버의 게임 화면 명령 SSE — clientId → { res, conn, since, sent(보낸 알림 번호), planned }
  const watchClients = new Set(); // 이 서버의 상태 파일 변경 알림 SSE — 관리 페이지 점수 입력 (R-55). 연결 표시는 없다
  const gameCache = new Map(); // id → { mtime, size, game }

  /** 이 창을 뺀 연결된 게임 화면 수 (12-host-view 6-3) — 모든 서버 */
  const othersOf = async (clientId) => (await shared.listGames()).filter((id) => id !== clientId).length;

  async function loadGame(id) {
    if (!id || !/^[a-z0-9-]+$/.test(id)) return null;
    const rel = `data/games/${id}.json`;
    const info = await ctx.store.stat(rel);
    if (!info || info.dir) return null;
    const hit = gameCache.get(id);
    if (hit && hit.mtime === info.mtimeMs && hit.size === info.size) return hit.game;
    const t = await readText(ctx.store, rel);
    const parsed = t === null ? { error: true } : parseJsonText(t, id);
    const game = parsed.error ? null : validateGame(parsed.value, { fileId: id }).game;
    gameCache.set(id, { mtime: info.mtimeMs, size: info.size, game });
    return game;
  }

  /** id — 알림 번호. 브라우저가 다시 붙을 때 Last-Event-ID 로 돌려준다 (11-4) */
  function sse(res, event, data, id) {
    res.write(`${id != null ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function findQuestion(game, qid) {
    for (const c of game.categories) {
      const q = c.questions?.find((x) => x.id === qid);
      if (q) return { q, c };
    }
    return null;
  }

  /** 게임 화면 상태 + 데이터 파일의 정답 · 메모 · 힌트 → 진행자용 상태. 게임 전체 정답은 주지 않는다 */
  async function hostState() {
    const connected = (await shared.listGames()).length > 0;
    const live = await shared.getLive();
    if (!live) return { v: 1, connected, live: false };
    const game = await loadGame(live.gameId);
    const out = { v: 1, connected, live: true, ...live };
    delete out.clientId;
    if (!game) return out;
    out.game = { id: game.id, title: game.title, icon: game.icon, type: game.type };
    const cat = (id) => {
      const c = game.categories.find((x) => x.id === id);
      return c ? { id, name: c.name, icon: c.icon } : { id, name: id, icon: '❓' };
    };
    if (Array.isArray(live.wheelList)) out.wheelList = live.wheelList.map((i) => ({ ...i, ...cat(i.id) }));
    if (live.spinResult) out.spinResult = cat(live.spinResult);
    if (Array.isArray(live.picks)) out.picks = live.picks.map((p) => ({ ...cat(p.categoryId), questionCount: p.questionIds?.length ?? null }));
    delete out.roundQuestionIds;
    // 현재 문제
    if (live.questionId) {
      const tb = live.questionId.startsWith('tb:');
      const id = tb ? live.questionId.slice(3) : live.questionId;
      const f = findQuestion(game, id);
      if (f) {
        out.question = {
          id, tb, answer: f.q.answer, note: f.q.note ?? null, hint: f.q.hint ?? null,
          prompt: f.q.prompt ?? f.c.prompt ?? null, category: cat(f.c.id),
          effect: f.q.effect ?? null, steps: f.q.steps ?? null, masks: f.q.masks?.length ?? null,
          emojis: f.q.emojis ?? null, image: f.q.image ?? null, answerImage: f.q.answerImage ?? null,
          hideAnswerText: !!f.q.hideAnswerText,
          // 정답 영상 구간 (R-61) — 사진 문제만
          clip: game.type === 'photo' ? clipSpec(f.q) : null,
        };
      }
    }
    // 이번 라운드 목록 (라운드 소개 · 문제 · 정답 화면만 — 다음 라운드 정보는 주지 않음)
    if (['round', 'question', 'answer'].includes(live.screen) && Array.isArray(live.roundQuestionIds)) {
      out.roundList = live.roundQuestionIds.map((qid, i) => {
        const f = findQuestion(game, qid);
        return { id: qid, n: i + 1, answer: f?.q.answer ?? '(없는 문제)', scoredTeam: live.roundScored?.[i] ?? null, current: i === live.questionIndex };
      });
      // 라운드에 안 뽑힌 후보 (R-52) — 이번 라운드 카테고리의 아직 안 낸 문제만 (게임 전체 정답은 주지 않는다 — 12-host-view 5-1)
      if (Array.isArray(live.roundCandidateIds)) {
        out.roundCandidates = live.roundCandidateIds.map((qid) => ({ id: qid, answer: findQuestion(game, qid)?.q.answer ?? '(없는 문제)' }));
      }
    }
    delete out.roundCandidateIds;
    // 이모티콘 퀴즈 문제 고르기 (R-90) — 진행자가 문제를 골라 내므로 이 게임에서 아직 안 낸 문제의 이모지 · 정답 (12-host-view 5-1)
    delete out.pickChoices;
    if (Array.isArray(live.pickChoices) && ['roulette', 'question', 'answer'].includes(live.screen)) {
      out.pickChoices = live.pickChoices.map((c) => ({
        ...cat(c.categoryId),
        questions: (Array.isArray(c.questionIds) ? c.questionIds : []).map((qid) => {
          const f = findQuestion(game, qid);
          return { id: qid, emojis: f?.q.emojis ?? null, image: !!f?.q.image, answer: f?.q.answer ?? '(없는 문제)' };
        }),
      }));
    }
    // 정답 기록 고치기 (R-60) — 이 게임에서 이미 낸 문제의 정답만 (공개 전 지금 문제 · 안 낸 문제는 없음 — 12-host-view 5-1)
    delete out.creditLog;
    if (live.creditLog && typeof live.creditLog === 'object') {
      const ans = (q) => (q.live ? null : findQuestion(game, q.id)?.q.answer ?? '(없는 문제)');
      const list = (v) => (Array.isArray(v) ? v : []);
      out.record = {
        reps: live.creditLog.reps ?? null, // 팀당 대표 방식 — 맞힌 대표까지 고친다 (R-94)
        rounds: list(live.creditLog.rounds).map((r) => ({ ...cat(r.categoryId), index: r.index, counts: list(r.counts), questions: list(r.questions).map((q) => ({ ...q, answer: ans(q) })) })),
        tiebreak: list(live.creditLog.tiebreak).map((q) => ({ ...q, answer: ans(q) })),
      };
    }
    // 추가 문제 고르기 (R-54) — 결과 화면 동점일 때 이 게임에 포함된 카테고리의 남은 문제 (게임 진행이 끝난 뒤 — 12-host-view 5-1)
    if (live.result && typeof live.result === 'object') {
      const choices = Array.isArray(live.result.tiebreakChoices) ? live.result.tiebreakChoices : [];
      out.result = {
        ...live.result,
        tiebreakChoices: choices.map((c) => ({
          ...cat(c.categoryId),
          questions: (Array.isArray(c.questionIds) ? c.questionIds : []).map((qid) => ({ id: qid, answer: findQuestion(game, qid)?.q.answer ?? '(없는 문제)' })),
        })),
      };
    }
    // 룰렛형 주제 카드 · 문제 (R-44) — 정답 후보는 지금 문제 것만, 이 추첨에서 낸 문제는 글자만
    delete out.topicQuestionIds;
    delete out.topicQuestionId;
    delete out.topicList;
    delete out.topicNextId;
    if (live.topicId) {
      const c = game.categories.find((x) => x.id === live.topicId);
      if (c) {
        const ids = Array.isArray(live.topicQuestionIds) ? live.topicQuestionIds : [];
        const qOf = (qid) => c.questions?.find((x) => x.id === qid) ?? null;
        out.topic = {
          id: c.id, name: c.name, icon: c.icon, rule: c.rule, examples: c.examples ?? [],
          questionCount: (c.questions ?? []).filter((q) => !q.disabled).length,
          remaining: typeof live.topicRemaining === 'number' ? live.topicRemaining : null,
          asked: ids.map((qid) => qOf(qid)?.prompt ?? '(없는 문제)'),
          // 진행자가 골라 내는 목록 (R-45) — 문제 글자만, 정답 후보는 지금 문제 것만 (5-1 데이터 최소화)
          list: (Array.isArray(live.topicList) ? live.topicList : []).map((it, i) => ({
            id: it.id, n: i + 1, prompt: qOf(it.id)?.prompt ?? '(없는 문제)', state: it.state, next: it.id === live.topicNextId,
          })),
          order: live.questionOrder === 'fixed' ? 'fixed' : 'random',
          question: null,
        };
        const q = live.topicQuestionId ? qOf(live.topicQuestionId) : null;
        if (q) out.topic.question = { id: q.id, no: ids.indexOf(q.id) + 1, prompt: q.prompt, answers: q.answers ?? [], note: q.note ?? null };
      }
    }
    return out;
  }

  /** 진행자 화면들에 지금 상태 — 모든 서버의 진행자 화면 (없으면 계산하지 않음) */
  async function pushHosts() {
    if (!(await shared.countHosts())) return;
    await shared.publish({ type: 'hoststate', state: await hostState() });
  }

  /** 진행자 화면이 몇 개 연결돼 있는지 게임 화면에 — 없으면 점수판 채우기 창을 게임 화면에 띄운다 */
  async function pushHostCount() {
    await shared.publish({ type: 'hosts', count: await shared.countHosts() });
  }


  /** 알림 하나를 이 서버의 게임 화면 하나에 — 번호(SSE id)를 붙이고, 이 연결에 이미 보낸 번호는 건너뛴다 */
  function toGame(clientId, g, ev) {
    if (g.sent.has(ev.n)) return;
    g.sent.add(ev.n);
    if (g.sent.size > 300) g.sent.delete(g.sent.values().next().value);
    switch (ev.type) {
      case 'command':
        if (ev.target !== clientId) return;
        sse(g.res, 'command', ev.command, ev.n);
        // 진행자 화면과 게임 화면이 다른 서버에 붙었을 때 — 이 서버가 대신 전달했다는 기록 (11-6)
        if (ev.o) ctx.log(`◀ ${clock()} ${ev.command.cmd} → 게임 화면 ${clientId.slice(0, 8)} (다른 서버에서 받은 명령)`);
        return;
      case 'kick':
        if (clientId === ev.except) return;
        if (gameClients.get(clientId) === g) gameClients.delete(clientId);
        sse(g.res, 'kick', {}, ev.n);
        g.res.end();
        return;
      case 'lock':
        sse(g.res, 'lock', { on: ev.on }, ev.n);
        return;
      case 'reload':
        sse(g.res, 'reload', ev.info, ev.n);
        return;
      case 'hosts':
        sse(g.res, 'hosts', { count: ev.count }, ev.n);
        return;
      default:
    }
  }

  /** 알림 받기 — 이 서버에 연결된 창에만 쓴다. 다른 서버에서 온 것(ev.o)은 폴링으로 들어온다 */
  shared.onEvent((ev) => {
    if (ev.type === 'hoststate') {
      for (const h of hostClients.values()) sse(h.res, 'state', ev.state);
      return;
    }
    if (ev.type === 'reload' && ev.info?.kind === 'state') for (const w of watchClients) sse(w.res, 'reload', ev.info);
    for (const [id, g] of [...gameClients]) toGame(id, g, ev);
  });

  function stopIfIdle() {
    if (!gameClients.size && !hostClients.size && !watchClients.size) shared.stop();
  }

  /**
   * SSE 시작 — 15초마다 신호 · 연결 표시 갱신. 실행 시간 상한이 있는 곳(Vercel)이면 그 전에 서버가 먼저 끊는다:
   * 'bye' 를 보내고 닫으면 브라우저가 곧바로 다시 붙고, 그동안 연결 표시는 그대로 둔다 (rec.planned — 11-4)
   */
  function openStream(req, res, touch, rec) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const ping = setInterval(() => {
      res.write(': ping\n\n');
      touch?.()?.catch?.(() => {});
    }, PING_MS);
    const limit = ctx.streamMaxMs ? setTimeout(() => {
      rec.planned = true;
      res.write('retry: 300\n\n');
      sse(res, 'bye', {});
      res.end();
    }, ctx.streamMaxMs) : null;
    res.on('close', () => { clearInterval(ping); clearTimeout(limit); });
  }

  /** 게임 화면이 떠남 — 연결 표시를 지우고, 명령 받을 창이었으면 다른 창으로 */
  async function leaveGame(clientId, conn) {
    await shared.removeGame(clientId, conn);
    const games = await shared.listGames();
    if (!games.includes(clientId) && (await shared.getActive()) === clientId) await shared.setActive(games[0] ?? null);
    await pushHosts();
  }

  async function leaveHost(id, conn) {
    await shared.removeHost(id, conn);
    await pushHostCount();
  }

  /** 서버가 먼저 끊은 연결 — 곧 다시 붙는다. 돌아오지 않으면 연결 표시를 지운다 (Redis 는 45초 뒤 만료로도) */
  function leaveLater(fn) {
    setTimeout(() => { fn().catch(() => {}).finally(stopIfIdle); }, PRESENCE_MS).unref?.();
  }

  /** 파일이 바뀌었다고 게임 화면들에 알림 (관리 페이지 저장 · 상태 초기화 · 다른 창의 상태 저장) — 모든 서버 */
  function broadcastReload(info) {
    shared.publish({ type: 'reload', info }).catch(() => {});
    if (info.kind === 'data') pushHosts().catch(() => {});
  }

  async function handle(req, res, pathname, url) {
    const auth = ctx.auth;

    if (pathname === '/api/live' && req.method === 'POST') {
      const body = await readJson(req, LIMITS.live);
      if (!body || typeof body !== 'object' || body.v !== 1) throw new HttpError(400, '상태 형식이 올바르지 않습니다');
      // 연결된 게임 화면이 아닌 곳(닫힌 창 · 막힌 창)의 보고는 받지 않는다 — 진행 중인 창을 덮어쓰지 못하게 (R-46)
      const games = await shared.listGames();
      if (games.length > 0 && !games.includes(body.clientId)) { sendEmpty(res); return true; }
      await shared.setLive(body);
      if (typeof body.clientId === 'string') await shared.setActive(body.clientId);
      sendEmpty(res);
      await pushHosts();
      return true;
    }

    // 화면에 "연결 끊김" 이 떴다 — 그때 잰 응답 시간과 함께 로그 한 줄 (R-66). 끊긴 동안 보낸 것은 연결되는 대로 온다
    if (pathname === '/api/live/beacon' && req.method === 'POST') {
      ctx.log(beaconLine(parseBeacon(await readJson(req, 2048)), auth.whereOf(req)));
      sendEmpty(res);
      return true;
    }

    if (pathname === '/api/live/peers' && req.method === 'GET') {
      const others = await othersOf(url.searchParams.get('clientId') ?? '');
      sendJson(res, 200, { others, locked: await shared.getLock() });
      return true;
    }

    if (pathname === '/api/live/takeover' && req.method === 'POST') {
      const body = await readJson(req, 1024);
      const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
      const others = (await shared.listGames()).filter((id) => id !== clientId);
      if ((await shared.getLock()) && others.length > 0) throw new HttpError(423, '다른 창 열기를 막아 두었습니다');
      for (const id of others) await shared.removeGame(id);
      await shared.publish({ type: 'kick', except: clientId });
      await shared.setActive(clientId || null);
      await shared.setLive(null); // 새 창이 상태를 보낼 때까지 진행자 화면은 "진행 중인 문제가 없습니다"
      ctx.log(`⇄ ${clock()} 게임 화면 바뀜 — 이전 창을 닫음 ${auth.whereOf(req)}`);
      sendEmpty(res, 204);
      await pushHosts();
      return true;
    }

    // 화면이 닫히거나 새로고침될 때 (pagehide) — 연결 표시를 바로 지운다. Vercel 은 브라우저가 닫은 연결을 함수에 알려 주지 않아
    // 닫힌 화면이 서버가 먼저 끊을 때까지 남는다 (R-51 · DEP-21, 08-tech 11-4)
    if (pathname === '/api/live/leave' && req.method === 'POST') {
      const body = await readJson(req, 1024);
      const id = (v) => (typeof v === 'string' && /^[a-z0-9-]{8,64}$/i.test(v) ? v : null);
      const clientId = id(body?.clientId);
      const hostId = id(body?.hostId);
      if (!clientId && !hostId) throw new HttpError(400, 'clientId 또는 hostId 가 필요합니다');
      if (clientId) {
        const g = gameClients.get(clientId);
        if (g) { gameClients.delete(clientId); g.left = true; g.res.end(); }
        await leaveGame(clientId);
        ctx.log(`📺 ${clock()} 게임 화면 닫힘 ${clientId.slice(0, 8)}`);
      }
      if (hostId) {
        const h = hostClients.get(hostId);
        if (h) { hostClients.delete(hostId); h.left = true; h.res.end(); }
        await leaveHost(hostId);
        ctx.log(`🎤 ${clock()} 진행자 화면 닫힘`);
      }
      stopIfIdle();
      sendEmpty(res, 204);
      return true;
    }

    if (pathname === '/api/live/lock' && req.method === 'POST') {
      const body = await readJson(req, 1024);
      const on = !!body?.on;
      await shared.setLock(on);
      await shared.publish({ type: 'lock', on });
      ctx.log(`${on ? '🔒 다른 창 열기 막음' : '🔓 다른 창 열기 허용'} ${auth.whereOf(req)}`);
      sendEmpty(res, 204);
      return true;
    }

    if (pathname === '/api/live/commands' && req.method === 'GET') {
      const clientId = url.searchParams.get('clientId') ?? '';
      if (!/^[a-z0-9-]{8,64}$/i.test(clientId)) throw new HttpError(400, 'clientId 가 필요합니다');
      // 다시 붙은 창 — 마지막으로 받은 알림 번호 (브라우저가 Last-Event-ID 로, 새로 연 연결은 ?last= 로)
      const lastRaw = req.headers['last-event-id'] ?? url.searchParams.get('last');
      const last = lastRaw == null || lastRaw === '' ? null : Number(lastRaw);
      const g = { res, conn: randomBytes(6).toString('hex'), since: Date.now(), sent: new Set(), planned: false };
      openStream(req, res, () => shared.touchGame(clientId, g.conn, g.since), g);
      if ((await shared.getLock()) && (await othersOf(clientId)) > 0) {
        // 다른 창 열기 막기 (R-46) — 붙이지 않는다
        sse(res, 'blocked', {});
        res.end();
        return true;
      }
      await shared.start();
      // 끊긴 사이의 알림 (11-4) — 명령 · 다시 읽기 · 닫기. 잠금 · 진행자 수는 아래에서 지금 값을 보낸다
      let missed = [];
      if (Number.isInteger(last) && last >= 0) {
        const now = Date.now();
        const back = ctx.redis ? REPLAY_BACK : 0; // 서버 하나면 번호 순서 = 보낸 순서
        missed = (await shared.since(Math.max(0, last - back))).filter((ev) => now - ev.t <= REPLAY_MS
          && (ev.type === 'command' || (ev.n > last && (ev.type === 'reload' || ev.type === 'kick'))));
      }
      if (missed.some((ev) => ev.type === 'kick' && ev.except !== clientId)) {
        // 끊긴 사이 다른 창이 넘겨받음 — 이 창은 닫는다
        sse(res, 'kick', {});
        res.end();
        return true;
      }
      gameClients.set(clientId, g);
      ctx.log(`📺 ${clock()} 게임 화면 연결 ${clientId.slice(0, 8)}${last != null ? ' (다시)' : ''} ${auth.whereOf(req)}`);
      await shared.addGame(clientId, g.conn, g.since);
      if (!(await shared.getActive())) await shared.setActive(clientId);
      // 지금 알림 번호를 붙여 둔다 — 아직 알림을 하나도 못 받은 창도 다시 붙을 때 그 뒤부터 받게
      sse(res, 'hello', { clientId }, await shared.seq());
      sse(res, 'hosts', { count: await shared.countHosts() });
      sse(res, 'lock', { on: await shared.getLock() });
      for (const ev of missed) toGame(clientId, g, ev);
      pushHosts().catch(() => {});
      res.on('close', () => {
        if (g.left) return; // 화면이 떠난다고 알려 이미 정리함 (leave)
        const mine = gameClients.get(clientId) === g;
        if (mine) gameClients.delete(clientId);
        if (g.planned) {
          // 서버가 먼저 끊음 — 곧 다시 붙으므로 연결 표시 · 명령 받을 창은 그대로
          leaveLater(() => leaveGame(clientId, g.conn));
          stopIfIdle();
          return;
        }
        if (mine) ctx.log(`📺 ${clock()} 게임 화면 끊김 ${clientId.slice(0, 8)}`);
        (mine ? leaveGame(clientId, g.conn) : pushHosts()).catch(() => {}).finally(stopIfIdle);
      });
      return true;
    }

    // 상태 파일이 바뀐 것만 알림 — 관리 페이지 점수 입력이 게임 창에서 바꾼 값을 따라간다 (R-55, 08-tech 4-4).
    // 3초마다 상태 전부를 다시 읽던 것(Upstash 시간당 약 9,600 명령)을 바뀔 때만으로. 진행자 수 · 게임 화면 수에는 세지 않는다
    if (pathname === '/api/live/changes' && req.method === 'GET') {
      const w = { res, planned: false };
      openStream(req, res, null, w);
      watchClients.add(w);
      res.on('close', () => { watchClients.delete(w); stopIfIdle(); });
      await shared.start();
      sse(res, 'hello', {});
      return true;
    }

    // /api/login — 서버 모드 게임 화면 입장 (같은 쿠키, docs/08-tech.md 11-2)
    if ((pathname === '/api/host/login' || pathname === '/api/login') && req.method === 'POST') {
      const body = await readJson(req, 1024);
      const token = await auth.login(body?.pin, req, pathname === '/api/login' ? '게임 화면' : '진행자 화면');
      sendEmpty(res, 204, { 'Set-Cookie': auth.hostCookie(token, req) });
      return true;
    }

    if (pathname === '/api/host/logout' && req.method === 'POST') {
      await auth.logout(req);
      sendEmpty(res, 204, { 'Set-Cookie': auth.clearCookie(req) });
      return true;
    }

    if (pathname === '/api/host/state' && req.method === 'GET') {
      await auth.requireHost(req);
      sendJson(res, 200, await hostState());
      return true;
    }

    if (pathname === '/api/host/stream' && req.method === 'GET') {
      await auth.requireHost(req);
      // 탭마다 같은 id — 다시 붙어도 진행자 수가 그대로 (11-4)
      const tab = url.searchParams.get('id') ?? '';
      const id = /^[a-z0-9-]{8,64}$/i.test(tab) ? tab : randomBytes(6).toString('hex');
      const since = Date.now();
      const h = { res, conn: randomBytes(6).toString('hex'), planned: false };
      openStream(req, res, () => shared.touchHost(id, h.conn, since), h);
      hostClients.set(id, h);
      ctx.log(`🎤 ${clock()} 진행자 화면 연결 ${auth.whereOf(req)}`);
      await shared.start();
      await shared.addHost(id, h.conn, since);
      await pushHostCount();
      sse(res, 'state', await hostState());
      res.on('close', () => {
        if (h.left) return; // 화면이 떠난다고 알려 이미 정리함 (leave)
        if (hostClients.get(id) === h) hostClients.delete(id);
        if (h.planned) {
          leaveLater(() => leaveHost(id, h.conn));
          stopIfIdle();
          return;
        }
        ctx.log(`🎤 ${clock()} 진행자 화면 끊김`);
        leaveHost(id, h.conn).catch(() => {}).finally(stopIfIdle);
      });
      return true;
    }

    if (pathname === '/api/host/command' && req.method === 'POST') {
      await auth.requireHost(req);
      const body = await readJson(req, 64 * 1024);
      if (!body || typeof body.cmd !== 'string' || !COMMANDS.has(body.cmd)) throw new HttpError(400, '모르는 명령입니다');
      const games = await shared.listGames();
      const active = await shared.getActive();
      const target = active && games.includes(active) ? active : games[0];
      if (!target) throw new HttpError(409, '게임 화면과 연결되지 않았습니다');
      const command = { id: String(body.id ?? ''), cmd: body.cmd, args: body.args ?? {}, basedOn: body.basedOn ?? null };
      await shared.publish({ type: 'command', target, command });
      ctx.log(`▶ ${clock()} ${body.cmd} ${auth.whereOf(req)}`);
      sendJson(res, 202, { ok: true });
      return true;
    }

    return false;
  }

  function closeAll() {
    shared.stop();
    for (const h of hostClients.values()) h.res.end();
    for (const g of gameClients.values()) g.res.end();
    for (const w of watchClients) w.res.end();
  }

  return { handle, broadcastReload, invalidateGame: (id) => gameCache.delete(id), closeAll };
}
