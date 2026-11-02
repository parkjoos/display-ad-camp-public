// Vercel 함수 진입점 — vercel.json 이 모든 경로를 여기로 보낸다 (R-51 · DEP-15, docs/08-tech.md 11-5 · 16-deploy)
// 앱(저장소 점검 · 서명 키)은 첫 요청 때 한 번 만들고, 인스턴스가 살아 있는 동안 다시 쓴다. 포트는 열지 않는다
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { readEnv, VERCEL_REDIS_VARS } from '../server/config.mjs';
import { sendJson } from '../server/guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 함수 실행 시간 상한(vercel.json maxDuration 300초)보다 먼저 실시간 연결을 끊고 다시 붙게 한다 (11-4) */
const STREAM_MAX_MS = 270_000;

/** 설정 오류 — 변수 이름만 담는다(값 없음). 응답에도 보여 로그를 열지 않고 고칠 수 있게 */
const configError = (message) => Object.assign(new Error(message), { code: 'CAMP_CONFIG' });

function readConfig(env) {
  let cfg;
  try { cfg = readEnv(env); } catch (err) { throw configError(err.message); }
  if (!cfg.serverMode) {
    // 운영 배포는 Vercel 시스템 환경 변수로 주소를 안다 (config.mjs — R-63). 미리보기는 운영 Redis 에 쓰지 않게 켜지 않는다
    throw configError(env.VERCEL && env.VERCEL_ENV && env.VERCEL_ENV !== 'production'
      ? `미리보기 배포(${env.VERCEL_ENV})는 쓰지 않습니다 — 운영 저장소를 건드리지 않게 운영 배포에서만 켭니다`
      : '서비스 주소를 알 수 없습니다 — Vercel 프로젝트의 시스템 환경 변수(VERCEL_PROJECT_PRODUCTION_URL)를 켜거나 CAMP_PUBLIC_ORIGIN(https://…)을 넣으세요. Vercel 에서는 서버 모드로만');
  }
  if (!cfg.redis && env.VERCEL) {
    const restOnly = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
    throw configError(restOnly
      ? 'Upstash 의 REST 주소만 있습니다 — Redis 프로토콜 주소(REDIS_URL · KV_URL, rediss://…)가 필요합니다'
      : `Vercel 에는 남는 디스크가 없습니다 — Redis 저장소 주소가 필요합니다 (Upstash 연결의 ${VERCEL_REDIS_VARS.join(' · ')} 또는 CAMP_REDIS_URL)`);
  }
  return cfg;
}

async function start() {
  const cfg = readConfig(process.env);
  const app = await createApp({
    root: ROOT, dataRoot: cfg.dataDir ?? ROOT, pin: cfg.pin, publicOrigin: cfg.publicOrigins, redis: cfg.redis, blob: cfg.blob,
    streamMaxMs: cfg.streamMaxMs ?? STREAM_MAX_MS,
    quickCheck: true, // 인스턴스가 자주 · 한꺼번에 새로 켜진다 — 저장소 점검은 짧게 (R-55)
  });
  const [main, ...others] = cfg.publicOrigins;
  console.log(`✔ 캠프 게임 함수 시작 — 대표 주소 ${main}${others.length ? ` · 다른 주소 ${others.join(' · ')}` : ''} · 저장소 ${app.ctx.store.label} (${cfg.redis?.source ?? '저장 폴더'}) · 이미지 ${app.ctx.store.blob ?? '✕ Blob 을 쓸 수 없음 (저장 실패)'} · PIN 은 로그에 표시하지 않음`);
  return app;
}

let starting = null;

export default async function handler(req, res) {
  let app;
  try {
    starting ??= start().catch((err) => { starting = null; throw err; }); // 실패하면 다음 요청 때 다시
    app = await starting;
  } catch (err) {
    console.error(`✕ 시작하지 못했습니다 — ${err.message}`);
    // 설정 오류는 무엇이 빠졌는지까지 (변수 이름만). 저장소 접속 실패 등은 주소가 드러나지 않게 로그에만
    sendJson(res, 503, { error: `서버를 시작하지 못했습니다 — ${err.code === 'CAMP_CONFIG' ? err.message : '운영자에게 알려 주세요 (Vercel 로그)'}` });
    return;
  }
  await app.handle(req, res);
}
