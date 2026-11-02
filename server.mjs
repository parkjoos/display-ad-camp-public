// 2026 디광 캠핑 게임 앱 — 서버 진입점 (docs/08-tech.md 1 · 4 · 11장)
// 노트북 모드: node server.mjs [--pin 123456] [--open]
// 서버 모드: 환경 변수 CAMP_PUBLIC_ORIGIN · CAMP_PIN (+ CAMP_DATA_DIR · CAMP_HOST · CAMP_PORT) — 08-tech 11-1
// Redis 저장소(Upstash 등 — R-50 · R-51): CAMP_REDIS_URL · CAMP_REDIS_PASSWORD (+ CAMP_REDIS_PREFIX · CAMP_SEED) — 08-tech 11-6
// Vercel 은 api/index.js 가 같은 앱을 요청 처리기로만 쓴다 (포트를 열지 않음 — 08-tech 11-5)
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer, APP_ID } from './server/app.mjs';
import { readEnv } from './server/config.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const env = process.env;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { pin: undefined, open: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--open') out.open = true;
    else if (argv[i] === '--pin') {
      const v = argv[++i];
      if (!/^\d{6}$/.test(v ?? '')) fail('--pin 은 6자리 숫자여야 합니다 (예: --pin 123456)');
      out.pin = v;
    }
  }
  return out;
}

function readConfig(argv) {
  const args = parseArgs(argv);
  let cfg;
  try { cfg = readEnv(env, { pin: args.pin }); } catch (err) { fail(err.message); }
  return { ...args, ...cfg, dataRoot: cfg.dataDir ?? ROOT };
}

function openBrowser(url) {
  if (process.platform !== 'darwin') return;
  const child = spawn('open', [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

async function alreadyRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body?.app === APP_ID;
  } catch {
    return false;
  }
}

const cfg = readConfig(process.argv.slice(2));
let app;
try {
  app = await createAppServer({ root: ROOT, dataRoot: cfg.dataRoot, port: cfg.port, host: cfg.host, pin: cfg.pin, publicOrigin: cfg.publicOrigins, redis: cfg.redis, streamMaxMs: cfg.streamMaxMs });
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    if (!cfg.serverMode && await alreadyRunning(cfg.port)) {
      console.log(`이미 켜져 있는 게임 서버가 있습니다 — 브라우저만 엽니다 (http://127.0.0.1:${cfg.port}/)`);
      if (cfg.open) openBrowser(`http://127.0.0.1:${cfg.port}/`);
      process.exit(0);
    }
    fail(`${cfg.port} 포트를 다른 프로그램이 쓰고 있습니다 — 그 프로그램을 끄고 다시 실행하세요`);
  }
  if (err.code === 'CAMP_STORAGE') fail(err.message); // 저장 폴더 · 저장소 점검 실패 (08-tech 11-3 · 11-6)
  throw err;
}

console.log('');
if (cfg.serverMode) {
  const [main, ...others] = cfg.publicOrigins;
  console.log('✔ 캠프 게임 서버 실행 중 — 서버 모드 (docs/08-tech.md 11장)');
  console.log(`  게임 화면    ${main}/`);
  console.log(`  진행자 화면  ${main}/host`);
  console.log(`  관리 페이지  ${main}/admin`);
  if (others.length) console.log(`  다른 주소    ${others.join(' · ')} (같은 서버 — 로그인은 주소마다)`);
  console.log(`  받는 주소    ${cfg.host}:${cfg.port}`);
  console.log(`  저장소       ${app.ctx.store.label}`);
  console.log('  PIN          CAMP_PIN (로그에 표시하지 않음)');
  console.log('');
} else {
  const base = `http://127.0.0.1:${cfg.port}`;
  console.log('✔ 캠프 게임 서버 실행 중 (Ctrl+C 로 종료)');
  console.log(`  게임 화면    ${base}/`);
  console.log(`  진행자 화면  ${base}/host`);
  console.log(`  관리 페이지  ${base}/admin`);
  console.log(`  PIN          ${app.pin}   (진행자 화면 · 관리 페이지 공용) ← 참가자에게 보이지 않게 주의`);
  console.log('');
  console.log('  게임 진행 중에는 이 창을 닫지 마세요.');
  console.log('');
  if (cfg.open) openBrowser(`${base}/`);
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('\n서버를 끕니다…');
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
