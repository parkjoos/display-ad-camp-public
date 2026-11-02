// 백업 내려받기 · 올리기 화면 (docs/04-admin.md 3-11, R-37)
import { h, replace } from '../ui/dom.js';
import { A, go, toast, confirmBox, dialog, loadAppGames } from './main.js';
import { api, readState } from './api.js';
import { listTar, classifyEntry, checkArchive, ARCHIVE_LIMIT } from '../core/tar.js';
import { resumeLabel } from '../core/state.js';

const mb = (n) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}MB`;
/** 요청 하나에 보내는 이미지 조각 — 서버(Vercel) 요청 상한 4.5MB 아래 (R-51 · DEP-18) */
const PART = 4 * 1024 * 1024;

/**
 * 나눠 올리기 — 시작(목록 · 문제 · 상태 JSON → 서버가 검사 · 자동 백업) → 이미지(4MB 조각) → 끝(문제 · 상태 쓰기).
 * 요청마다 4.5MB 아래라 Vercel 에서도 큰 백업을 올릴 수 있다. onProgress(보낸 바이트, 전체, 보낸 이미지 수, 전체 수)
 */
async function uploadInParts({ bytes, items, textOf }, chosen, parts, onProgress) {
  const texts = {};
  for (const it of chosen) if (it.cls.kind !== 'image') texts[it.path] = textOf(it);
  const started = await api.archiveBegin({ parts, items: chosen.map(({ path, size }) => ({ path, size })), texts });
  const byPath = new Map(items.map((it) => [it.path, it]));
  const total = started.images.reduce((n, x) => n + x.size, 0);
  let sent = 0;
  for (let i = 0; i < started.images.length; i++) {
    const it = byPath.get(started.images[i].path);
    let offset = 0;
    do {
      const end = Math.min(it.size, offset + PART);
      await api.archivePart(started.id, it.path, offset, bytes.slice(it.offset + offset, it.offset + end));
      sent += end - offset;
      offset = end;
      onProgress(sent, total, i + (offset >= it.size ? 1 : 0), started.images.length);
    } while (offset < it.size);
  }
  return api.archiveFinish(started.id);
}

/** 응답(tar)을 파일로 저장 — 이름은 서버가 준 것 */
async function saveResponse(res, fallbackName) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `내려받기 실패 (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { name, size: blob.size };
}

