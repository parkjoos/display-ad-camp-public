// 사람이 보는 시각은 한국 시간 — 프로세스 시간대가 UTC(Vercel)여도 (R-51, docs/08-tech.md 11-5)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, clock } from '../server/files.mjs';

test('백업 파일 이름 · 로그 시각 — 서버가 UTC 로 돌아도 한국 시간', (t) => {
  const tz = process.env.TZ;
  process.env.TZ = 'UTC'; // Vercel 함수와 같게
  t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
  const at = new Date('2026-10-14T08:32:18Z'); // 한국 17:32:18
  assert.equal(at.getHours(), 8, '이 프로세스는 UTC');
  assert.equal(stamp(at), '20261014-173218');
  assert.equal(clock(at), '17시 32분 18초');
  assert.equal(stamp(new Date('2026-10-29T15:00:00Z')), '20261030-000000', '자정은 00시 (24시 아님), 날짜도 한국 기준');
  assert.equal(clock(new Date('2026-10-29T15:09:05Z')), '0시 9분 5초', '로그 시각은 자정 0시 · 앞자리 0 없음 — Node(ICU) 판과 상관없이 (R-101)');
});
