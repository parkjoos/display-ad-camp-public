// 쓰지 않는 이미지 정리 화면 (docs/04-admin.md 3-14, R-68) — 문제가 가리키지 않는 이미지를 하나씩 보면서 지운다
import { h, replace } from '../ui/dom.js';
import { A, go, toast, loadAppGames, loadGame } from './main.js';
import { api } from './api.js';
import { assetUrl } from '../core/assets.js';

const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${n ? Math.max(1, Math.round(n / 1024)) : 0}KB`);
const when = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 경로 → 게임 · 카테고리 이름 (카테고리를 지웠으면 id 그대로) */
function labels(img) {
  const [, gameId, catId, file] = img.path.split('/');
  const g = A.games[gameId]?.data;
  const c = g?.categories?.find((x) => x.id === catId);
  return { game: g?.title ?? gameId, cat: c ? `${c.icon ?? ''} ${c.name}`.trim() : `${catId} (없는 카테고리)`, file };
}

export async function imagesPage(body) {
  replace(body, h('div.a-section', h('div.small-note', '찾는 중…')));
  if (!A.appGames.length) await loadAppGames();
  await Promise.all(A.appGames.map((id) => (A.games[id] ? null : loadGame(id).catch(() => null))));
  const { images, skipped } = await api.unusedImages();
  let at = 0;
  let busy = false;

  const move = (d) => {
    if (busy || !images.length) return;
    at = (at + d + images.length) % images.length;
    draw();
  };

  async function remove() {
    const img = images[at];
    if (busy || !img) return;
    busy = true;
    draw();
    try {
      await api.deleteImage(img.path);
      images.splice(at, 1);
      if (at >= images.length) at = Math.max(0, images.length - 1);
      toast(`지웠습니다 — ${labels(img).file} (${size(img.size)})`);
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      draw();
    }
  }

  function viewer() {
    const img = images[at];
    const l = labels(img);
    return h('div.a-section.a-imgclean',
      h('div.a-row',
        h('b', `${at + 1} / ${images.length}`),
        h('span', `${l.game} › ${l.cat}`),
        h('code.small-note', l.file)),
      // 미리보기는 주소 표의 Blob 주소 (R-70) — 표가 없으면(노트북 모드) 서버 경로
      h('div.a-imgclean-view', h('img', { src: assetUrl(img.path), alt: l.file })),
      h('div.small-note', `${size(img.size)} · ${when(img.mtimeMs)} 저장`),
      h('div.a-row',
        h('button.btn', { onclick: () => move(-1), disabled: busy || images.length < 2 }, '◀ 이전'),
        h('button.btn', { onclick: () => move(1), disabled: busy || images.length < 2 }, '다음 ▶'),
        h('button.btn.danger', { onclick: remove, disabled: busy }, busy ? '지우는 중…' : '🗑 이 이미지 지우기')),
      h('div.small-note', '← → 키로 넘겨 봅니다. 지우기는 되돌릴 수 없습니다.'));
  }

  function list() {
    return h('table.a-table',
      h('tr', h('th', ''), h('th', '게임 › 카테고리'), h('th', '파일'), h('th', '크기')),
      images.map((img, i) => {
        const l = labels(img);
        return h(`tr${i === at ? '.a-imgclean-on' : ''}`, { onclick: () => { if (!busy) { at = i; draw(); window.scrollTo(0, 0); } }, style: { cursor: 'pointer' } },
          h('td', String(i + 1)), h('td', `${l.game} › ${l.cat}`), h('td', h('code', l.file)), h('td', size(img.size)));
      }));
  }

  function draw() {
    const total = images.reduce((n, x) => n + x.size, 0);
    replace(body,
      h('div.a-section',
        h('h2', '안 쓰는 이미지 정리'),
        h('div.a-msg.info', images.length
          ? `문제에서 쓰지 않는 이미지 ${images.length}개 · ${size(total)} — 문제를 지우거나 이미지를 바꾸면 옛 파일이 남습니다. 큰 것부터 보여 줍니다.`
          : '문제에서 쓰지 않는 이미지가 없습니다 ✔'),
        skipped.length ? h('div.a-msg.warn', `데이터 파일을 읽을 수 없는 게임은 빼고 찾았습니다: ${skipped.join(', ')}`) : null,
        images.length ? h('div.a-msg.warn', '지운 이미지는 되돌릴 수 없습니다. 보관하려면 먼저 백업을 내려받으세요 (이미지가 함께 들어갑니다). 예전 문제 백업으로 되돌리면 지운 이미지는 없는 이미지(W02)로 보입니다.') : null,
        images.length ? h('div.a-row', h('button.btn.small', { onclick: () => go({ page: 'archive' }) }, '💾 백업 내려받기 · 올리기')) : null),
      images.length ? viewer() : null,
      images.length ? h('div.a-section', list()) : null);
  }

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, dialog')) return;
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
  };
  document.addEventListener('keydown', onKey);
  draw();
  return () => document.removeEventListener('keydown', onKey);
}