/** 고른 tar 파일 → 미리보기 재료 (브라우저 안에서만 읽는다 — 서버에 보내기 전) */
async function readArchiveFile(file) {
  if (file.size > ARCHIVE_LIMIT) throw new Error(`파일이 너무 큽니다 (${mb(file.size)} — 300MB 까지)`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = listTar(bytes);
  const items = [];
  const skipped = [];
  for (const en of entries) {
    const cls = classifyEntry(en.path, en.type);
    if (cls.dir) continue;
    if (cls.skip) { skipped.push({ path: en.path, reason: cls.skip }); continue; }
    items.push({ path: en.path.replace(/^\.\//, ''), size: en.size, cls, offset: en.offset });
  }
  const dec = new TextDecoder();
  const textOf = (it) => dec.decode(bytes.subarray(it.offset, it.offset + it.size));
  return { bytes, items, skipped, textOf };
}

export async function archivePage(body) {
  if (!A.appGames.length) await loadAppGames();
  const auto = await api.autoBackups().catch(() => []);

  const download = async (btn) => {
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    try {
      const { name, size } = await saveResponse(await api.archive(), 'camp-game.tar');
      toast(`${name} (${mb(size)}) 을 내려받았습니다`);
    } catch (e) { toast(e.message); }
    btn.disabled = false;
    btn.textContent = '⬇ 백업 내려받기';
  };

  const preview = h('div');
  const fileInput = h('input', {
    type: 'file', accept: '.tar,application/x-tar',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try { showPreview(file, await readArchiveFile(file)); } catch (err) { replace(preview, h('div.a-msg.err', err.message)); }
    },
  });

  function showPreview(file, archive) {
    const { items, skipped, textOf } = archive;
    const parts = { data: true, state: true };
    const box = (key, label) => h('label', h('input', { type: 'checkbox', checked: true, onchange: (e) => { parts[key] = e.target.checked; draw(); } }), ' ', label);
    const result = h('div');
    const draw = () => {
      const chosen = items.filter((it) => parts[it.cls.part]);
      const r = checkArchive(chosen, textOf);
      const games = Object.entries(r.games);
      const allSkipped = [
        ...skipped,
        ...items.filter((it) => !parts[it.cls.part]).map((it) => ({ path: it.path, reason: it.cls.part === 'state' ? '현장 상태는 고르지 않음' : '문제 · 이미지는 고르지 않음' })),
        ...r.skipped,
      ];
      const upload = async () => {
        const st = await readState().catch(() => ({ sessions: {} }));
        const active = Object.entries(st.sessions ?? {})
          .filter(([, v]) => v?.data && !v.data.empty && v.data.status === 'active')
          .map(([id, v]) => resumeLabel(v.data, { title: A.games[id]?.data?.title ?? id }));
        const what = [parts.data && '문제 · 이미지', parts.state && '현장 상태(팀 · 진행 기록 · 점수판)'].filter(Boolean).join(', ');
        const warn = active.length ? `\n\n⚠ 진행 중인 게임이 있습니다 (${active.join(', ')}) — 게임 진행 중에는 올리지 마세요.` : '';
        if (!(await confirmBox({
          title: '백업 올리기',
          message: `${file.name} 의 ${what} 로 서버의 같은 이름 파일을 덮어씁니다. 서버에만 있는 파일은 남습니다.\n올리기 전 지금 문제 · 현장 상태는 자동 백업으로 남깁니다 (이미지는 지우지 않으므로 빼고).${warn}`,
          ok: '올리기', danger: true,
        }))) return;
        const progress = h('div.a-msg.info', '올리는 중…');
        replace(result, progress);
        try {
          const res = await uploadInParts(archive, chosen, Object.keys(parts).filter((k) => parts[k]), (sent, total, done, count) => {
            progress.textContent = `올리는 중… 이미지 ${done} / ${count} (${mb(sent)} / ${mb(total)}) — 창을 닫지 마세요`;
          });
          A.games = {};
          await dialog({ title: '올렸습니다', message: `파일 ${res.written}개를 썼습니다${res.skipped?.length ? ` (건너뜀 ${res.skipped.length}개)` : ''}.\n올리기 전 내용: ${res.autoBackup} (이 화면의 자동 백업 목록)`, buttons: [{ label: '확인', value: true, primary: true }] });
          go({ page: 'archive' });
        } catch (e) {
          if (e.body?.errors?.length) replace(result, h('div.a-msg.err', e.message), h('ul.error-list', e.body.errors.map((x) => h('li', h('b', x.path), x.message))));
          else { toast(e.message); draw(); }
        }
      };
      replace(result,
        h('table.a-table',
          h('tr', h('th', '담긴 것'), h('th', '')),
          h('tr', h('td', '문제 · 데이터 (data/)'), h('td', `${r.counts.data}개`)),
          h('tr', h('td', '이미지 (assets/)'), h('td', `${r.counts.assets}개`)),
          h('tr', h('td', '현장 상태 (state/)'), h('td', r.counts.state ? `${r.counts.state}개 — 팀 설정 · 진행 기록 · 점수판` : '없음'))),
        games.length > 0 && h('table.a-table',
          h('tr', h('th', '게임'), h('th', '카테고리'), h('th', '문제')),
          games.map(([id, g]) => h('tr', h('td', `${g.title} `, h('code.small-note', id)), h('td', g.categories), h('td', g.questions)))),
        r.errors.length > 0 && h('div.a-msg.err', '검증 오류가 있어 올릴 수 없습니다'),
        r.errors.length > 0 && h('ul.error-list', r.errors.map((x) => h('li', h('b', x.path), x.message))),
        allSkipped.length > 0 && h('details', h('summary.small-note', `건너뜀 ${allSkipped.length}개`),
          h('ul.error-list', allSkipped.slice(0, 200).map((x) => h('li.warn', h('b', x.path), x.reason)))),
        h('div.a-row', h('button.btn.danger.fill', { disabled: r.errors.length > 0 || r.keep.length === 0, onclick: upload }, '⬆ 올리기')));
    };
    replace(preview, h('div.a-section',
      h('h3', `${file.name} (${mb(file.size)})`),
      h('div.a-row', h('span.small-note', '올릴 것:'), box('data', '문제 · 이미지 (data/ · assets/)'), box('state', '현장 상태 (state/)')),
      result));
    draw();
  }

  const downloadBtn = h('button.btn.primary', { onclick: (e) => download(e.currentTarget) }, '⬇ 백업 내려받기');
  replace(body,
    h('div.a-section',
      h('h2', '💾 백업 내려받기 · 올리기 (R-37)'),
      h('div.a-msg.info', `이 서버의 문제 · 이미지 · 현장 상태(data/ · assets/ · state/)를 파일 하나(.tar)로 받거나, 받은 파일로 되돌립니다. ${A.server ? '잘못 저장 · 초기화에 대비해 리허설 뒤 · 행사 전날 · 끝난 뒤에 받아 두세요.' : '노트북 모드 — 서버로 옮길 때는 여기서 받아 서버 관리 페이지에서 올리세요.'}`),
      h('div.a-row', downloadBtn, h('span.small-note', 'Mac 에서 더블클릭하면 data · assets · state 폴더로 풀립니다'))),
    h('div.a-section',
      h('h2', '⬆ 백업 올리기'),
      h('div.small-note', '파일을 고르면 먼저 이 화면에서 내용을 보여줍니다 (서버에는 [올리기] 를 눌러야 보냅니다).'),
      fileInput,
      preview),
    h('div.a-section',
      h('h2', '올리기 전 자동 백업'),
      auto.length === 0 ? h('div.small-note', '아직 없습니다 (올리기 때마다 직전 문제 · 현장 상태를 남깁니다, 최근 3개 — 이미지는 빼고)')
        : h('table.a-table', h('tr', h('th', '시각'), h('th', '크기'), h('th', '')),
          auto.map((b) => h('tr', h('td', b.savedAt), h('td', mb(b.size)),
            h('td', h('button.btn.small', { onclick: async () => { try { await saveResponse(await api.autoBackup(b.file), b.file); } catch (e) { toast(e.message); } } }, '내려받기')))))));
}
