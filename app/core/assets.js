// 이미지 주소 (R-70, docs/08-tech.md 11-7) — 운영(Redis 저장소)은 이미지가 Blob 에 있어 "경로 → Blob 주소" 표를 한 번 받아
// <img> 에 Blob 주소를 바로 쓴다. 이미지마다 서버 함수를 타지 않는다 — 캐시는 Blob CDN · 브라우저가 한다.
// 노트북 모드(파일 저장소)는 표가 없어(null) /assets/… 를 그대로. 표를 못 받았을 때도 /assets/… (서버가 302 로 안내)

let urls = null;

/** 표 받기 — 화면 시작 · 데이터가 바뀌었을 때. 못 받으면 가진 표 그대로 */
export async function loadAssetUrls() {
  try {
    const res = await fetch('/api/assets', { cache: 'no-store' });
    if (res.ok) urls = (await res.json()).images ?? null;
  } catch { /* 서버 끊김 — 가진 표 그대로 */ }
  return urls;
}

/** <img src> 에 쓸 주소 */
export const assetUrl = (path) => urls?.[path] ?? `/${path}`;

/** 있는지 — 표가 있으면 표로(네트워크 없이), 없으면 undefined (HEAD 로 확인) */
export const assetKnown = (path) => (urls ? Object.hasOwn(urls, path) : undefined);

/** 관리 페이지가 막 올린 이미지 (서버가 돌려준 Blob 주소) */
export function setAssetUrl(path, url) {
  if (urls && url) urls[path] = url;
}

/** 표를 통째로 — 공개 모드 /play 는 /api/public 이 함께 준 표 (R-96). 테스트도 */
export function setAssetUrls(value) {
  urls = value;
}
export const setAssetUrlsForTest = setAssetUrls;
