// Redis 프로토콜(RESP2) 클라이언트 — Node 내장 모듈만 (docs/08-tech.md 11-6, R-50 · R-51)
// 기본 명령만 쓰고(ALLOWED), 오래 쉰 연결은 저장소 · 중간 장비가 끊을 수 있어 20초 넘게 쉬면 새로 열고,
// 연결이 끊기면 다시 붙어 재시도한다. Upstash · 일반 Redis 모두 같은 코드로
import net from 'node:net';
import tls from 'node:tls';

/**
 * 이 앱이 쓰는 명령 — 문자열 · HASH · 카운터 · 알림 보내기(PUBLISH)만 (Set · Lua · MULTI · KEYS/SCAN 은 쓰지 않는다).
 * 알림 받기(SUBSCRIBE)는 createSubscriber 의 따로 연 연결에서만. 다른 명령을 쓰면 바로 오류 — 늘릴 때는 08-tech 11-6 도 같이 고친다
 */
export const ALLOWED = new Set(['PING', 'AUTH', 'GET', 'GETRANGE', 'SET', 'DEL', 'EXISTS', 'MGET', 'INCR', 'HSET', 'HGET', 'HDEL', 'HGETALL', 'PUBLISH']);

const IDLE_MS = 20_000; // 쉰 연결은 20초 넘으면 새로
const TIMEOUT_MS = 5_000;
const RETRIES = 5;

/** 서버가 돌려준 오류 (`-ERR …`) — 재시도하지 않는다 */
export class RedisError extends Error {}

/** 연결 문제 — 다시 붙어 재시도한다 */
class ConnectionError extends Error {}

function encode(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}

/** RESP 한 덩어리 읽기 — 모자라면 undefined. 묶음 문자열은 Buffer 로 */
function parse(buf, at) {
  if (at >= buf.length) return undefined;
  const end = buf.indexOf('\r\n', at);
  if (end < 0) return undefined;
  const type = buf[at];
  const line = buf.toString('utf8', at + 1, end);
  const next = end + 2;
  switch (type) {
    case 0x2b: return { value: line, at: next }; // +
    case 0x2d: return { value: new RedisError(line), at: next }; // -
    case 0x3a: return { value: Number(line), at: next }; // :
    case 0x24: { // $
      const len = Number(line);
      if (len < 0) return { value: null, at: next };
      if (buf.length < next + len + 2) return undefined;
      return { value: buf.subarray(next, next + len), at: next + len + 2 };
    }
    case 0x2a: { // *
      const n = Number(line);
      if (n < 0) return { value: null, at: next };
      const out = [];
      let p = next;
      for (let i = 0; i < n; i++) {
        const r = parse(buf, p);
        if (!r) return undefined;
        out.push(r.value);
        p = r.at;
      }
      return { value: out, at: p };
    }
    default: throw new ConnectionError(`알 수 없는 응답 형식 (${String.fromCharCode(type)})`);
  }
}

/** `redis://[사용자][:비밀번호]@호스트:포트` · `rediss://` (TLS). 비밀번호는 따로 줄 수도 있다 */
export function parseRedisUrl(url) {
  let u;
  try { u = new URL(url); } catch { u = null; }
  if (!u || !/^rediss?:$/.test(u.protocol) || !u.hostname) throw new Error('CAMP_REDIS_URL 은 redis://호스트:포트 형식이어야 합니다');
  return {
    tls: u.protocol === 'rediss:',
    host: u.hostname,
    port: Number(u.port || 6379),
    username: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
  };
}

/**
 * @param url `redis://…` (CAMP_REDIS_URL)
 * @param password 따로 줄 때 (CAMP_REDIS_PASSWORD — URL 의 것보다 우선)
 */
