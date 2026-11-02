// 저장 폴더 · 저장소 준비 (docs/08-tech.md 11-2 · 11-3 · 11-6) — 서버 모드의 볼륨 · Redis
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { existsPath, atomicWrite } from './files.mjs';

export const SEED_DIRS = ['data', 'assets', 'state'];
export const SECRET_FILE = '.camp-secret';
/** Redis 저장소에 초기 데이터를 넣었다는 표시 (R-50) */
export const SEEDED_FILE = '.seeded';

const skipName = (name) => name.startsWith('.') || name.endsWith('.tmp');

/**
 * 저장 폴더에 data · assets · state 가 없으면 코드 폴더(이미지 안)의 것을 복사한다 — 폴더별로, 있으면 그대로 둔다.
 * 코드 폴더에 없으면(이미지에 넣지 않는 state — R-37) 빈 폴더로 만든다.
 * 백업 폴더(.backup) · 숨김 파일 · 임시 파일은 복사하지 않는다.
 */
export async function seedDataDir(appRoot, dataRoot, log = () => {}) {
  await mkdir(dataRoot, { recursive: true });
  const copied = [];
  for (const dir of SEED_DIRS) {
    const dest = join(dataRoot, dir);
    if (await existsPath(dest)) continue;
    const src = join(appRoot, dir);
    if (await existsPath(src)) {
      await cp(src, dest, { recursive: true, filter: (p) => !skipName(basename(p)) });
    } else {
      await mkdir(dest, { recursive: true });
    }
    copied.push(dir);
  }
  if (copied.length) log(`📦 처음 시작 — 저장 폴더에 ${copied.join(' · ')} 를 만들었습니다 (${dataRoot})`);
  return copied;
}

/**
 * Redis 저장소(R-50) 처음 채우기 — **`CAMP_SEED=1` 일 때만**, 표시(.seeded)가 없을 때 한 번.
 * 비어 있다고 저절로 초기 데이터를 넣지 않는다: Redis 가 비워졌을 때 옛 초기 데이터로 조용히 돌아가면 유실을 알아챌 수 없다.
 * 이미 데이터가 있으면(백업 올리기로 채움) 표시만 남긴다.
 * @returns 'seeded' | 'present' | 'empty' | 'done'
 */
export async function seedStore(appRoot, store, { allow = false, log = () => {} } = {}) {
  if (await store.stat(SEEDED_FILE)) return 'done';
  if (await store.stat('data/app.json')) {
    await store.writeFileIfAbsent(SEEDED_FILE, new Date().toISOString());
    return 'present';
  }
  if (!allow) {
    log('⚠ 저장소가 비어 있습니다 — 처음이면 CAMP_SEED=1 로 한 번 켜서 초기 데이터를 넣고, 쓰던 서버라면 관리 페이지 [백업 올리기] 로 복구하세요 (docs/16-deploy.md 5장)');
    return 'empty';
  }
  let n = 0;
  async function copy(dir) {
    let entries;
    try { entries = await readdir(join(appRoot, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skipName(e.name)) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) await copy(rel);
      else if (e.isFile()) { await store.writeFile(rel, await readFile(join(appRoot, rel))); n++; }
    }
  }
  for (const dir of ['data', 'assets']) await copy(dir);
  await store.writeFileIfAbsent(SEEDED_FILE, new Date().toISOString());
  log(`📦 처음 시작 — 저장소에 초기 데이터 ${n}개 파일을 넣었습니다 (${store.label})`);
  return 'seeded';
}

/**
 * 서버 모드 쿠키 서명 키 — 저장소에 한 번 만들어 두고 계속 쓴다 (서버가 다시 떠도, 서버가 여럿이어도 같은 키)
 * 두 서버가 동시에 처음 켜져도 먼저 쓴 쪽 하나로 맞춘다 (없을 때만 쓰기 → 다시 읽기)
 */
export async function loadSecret(store) {
  const read = async () => {
    const text = (await store.readFile(SECRET_FILE))?.toString('utf8').trim();
    return /^[0-9a-f]{64}$/.test(text ?? '') ? text : null;
  };
  const found = await read();
  if (found) return found;
  await store.writeFileIfAbsent(SECRET_FILE, `${randomBytes(32).toString('hex')}\n`);
  const made = await read();
  if (!made) throw Object.assign(new Error(`서명 키(${SECRET_FILE})가 올바르지 않습니다 — 지우고 다시 시작하세요`), { code: 'CAMP_STORAGE' });
  return made;
}

