// 백업 파일 형식 — POSIX ustar tar (docs/04-admin.md 3-11, R-37). 화면(미리보기) · 서버(만들기 · 풀기 · 검사) 공용
import { validateGame, validateApp, validateScoreboardDefaults, parseJsonText, checkStateFile, SLUG_RE } from './validate.js';

export const BLOCK = 512;
/** 백업에 담는 폴더 — 올리기에서 고르는 단위 */
export const PARTS = { data: ['data', 'assets'], state: ['state'] };
/** 파일 하나 크기 제한 (서버 저장 규칙과 같다 — 08-tech 4-5) */
export const ENTRY_LIMIT = { json: 2 * 1024 * 1024, image: 15 * 1024 * 1024, state: 256 * 1024 };
export const ARCHIVE_LIMIT = 300 * 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

function putStr(buf, off, len, str) {
  const b = enc.encode(str);
  if (b.length > len) throw new Error(`tar 머리글 칸이 넘칩니다: ${str}`);
  buf.set(b, off);
}
function putOctal(buf, off, len, n) {
  putStr(buf, off, len - 1, Math.floor(n).toString(8).padStart(len - 1, '0'));
}

/** 경로를 ustar 의 name(100) · prefix(155) 로 나눈다 */
function splitName(path) {
  if (enc.encode(path).length <= 100) return ['', path];
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (name && enc.encode(name).length <= 100 && enc.encode(prefix).length <= 155) return [prefix, name];
  }
  throw new Error(`경로가 너무 깁니다: ${path}`);
}

/** 파일 하나의 머리글 (512바이트) */
export function tarHeader(path, size, mtimeMs = Date.now()) {
  const h = new Uint8Array(BLOCK);
  const [prefix, name] = splitName(path);
  putStr(h, 0, 100, name);
  putOctal(h, 100, 8, 0o644);
  putOctal(h, 108, 8, 0);
  putOctal(h, 116, 8, 0);
  putOctal(h, 124, 12, size);
  putOctal(h, 136, 12, mtimeMs / 1000);
  h.fill(0x20, 148, 156); // 검사합 자리는 공백으로 두고 계산
  h[156] = 0x30; // '0' 일반 파일
  putStr(h, 257, 6, 'ustar');
  putStr(h, 263, 2, '00');
  putStr(h, 345, 155, prefix);
  let sum = 0;
  for (const x of h) sum += x;
  putStr(h, 148, 6, sum.toString(8).padStart(6, '0'));
  h[154] = 0;
  return h;
}

/** 파일 내용 뒤를 512 배수로 채우는 길이 */
export const padding = (size) => (BLOCK - (size % BLOCK)) % BLOCK;
/** 끝 표시 (빈 블록 2개) */
export const tarEnd = () => new Uint8Array(BLOCK * 2);

/** 머리글 읽기 — 빈 블록(끝)이면 null, 형식이 틀리면 오류 */
export function readHeader(block) {
  if (block.every((x) => x === 0)) return null;
  const str = (off, len) => {
    let end = off;
    while (end < off + len && block[end] !== 0) end++;
    return dec.decode(block.subarray(off, end));
  };
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  if (parseInt(str(148, 8).trim(), 8) !== sum) throw new Error('백업 파일(tar) 형식이 올바르지 않습니다');
  const name = str(0, 100);
  const prefix = str(345, 155);
  const size = parseInt(str(124, 12).trim() || '0', 8);
  const type = block[156] === 0 ? '0' : String.fromCharCode(block[156]);
  return { path: prefix ? `${prefix}/${name}` : name, size, type };
}

/** 메모리에 든 tar 전체 → 항목 목록 (화면 미리보기용) */
export function listTar(bytes) {
  const out = [];
  let off = 0;
  while (off + BLOCK <= bytes.length) {
    const h = readHeader(bytes.subarray(off, off + BLOCK));
    if (!h) break;
    off += BLOCK;
    if (off + h.size > bytes.length) throw new Error('백업 파일이 잘렸습니다');
    out.push({ ...h, offset: off });
    off += h.size + padding(h.size);
  }
  return out;
}

const IMAGE_NAME_RE = /^[a-z0-9][a-z0-9_-]*\.(jpe?g|png|webp|gif)$/i;

/**
 * 백업 안 경로 → 무엇인지. 정해진 위치 밖 · `..` · 숨김 파일 · 파일이 아닌 항목은 { skip: 이유 }.
 * @returns {{ part, kind, id?, name?, limit } | { dir: true } | { skip: string }}
 */
