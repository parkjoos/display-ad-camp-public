// 환경 변수 읽기 — server.mjs(Node 서버) · api/index.js(Vercel 함수) 공용 (docs/08-tech.md 11-1)
// 형식이 틀리면 Error — 받는 쪽이 종료(Node 서버)하거나 503(Vercel 함수)으로 알린다
import { resolve } from 'node:path';
import { parseRedisUrl } from './redis.mjs';

const ORIGIN_FORMAT = 'CAMP_PUBLIC_ORIGIN 은 https://<도메인> 형식이어야 합니다 (경로 없이, 도메인이 여럿이면 쉼표로)';

/** 공개 주소 — `https://도메인` (경로 · 끝 `/` 없이 비교하므로 origin 으로 맞춘다) */
function parseOrigin(value) {
  let u;
  try { u = new URL(value); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol) || u.pathname !== '/' || u.search || u.hash) throw new Error(ORIGIN_FORMAT);
  return u.origin;
}

/** 쉼표로 여러 개 — 첫 번째가 대표 주소 (로그에 보이는 주소, 08-tech 11-1) */
function parseOrigins(value) {
  const list = value.split(',').map((v) => v.trim()).filter(Boolean).map(parseOrigin);
  if (!list.length) throw new Error(ORIGIN_FORMAT);
  return [...new Set(list)];
}

/**
 * Vercel 이 넣어 주는 주소 (시스템 환경 변수 — `https://` 없이, 이 순서로 · 첫 번째가 대표 — R-63).
 * 운영 도메인(가장 짧은 커스텀 도메인, 없으면 vercel.app) · 배포별 주소 · 브랜치 주소
 */
export const VERCEL_ORIGIN_VARS = ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL'];

/** Vercel 운영 배포의 공개 주소 — 미리보기 배포는 운영 Redis 에 쓰지 않게 서버 모드로 켜지 않는다 (운영 도메인 변수가 미리보기에도 들어온다) */
function vercelOrigins(env) {
  if (!env.VERCEL || env.VERCEL_ENV !== 'production') return [];
  return VERCEL_ORIGIN_VARS.filter((name) => env[name]).map((name) => {
    try { return parseOrigin(`https://${env[name]}`); } catch { throw new Error(`${name} 가 도메인 형식이 아닙니다`); }
  });
}

/** Vercel 에서 Upstash 를 연결하면 넣어 주는 Redis 주소 (비밀번호 포함 rediss://) — CAMP_REDIS_URL 이 없을 때 이 순서로 (R-51) */
export const VERCEL_REDIS_VARS = ['REDIS_URL', 'KV_URL'];

/** Redis 주소와 어느 변수에서 왔는지 — 없으면 null */
function redisUrlOf(env) {
  if (env.CAMP_REDIS_URL) return { url: env.CAMP_REDIS_URL, source: 'CAMP_REDIS_URL' };
  if (!env.VERCEL) return null; // 노트북 · 다른 서버에서는 다른 용도의 REDIS_URL 을 잘못 집지 않게
  for (const name of VERCEL_REDIS_VARS) if (env[name]) return { url: env[name], source: name };
  return null;
}

/** Redis 저장소 설정 — 없으면 null (저장 폴더). 키 접두어는 같이 쓰는 저장소에서 이 앱 키를 구분한다 */
function readRedis(env, serverMode) {
  const found = redisUrlOf(env);
  if (!found) return null;
  if (!serverMode) {
    // Upstash 연결 변수는 미리보기 배포에도 들어간다 — 서버 모드가 아니면 쓰지 않고, 빠진 CAMP_PUBLIC_ORIGIN 을 알린다 (api/index.js)
    if (found.source !== 'CAMP_REDIS_URL') return null;
    throw new Error('CAMP_REDIS_URL(Redis 저장소)은 서버 모드(CAMP_PUBLIC_ORIGIN)에서만 씁니다');
  }
  try { parseRedisUrl(found.url); } catch { throw new Error(`${found.source} 는 redis://호스트:포트 (TLS 는 rediss://) 형식이어야 합니다`); }
  let prefix = env.CAMP_REDIS_PREFIX ?? 'camp-game:';
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_:.-]{0,39}$/.test(prefix)) throw new Error('CAMP_REDIS_PREFIX 는 영문 · 숫자 · _ - : . 로 40자까지입니다 (예: camp-game:)');
  if (!prefix.endsWith(':')) prefix += ':';
  return { url: found.url, source: found.source, password: env.CAMP_REDIS_PASSWORD || undefined, prefix, seed: env.CAMP_SEED === '1' };
}