/**
 * 시작할 때 저장 폴더 점검 (docs/08-tech.md 11-3) — 만들기 · 이름 바꾸기로 덮어쓰기 · 읽기 · 지우기.
 * 안 되면 code 'CAMP_STORAGE' 오류 — server.mjs 가 원인을 남기고 시작하지 않는다 (첫 저장 때가 아니라 배포 때 알 수 있게).
 */
export async function checkStorage(dataRoot, log = () => {}) {
  const dir = join(dataRoot, '.camp-check');
  const file = join(dir, 'probe.txt');
  const step = async (label, fn) => {
    try { return await fn(); } catch (err) {
      throw Object.assign(new Error(`저장 폴더에 쓸 수 없습니다 — ${label} 실패 (${err.code ?? err.message}) · ${dataRoot}`), { code: 'CAMP_STORAGE' });
    }
  };
  await step('폴더 만들기', () => mkdir(dir, { recursive: true }));
  await step('파일 만들기', () => atomicWrite(file, 'a'));
  await step('이름 바꾸기로 덮어쓰기', () => atomicWrite(file, 'b'));
  const text = await step('읽기', () => readFile(file, 'utf8'));
  if (text !== 'b') throw Object.assign(new Error(`저장 폴더에 쓸 수 없습니다 — 쓴 내용이 읽히지 않습니다 · ${dataRoot}`), { code: 'CAMP_STORAGE' });
  await step('지우기', () => rm(dir, { recursive: true, force: true }));
  log(`🗄 저장 폴더 점검 ✔ (${dataRoot})`);
}

/**
 * Redis 저장소 점검 (R-50) — 접속 · 인증 · 쓰기 · 덮어쓰기 · 읽기 · 지우기. 안 되면 CAMP_STORAGE.
 * quick — Vercel 함수 (R-55): 인스턴스가 자주 새로 켜지고 한꺼번에 수십 개 켜지기도 해서 접속 · 쓰기 · 읽기만 짧게 (명령 2개 —
 * 전부 하면 약 12개). 점검 키는 60초 뒤 저절로 사라진다
 */
export async function checkStore(store, log = () => {}, { quick = false } = {}) {
  // 점검 파일은 시작마다 따로 — 서버(Vercel 인스턴스) 여럿이 동시에 켜져도 서로의 점검 파일을 덮어쓰거나 지우지 않게 (R-51)
  const id = randomBytes(6).toString('hex');
  const rel = `.camp-check/${id}.txt`;
  const step = async (label, fn) => {
    try { return await fn(); } catch (err) {
      throw Object.assign(new Error(`저장소를 쓸 수 없습니다 — ${label} 실패 (${err.message}) · ${store.label}`), { code: 'CAMP_STORAGE' });
    }
  };
  await step('접속', () => store.redis.call('PING'));
  if (quick) {
    const key = `${store.prefix}check:${id}`;
    await step('쓰기', () => store.redis.call('SET', key, 'b', 'EX', '60'));
    const v = await step('읽기', () => store.redis.call('GET', key));
    if (v?.toString('utf8') !== 'b') throw Object.assign(new Error(`저장소를 쓸 수 없습니다 — 쓴 내용이 읽히지 않습니다 · ${store.label}`), { code: 'CAMP_STORAGE' });
    log(`🗄 저장소 점검 ✔ (${store.label} · 짧게)`);
    return;
  }
  await step('쓰기', () => store.writeFile(rel, 'a'));
  await step('덮어쓰기', () => store.writeFile(rel, 'b'));
  const text = await step('읽기', () => store.readFile(rel));
  if (text?.toString('utf8') !== 'b') throw Object.assign(new Error(`저장소를 쓸 수 없습니다 — 쓴 내용이 읽히지 않습니다 · ${store.label}`), { code: 'CAMP_STORAGE' });
  await step('지우기', () => store.unlink(rel));
  log(`🗄 저장소 점검 ✔ (${store.label})`);
}
