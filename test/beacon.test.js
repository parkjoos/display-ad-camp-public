// 연결 끊김 비콘 — 화면에 "연결 끊김" 이 뜰 때 그때 응답 시간을 실어 로그 한 줄 (R-66, 11-acceptance-tests X-53)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/app.mjs';
import { parseBeacon, beaconLine } from '../server/beacon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // 실행할 때마다 무작위 6자리 — 저장소에 고정 PIN 을 두지 않는다 (R-105)
const ORIGIN = 'https://camp.test';
const HOST = 'camp.test';
const logs = [];
let app, dataDir, cookie;

before(async () => {
  dataDir = join(await mkdtemp(join(tmpdir(), 'camp-beacon-')), 'data');
  app = await createAppServer({ root: ROOT, dataRoot: dataDir, port: 0, pin: PIN, publicOrigin: ORIGIN, log: (m) => logs.push(m) });
  cookie = String((await req('/api/login', { body: { pin: PIN } })).headers['set-cookie'][0]).split(';')[0];
});
after(async () => {
  await app.close();
  await rm(dirname(dataDir), { recursive: true, force: true });
});

function req(path, { headers = {}, body, withCookie = true } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: app.ctx.port, path, method: 'POST',
      headers: { Host: HOST, 'X-Camp-App': '1', Origin: ORIGIN, 'Content-Type': 'application/json', ...(withCookie && cookie ? { Cookie: cookie } : {}), ...headers },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('비콘 한 줄 — 화면 · 이유 · 화면 시각 · 응답 시간(구간별) · 도착 지연 · 가려짐 (X-53)', () => {
  const now = Date.UTC(2026, 9, 27, 2, 9, 30); // 11:09:30 KST
  const b = parseBeacon({ screen: 'game', reason: 'stream', id: 'g-n0yasyncmvoybkv3', at: now - 2100, vis: 'hidden', online: true, rtt: 2904, dns: 0, conn: 0, wait: 2902 });
  const line = beaconLine(b, '203.0.113.7', now);
  assert.match(line, /^⚠ 11시 9분 30초 연결 끊김 — 게임 화면 g-n0yasy · 실시간 연결 오류 · 화면 11시 9분 27초 · 응답 2,904ms \(DNS 0 · 연결 0 · 요청→첫 응답 2,902\) · 도착 2\.1초 뒤 · 화면 가려짐 203\.0\.113\.7$/);
  // 응답을 못 받음 · 구간 없음 · 기기 오프라인
  const failed = beaconLine(parseBeacon({ screen: 'admin', reason: 'health', at: now - 31000, rtt: 30000, err: 'timeout', vis: 'visible', online: false }), '', now);
  assert.match(failed, /관리 페이지 · 서버 확인 실패 · 화면 11시 8분 59초 · 응답 응답 없음\(30초\) 30,000ms · 도착 31\.0초 뒤 · 기기 오프라인$/);
  // 기기 시계가 하루 넘게 어긋나면 도착 지연은 적지 않는다
  assert.doesNotMatch(beaconLine(parseBeacon({ screen: 'host', reason: 'stream', at: now + 3 * 86_400_000 }), '', now), /도착/);
});

test('비콘 값 정리 — 모르는 화면 · 이유는 400, 이상한 id · 숫자 · 오류는 버림 (X-53)', () => {
  assert.throws(() => parseBeacon({ screen: 'evil', reason: 'stream' }), (e) => e.status === 400);
  assert.throws(() => parseBeacon({ screen: 'game', reason: 'x' }), (e) => e.status === 400);
  assert.throws(() => parseBeacon(null), (e) => e.status === 400);
  const b = parseBeacon({ screen: 'game', reason: 'save', id: 'a b<script>', rtt: -5, dns: 1.5, conn: 999_999_999, wait: '12', err: 'boom', at: 'x' });
  assert.deepEqual(b, { screen: 'game', reason: 'save', id: null, at: null, rtt: null, dns: null, conn: null, wait: null, err: null, hidden: false, offline: false });
  assert.doesNotMatch(beaconLine(b, ''), /script|응답|화면 \d+시/);
});

test('POST /api/live/beacon — 204 + 로그 한 줄, 로그인 · 앱 헤더 · 형식 검사 (X-53)', async () => {
  logs.length = 0;
  const at = Date.now() - 1500;
  const ok = await req('/api/live/beacon', { body: { screen: 'host', reason: 'stream', id: 'h-abc12345', at, vis: 'visible', online: true, rtt: 1810, dns: 0, conn: 0, wait: 1806 } });
  assert.equal(ok.status, 204);
  const line = logs.find((l) => l.includes('연결 끊김'));
  assert.match(line, /진행자 화면 h-abc123 · 실시간 연결 오류 · 화면 .+ · 응답 1,810ms \(DNS 0 · 연결 0 · 요청→첫 응답 1,806\) · 도착 1\.\d초 뒤/);
  assert.equal((await req('/api/live/beacon', { body: { screen: 'x', reason: 'stream' } })).status, 400);
  assert.equal((await req('/api/live/beacon', { body: { screen: 'game', reason: 'save' }, headers: { 'X-Camp-App': '' } })).status, 403);
  assert.equal((await req('/api/live/beacon', { body: { screen: 'game', reason: 'save' }, withCookie: false })).status, 401, '서버 모드는 입장한 화면만');
  assert.equal(logs.filter((l) => l.includes('연결 끊김')).length, 1, '거절된 비콘은 로그에 없다');
});
