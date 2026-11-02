// PIN · 입장 토큰 · 관리 PIN 헤더 · 실패 잠금 (docs/12-host-view.md 5장, docs/04-admin.md 2-1)
// 서버 모드(secret 이 있을 때 — docs/08-tech.md 11-2): 서명 쿠키(서버가 다시 떠도 유지) · 접속한 곳(IP)별 잠금
// 실패 잠금 · [나가기] 한 쿠키는 메모리, Redis 저장소면 Redis 에 — 서버가 여럿이어도 같이 센다 (R-50, 11-6)
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { cookies, HttpError } from './guard.mjs';

export const HOST_COOKIE = 'camp_host';
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const SIGNED_TTL_S = 7 * 24 * 3600; // 서버 모드 쿠키 7일
const MAX_CLIENTS = 1000; // 실패 기록을 둘 접속한 곳 수 (넘으면 잠기지 않은 곳부터 지움)
// 서버 모드 전체 상한 — X-Forwarded-For 를 꾸며 곳마다 5회씩 시도하는 것을 막는다 (인그레스를 거치지 않는 경로 대비 — 08-tech 11-2)
const GLOBAL_WINDOW_MS = 10 * 60_000;
const GLOBAL_MAX_FAILS = 100;
const GLOBAL_LOCK_MS = 5 * 60_000;

export function newPin() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 실패 기록 · 나가기 기록 — 서버 하나(메모리) */
function memoryState(now) {
  const clients = new Map(); // 실패 잠금 — 노트북 모드는 'local' 하나 (모두 127.0.0.1), 서버 모드는 접속한 곳별
  let global = { fails: [], lockedUntil: 0 }; // 서버 모드 — 최근 실패 시각
  const revoked = new Set(); // 서버 모드에서 [나가기] 한 토큰 id (이 서버가 켜져 있는 동안)
  return {
    async getClient(id) {
      let c = clients.get(id);
      if (!c) {
        if (clients.size >= MAX_CLIENTS) for (const [k, v] of clients) if (v.lockedUntil <= now()) clients.delete(k);
        c = { fails: 0, lockedUntil: 0, wrongSeen: [] };
        clients.set(id, c);
      }
      return c;
    },
    async setClient(id, c) { clients.set(id, c); },
    async deleteClient(id) { clients.delete(id); },
    async getGlobal() { return global; },
    async setGlobal(g) { global = g; },
    async revoke(id) { revoked.add(id); },
    async isRevoked(id) { return revoked.has(id); },
  };
}

/** 실패 기록 · 나가기 기록 — Redis (서버 여러 개, R-50). 키는 접두어 아래 auth:* 에 만료와 함께 */
function redisState(redis, prefix) {
  const key = (k) => `${prefix}auth:${k}`;
  const getJson = async (k, fallback) => {
    const v = await redis.call('GET', key(k));
    try { return v ? JSON.parse(v.toString('utf8')) : fallback; } catch { return fallback; }
  };
  return {
    getClient: (id) => getJson(`f:${id}`, { fails: 0, lockedUntil: 0, wrongSeen: [] }),
    setClient: (id, c) => redis.call('SET', key(`f:${id}`), JSON.stringify(c), 'EX', String(Math.ceil((LOCK_MS + GLOBAL_WINDOW_MS) / 1000))),
    deleteClient: (id) => redis.call('DEL', key(`f:${id}`)),
    getGlobal: () => getJson('g', { fails: [], lockedUntil: 0 }),
    setGlobal: (g) => redis.call('SET', key('g'), JSON.stringify(g), 'EX', String(Math.ceil((GLOBAL_WINDOW_MS + GLOBAL_LOCK_MS) / 1000))),
    revoke: (id, untilMs) => redis.call('SET', key(`r:${id}`), '1', 'EX', String(Math.max(1, Math.ceil((untilMs - Date.now()) / 1000)))),
    isRevoked: async (id) => (await redis.call('EXISTS', key(`r:${id}`))) > 0,
  };
}

/**
 * @param secret 서버 모드의 서명 키 (저장소의 `.camp-secret`). 없으면 노트북 모드 — 메모리 토큰, 서버를 다시 켜면 무효
 * @param redis Redis 저장소일 때 (R-50) — 실패 잠금 · 나가기 기록을 서버끼리 같이 쓴다
 */
