// 원자적 쓰기 · 리비전 · 줄 세우기 · 백업 (docs/08-tech.md 4-6 · 4-6-1)
// 백업 · 읽기는 저장소(store.mjs — 파일 · Redis)를 거친다. 경로는 저장 폴더 기준 상대 경로
import { createHash, randomBytes } from 'node:crypto';
import { open, rename, mkdir, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export const revisionOf = (text) => createHash('sha256').update(text).digest('hex');

/** 저장소의 글자 읽기. 없으면 null */
export async function readText(store, rel) {
  const buf = await store.readFile(rel);
  return buf === null ? null : buf.toString('utf8');
}

/** 저장소에 있는지 (파일) */
export async function exists(store, rel) {
  const s = await store.stat(rel);
  return !!s && !s.dir;
}

/** 파일 시스템 경로가 있는지 (저장 폴더 준비 — seed.mjs) */
export async function existsPath(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** 임시 파일에 쓰고 디스크에 확정한 뒤 이름 바꾸기 — 중간에 꺼져도 깨진 파일이 남지 않는다 */
export async function atomicWrite(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

// 파일별로 한 번에 하나의 저장만 (동시 요청은 줄 세움) — 서버 하나 안에서. 서버끼리는 store.lock (Redis 잠금 키)
const chains = new Map();
export function withLock(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  // 줄의 꼬리는 실패해도 거부되지 않게 — 오류는 run 을 기다리는 쪽이 받는다
  const tail = run.catch(() => {}).then(() => { if (chains.get(key) === tail) chains.delete(key); });
  chains.set(key, tail);
  return run;
}

/** 사람이 보는 시각은 한국 시간 — Vercel 은 UTC 로 돌고 시간대(TZ)를 바꿀 수 없다 (R-51) */
export const TIME_ZONE = 'Asia/Seoul';
const STAMP_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const parts = (date) => Object.fromEntries(STAMP_PARTS.formatToParts(date).map((x) => [x.type, x.value]));

/** `YYYYMMDD-HHmmss` (한국 시간) — 백업 파일 이름 */
export function stamp(date = new Date()) {
  const p = parts(date);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

/** 로그의 시각 `17시 30분 5초` (한국 시간) — 직접 조립한다. `toLocaleTimeString('ko-KR')` 은 Node(ICU) 판마다 모양이 달라 Node 24 는 `17:30:05` (R-101) */
export function clock(date = new Date()) {
  const p = parts(date);
  return `${Number(p.hour)}시 ${Number(p.minute)}분 ${Number(p.second)}초`;
}

/**
 * 현재 파일을 백업 폴더에 `<base>-YYYYMMDD-HHmmss.json` 으로 복사하고 최근 keep 개만 남긴다.
 * 파일이 없으면 아무것도 안 한다. 서버가 지우는 것은 자기가 만든 오래된 백업뿐 (docs/08-tech.md 4-5).
 */
export async function backupFile(store, src, dir, base, keep) {
  const data = await store.readFile(src);
  if (data === null) return null;
  // 같은 초의 백업은 번호를 붙인다 — 비어 있는 번호가 아니라 "있는 번호 중 가장 큰 것 + 1".
  // 정리로 지워진 앞 번호를 다시 쓰면 새 백업이 가장 오래된 것으로 분류돼 바로 지워진다
  const st = stamp();
  const same = (await listBackups(store, dir, base)).filter((b) => b.stamp === st);
  const seq = same.length ? Math.max(...same.map((b) => b.seq)) + 1 : 1;
  const name = seq === 1 ? `${base}-${st}.json` : `${base}-${st}-${seq}.json`;
  await store.writeFile(`${dir}/${name}`, data);
  await pruneBackups(store, dir, base, keep);
  return name;
}

const BACKUP_RE = /^(.+)-(\d{8}-\d{6})(?:-(\d+))?\.json$/;

export async function listBackups(store, dir, base) {
  return (await store.readdir(dir))
    .filter((e) => !e.dir)
    .map(({ name }) => ({ name, m: BACKUP_RE.exec(name) }))
    .filter(({ m }) => m && m[1] === base)
    .map(({ name, m }) => ({ name, stamp: m[2], seq: Number(m[3] ?? 1) }))
    .sort((a, b) => (a.stamp === b.stamp ? b.seq - a.seq : a.stamp < b.stamp ? 1 : -1));
}

async function pruneBackups(store, dir, base, keep) {
  const list = await listBackups(store, dir, base);
  for (const old of list.slice(keep)) await store.unlink(`${dir}/${old.name}`).catch(() => {});
}

/** `20261029-173000` → `2026-10-29 17:30:00` */
export function stampToText(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
}