/**
 * 이미지 Blob 저장소 (R-67, 08-tech 11-7) — Redis 저장소는 이미지를 Blob 에만 둔다 (Redis 에 넣지도 읽지도 않는다 — DEP-27).
 * 토큰은 Blob 저장소를 프로젝트에 연결하면 Vercel 이 넣는다 — 없으면 token: null 로 넘겨 이미지 저장을 막는다(app.mjs). 저장 폴더면 null
 */
function readBlob(env, redis) {
  return redis ? { token: env.BLOB_READ_WRITE_TOKEN || null } : null;
}

/**
 * @param env process.env
 * @param pin 명령줄 `--pin` (있으면 CAMP_PIN 대신)
 * @returns {{ publicOrigins: string[], serverMode: boolean, redis: object|null, blob: object|null, pin: string|undefined, port: number,
 *   host: string, dataDir: string|null, streamMaxMs: number|null }}
 */
export function readEnv(env, { pin } = {}) {
  // Vercel 운영 배포는 Vercel 이 준 주소가 먼저 — CAMP_PUBLIC_ORIGIN 은 더할 주소 (도메인을 붙여도 환경 변수를 고치지 않게, R-63)
  const publicOrigins = [...new Set([...vercelOrigins(env), ...(env.CAMP_PUBLIC_ORIGIN ? parseOrigins(env.CAMP_PUBLIC_ORIGIN) : [])])];
  const serverMode = publicOrigins.length > 0;
  const redis = readRedis(env, serverMode);
  if (serverMode && !pin) {
    // 서버 모드 PIN 은 배포 환경의 비밀 값(환경 변수)에서 — 로그에 찍지 않는다
    if (!/^\d{6}$/.test(env.CAMP_PIN ?? '')) throw new Error('서버 모드(CAMP_PUBLIC_ORIGIN)에는 CAMP_PIN 이 필요합니다 — CAMP_PIN 은 6자리 숫자여야 합니다');
    pin = env.CAMP_PIN;
  }
  // 포트 1029 = 행사일 10/29. 노트북 모드는 브라우저 임시 사본이 주소별이라 고정
  const port = env.CAMP_PORT ? Number(env.CAMP_PORT) : 1029;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CAMP_PORT 는 1 ~ 65535 숫자여야 합니다');
  // 실시간 연결(SSE)을 서버가 먼저 끊고 다시 붙게 할 시간 — 실행 시간 상한이 있는 곳(Vercel)용 (11-4)
  let streamMaxMs = null;
  if (env.CAMP_STREAM_MAX_S) {
    const s = Number(env.CAMP_STREAM_MAX_S);
    if (!Number.isFinite(s) || s < 1 || s > 86_400) throw new Error('CAMP_STREAM_MAX_S 는 1 ~ 86400 초여야 합니다');
    streamMaxMs = Math.round(s * 1000);
  }
  return {
    publicOrigins, serverMode, redis, blob: readBlob(env, redis), pin, port, streamMaxMs,
    host: env.CAMP_HOST || (serverMode ? '0.0.0.0' : '127.0.0.1'),
    dataDir: env.CAMP_DATA_DIR ? resolve(env.CAMP_DATA_DIR) : null,
  };
}
