// 이미지 Blob 저장소 (R-67, docs/08-tech.md 11-7) — Vercel Blob 공개 저장소.
// SDK(@vercel/blob — D-34)는 켤 때만 불러온다: 노트북 모드 · 저장 폴더 서버 모드는 설치 없이 그대로. 테스트는 같은 모양의 가짜를 넣는다

/**
 * @param token Blob 읽기 · 쓰기 토큰 (BLOB_READ_WRITE_TOKEN — 로그에 찍지 않는다)
 * @param referer 서버가 Blob 에서 받을 때 붙일 Referer — 저장소 방화벽이 Referer 로 막는다 (R-69, 16-deploy 2-4)
 * @param load SDK 불러오기 (테스트가 실패를 흉내 낼 때만 바꾼다)
 */
export async function createBlob({ token, referer = null, load = () => import('@vercel/blob') }) {
  const sdk = await load();
  return {
    label: 'Vercel Blob (공개)',
    /** 올리고 주소를 돌려준다 — 올릴 때마다 무작위 접미사로 새 주소 (CDN · 브라우저 캐시가 옛 사진을 보여 주지 않게) */
    async put(pathname, bytes, contentType) {
      const r = await sdk.put(pathname, bytes, { access: 'public', addRandomSuffix: true, contentType, token });
      return r.url;
    },
    /** 지우기 (무료) — 없는 주소여도 오류 없음 */
    async del(urls) {
      if (urls.length) await sdk.del(urls, { token });
    },
    get: (url) => fetchBytes(url, referer),
  };
}

/**
 * 공개 주소에서 바이트 받기 — 백업 내려받기처럼 서버가 내용이 필요할 때 (Blob 데이터 전송에 셈).
 * referer: 우리 주소 — 브라우저의 <img> 처럼 보내야 저장소 방화벽(Referer 검사 — R-69)을 지난다
 */
export async function fetchBytes(url, referer = null) {
  const res = await fetch(url, referer ? { headers: { Referer: referer } } : undefined);
  if (!res.ok) throw new Error(`이미지를 Blob 에서 받지 못했습니다 (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
