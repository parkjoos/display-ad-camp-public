// 진행자 요약 설명서 내용 (docs/12-host-view.md 4-7, docs/04-admin.md 3-12, R-38)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideSections, MANUAL_URL } from '../app/ui/guide.js';

const text = (sections) => JSON.stringify(sections);

test('구역마다 제목과 내용(순서 또는 표)이 있음, 진행자 화면에는 관리 구역 없음 (W-28)', () => {
  const host = guideSections({ server: true });
  for (const s of host) assert.ok(s.title && (s.steps?.length || s.rows?.length), s.title);
  assert.ok(!host.some((s) => s.title.includes('관리 페이지')));
  assert.match(text(host), /\[정답 공개\]/);
  assert.match(text(host), /\[다시 추첨 ▶\]/);
});

test('관리 페이지는 관리 구역을 더함 — 백업 시점 · 리허설 뒤 초기화 (I-51)', () => {
  const admin = guideSections({ server: true, admin: true });
  const last = admin.at(-1);
  assert.match(last.title, /관리 페이지/);
  assert.match(text(last), /10\/27/);
  assert.match(text(last), /리허설 기록 지우기/);
  assert.equal(admin.length, guideSections({ server: true }).length + 1);
});

test('연결 문제 안내 — 서버 모드는 인터넷 연결, 노트북 모드는 터미널(서버) (W-29)', () => {
  const trouble = (server) => text(guideSections({ server }).find((s) => s.title.includes('이럴 땐')));
  assert.match(trouble(true), /인터넷/);
  assert.doesNotMatch(trouble(false), /인터넷/);
  assert.doesNotMatch(text(guideSections({ server: true, admin: true })), /VPN|사내/);
  assert.match(trouble(false), /터미널/);
  // 서버 모드 [나가기] 는 브라우저 전체가 잠긴다는 경고
  assert.match(text(guideSections({ server: true })), /모니터 노트북에서는 누르지 않기/);
  assert.equal(MANUAL_URL, '/docs/manual.md'); // 앱 서버가 내준다 — 바깥 저장소 주소에 기대지 않는다 (R-51)
});