export function createRedis({ url, password, log = () => {}, timeoutMs = TIMEOUT_MS, retries = RETRIES }) {
  const conf = parseRedisUrl(url);
  const pass = password || conf.password;
  let sock = null;
  let opening = null;
  let buf = Buffer.alloc(0);
  let queue = []; // 응답을 기다리는 명령 (보낸 순서대로)
  let lastUsed = 0;
  let closed = false;

  function fail(err) {
    const q = queue;
    queue = [];
    for (const p of q) { clearTimeout(p.timer); p.reject(err); }
  }

  function drop(s, err) {
    if (sock !== s) return;
    sock = null;
    buf = Buffer.alloc(0);
    s.destroy();
    fail(err);
  }

  function onData(s, chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    let at = 0;
    for (;;) {
      let r;
      try { r = parse(buf, at); } catch (err) { drop(s, err); return; }
      if (!r) break;
      at = r.at;
      const p = queue.shift();
      if (!p) continue;
      clearTimeout(p.timer);
      if (r.value instanceof RedisError) p.reject(r.value); else p.resolve(r.value);
    }
    buf = at >= buf.length ? Buffer.alloc(0) : buf.subarray(at);
  }

  function send(s, args) {
    return new Promise((resolve, reject) => {
      const p = { resolve, reject, timer: null };
      p.timer = setTimeout(() => drop(s, new ConnectionError(`응답이 ${timeoutMs}ms 안에 오지 않습니다`)), timeoutMs);
      queue.push(p);
      lastUsed = Date.now();
      s.write(encode(args));
    });
  }

  function open() {
    return new Promise((resolve, reject) => {
      const opts = { host: conf.host, port: conf.port };
      const s = conf.tls ? tls.connect({ ...opts, servername: conf.host }) : net.connect(opts);
      s.setNoDelay(true);
      const timer = setTimeout(() => { s.destroy(); reject(new ConnectionError(`${conf.host}:${conf.port} 에 연결하지 못했습니다 (시간 초과)`)); }, timeoutMs);
      s.once(conf.tls ? 'secureConnect' : 'connect', async () => {
        clearTimeout(timer);
        sock = s;
        buf = Buffer.alloc(0);
        s.on('data', (c) => onData(s, c));
        s.on('close', () => drop(s, new ConnectionError('연결이 끊겼습니다')));
        try {
          if (pass) await send(s, conf.username ? ['AUTH', conf.username, pass] : ['AUTH', pass]);
          resolve(s);
        } catch (err) {
          drop(s, err);
          reject(err instanceof RedisError ? new RedisError(`인증 실패 — ${err.message}`) : err);
        }
      });
      s.on('error', (err) => {
        clearTimeout(timer);
        if (sock === s) drop(s, new ConnectionError(err.message)); else reject(new ConnectionError(`${conf.host}:${conf.port} 에 연결하지 못했습니다 (${err.code ?? err.message})`));
      });
    });
  }

  async function ready() {
    if (closed) throw new ConnectionError('닫힌 연결입니다');
    if (sock && !queue.length && Date.now() - lastUsed > IDLE_MS) drop(sock, new ConnectionError('쉬던 연결을 닫음'));
    if (sock) return sock;
    if (!opening) opening = open().finally(() => { opening = null; });
    return opening;
  }

  /** 명령 하나. 묶음 문자열은 Buffer, 없으면 null. 서버 오류는 RedisError, 연결 문제는 다시 붙어 재시도 */
  async function call(...args) {
    const name = String(args[0]).toUpperCase();
    if (!ALLOWED.has(name)) throw new Error(`이 앱이 쓰지 않는 Redis 명령입니다: ${name}`);
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await send(await ready(), args);
      } catch (err) {
        if (err instanceof RedisError) throw err; // 명령 자체 오류 · 사용량 한도 초과 · 인증 실패
        last = err;
        if (closed) break;
        if (attempt < retries) await new Promise((r) => setTimeout(r, Math.min(1000, 50 * 2 ** attempt)));
      }
    }
    log(`⚠ Redis 연결 실패: ${last?.message}`);
    throw last;
  }

  return {
    call,
    label: `${conf.host}:${conf.port}`,
    /** 알림 받기 전용 연결을 따로 연다 — createSubscriber */
    subscribe: (channel, handlers) => createSubscriber({ url, password, channel, log, timeoutMs, ...handlers }),
    async close() {
      closed = true;
      if (sock) drop(sock, new ConnectionError('닫음'));
    },
  };
}

const SUB_PING_MS = 15_000; // 구독 연결이 살아 있는지 (PING 은 Upstash 사용량에 세지 않는다)

