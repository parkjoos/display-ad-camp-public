// 클립보드 이미지 붙여넣기 판단 (docs/04-admin.md 3-6, R-34) — 화면과 떨어진 순수 함수 (단위 테스트)

const IMAGE_NAME = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

export const NO_IMAGE_MESSAGE = "클립보드에 이미지가 없습니다 — 웹페이지 이미지는 오른쪽 클릭 → '이미지 복사' 로 복사하세요";

/** 붙여넣은 내용에서 이미지 파일 하나 — 없으면 null. Finder 에서 복사한 이미지 파일도 여기로 온다 */
export function clipboardImage(data) {
  if (!data) return null;
  for (const file of data.files ?? []) {
    if (file.type?.startsWith('image/') || IMAGE_NAME.test(file.name ?? '')) return file;
  }
  for (const item of data.items ?? []) {
    if (item.kind === 'file' && item.type?.startsWith('image/')) {
      const file = item.getAsFile?.();
      if (file) return file;
    }
  }
  return null;
}

/**
 * `⌘V` 를 어떻게 처리할지.
 * 'image' 이미지를 넣는다 / 'text' 글자 칸의 글자 붙여넣기를 그대로 둔다 / 'none' 이미지가 없다고 안내
 */
export function pasteAction({ hasImage, hasText, typing }) {
  if (typing && hasText) return 'text';
  if (hasImage) return 'image';
  return typing ? 'text' : 'none';
}
