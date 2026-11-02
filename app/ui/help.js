// 도움말 — 지금 화면에서 쓸 수 있는 단축키 (docs/06-controls.md)

// 메뉴 · 도움말 키(M · ?)는 없앴다 — ☰ 버튼 · 메뉴의 [도움말] 로 (R-73)
const COMMON = [['F', '전체화면'], ['Esc', '열린 창 닫기 (메뉴 · 도움말 · 확인창 등)']];

export function helpRows(app) {
  const r = app.route;
  if (r.view === 'title') return COMMON; // 제목 화면 키 없음 — ☰ · [이어하기] 버튼으로 (R-73)
  if (r.view === 'gameHome') return COMMON; // 게임 홈 키 없음 — 카드 · 버튼 클릭으로 (R-76)
  if (r.view === 'pointsTable') return [['↑ ↓', '강조 행 이동'], ['Enter / Esc', '강조 행 크게 보기 / 표로'], ['E', '수정 모드'], ...COMMON];
  // 발표 화면의 다음 순위 공개는 Enter (R-85)
  if (r.view === 'scoreboard') return [['방향키', '칸 이동'], ['1 ~ 4', '(등수 라운드) 등수'], ['S / F', '(성공 · 실패 라운드) 성공 / 실패'], ['숫자 + Enter', '(직접 입력 라운드) 값'], ['Backspace', '칸 지우기'], ['E', '칸 점수 직접 수정'], ['P', '발표 화면'], ['B', '배점표'], ...COMMON];
  if (r.view === 'teamSettings') return [['Enter', '저장'], ['Esc', '취소'], ...COMMON];
  if (r.view === 'stats') return [['1 · 2 · 3', '종합 점수 추이 · 팀별 통계 · 문제 기록'], ['→', '다음 탭 (한 바퀴)'], ['↑ ↓ · PageUp PageDown', '넘기기'], ...COMMON]; // R-58
  if (r.view !== 'play') return COMMON;
  const s = app.playing();
  if (!s) return COMMON;
  // 줄줄이 말해요는 키 없음 — 주제 고르기 · 다음 주제 · 문제 · 끝내기는 진행자 화면 버튼으로 (R-85)
  if (s.type === 'roulette') return COMMON;
  // 이모티콘 퀴즈는 룰렛 없음 — 문제는 진행자 화면 [내기] 로 고른다 (R-90)
  const pick = s.type === 'emoji';
  if (pick && s.screen === 'roulette') return [['Enter', '(문제를 다 냈으면) 결과로'], ...COMMON];
  if (pick && (s.screen === 'question' || s.screen === 'answer')) return [['Enter', '정답 공개 · (정답 공개 뒤) 카테고리 목록. 맞힌 팀을 안 정했으면 확인창'], ...COMMON];
  // 카테고리 넣기 · 빼기는 진행자 화면에서만 (R-72)
  if (s.screen === 'roulette') return [['Enter', '돌리기 · (정지 후) 확정 · (문제 없음) 결과로'], ['Backspace', '(정지 후) 돌리기 전으로 — 다시 돌리기 (R-84)'], ...COMMON]; // E · R (R-77) · → · Space (R-79) 는 룰렛에서 뺌
  // 넘기기는 모두 Enter 만 — → · Space · PageDown 은 R-85 에서 뺌
  // Backspace(되돌리기)는 R-83 에서 모든 진행 화면에서 뺌 — 고치기는 진행자 화면 [📝 정답 기록]
  if (s.screen === 'round') return [['Enter', '첫 문제'], ...COMMON]; // R-82
  // 라운드 종료 화면 (R-56) — Shift+N(한 라운드 더) · B(팀 점수에 반영)는 R-85, E · R 은 R-80 에서 뺌
  if (s.screen === 'roundEnd') return [['Enter', '다음 라운드 · 결과'], ...COMMON];
  // S(추가 문제) · B(점수판 채우기 창) · H(게임 홈)는 R-85 에서 뺌
  if (s.screen === 'result') return [['Enter', '다음 순위 공개'], ...COMMON];
  return [
    ['Enter', '정답 공개 · (정답 공개 뒤) 다음 — 라운드 끝 정답에서는 라운드 종료. 맞힌 팀을 안 정했으면 확인창'], // R-82 · R-85 · R-86
    // 힌트 단계 · 힌트 (R-78), 맞힌 팀 · 득점 취소 · 정답 영상 (R-81), 한 문제 더 (R-85) 는 진행자 화면 버튼으로. E · R 은 뺌 (R-80)
    ...COMMON,
  ];
}