export function classifyEntry(rawPath, type = '0') {
  const path = rawPath.replace(/^\.\//, '').replace(/\/$/, '');
  if (type === '5') return { dir: true };
  const parts = path.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return { skip: '허용되지 않는 경로 · 숨김 파일' };
  if (type !== '0') return { skip: '일반 파일이 아닙니다' };
  if (path === 'data/app.json') return { part: 'data', kind: 'app', limit: ENTRY_LIMIT.json };
  if (path === 'data/scoreboard.json') return { part: 'data', kind: 'scoreboardDefaults', limit: ENTRY_LIMIT.json };
  if (parts[0] === 'data' && parts[1] === 'games' && parts.length === 3 && /^[a-z0-9-]+\.json$/.test(parts[2])) {
    const id = parts[2].slice(0, -5);
    if (SLUG_RE.test(id)) return { part: 'data', kind: 'game', id, limit: ENTRY_LIMIT.json };
  }
  if (parts[0] === 'assets' && parts.length >= 3 && parts.slice(1, -1).every((s) => SLUG_RE.test(s))) {
    if (IMAGE_NAME_RE.test(parts.at(-1))) return { part: 'data', kind: 'image', limit: ENTRY_LIMIT.image };
    return { skip: '이미지 파일이 아닙니다' };
  }
  if (parts[0] === 'state' && parts.length === 2 && /^(settings|route|scoreboard)\.json$/.test(parts[1])) {
    return { part: 'state', kind: 'state', name: parts[1].slice(0, -5), limit: ENTRY_LIMIT.state };
  }
  if (parts[0] === 'state' && parts[1] === 'sessions' && parts.length === 3 && /^[a-z0-9-]+\.json$/.test(parts[2])) {
    const id = parts[2].slice(0, -5);
    if (SLUG_RE.test(id)) return { part: 'state', kind: 'state', name: `session:${id}`, limit: ENTRY_LIMIT.state };
  }
  return { skip: '백업에 넣지 않는 파일' };
}

/**
 * 올릴 항목 검사 — 화면 미리보기와 서버가 같은 규칙으로 본다.
 * @param items [{ path, size, cls }] — classifyEntry 가 파일로 본 것만, 고른 부분(parts)만
 * @param textOf (item) => 글자 (JSON 항목만 부른다)
 * @returns {{ errors: {path, message}[], skipped: {path, reason}[], games: {[id]: {title, categories, questions}}, counts: {data, assets, state}, keep: item[] }}
 *   errors 가 있으면 아무것도 쓰지 않는다 (게임 데이터 · app.json · 점수판 기본값). 상태 파일 형식 오류는 그 파일만 skipped.
 */
export function checkArchive(items, textOf) {
  const errors = [];
  const skipped = [];
  const games = {};
  const counts = { data: 0, assets: 0, state: 0 };
  const keep = [];
  const last = new Map(); // 같은 경로가 두 번 있으면 뒤의 것
  for (const it of items) last.set(it.path, it);
  for (const it of last.values()) {
    const { cls } = it;
    if (it.size > cls.limit) { skipped.push({ path: it.path, reason: '파일이 너무 큽니다' }); continue; }
    if (cls.kind === 'image') { counts.assets++; keep.push(it); continue; }
    const label = it.path;
    const parsed = parseJsonText(textOf(it), label);
    if (parsed.error) {
      if (cls.kind === 'state') { skipped.push({ path: label, reason: '읽을 수 없는 JSON' }); continue; }
      errors.push({ path: label, message: parsed.error.message });
      continue;
    }
    if (cls.kind === 'state') {
      const kind = cls.name.startsWith('session:') ? 'session' : cls.name;
      const problem = checkStateFile(kind, parsed.value, { gameId: kind === 'session' ? cls.name.slice(8) : undefined });
      if (problem) { skipped.push({ path: label, reason: `상태 파일 형식 오류: ${problem}` }); continue; }
      counts.state++;
      keep.push(it);
      continue;
    }
    let v = { errors: [] };
    if (cls.kind === 'game') {
      v = validateGame(parsed.value, { fileId: cls.id });
      const cats = Array.isArray(parsed.value?.categories) ? parsed.value.categories : [];
      games[cls.id] = { title: parsed.value?.title ?? cls.id, categories: cats.length, questions: cats.reduce((n, c) => n + (c.questions?.length ?? 0), 0) };
    } else if (cls.kind === 'app') v = validateApp(parsed.value);
    else if (cls.kind === 'scoreboardDefaults') v = validateScoreboardDefaults(parsed.value);
    if (v.errors.length) { for (const e of v.errors) errors.push({ path: label, message: e.message }); continue; }
    counts.data++;
    keep.push(it);
  }
  return { errors, skipped, games, counts, keep };
}
