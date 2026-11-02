// 연결 끊김 비콘 — 화면에 "연결 끊김" 이 뜰 때 그때의 응답 시간을 실어 보낸 것을 로그 한 줄로 (R-66, docs/08-tech.md 11-4)
// 받는 값은 정해진 이름 · 숫자만 — 로그에 아무 글자나 들어가지 않게
import { HttpError } from './guard.mjs';
import { clock } from './files.mjs';

const SCREENS = { game: '게임 화면', host: '진행자 화면', admin: '관리 페이지' };
const REASONS = { stream: '실시간 연결 오류', save: '상태 저장 실패', health: '서버 확인 실패', request: '요청 실패' };
const ERRORS = { timeout: '응답 없음(30초)', network: '네트워크 오류' };
const DAY_MS = 86_400_000;

const ms = (v) => (Number.isInteger(v) && v >= 0 && v <= 600_000 ? v : null);
const comma = (v) => v.toLocaleString('en-US');

/** 받은 본문 → 정리된 값. 화면 · 이유가 없거나 모르는 값이면 400 */
export function parseBeacon(body) {
  if (!body || typeof body !== 'object' || !SCREENS[body.screen] || !REASONS[body.reason]) throw new HttpError(400, '비콘 형식이 올바르지 않습니다');
  return {
    screen: body.screen,
    reason: body.reason,
    id: typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(body.id) ? body.id : null,
    at: Number.isFinite(body.at) ? body.at : null,
    rtt: ms(body.rtt), dns: ms(body.dns), conn: ms(body.conn), wait: ms(body.wait),
    err: ERRORS[body.err] ? body.err : null,
    hidden: body.vis === 'hidden',
    offline: body.online === false,
  };
}

/**
 * 로그 한 줄 — 언제(화면 시각) · 어느 화면 · 왜 · 그때 응답 시간(구간별) · 서버에 늦게 도착한 만큼.
 * 화면 시각은 그 기기의 시계라 몇 초 어긋날 수 있다 — 하루 넘게 어긋나면 도착 지연은 적지 않는다
 */
export function beaconLine(b, where, now = Date.now()) {
  const parts = [`${SCREENS[b.screen]}${b.id ? ` ${b.id.slice(0, 8)}` : ''}`, REASONS[b.reason]];
  if (b.at != null) parts.push(`화면 ${clock(new Date(b.at))}`);
  if (b.err) parts.push(`응답 ${ERRORS[b.err]}${b.rtt != null ? ` ${comma(b.rtt)}ms` : ''}`);
  else if (b.rtt != null) {
    const phases = [['DNS', b.dns], ['연결', b.conn], ['요청→첫 응답', b.wait]].filter(([, v]) => v != null);
    parts.push(`응답 ${comma(b.rtt)}ms${phases.length ? ` (${phases.map(([k, v]) => `${k} ${comma(v)}`).join(' · ')})` : ''}`);
  }
  const late = b.at != null ? now - b.at : null;
  if (late != null && late >= 0 && late < DAY_MS) parts.push(`도착 ${(late / 1000).toFixed(1)}초 뒤`);
  if (b.hidden) parts.push('화면 가려짐');
  if (b.offline) parts.push('기기 오프라인');
  return `⚠ ${clock(new Date(now))} 연결 끊김 — ${parts.join(' · ')} ${where}`.trimEnd();
}
