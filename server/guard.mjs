// 요청 가드 — 접속 주소 · Host · Origin · 헤더 확인, 요청 크기 제한 (docs/08-tech.md 4-5)

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const LIMITS = {
  json: 2 * 1024 * 1024,
  image: 4 * 1024 * 1024, // Vercel 요청 상한 4.5MB 아래 (R-51 · DEP-18) — 화면이 2400px JPEG 로 줄여 보낸다
  live: 16 * 1024,
  state: 256 * 1024,
};

/**
 * Host 헤더 확인. 127.0.0.1:<port> 와 서버 모드의 공개 주소들(docs/08-tech.md 11-1 · 11-2)만 통과.
 * localhost:<port> 는 127.0.0.1 로 이동 (브라우저 저장소를 하나로 유지).
 * @returns {boolean} true 면 계속 처리, false 면 이미 응답함
 */
export function checkHost(req, res, { port, publicOrigins = [] }) {
  const host = (req.headers.host ?? '').toLowerCase();
  if (host === `127.0.0.1:${port}`) return true;
  if (publicOrigins.some((o) => host === new URL(o).host)) return true;
  if (host === `localhost:${port}`) {
    res.writeHead(302, { Location: `http://127.0.0.1:${port}${req.url}` });
    res.end();
    return false;
  }
  sendJson(res, 403, { error: '허용되지 않은 주소입니다' });
  return false;
}

/** 쓰기 요청(PUT · POST · DELETE) — X-Camp-App 헤더 + 같은 출처 (서버 모드는 공개 주소들도) */
export function checkWrite(req, { port, publicOrigins = [] }) {
  if (req.method !== 'PUT' && req.method !== 'POST' && req.method !== 'DELETE') return;
  if (req.headers['x-camp-app'] !== '1') throw new HttpError(403, 'X-Camp-App 헤더가 없습니다');
  const origin = req.headers.origin;
  if (origin !== `http://127.0.0.1:${port}` && !publicOrigins.includes(origin)) throw new HttpError(403, '다른 출처의 요청은 받지 않습니다');
}

export async function readBody(req, limit) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) {
    req.resume();
    throw new HttpError(413, '요청이 너무 큽니다');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '요청이 너무 큽니다');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = LIMITS.json) {
  const buf = await readBody(req, limit);
  try {
    return JSON.parse(buf.toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'JSON 형식이 올바르지 않습니다');
  }
}

export function sendJson(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendEmpty(res, status = 204, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end();
}

/** 쿠키 읽기 */
export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 오류 응답 — 내부 경로 · 스택은 터미널에만 */
export function sendError(res, err, log) {
  if (err instanceof HttpError) {
    if (!res.headersSent) sendJson(res, err.status, { error: err.message, ...(err.extra ?? {}) });
    else res.end();
    return;
  }
  log?.(`⚠ 서버 오류: ${err?.stack ?? err}`);
  if (!res.headersSent) sendJson(res, 500, { error: '서버 오류가 발생했습니다' });
  else res.end();
}