export function createAuth({ pin, log = () => {}, now = () => Date.now(), secret = null, redis = null, prefix = '' }) {
  const serverMode = !!secret;
  // PIN 을 키에 섞어 PIN 을 바꾸면 모든 쿠키가 무효가 되게 한다
  const key = serverMode ? createHmac('sha256', secret).update(`camp-host:${pin}`).digest() : null;
  const tokens = new Set(); // 노트북 모드 토큰
  const state = redis ? redisState(redis, prefix) : memoryState(now);

  const same = (a, b) => {
    const x = Buffer.from(String(a ?? ''));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
  };

  /** 접속한 곳 — 서버 모드는 인그레스가 붙인 X-Forwarded-For 의 마지막 주소 (앞쪽은 접속한 쪽이 꾸밀 수 있다) */
  function whereOf(req) {
    const socketAddr = req?.socket?.remoteAddress ?? '';
    if (!serverMode) return socketAddr;
    const forwarded = String(req?.headers?.['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return forwarded.at(-1) ?? socketAddr;
  }

  /** @returns {Promise<'ok'|'wrong'|'locked'>} */
  async function attempt(candidate, who, req) {
    const where = whereOf(req);
    const id = serverMode ? where : 'local';
    const c = await state.getClient(id);
    const g = serverMode ? await state.getGlobal() : { fails: [], lockedUntil: 0 };
    if (now() < c.lockedUntil || now() < g.lockedUntil) return 'locked';
    if (same(candidate, pin)) {
      await state.deleteClient(id);
      return 'ok';
    }
    // 같은 틀린 PIN 이 여러 요청에 반복되면 1회로 센다 — 틀린 값은 해시로만 둔다 (Redis 에 PIN 후보를 남기지 않게)
    const k = createHash('sha256').update(String(candidate ?? '')).digest('hex').slice(0, 16);
    if (!c.wrongSeen.includes(k)) {
      c.wrongSeen.push(k);
      c.fails += 1;
      log(`✕ ${who} PIN 실패 (${c.fails}/${MAX_FAILS}) ${where}`);
      if (serverMode) {
        const t = now();
        g.fails = g.fails.filter((x) => x > t - GLOBAL_WINDOW_MS);
        g.fails.push(t);
        if (g.fails.length >= GLOBAL_MAX_FAILS) {
          g.lockedUntil = t + GLOBAL_LOCK_MS;
          g.fails = [];
          await state.setGlobal(g);
          await state.setClient(id, c);
          log(`⏸ PIN 실패가 10분에 ${GLOBAL_MAX_FAILS}회 — 모든 곳 5분 잠금`);
          return 'locked';
        }
        await state.setGlobal(g);
      }
    }
    if (c.fails >= MAX_FAILS) {
      c.lockedUntil = now() + LOCK_MS;
      c.fails = 0;
      c.wrongSeen = [];
      await state.setClient(id, c);
      log(`⏸ PIN ${MAX_FAILS}회 실패 — 60초 잠금${serverMode ? ` ${where}` : ''}`);
      return 'locked';
    }
    await state.setClient(id, c);
    return 'wrong';
  }

  const sign = (body) => createHmac('sha256', key).update(body).digest('base64url');

  /** 토큰 만들기 — 서버 모드: `<만료 시각 36진수>.<id>.<서명>` */
  function issue() {
    if (!serverMode) {
      const token = randomBytes(32).toString('hex');
      tokens.add(token);
      return token;
    }
    const body = `${(now() + SIGNED_TTL_S * 1000).toString(36)}.${randomBytes(16).toString('hex')}`;
    return `${body}.${sign(body)}`;
  }

  /** 서명 · 만료만 본 토큰 — { id, until } 또는 null */
  function parseSigned(token) {
    const m = /^([0-9a-z]{1,12})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
    if (!m || !same(m[3], sign(`${m[1]}.${m[2]}`))) return null;
    const until = parseInt(m[1], 36);
    return until > now() ? { id: m[2], until } : null;
  }

  async function valid(token) {
    if (!token) return false;
    if (!serverMode) return tokens.has(token);
    const t = parseSigned(token);
    return !!t && !(await state.isRevoked(t.id));
  }

  /** 쿠키 — https 로 들어온 요청이면 Secure. 서버 모드는 7일 유지 (휴대폰 브라우저를 닫아도) */
  function cookie(value, req, maxAge) {
    const parts = [`${HOST_COOKIE}=${value}`, 'HttpOnly', 'SameSite=Strict', 'Path=/'];
    if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
    if (serverMode && String(req?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https') parts.push('Secure');
    return parts.join('; ');
  }

  return {
    pin,
    serverMode,
    whereOf,
    /** PIN 입장 → 토큰 (쿠키로 준다) */
    async login(candidate, req, who = '진행자 화면') {
      const r = await attempt(candidate, who, req);
      if (r === 'locked') throw new HttpError(429, '잠시 후 다시 시도하세요');
      if (r === 'wrong') throw new HttpError(401, 'PIN 이 맞지 않습니다');
      log(`✔ ${who} 입장 ${whereOf(req)}`);
      return issue();
    },
    /** 관리 PIN 확인이 끝난 요청에 쿠키용 토큰 (서버 모드 — 관리 페이지도 이미지 · 데이터를 읽어야 한다) */
    issue,
    async logout(req) {
      const t = cookies(req)[HOST_COOKIE];
      if (!t) return;
      tokens.delete(t);
      const signed = serverMode ? parseSigned(t) : null;
      if (signed) await state.revoke(signed.id, signed.until);
    },
    async isHost(req) {
      return valid(cookies(req)[HOST_COOKIE]);
    },
    async requireHost(req) {
      if (!(await this.isHost(req))) throw new HttpError(401, '진행자 화면에 다시 입장하세요');
    },
    /** 서버 모드에서 데이터 · 이미지 · 상태 · 실시간 API (노트북 모드는 그대로 통과) */
    async requireLogin(req) {
      if (serverMode && !(await this.isHost(req))) throw new HttpError(401, 'PIN 을 입력하세요');
    },
    /** 관리 API — 요청마다 X-Admin-Pin 헤더를 지금 PIN 과 비교 (R-31) */
    async requireAdmin(req) {
      const r = await attempt(req.headers['x-admin-pin'], '관리 페이지', req);
      if (r === 'locked') throw new HttpError(429, '잠시 후 다시 시도하세요');
      if (r === 'wrong') throw new HttpError(401, 'PIN 이 맞지 않습니다');
    },
    hostCookie(token, req) {
      return cookie(token, req, serverMode ? SIGNED_TTL_S : undefined);
    },
    clearCookie(req) {
      return cookie('', req, 0);
    },
  };
}