/**
 * 알림 받기 전용 연결 (SUBSCRIBE — R-51 · DEP-16, docs/08-tech.md 11-6). 구독한 연결은 다른 명령을 못 쓰므로 따로 연다.
 * 끊기면 다시 붙어 다시 구독하고 onReady 를 다시 부른다 — 끊긴 사이의 알림은 받는 쪽이 저장된 번호로 채운다 (pub/sub 은 기록이 없다).
 * 구독 명령이 없는 저장소면 onUnsupported 를 부르고 멈춘다 — 받는 쪽은 번호 확인(폴링)으로 돌아간다.
 */
export function createSubscriber({ url, password, channel, onMessage, onReady = () => {}, onUnsupported = () => {}, log = () => {}, timeoutMs = TIMEOUT_MS, pingMs = SUB_PING_MS }) {
  const conf = parseRedisUrl(url);
  const pass = password || conf.password;
  let sock = null;
  let closed = false;
  let failures = 0;
  let pingTimer = null;
  let pongTimer = null;
  let retryTimer = null;

  function cleanup(s) {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    pingTimer = null;
    pongTimer = null;
    if (sock === s) sock = null;
    s.destroy();
  }

  function connect() {
    if (closed) return;
    const opts = { host: conf.host, port: conf.port };
    const s = conf.tls ? tls.connect({ ...opts, servername: conf.host }) : net.connect(opts);
    sock = s;
    s.setNoDelay(true);
    let dead = false;
    /** 이 연결을 접고 (한 번만) 조금 뒤 다시 붙는다 */
    const again = (_s, why) => {
      if (dead) return;
      dead = true;
      cleanup(s);
      if (closed) return;
      failures++;
      if (failures === 1 || failures % 10 === 0) log(`⚠ 실시간 알림 연결 끊김 — 다시 붙습니다 (${why})`);
      retryTimer = setTimeout(connect, Math.min(5000, 100 * 2 ** Math.min(failures, 6)));
    };
    const expect = []; // 응답 순서 — 'auth' · 'subscribe'
    let buf = Buffer.alloc(0);
    const openTimer = setTimeout(() => again(s, '연결 시간 초과'), timeoutMs);
    s.once(conf.tls ? 'secureConnect' : 'connect', () => {
      if (pass) { expect.push('auth'); s.write(encode(conf.username ? ['AUTH', conf.username, pass] : ['AUTH', pass])); }
      expect.push('subscribe');
      s.write(encode(['SUBSCRIBE', channel]));
    });
    s.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let at = 0;
      for (;;) {
        let r;
        try { r = parse(buf, at); } catch (err) { again(s, err.message); return; }
        if (!r) break;
        at = r.at;
        const v = r.value;
        if (expect.length && (!Array.isArray(v) || text(v[0]) === 'subscribe')) {
          const what = expect.shift();
          if (v instanceof RedisError) {
            clearTimeout(openTimer);
            if (what === 'subscribe' && /unknown|not allowed|disabled|unsupported/i.test(v.message)) {
              closed = true;
              dead = true;
              cleanup(s);
              onUnsupported(v.message);
              return;
            }
            again(s, what === 'auth' ? `인증 실패 — ${v.message}` : v.message);
            return;
          }
          if (what === 'subscribe') {
            clearTimeout(openTimer);
            failures = 0;
            pingTimer = setInterval(() => {
              s.write(encode(['PING']));
              clearTimeout(pongTimer);
              pongTimer = setTimeout(() => again(s, `PING 응답이 ${timeoutMs}ms 안에 오지 않습니다`), timeoutMs);
            }, pingMs);
            pingTimer.unref?.();
            onReady();
          }
          continue;
        }
        if (!Array.isArray(v)) continue;
        const kind = text(v[0]);
        if (kind === 'message') onMessage(v[2]);
        else if (kind === 'pong') clearTimeout(pongTimer);
      }
      buf = at >= buf.length ? Buffer.alloc(0) : buf.subarray(at);
    });
    s.on('error', (err) => { clearTimeout(openTimer); again(s, err.code ?? err.message); });
    s.on('close', () => { clearTimeout(openTimer); again(s, '연결이 끊겼습니다'); });
  }

  connect();
  return {
    close() {
      closed = true;
      clearTimeout(retryTimer);
      if (sock) cleanup(sock);
    },
  };
}

/** Buffer · null → 글자 */
export const text = (v) => (v == null ? null : Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
