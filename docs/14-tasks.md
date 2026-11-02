# 14. 작업 목록

진행할 작업을 범주별로 나눈다. 날짜별 큰 일정은 [10-schedule.md](10-schedule.md), 완료 판정은 [11-acceptance-tests.md](11-acceptance-tests.md).

- 구현은 10/06 시작 지시에 따라 이 목록 순서대로 진행한다. 저장소 권한(CHK-1)은 나중에.
- 상태: 대기 / 진행 중 / 완료. 작업을 시작 · 끝낼 때 상태 열을 고친다. 구현 작업의 "완료" 는 구현 · 단위 테스트(`npm test`) · 브라우저 동작 확인까지 — 검수 시나리오 전체 통과는 QA-1 에서 따로 본다.
- **진행 현황 (10/06)**: BASE · CORE · SRV · GAME · HOST · SB · ADMIN 전부, DATA-1 ~ 4 완료. QA-1 1차 완료 — 결함 26건을 고쳤고 실제 장비 확인만 남음 ([15-qa-results.md](15-qa-results.md)). 테스트 47개 통과.
- **10/07**: R-33 (득점형 타이머 제거, `D-20`) — CORE-6 · GAME-13 · HOST-4 · ADMIN-9 · QA-5 완료 (G-10 ~ G-14 통과, 테스트 48개). R-34 (관리 페이지 클립보드 이미지 붙여넣기) — ADMIN-10 · QA-6 완료 (I-45 ~ I-49 통과, 테스트 50개 — 실제 `⌘V` 는 행사 노트북에서). R-35 (진행자 화면에서 다음 문제 지정 — 이번 라운드 안) — CORE-7 · GAME-14 · HOST-5 · QA-7 완료 (W-24 ~ W-27 통과, 테스트 50개).
- **10/08**: R-36 (서버 모드 — 진행자 휴대폰 접속, `D-21`) — DEP-1 ~ DEP-5 완료 (테스트 58개). DEP-6 · DEP-7(이미지 빌드 · 매니페스트)은 이전 운영 환경용 — R-51 로 뺌. QA-8 은 노트북에서 흉내 낸 서버 모드로 X-1 ~ X-17 · X-23 통과.
- **10/08 (2)**: R-37 (게임 데이터 · 저장 데이터를 git 대신 서버 저장 폴더(볼륨)에, `D-22` — NFS 는 저장이 느려 쓰지 않음) — DEP-9 · DEP-10 완료 (테스트 66개), DEP-11 은 `state/` 추적 해제(커밋 때)만 남음. QA-9 는 노트북에서 확인.
- **10/08 (3)**: 입구를 클러스터 기본 입구(로드밸런서)로 (`D-23`), 서버 모드 연결 유지 190초 (X-30, 테스트 67개 — R-51 로 뺌). 앱 첫 배포 (DEP-8).
- **10/08 (4)**: `CAMP_PUBLIC_ORIGIN` 이 쉼표로 여러 도메인을 받음 (첫 번째가 대표, X-31, 테스트 68개).
- **10/09**: R-38 (앱 안 진행자 설명서) · R-39 (이모티콘 정답 이미지) 완료 (테스트 72개, 서버 반영). R-40 (라운드 수는 계획값 — [한 라운드 더 ▶]) · R-41 (정답 글자 숨기기) · R-42 (가림 문제 힌트가 마지막 상자 = 제목까지 벗기던 결함 — 다크나이트 실데이터로 찾음) 완료 (테스트 75개).
- **10/09 (2)**: R-43 — 라운드당 문제 수도 계획값 (R-40 은 라운드 수로 잘못 읽은 것 — 그대로 둠). 라운드 끝 [한 문제 더 ▶] · `N` (한 라운드 더는 `Shift+N`), 테스트 76개.
- **10/13 (R-49)**: 이모티콘 퀴즈 19명 모두 참여 · 정답 1개당 50점 — 점수판 라운드 방식 "정답 수"(SB-6), 게임 화면 · 진행자 화면 점수 표시(GAME-23 · HOST-12), 기본 배점 이모티콘 1행. 대표 차례(사진 라운드 수)는 `D-28` 미결. 서버에서 배점을 바꾼 적이 있으면 배포 뒤 라운드 설정 [기본값으로 되돌리기] 필요 (T-39). 같은 날 R-48 · R-49 배포 — 점수판 기본값은 저장 폴더 사본이라 배포 뒤 사본을 바꿈.
- **10/14 (R-50)**: 저장소를 Redis 로 — 서버 여러 개 (`D-29`, 디스크에 쓰는 저장소). 저장소 계층(파일 · Redis) · Redis 프로토콜 클라이언트 · 잠금 키 · 실시간 중계 Redis 공유(0.2초 폴링) · PIN 잠금 공유 · `CAMP_SEED` (DEP-12 완료, 테스트 105개 — Redis 테스트는 로컬 `redis-server`). 이전 운영 환경에서 서버 2개로 확인 (DEP-13).
- **10/14 (R-51)**: Vercel 로 옮기기 (`D-30`) — `vercel` 브랜치에서 사내 설정 제거 (DEP-14 완료 — 매니페스트 · 이미지 빌드 · 이전 저장소 전용 명령 · 연결 유지 190초 · VPN 안내 · 사내 주소, 테스트 104개).
- **10/14 (R-51 — 2)**: DEP-15 (Vercel 함수 진입점 `api/index.js` · `vercel.json` · 공개 파일 막기 · 시작을 `createApp` / `createAppServer` 로 나눔 · 환경 변수 읽기 공용), DEP-17 (서버가 먼저 끊고 다시 붙기 · 끊긴 사이의 명령 다시 보내기 · 연결 표시 유지), DEP-20 (이미지 ETag) 완료 — 테스트 114개, QA-17. 남은 것은 DEP-16 · DEP-18 · DEP-19.
- **10/14 (R-51 — 3)**: 새 저장소(외부 · 새 이력)로 옮김. DEP-16 (실시간 알림을 구독(pub/sub)으로 — 쉬는 동안 명령 0, 못 하면 0.2초 확인), DEP-18 (백업 나눠 올리기 · 자동 백업은 문제 · 현장 상태만 · 이미지 4MB 상한) 완료 — 테스트 120개, QA-18. 남은 것은 DEP-19 (Vercel · Upstash 준비 뒤 첫 배포 · 데이터 옮기기).
- **10/14 (R-51 — 4)**: Vercel 프로젝트 · Upstash 연결 (운영자). 첫 배포가 503 — Upstash 연결이 넣는 변수(`REDIS_URL` · `KV_URL`)를 앱이 읽지 않았음 → Vercel 에서 `CAMP_REDIS_URL` 이 없으면 그것을 읽게, 설정 오류는 응답에 빠진 설정 이름을 (DEP-19 진행 중, 테스트 121개).
- **10/14 (R-51 — 5)**: 실제 Vercel 확인 (DEP-19) — 데이터 이관이 이전 서버와 151개 파일 해시까지 같음, 명령 22개 전달 · 서버를 건너는 알림 0.22 ~ 0.24초. 닫은 화면이 최대 5분 남는 것을 찾아 DEP-21 (떠날 때 알리기) — 테스트 123개. 이어서 동시에 켜진 인스턴스의 시작 점검이 서로 부딪쳐 503 이 나던 것을 고침 (점검 파일을 시작마다 따로, 테스트 124개). 백업 파일 이름 · 백업 목록 · 로그 시각이 UTC(9시간 이르게)로 나오던 것을 한국 시간으로 (Vercel 은 TZ 를 바꿀 수 없음, 테스트 125개).
- **10/14 (R-51 — 6)**: DEP-19 완료 — 백업 내려받기(약 95MB) 16.6초, Vercel 에서 서버 데이터로 한 판 (이어하기 → 두 라운드 → 결과 → 채우기 미리보기).
- **10/14 (R-52)**: 진행자 화면에 라운드에 안 뽑힌 후보 문제 — 골라서 다음 문제로 (문제 수 그대로 · 라운드 마지막이면 하나 더, `D-31`). CORE-10 · GAME-24 · HOST-13 · QA-19 완료 (W-45 ~ W-47, 테스트 126개).
- **10/14 (R-53)**: 사진 문제 화면 스코어보드를 오른쪽 세로 열(폭 16vh)로 — 사진 칸 1920×720 → 1747×892, 가장 넓은 사진도 작아지지 않음 (`D-32`). 이모티콘 퀴즈는 아래 띠 그대로. GAME-25 · ADMIN-16 · QA-20 완료 (E-21 ~ E-23, 테스트 126개).
- **10/14 (R-54)**: 동점 추가 문제는 진행자가 진행자 화면에서 카테고리 → 문제로 고른다 (이미 낸 문제 제외, 무작위 버튼 없음). 게임 창 `S` 는 무작위 — 이 게임에 포함된 카테고리 안에서만. CORE-11 · GAME-26 · HOST-14 · QA-21 완료 (W-48 ~ W-50, 테스트 127개).
- **10/16 (R-56)**: 라운드 끝 안내 · 라운드 점수 — 라운드 마지막 정답 화면에서 진행자 화면에 "라운드가 종료되었습니다" + [한 문제 더 ▶] · [라운드 종료 ▶], 게임 화면 새 화면 라운드 종료(팀별 이번 라운드 점수 · 누적). [한 라운드 더 ▶] · `Shift+N` 은 라운드 종료 화면으로 옮김. CORE-12 · GAME-27 · HOST-15 · QA-23 완료.
- **10/16 (2) (R-57)**: 라운드마다 종합 점수판에 반영 — 라운드 종료 화면 [팀 점수에 반영], 등수 행은 라운드별 등수 목록(`ranks`)의 배점 합(사진 보고 맞추기 — 사용자 선택), 정답 수 행은 반영한 라운드 정답 수 합. 게임 결과 채우기도 같은 계산. SB-7 · GAME-28 · HOST-16 · QA-24 완료.
- **10/16 (3) (R-58)**: 게임 화면 기록 · 통계 — 종합 점수 추이(점수판 `log`) · 팀별 통계 · 문제 기록(안 낸 문제 · 공개 전 정답은 감춤). SB-8 · GAME-30 · QA-25 완료.
- **10/16 (4) (R-59)**: 정답 이미지가 문제 사진 비율로 늘어나던 결함 — 정답 이미지를 자기 비율 액자로 (GAME-29 완료). R-56 ~ R-59 는 이전 저장소에서 먼저 만든 것을 번호를 바꿔 옮겨 옴 — 테스트 136개, 검수는 15-qa-results 25 ~ 28장.
- **10/16 (5) (R-60)**: 진행자 화면 [↶ 되돌리기] 빼고 머리줄 [📝 정답 기록] — 이 게임에서 낸 문제의 맞힌 팀을 바로 고침 (진행 기록은 게임 화면이 들고 있어 관리 페이지가 아니라 진행자 화면). CORE-13 · GAME-31 · HOST-17 · QA-26 완료 (테스트 137개 — 15-qa-results 29장).
- **10/16 (6) (R-61)**: 사진 문제 정답 영상 — 유튜브 주소 + 시작 · 끝, 정답 공개 때 자동 재생 → 끝나면 정답 글자 (뮤직비디오 장면 · 명대사 — 사용자 선택). CORE-14 · GAME-32 · HOST-18 · ADMIN-17 · QA-27 완료 (테스트 139개 — 15-qa-results 30장).
- **10/21 (R-62)**: 사진 보고 맞추기 릴레이 — 팀당 대표 n명(기본 2명), 맞힌 사람은 라운드에서 빠지고 대표를 모두 내보낸 순서가 라운드 등수, 한 팀만 남으면 라운드 종료. 라운드마다 (팀 수 − 1) × 대표 수만 뽑고 모자라면 하나씩 더, 부족한 카테고리는 쓰지 않음 (`D-33`), 결과 순위는 라운드 배점 합. 대표 차례 `D-28` 해소 (3라운드 × 2명). CORE-15 · GAME-33 · HOST-19 · ADMIN-18 · QA-28 완료 (테스트 145개 — 15-qa-results 31장).
- **10/26 (R-64)**: 릴레이 인당 문제 — 관리 페이지 진행 기본값 "인당 문제" (기본 1), 팀은 대표 × 인당 문제만큼 맞히면 끝. 참고용이라 최소 문제 수 · 처음 뽑는 수는 그대로, 진행자 화면에 대표 교체 안내만. CORE-16 · GAME-34 · HOST-20 · ADMIN-19 · QA-29 (15-qa-results 33장).
- **10/26 (R-65)**: 줄줄이 말해요 룰렛 없앰 — 진행자가 주제를 고르면 고른 순간 공개, 문제가 있는 주제는 주제 카드 없이 주제와 첫 문제가 함께 (→ 10/27 보완 2 로 취소: 주제 카드만, 문제 · 정답 후보는 진행자 화면에만). 무작위는 숨김 아닌 주제 중 다 내지 않은 것. 보완: 게임 홈도 주제 목록 대신 개수만 (제외 토글 없음). CORE-17 · GAME-35 · HOST-21 · QA-30 (15-qa-results 34장 — 보완 2 는 34-1). 10/27 보완 3: 게임 홈은 이름 · 규칙 · 배점 · 시작만 (주제 수 요약 · 안내 · 문제 순서 옵션 뺌 — 34-2).
- **10/27 (R-66)**: 리허설 중 "연결 끊김" · "서버 연결 안 됨" 이 가끔 뜸 — 조사해 보니 이 Mac 에서 나가는 모든 TCP 연결이 1 ~ 7초씩 동시에 멈춤 (DNS · Vercel · 앱 아님, Wi-Fi 링크 정상 — 투명 프록시 보안 확장 또는 회사망 출구). 끊김 표시가 뜨는 순간 응답 시간을 재어 서버 로그에 비콘 (DEP-25 · QA-31, 테스트 154개 — 15-qa-results 35장).
- **10/27 (2) (R-67 · R-68)**: 운영 Upstash 131MB / 무료 250MB 중 이미지 124MB, 그중 81개 · 30MB 는 문제에서 쓰지 않는 이미지. 관리 페이지에 안 쓰는 이미지를 한 장씩 보며 지우는 화면 (ADMIN-20 · QA-32, 테스트 155개 — 15-qa-results 36장). 이미지는 Vercel 공개 Blob 저장소 · Redis 에는 주소만 — 설계만 (DEP-26, `D-34` · `D-35` 결정 대기).
- **10/27 (3) (R-67)**: `D-34` A · `D-35` B 로 정하고 이미지 Blob 저장소 구현 — Redis 에는 머리말(주소)만, `/assets` 302, 관리 페이지 [☁ 이미지 Blob 으로 옮기기], 올릴 때 500KB 넘는 PNG · JPEG 는 JPEG 0.85. 첫 의존성 `@vercel/blob` 2.8.1 (켤 때만 불러옴). 운영은 Blob 필수 — 쓸 수 없으면 이미지 저장 503, Redis 폴백 없음 (사용자). 옮기기가 끝나면 Redis 이미지 읽기를 뺀다 (DEP-27). DEP-26 · ADMIN-21 · QA-33 (테스트 160개 — 15-qa-results 37장). 운영 Blob 저장소 만들기 · 옮기기는 16-deploy 2-3.
- **10/27 (4) (R-69)**: Blob 공개 주소를 Referer 로 막기 — Blob 자체에는 허용 목록이 없어 저장소 방화벽 규칙(Request Header referer 가 우리 주소로 시작하지 않음 → Deny)으로, 서버가 Blob 에서 받을 때도 Referer 를 붙임. 규칙 조건(Request Header · Does not start with)은 크롬으로 확인. 같은 날 배포 · 규칙 게시 (Method GET 조건은 필요 없어 뺌). DEP-28 · QA-34 (테스트 161개 — 15-qa-results 38장).
- **10/27 (5) (R-67 · DEP-27)**: 운영 옮기기 확인(Upstash 131MB → 988KB, 이미지 146개 모두 Blob, 조각 0 — 15-qa 39장) 뒤 Redis 에서 이미지 본문을 읽고 쓰는 부분과 옮기기 화면 · API 를 걷어냄 — Redis 저장소는 이미지를 Blob 에만 (Vercel 밖 Redis 서버도, 토큰이 없으면 이미지 저장 503). 테스트 161개 (15-qa 40장).
- **10/27 (6) (R-70)**: 이미지 로딩이 느린 원인을 보다가 — 방화벽은 무관(평가 약 20ms), 이미지마다 함수 + Redis 2회 → 302 를 타던 것을 뺌. 화면은 이미지 주소 표(`GET /api/assets` 한 번)로 Blob 주소를 바로. DEP-29 · QA-35 (테스트 164개 — 15-qa 41장).
- **10/28 (R-72)**: 이모티콘 · 사진 게임 화면 룰렛에서 결과를 고르는 것처럼 보이던 카테고리 목록 · 키보드 커서를 없앰 — 게임 화면은 원판만, 넣기 · 빼기는 진행자 화면에서만 (게임 창 `↑` `↓` `X` `A` 없앰). GAME-36 · QA-37 (15-qa-results 43장).
- **10/28 (2) (R-73)**: 게임 화면 단축키에서 `M`(메뉴) · `?`(도움말) · 제목 화면 `→` `Enter` `Space` `C` 없앰 — 메뉴는 ☰, 도움말은 메뉴 [도움말]. GAME-37 · QA-38 (15-qa-results 44장).
- **10/28 (3) (R-74)**: 게임 화면 `←` · `PageUp`(이전) 전부 없앰 — 룰렛 · 라운드 소개 · 문제 · 정답 · 라운드 종료 · 결과 · 줄줄이 말해요 · 점수판 발표 화면 · 통계 이전 탭. 방향키 칸 이동(게임 홈 · 점수판)은 그대로. GAME-38 · QA-39 (15-qa-results 45장).
- **10/28 (4) (R-75)**: `Enter` · `Space` 가 같은 일을 하던 곳은 `Enter` 로만 — 룰렛 돌리기 · 결과로, 줄줄이 무작위 주제, 정답 공개, 확인창 확인. GAME-39 · QA-40 (15-qa-results 46장).
- **10/28 (5) (R-76)**: 게임 홈 단축키 전부 없앰 (`Tab` · 방향키 · `Space` · `Enter` · `N`) — 카드 · 버튼 클릭으로만. GAME-40 · QA-41 (15-qa-results 47장).
- **10/28 (6) (R-77)**: 득점형 룰렛 화면 `E`(일찍 끝내기) · `R`(진행 초기화) 없앰 — 끝내기는 진행자 화면 [종료]. GAME-41 · QA-42 (15-qa-results 48장).
- **10/28 (7) (R-78)**: 게임 화면 `H`(예시 · 힌트) · `Z` / `Shift+Z`(힌트 단계) 없앰 — 진행자 화면 버튼으로만. 관리 페이지 안내 문구도. GAME-42 · QA-43 (15-qa-results 49장).
- **10/28 (8) (R-79)**: 득점형 룰렛 키는 `Enter` 만 — 확정 · 결과로의 `→` · `PageDown`, 정지 후 `Space` 다시 돌리기 없앰, 모니터 "— → 결과 보기" 문구 삭제. GAME-43 · QA-44 (15-qa-results 50장).
- **10/28 (9) (R-80)**: 득점형 진행 화면 `R`(진행 초기화) · `E`(일찍 끝내기) 없앰 — 끝내기는 진행자 [종료], 기록 지우기는 게임 홈 [새로 시작]. GAME-44 · QA-45 (15-qa-results 51장).
- **10/28 (10) (R-81)**: 정답 화면 `1`~`4` · `0` · `Shift+1`~`4`(맞힌 팀 · 없음 · 득점 취소) · `V` · `Shift+V`(영상) 없앰 — 진행자 화면 버튼으로만. GAME-45 · QA-46 (15-qa-results 52장).
- **10/28 (11) (R-82)**: 라운드 소개 첫 문제 · 문제 화면 정답 공개는 `Enter` 만 — `→` · `Space` · `PageDown` 은 정답 공개 뒤 다음에만. 도움말에 라운드 소개 줄. GAME-46 · QA-47 (15-qa-results 53장).
- **10/28 (12) (R-83)**: 게임 화면 `Backspace` 되돌리기 없앰 — 화면과 상관없이 마지막 점수를 지워 라운드 소개에서 지난 라운드 점수가 보이지 않게 지워졌다. `score.undo` 명령 · 상태 함수 `undo` 도 삭제, 고치기는 진행자 [📝 정답 기록]. GAME-47 · QA-48 (15-qa-results 54장).
- **10/28 (13) (R-84)**: 룰렛 정지 후 `Backspace` = 돌리기 전으로 (진행자 [다시 돌리기] 와 같음). GAME-48 · QA-49 (15-qa-results 55장).
- **10/28 (14) (R-85)**: 넘기기는 모두 `Enter` (정답 · 라운드 종료 · 결과 · 발표 화면) — `→` · `Space` · `PageDown` 없앰. `N` · `Shift+N` · 라운드 종료 `B`, 결과 `S` · `B` · `H`, 채우기 창 `E`, 줄줄이 말해요 키 전부 없앰. GAME-49 · QA-50 (15-qa-results 56장).
- **10/28 (15) (R-86)**: 정답 화면 `Enter` 다음 — 맞힌 팀도 [없음] 도 안 정했으면 확인창 한 번. GAME-50 · QA-51 (15-qa-results 57장).
- **10/28 (16) (R-87)**: 진행자 화면 정답 화면 다음 버튼도 맞힌 팀 미지정이면 확인 — `question.next` 가 `needConfirm: "noCredit"`, 다시 보낼 때 문제 `key` 로 중복 넘김 방지. HOST-22 · QA-52 (15-qa-results 58장).
- **10/29 (R-88)**: 줄줄이 말해요 주제 고르는 중 모니터 문구 "진행자가 다음 주제를 고르고 있습니다" → "주제를 뽑아 주세요". GAME-51 · QA-53 (15-qa-results 59장).
- **10/29 (2) (R-89)**: 세 게임 홈 규칙을 한 줄에 하나씩 · 3vh 밝은 글자로, 넘치면 카테고리 카드 영역만 내부 스크롤. GAME-52 · QA-54 (15-qa-results 60장).
- **10/29 (3) (R-90)**: 이모티콘 퀴즈 룰렛 없앰 — 모니터 카테고리 목록, 진행자가 카테고리 → 문제 [내기] 로 바로 문제, 라운드 소개 · 라운드 종료 없음, 게임 홈 카드 · 옵션 없음. CORE-18 · GAME-53 · HOST-23 · QA-55 (15-qa-results 61장).
- **10/29 (4) (R-91)**: 이모티콘 퀴즈 문제 고르기 화면의 카테고리 카드를 게임 화면에서 클릭 → 그 카테고리 문제 하나(문제 순서 옵션대로). GAME-54 · QA-56 (15-qa-results 62장).
- **10/29 (5) (R-92)**: 사진 보고 맞추기 게임 홈의 라운드 · 팀당 대표 · 순서 옵션 · 요약 줄 · [기본값으로] 없앰 — 진행 옵션은 관리 페이지 진행 기본값만 (게임 홈 저장값 무시). GAME-55 · QA-57 (15-qa-results 63장).
- **10/29 (6) (R-93)**: 행사 안내 페이지(omaegi744-v2.surge.sh)의 밤 캠핑 팔레트로 디자인 토큰 · 직접 적은 색 · 룰렛 · 꽃가루를 바꾸고, 제목 화면을 해 질 녘 하늘 · 달 · 별 · 산 · 모닥불 배경으로. GAME-56 · QA-58 (15-qa-results 64장).
- **10/29 (7) (R-94)**: 사진 보고 맞추기 팀당 대표 방식에서 맞힌 사람을 팀 · 대표 번호까지 클릭으로 기록 — 진행자 화면 "맞힌 사람" [대표1 ●○] [대표2 ○○], 게임 화면 점수 띠 대표 묶음 클릭, 인당 문제를 채운 사람은 "빠짐" 으로 막음, 정답 기록 고치기도 대표까지. 대표는 함께 나오므로 R-64 의 "다음 대표 차례" 교체 안내를 없애고, 화면 문구에서 "릴레이" 를 뺌. CORE-19 · GAME-57 · HOST-24 · QA-59 (15-qa-results 65장).
- **10/29 (8) (R-95)**: 사진 보고 맞추기 팀당 대표 방식도 라운드당 문제 수(관리 페이지, 실환경 12)만큼 뽑기 — 전에는 최소 수 4개만. 순위가 정해지면 라운드 끝 · 안 낸 문제 돌려놓기는 그대로. CORE-20 · QA-60 (15-qa-results 66장).
- **10/21 (2) (R-63)**: 가끔 접속이 안 되던 원인 — `*.vercel.app` 이 주는 IP 쌍 중 `.67` 은 TLS 응답이 오지 않음 (TTL 5분이라 간헐). 도메인 `display-ad-camp.fun` (Vercel DNS, IP 4개 · TTL 30분)을 붙임. 공개 주소는 Vercel 운영 배포에서 시스템 환경 변수(`VERCEL_PROJECT_PRODUCTION_URL` · `VERCEL_URL` · `VERCEL_BRANCH_URL`)로 — `CAMP_PUBLIC_ORIGIN` 은 더할 주소, 미리보기 배포는 503 (DEP-24, 테스트 146개). 같은 날 배포 — 새 주소 PIN 화면 · 막힌 경로 · Origin 확인, 루트 A 레코드 두 개로 IP 고정 (15-qa-results 32장).
- ID: 범주 약어 + 번호 (예: `SRV-3`). 검수 시나리오 ID(`S-1`, `I-28` …)와 헷갈리지 않게 약어를 쓴다. 새 작업은 그 범주 끝 번호로 추가한다.
- 담당은 적지 않는다. 데이터 · 콘텐츠는 누구나 넣는다 (`D-14`). 이모티콘 문제 작성은 이모티콘 담당자 (R-15).
- 스펙이 바뀌면 관련 작업의 내용 · 검수 열도 함께 고친다.

## 0. 순서 한눈에

```
[1. 확인]  저장소 권한 · 장비 · 이모티콘 채점 단위 · Node 22
   │
[2. 구현]  BASE 뼈대 ─▶ CORE 공용 모듈 ─▶ SRV 서버
                                           │
                                           ├─▶ GAME 게임 화면 ─┬─▶ HOST 진행자 화면
                                           │                  └─▶ SB 배점표 · 종합 점수판
                                           └─▶ ADMIN 관리 페이지 (/admin)
   │
[3. 데이터]  초기 데이터 · 템플릿 · 검수용 샘플 (구현과 함께)
   │
[4. 검수]  11-acceptance-tests 전체 통과                       ← 10/19 ~ 10/21
   │
[5. 콘텐츠]  사진 70문제 이상 · 이모티콘 · 줄줄이 주제          ← 관리 페이지가 생기면 바로, ~10/24
   │
[6. 리허설 · 행사]  리허설 → 상태 초기화 · 커밋 → 최종 점검 → 현장 진행 → 결과 커밋
```

## 1. 확인 (구현 전 · 병행)

| ID | 할 일 | 내용 | 관련 | 기한 | 상태 |
| --- | --- | --- | --- | --- | --- |
| CHK-1 | 저장소 권한 | 준비위원에게 `displayad/display-ad-camp-game` 쓰기 권한 요청 | [08-tech.md](08-tech.md) 5-1 | 10/08 | 대기 |
| CHK-2 | 이모티콘 채점 단위 | 종합 점수판 기본값 3행(영화 · 속담 · 노래 제목 각각 100 / 50 / 0) 그대로 갈지, 1행으로 합칠지 이모티콘 담당자와 확인 (`D-11`) | [13-scoreboard.md](13-scoreboard.md) 3 · 8장 | 리허설 전 | 대기 |
| CHK-3 | 장비 | 외부 모니터 · HDMI 어댑터 · 확장 모드 동작, 충전기 · 멀티탭, (선택) 무선 프리젠터 · iPad Sidecar | [10-schedule.md](10-schedule.md) 2장 | 리허설 전 | 대기 |
| CHK-4 | Node 22 | 진행 노트북과 문제를 넣을 사람 노트북에 Node.js 22 이상 | [08-tech.md](08-tech.md) 1장 | 10/17 (템플릿 전달 때) | 대기 |

## 2. 구현

### 2-1. BASE — 프로젝트 뼈대 (10/09)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| BASE-1 | 폴더 · 설정 파일 | 파일 구조, `package.json`(`"type": "module"`, `engines.node >= 22`, `start` 스크립트, 의존성 없음), `.gitignore`(`.DS_Store` · `data/.backup/` · `state/.backup/` · `*.tmp` · `node_modules/`) | [08-tech.md](08-tech.md) 3장 · 5-2 | — | — | 완료 |
| BASE-2 | `start.command` | 폴더 이동 → Node 버전 확인 → 1029 포트 확인(이 앱이면 브라우저만 열기, 다른 프로그램이면 안내) → `node server.mjs` → 준비되면 `open http://127.0.0.1:1029/`. 실행 권한까지 커밋 | [08-tech.md](08-tech.md) 1장 | S-1 ~ S-4 | BASE-1 | 완료 |
| BASE-3 | 사용자용 README | 실행 방법, 관리 페이지로 문제 넣기, git 사용법 (데이터 커밋 · 상태 파일 커밋 규칙) | [08-tech.md](08-tech.md) 5-4 · 5-5 | — | BASE-1 | 완료 |

### 2-2. CORE — 브라우저 · 서버 공용 모듈 (10/09 ~ 10/10)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| CORE-1 | 직렬화 `serialize.js` | 키 순서 고정 · 기본값 생략 · 2칸 들여쓰기 · LF · `\u` 이스케이프 금지. 같은 데이터는 같은 글자. 데이터 파일 · 상태 파일 공용 | [02-data-schema.md](02-data-schema.md) 2-2, [08-tech.md](08-tech.md) 4-6-1 | J-1 ~ J-4, K-3-10 | BASE-1 | 완료 |
| CORE-2 | 검증 `validate.js` | 오류 E01 ~ E10 · 경고 W01 ~ W12, id 중복, 점수판 기본값 검증 | [02-data-schema.md](02-data-schema.md) 5 · 7장 | J-5 ~ J-9, T-19 | CORE-1 | 완료 |
| CORE-3 | 무작위 `random.js` | 룰렛 결과(회전 시작 때 결정, 정지 위치 조각 폭 15 ~ 85%), 라운드 문제 뽑기(랜덤 / 작성 순서), 동점 추가 문제, 문제 id 발급(31자 중 4자리, 겹치면 다시), 카테고리 id 제안 | [01-app-flow.md](01-app-flow.md) 5-3 · 5-4, [02-data-schema.md](02-data-schema.md) 3-5, [games/README.md](games/README.md) 3장 | D-12, D-13, D-22, D-23, I-37 | — | 완료 |
| CORE-4 | 세션 · 전이 `state.js` | 득점형 · 룰렛형 세션 구조, 화면 전이표(다음 · 이전 · 기타 액션), 파생 값(남은 문제 · 원판 후보 · 이어하기 문구), 불변 조건 검사 | [07-state-model.md](07-state-model.md) 3 ~ 6 · 9장 | E-1, E-2, H-1 ~ H-9 | CORE-3 | 완료 |
| CORE-5 | 정답 수 · 순위 `scoring.js` | `history` 재생, 1224 순위, 동점 그룹 · 추가 문제 순서, 라운드별 정답 수, 점수판 채우기 미리보기 | [07-state-model.md](07-state-model.md) 4장, [games/README.md](games/README.md) 3장, [13-scoreboard.md](13-scoreboard.md) 10장 | F-11 ~ F-16-4, T-21 ~ T-27 | CORE-4 | 완료 |
| CORE-6 | 타이머 필드 정리 (R-33) | 게임 옵션 계산에서 타이머 제외. 데이터 `defaults.timerSeconds` · 문제 `timerSeconds`, 게임 옵션 저장값 · 진행 기록 옵션의 `timerSeconds` — 검증은 무시, 직렬화는 저장할 때 정리. 데이터 파일에 남은 값 정리 | [02-data-schema.md](02-data-schema.md) 3-3 · 3-5, [03-settings.md](03-settings.md) 4장 | G-14, J-3 | — | 완료 |
| CORE-7 | 다음 문제 지정 전이 (R-35) | `setNextQuestion` — 이번 라운드에서 고른 문제를 다음 차례 자리로 옮김 (라운드 소개 = 첫 문제), 현재 · 지난 문제 · 라운드 밖 문제는 거절, 단위 테스트 | [07-state-model.md](07-state-model.md) 5-3 | W-24 ~ W-27 | CORE-4 | 완료 |
| CORE-8 | 줄줄이 말해요 문제 — 검증 · 직렬화 · 전이 (R-44) | 룰렛형 주제의 `questions`(문제 글자 · 정답 후보 · 메모) 검증(E03 · E04 · W05 · W07)과 저장 순서, 0개면 저장 안 함. 세션 pick 의 `questionIds` · `answersVisible`, 전이 첫 문제 · 다음 문제(남은 문제 무작위) · 문제 취소 · 정답 후보 토글, 룰렛 준비 남은 문제 수(원판 후보에서는 빼지 않음), 복원 때 지운 문제 건너뛰기, 단위 테스트 | [02-data-schema.md](02-data-schema.md) 4-3, [07-state-model.md](07-state-model.md) 3-3 · 6장 | H-11 ~ H-18, J-1 | CORE-4 | 완료 |
| CORE-9 | 줄줄이 문제 고르기 · 다 낸 주제 (R-45) | 문제 순서 옵션(`snapshot.options.questionOrder` — 랜덤 / 작성 순서) · 고른 문제 내기(`questionId`, 거절 이유), 다시 추첨 때 다 낸 주제를 `wheel` 에서 빼기(그때 한 번), 모두 넣기에서 다 낸 주제 제외. 룰렛형 `defaults.questionOrder` 저장, 단위 테스트 | [07-state-model.md](07-state-model.md) 6장, [02-data-schema.md](02-data-schema.md) 3-3 | H-20 ~ H-23 | CORE-8 | 완료 |
| CORE-10 | 라운드에 안 뽑힌 후보를 다음 문제로 (R-52) | `setNextQuestion(session, questionId, game)` — 이번 라운드 카테고리의 남은 문제면 다음 차례 자리에 넣고 목록 끝 문제를 뺌 (문제 수 그대로, `D-31`), 지금 문제가 라운드 마지막이면 하나 더 붙임. 다른 카테고리 · 이미 낸 문제 거절, 단위 테스트 | [07-state-model.md](07-state-model.md) 5-3 | W-45 ~ W-47 | CORE-7 | 완료 |
| CORE-11 | 추가 문제 후보 · 골라 열기 (R-54) | `tiebreakPool` 을 이 게임에 포함된 카테고리(`snapshot.candidates`)로, `tiebreakChoices` (카테고리별 남은 문제 id), `openTiebreak(session, game, questionId)` — 후보가 아니면 거절, 없으면 무작위. 단위 테스트 | [07-state-model.md](07-state-model.md) 4 · 5-3장 | W-48 ~ W-50 | CORE-4 | 완료 |
| CORE-12 | 라운드 종료 화면 전이 (R-56) | 득점형 screen `roundEnd` — 라운드 마지막 `answer` → `roundEnd` → (다음 라운드 · 결과 · 더 출제할 문제 없음 안내), `moreRound` 를 `roundEnd` 로 옮김, `←` 로 마지막 정답 · 룰렛 준비 `←` 로 `roundEnd`, 일찍 끝내기 · 되돌리기 허용, 복원(지운 문제) · 이어하기 문구 · 상태 파일 형식 검사의 화면 목록, 단위 테스트 | [07-state-model.md](07-state-model.md) 3-2 · 4 · 5 · 7장 | W-51 ~ W-55 | CORE-4 | 완료 |
| CORE-13 | 정답 기록 고치기 전이 (R-60) | `setCredit` — 이 게임에서 낸 문제 하나의 맞힌 팀 지정 · 없음 (맞힌 팀 지정과 같은 규칙 · 기록 방식), 추가 문제는 동점 그룹만, 결과 화면이면 순위 공개 · 점수판 채우기 다시. 고칠 수 있는 문제 = 문제 기록(`questionLog`)의 공개된 문제. 단위 테스트 | [07-state-model.md](07-state-model.md) 5-3 | W-60 ~ W-64 | CORE-12 | 완료 |
| CORE-14 | 정답 영상 주소 · 검증 (R-61) | `core/youtube.js` — 유튜브 주소 → 영상 id · 시작 · 끝 (`watch` · `youtu.be` · `shorts` · `embed` · `live`, 클립 주소 거절), 시간 글자 ↔ 초, 문제 → 재생 구간. 검증: `answerClip` 을 `https://youtu.be/<id>` 로 정리 · 주소의 `t=` · `end=` 를 구간으로, 못 읽으면 W13 (영상 없이), 앞뒤 바뀐 구간 W01, 주소 없는 구간 W09. 저장 순서 `hideAnswerText` 다음. 단위 테스트 | [02-data-schema.md](02-data-schema.md) 4-1 · 5-2 | I-59, I-60 | CORE-3 | 완료 |
| CORE-15 | 릴레이 (R-62) | 옵션 `relay` (사진 기본 2 · 이모티콘 0, 데이터 `defaults.relay` 검증 E04 · W01 0 ~ 6, 직렬화 — 0 도 저장), 세션 `snapshot.options.relay` · `snapshot.points`. `relayRound` (맞힌 대표 수 · 다 내보낸 순서 · 등수 · 순위가 정해짐), `roundRanksAt` (점수판 채우기 · 반영 · 통계 공용), `relayScores` · 순위를 게임 점수로. 전이: 라운드 확정 때 (팀 수 − 1) × 대표 수만 뽑기, 정답 → 다음 (하나 더 뽑기 · 한 팀만 남거나 문제가 떨어지면 라운드 종료 · 안 낸 문제 돌려놓기), 대표를 모두 내보낸 팀은 맞힌 팀 · 정답 기록 고치기 불가, 부족한 카테고리(게임 홈 후보 · 원판 · 더 낼 라운드). `relayStatus` (진행자 · 게임 화면 표시용). 단위 테스트 | [07-state-model.md](07-state-model.md) 3-2 · 4 · 5장, [games/photo-quiz.md](games/photo-quiz.md) 4-1 | Y-1 ~ Y-11 | CORE-12, CORE-13 | 완료 |
| CORE-16 | 인당 문제 (R-64) | 옵션 `perRep` (1 ~ 5, 기본 1, 데이터 `defaults.perRep` 검증 E04 · W01, 직렬화 — 1 은 저장 안 함), 세션 `snapshot.options.perRep`. `relayPerOf` · `relayGoal` (= relay × perRep) — `relayRound` · `roundRanksAt` · 다음 문제 · 빠진 팀 · `relayStatus` 가 goal 로. 최소 문제 수 · 처음 뽑는 수(`need`)는 그대로. `relayStatus` 에 `per` · `goal`. 단위 테스트 | [07-state-model.md](07-state-model.md) 3-2 · 4 · 10장, [games/photo-quiz.md](games/photo-quiz.md) 4-1 | Y-16, Y-17, Y-19 | CORE-15 | 완료 |
| CORE-17 | 줄줄이 주제 고르기 (R-65) | `pickTopic` (진행자가 고른 주제 · 없으면 무작위 → 주제 카드 — 보완 2 로 첫 문제 자동 공개 취소), `topicPool` (넣은 주제 − 다 낸 주제), `topicPrev` (첫 문제 취소 → 문제 전), 모니터 정답 후보 명령 `topic.answers` 거절, 명령 `topic.pick` (서버 허용 목록), 룰렛형의 `roulette.*` 거절, 게임 창 `Space` = 무작위. 단위 테스트 | [07-state-model.md](07-state-model.md) 6장, [games/chain-talk.md](games/chain-talk.md) 3장 | H-11, H-15, H-20 ~ H-22, H-25 ~ H-27 | CORE-9 | 완료 |
| CORE-18 | 이모티콘 퀴즈 문제 고르기 (R-90) | `pickMode` · `pickQuestion` (카테고리마다 한 묶음) · `pickChoices` · `askedCount`, 정답 · (예전) 라운드 종료 다음 → 문제 고르기 (뽑아 두고 안 낸 문제는 후보로), 이어하기 문구 | [07-state-model.md](07-state-model.md) 5-4 | E-34 | — | 완료 |
| CORE-19 | 맞힌 대표 기록 (R-94) | history `add` · `replace` 의 `rep`, `replay` 의 `reps`, `relayRound` 대표마다 세기(`reps` · `repAt` — 기록 없거나 다 채운 대표면 남은 첫 대표), `relayOpt`, `credit` · `setCredit` 의 `rep` (`resolveRep` — 다 채운 대표 거절, 없으면 같은 팀 그대로 · 다른 팀은 남은 첫 대표), `relayStatus` 의 `reps` · `repsBefore` · `scoredRep`, `questionLog` 의 `rep` | [07-state-model.md](07-state-model.md) 3-2 · 10장 | Y-20 ~ Y-23 | — | 완료 |
| CORE-20 | 팀당 대표 방식 뽑는 수 (R-95) | `drawRound` — 릴레이도 `questionsPerRound` 만큼 (`sessionNeed` 보다 적으면 need), 관리 페이지 팀당 대표 안내 문구 | [01-app-flow.md](01-app-flow.md) 5-4 | Y-24 | — | 완료 |
| CORE-21 | 공개 모드 공용 모듈 (R-96) | `app/core/public-play.js` — `publicGame`(숨김 · 메모 · 출처 · 옵션 · 규칙 빼기) · `publicImagePaths` · `planRun`(전체 무작위, 줄줄이 말해요는 주제 카드 뒤 문제) · `stepOf` · `restoreRun`(숨긴 것 빼고 위치 당김) · `countOf`. `assets.js` `setAssetUrls` | [08-tech.md](08-tech.md) 11-8 | P-1 ~ P-3 | — | 완료 |
| CORE-22 | 공개 모드 — 줄줄이 말해요 빼기 · 카테고리 한 판 (R-97 · R-98) | `publicGame` 이 `roulette` 은 null (주제 · 예시 · 정답 후보 필드도 뺌), `planRun(카테고리)` · `restoreRun(카테고리, 저장값)` (키는 문제 id), `questionCount`. 단계 키 · `stepOf` · `countOf` 걷어냄 | [08-tech.md](08-tech.md) 11-8 | P-1 ~ P-3 | CORE-21 | 완료 |
| CORE-23 | 공개 모드 문제 순서 (R-102) | `publicGame` 에 `questionOrder`(`defaults.questionOrder`, 없으면 `random`) · `planRun(카테고리, order)` 작성 순서면 그대로 · `restoreRun(카테고리, 저장값, order)` 순서가 다른 판은 null · 판에 `order` | [08-tech.md](08-tech.md) 11-8 | P-2, P-12 | CORE-22 | 완료 |

### 2-3. SRV — 로컬 서버 (10/09 ~ 10/10)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| SRV-1 | 서버 시작 | `server.mjs`: `127.0.0.1:1029` 고정, PIN 생성(`crypto.randomInt`, `--pin` 으로 고정), 터미널 출력(주소 · PIN · 주의 문구), 종료 처리 | [08-tech.md](08-tech.md) 1장, [12-host-view.md](12-host-view.md) 5-2 | S-1 | BASE-1 | 완료 |
| SRV-2 | 요청 가드 `guard.mjs` | Host 헤더 허용 목록, `localhost` → `127.0.0.1` 이동, 쓰기 요청 `X-Camp-App` · Origin 확인, 크기 제한(JSON 2MB · 이미지 15MB · 상태 보고 16KB · 상태 파일 256KB), 오류 응답에 내부 정보 없음 | [08-tech.md](08-tech.md) 4-5 | S-5 ~ S-9, S-12 | SRV-1 | 완료 |
| SRV-3 | 정적 파일 `static.mjs` | `/` · `/host` · `/admin` · `/app/**` · `/data/**` · `/assets/**` 만 제공, 캐시 헤더, 그 밖(`/server` · `/docs` · `/.git` · `/state` · 백업 폴더 · `..`)은 404 | [08-tech.md](08-tech.md) 4-2 | S-7, K-3-9 | SRV-2 | 완료 |
| SRV-4 | 상태 API `api-state.mjs` | `GET /api/state`, `PUT /api/state/*` — `If-Match` · 409, 형식 검사, 원자적 쓰기, 설정 · 점수판 백업(최근 30개), 직렬화(CORE-1), 쓴 뒤 게임 창에 `reload` | [08-tech.md](08-tech.md) 4-3 · 4-6-1 · 6장 | K-3-1 ~ K-3-6 | SRV-3, CORE-1 | 완료 |
| SRV-5 | PIN · 잠금 `host-auth.mjs` | 진행자 로그인(쿠키 토큰 `HttpOnly` · `SameSite=Strict`), 관리 PIN 헤더 검사, 실패 5회 → 60초 잠금(진행자 · 관리 합산, 같은 틀린 PIN 반복은 1회), 터미널 기록(PIN 값은 안 남김) | [12-host-view.md](12-host-view.md) 5장, [04-admin.md](04-admin.md) 2-1 | V-1 ~ V-5, I-29, I-33 | SRV-1 | 완료 |
| SRV-6 | 관리 API `api-admin.mjs` | `/api/admin/*` 공통 PIN 헤더 검사, verify, 게임 데이터 GET · PUT(검증 · 리비전 · 백업 20개 · 원자적 쓰기 · 게임별 줄 세우기), 이미지 PUT(서버가 경로 조립 · 형식 · 크기 검사), 백업 목록 · 복원, 전체 검증, 상태 초기화(백업 후 덮어쓰기), 저장 뒤 `reload` | [08-tech.md](08-tech.md) 4-3 · 4-5 · 4-6, [04-admin.md](04-admin.md) 2-1 · 3-10 · 5장 | S-8 ~ S-13, I-24 ~ I-26, I-33, I-40 ~ I-44 | SRV-4, SRV-5, CORE-2 | 완료 |
| SRV-7 | 진행자 · 실시간 API `api-live.mjs` | `POST /api/live`(현재 상태 1개 보관, 데이터에서 정답 · 메모 · 힌트를 찾아 붙임), `/api/host/state` · `/api/host/stream`(SSE · 15초 ping), `/api/host/command`(명령 목록 · 게임 창 미연결 409), `/api/live/commands`(명령 + `reload`) | [08-tech.md](08-tech.md) 4-4, [12-host-view.md](12-host-view.md) 6장 | V-6 ~ V-16, V-19, W-16 ~ W-20 | SRV-5 | 완료 |
| SRV-8 | 공개 모드 서버 (R-96) | `server/public-play.mjs` — 스위치 `state/public.json`(백업 대상 아님) · `GET /api/public`(로그인 없이, 꺼지면 제목만) · 공개한 문제의 이미지만 로그인 없이(`static.mjs`). `GET` · `PUT /api/admin/public`(PIN 헤더). `/play` 페이지 · `vercel.json` includeFiles `play.html` | [08-tech.md](08-tech.md) 4-2 · 4-3 · 11-2 · 11-8 | P-4, P-5 | CORE-21 | 완료 |

### 2-4. GAME — 게임 화면 (10/11 ~ 10/15)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| GAME-1 | 화면 틀 | 라우터, 디자인 토큰, 공통 레이아웃, 오버레이(도움말 · 확인창 · 오류 · 토스트), 전체화면, 키 입력 공통 규칙 | [05-screens.md](05-screens.md) 2 · 3 · 5장, [06-controls.md](06-controls.md) 1 · 2장 | K-5 ~ K-8, K-11 | BASE-1 | 완료 |
| GAME-2 | 상태 연결 | 시작 시 `GET /api/state`(파일이 원본 + 브라우저 임시 사본), 300ms 묶음 쓰기, 저장 대기 · 5초 재시도, 409 · `reload` 처리 | [08-tech.md](08-tech.md) 6장, [07-state-model.md](07-state-model.md) 7장 | K-3-1 ~ K-3-5, S-14 | SRV-4, GAME-1 | 완료 |
| GAME-3 | 제목 화면 · 메뉴 | 제목 · 팀 배지 · 이어하기 카드 · 경고 띠, ☰ 메뉴(게임 목록 · 배점표 · 종합 점수판 · 팀 설정 · 진행자 화면 · 관리 — 새 창을 열기 전 `GET /api/health`) | [05-screens.md](05-screens.md) 4-1 · 4-2, [01-app-flow.md](01-app-flow.md) 2 · 3장 | A-1 ~ A-10, I-35 | GAME-2 | 완료 |
| GAME-4 | 팀 설정 | 팀 수 · 이름 · 색, 입력 검증, 진행 중 변경 제한, 모든 설정 초기화 | [03-settings.md](03-settings.md) | B-1 ~ B-11 | GAME-2 | 완료 |
| GAME-5 | 게임 홈 | 카테고리 카드(9개 이상이면 한 줄 5개), 제외 토글, 진행 옵션, 배점 구역, 시작 조건 · 이어하기 · 새로 시작 | [01-app-flow.md](01-app-flow.md) 4장, [05-screens.md](05-screens.md) 4-3 | C-1 ~ C-9 | GAME-4, CORE-2 | 완료 |
| GAME-6 | 룰렛 준비 · 회전 | 목록(13개 이상이면 2열) · 원판 미리보기 · 넣기/빼기, 회전(4 ~ 6초 · 60fps · 9칸 이상이면 반지름 방향 글자 · 같은 색 이웃 금지) · 당첨 카드 · 확정 · 다시 돌리기 | [01-app-flow.md](01-app-flow.md) 5장, [05-screens.md](05-screens.md) 4-4 | D-1 ~ D-26 | GAME-5, CORE-3 | 완료 |
| GAME-7 | 사진 문제 | 라운드 소개("n 번째 게임은 ○○ 입니다"), 질문 문구, 원본 · 확대(단계 축소 · 중심 보정) · 가림(상자 · 하나씩 제거) · 정답 이미지 교차 페이드, 후보 카테고리 이미지 미리 불러오기 | [05-screens.md](05-screens.md) 4-5 ~ 4-7, [games/photo-quiz.md](games/photo-quiz.md) 5장, [08-tech.md](08-tech.md) 7장 | E-1 ~ E-12, E-19, E-20 | GAME-6, CORE-4 | 완료 |
| GAME-8 | 이모티콘 문제 | 이모지 대형 표시 · 순차 공개 · 이미지 문제 | [games/emoji-quiz.md](games/emoji-quiz.md) 4장 | E-13 ~ E-15 | GAME-7 | 완료 |
| GAME-9 | 정답 기록 · 힌트 | 정답 공개 후 맞힌 팀(`1`~`4` · `0`) · 교체 · 취소 · 되돌리기, 스코어보드(정답 수), 힌트. 처음 만든 타이머는 R-33 으로 제거 (GAME-13) | [06-controls.md](06-controls.md) 4장, [05-screens.md](05-screens.md) 4-10 | F-1 ~ F-10, E-16 ~ E-18 | GAME-7, CORE-5 | 완료 |
| GAME-10 | 결과 · 동점 | 시상대 공개 순서, 라운드별 정답 수 표, 동점 추가 문제(`S`), 점수판 채우기 창(진행자 화면이 없을 때 비상용) | [05-screens.md](05-screens.md) 4-8, [games/README.md](games/README.md) 3장 | F-11 ~ F-20 | GAME-9 | 완료 |
| GAME-11 | 줄줄이 말해요 | 주제 룰렛 · 주제 카드 · 예시(`H`) · 다시 추첨 · 끝내기 (팀 차례 표시 없음) | [games/chain-talk.md](games/chain-talk.md) | H-1 ~ H-10 | GAME-6 | 완료 |
| GAME-12 | 진행자 연동 | 상태 보고(100ms 묶음 · 30초마다 다시), 명령 수신 · `basedOn` 확인 · 키와 같은 전이로 적용 | [07-state-model.md](07-state-model.md) 10 · 11장 | V-6, W-16, W-21 | GAME-9, SRV-7 | 완료 |
| GAME-13 | 타이머 제거 (R-33) | 문제 화면 타이머 표시 · `T` · `Shift+T`, 메뉴를 열 때 일시정지, 게임 홈 타이머 옵션, 도움말 줄, 진행자 화면에 보내는 `timer`, 명령 `timer.toggle` · `timer.reset` | [05-screens.md](05-screens.md) 4-6, [06-controls.md](06-controls.md) 2 · 5장, [07-state-model.md](07-state-model.md) 10장 | G-10, G-11, A-7 | CORE-6 | 완료 |
| GAME-14 | 명령 `question.setNext` 적용 (R-35) | 진행자 명령 → 다음 문제 지정 전이. 거절 이유는 진행자 화면에만 (모니터 토스트 없음), 상태 보고에 바뀐 이번 라운드 목록 | [07-state-model.md](07-state-model.md) 11장 | W-24 ~ W-26 | CORE-7, GAME-12 | 완료 |
| GAME-15 | 이모티콘 정답 이미지 표시 (R-39) | 정답 공개 때 이모지 대신 정답 이미지 교차 페이드(순차 공개 뒤집기 뒤), 이미지 문제는 사진처럼. 검증 · 저장 순서에 `answerImage` | [games/emoji-quiz.md](games/emoji-quiz.md) 4장, [02-data-schema.md](02-data-schema.md) 4-2 | E-15-1 | GAME-8 | 완료 |
| GAME-16 | 한 라운드 더 (R-40) | 전이 `moreRound` (라운드 마지막 정답 · 지금 라운드 · 남은 문제 있을 때 → 룰렛 준비), 명령 `round.more`, 비상용 `N` · 도움말, 상태 보고 `plannedRounds` · `canMoreRound`, 게임 홈 "라운드(계획)" | [07-state-model.md](07-state-model.md) 5-1, [06-controls.md](06-controls.md) 3-5 | W-30, W-31 | GAME-12 | 완료 |
| GAME-17 | 정답 글자 숨기기 (R-41) | `hideAnswerText` 검증(W09 · E04) · 저장 순서 · 정리, 정답 공개 때 정답 띠 없이 맞힌 팀만 작은 띠 | [02-data-schema.md](02-data-schema.md) 4-1 · 4-2, [05-screens.md](05-screens.md) 4-7 | E-12-1 | GAME-15 | 완료 |
| GAME-18 | 가림 힌트 단계 결함 (R-42) | 힌트 단계는 상자 수 − 1 까지, 마지막 상자는 정답 공개 때만. 예전 진행 기록의 단계 값이 커도 마지막 상자는 덮어 둠 | [07-state-model.md](07-state-model.md) 5-1, [games/photo-quiz.md](games/photo-quiz.md) 5-2 | E-8, E-10-1 | GAME-7 | 완료 |
| GAME-19 | 한 문제 더 (R-43) | 전이 `moreQuestion` (지금 라운드 마지막 정답 · 같은 카테고리 안 낸 문제 → 라운드 목록 끝에 추가 → 그 문제), 명령 `question.more`, 비상용 `N` (한 라운드 더는 `Shift+N`) · 도움말, 상태 보고 `canMoreQuestion`, 게임 홈 "라운드당 문제(계획)" | [07-state-model.md](07-state-model.md) 5-1, [06-controls.md](06-controls.md) 3-5 | W-32 | GAME-16 | 완료 |
| GAME-20 | 줄줄이 말해요 문제 화면 (R-44) | 주제 카드 → 문제(위 주제 · 규칙 작게, 가운데 문제 글자 크게 · 길면 축소, 정답 후보 `H`), 비상용 `N` · `←` · 도움말, 명령 `topic.question` · `topic.answers`, 상태 보고 `topicQuestionId` 등, 게임 홈 · 룰렛 준비의 문제 수 | [games/chain-talk.md](games/chain-talk.md) 3장, [05-screens.md](05-screens.md) 4-9, [06-controls.md](06-controls.md) 3-7 | H-11 ~ H-19 | CORE-8, GAME-11 | 완료 |
| GAME-21 | 줄줄이 문제 순서 옵션 · 고르기 명령 (R-45) | 게임 홈 "문제 순서" (문제가 있을 때 — R-65 보완 3 으로 게임 홈에서 빼고 관리 페이지 진행 기본값만), 세션 시작 때 고정, 명령 `topic.question {questionId}`, 상태 보고 `topicList` · `topicNextId` · `questionOrder` | [games/chain-talk.md](games/chain-talk.md) 3-1 · 3-3 | H-23, W-37 | CORE-9, GAME-20 | 완료 |
| GAME-22 | 룰렛 결과 지정 적용 (R-48) | `planSpin` 에 지정 순번, 명령 `roulette.spin {categoryId}` — 원판 후보면 그 조각, 아니면 거절(이유는 진행자 화면에만). 원판 각도 계산을 `spinEnd` · `sliceAt` 으로 빼서 자동 테스트 | [01-app-flow.md](01-app-flow.md) 5-3, [07-state-model.md](07-state-model.md) 11장 | W-38, W-39, W-42 | GAME-12 | 완료 |
| GAME-23 | 정답 수 × 1개당 점수 표시 (R-49) | 게임 전체에 "정답 수" 라운드가 연결된 게임(`perCorrectRound`)은 스코어보드 · 룰렛 정답 띠 · 정답 띠 "✔ 팀A +50" · 결과 카드(점수 + 정답 수)에 점수, 동점 추가 문제 안내 없음. 게임 홈 배점 "정답 1개당 50" · 안내 문구. 이모티콘 퀴즈 규칙 문구(초기 데이터) · 앱 안 설명서 | [05-screens.md](05-screens.md) 4-3 · 4-7 · 4-8 · 4-10, [games/emoji-quiz.md](games/emoji-quiz.md) 3장 | T-30 ~ T-33 | SB-6 | 완료 |
| GAME-24 | 후보 보고 · 후보 명령 적용 (R-52) | 상태 보고에 이번 라운드 카테고리의 남은 문제 id(`roundCandidateIds`), `question.setNext` 에 게임 데이터를 넘겨 후보도 적용 | [07-state-model.md](07-state-model.md) 10장 · 11장 | W-45 ~ W-47 | CORE-10, GAME-14 | 완료 |
| GAME-25 | 사진 문제 스코어보드 오른쪽 열 (R-53) | 사진 보고 맞추기 문제 · 정답 · 추가 문제 화면에서 스코어보드를 머리줄 아래 오른쪽 세로 열(폭 16vh)로 — 카드 위아래로, 이름 위 · 정답 수 아래, 이름 두 줄까지 · 정답 수도 칸 폭에 맞춰 축소. 이모티콘은 아래 띠 그대로 | [05-screens.md](05-screens.md) 2-1 · 4-10 | E-21, E-22, E-23 | GAME-23 | 완료 |
| GAME-26 | 추가 문제 후보 보고 · 고른 문제 열기 (R-54) | 상태 보고 `result.tiebreakChoices` (결과 · 모두 공개 · 동점 · 점수를 주지 않는 게임), 명령 `result.tiebreak {questionId}` — 거절 이유는 진행자 화면에만 | [07-state-model.md](07-state-model.md) 10 · 11장 | W-48 ~ W-50 | CORE-11 | 완료 |
| GAME-27 | 라운드 종료 화면 (R-56) | 새 화면 `round-end.js` — 라운드 · 카테고리, "라운드가 종료되었습니다", 팀별 이번 라운드 점수(점수를 주는 게임은 점수) · 누적 · 단독 1위 👑, 되돌리기에 다시 그림. 비상용 `→` · `←` · `Shift+N` · `Backspace` · `E` · `R` · 도움말, 명령 `round.back` · `question.next` · `round.more`, 상태 보고 `roundScores` · `isLastRound` · `canMoreRound` | [05-screens.md](05-screens.md) 4-11, [06-controls.md](06-controls.md) 3-5, [07-state-model.md](07-state-model.md) 10 · 11장 | W-52 ~ W-55 | CORE-12, GAME-12 | 완료 |
| GAME-28 | 라운드 종료 반영 (R-57) | 명령 `round.reflect` · 비상용 `B` — 반영한 라운드로 다시 계산해 종합 점수판에 쓰고 세션 `reflectedRounds` 기록, 상태 보고 `reflect`(미리보기 · 반영 여부 · 달라짐 · 반영 뒤 합계), 라운드 종료 카드 "종합 450 (+100)", 결과에서 모두 반영했고 값이 같으면 채우기 창을 띄우지 않음 | [05-screens.md](05-screens.md) 4-11, [07-state-model.md](07-state-model.md) 3-2 · 5-3 · 10장 | W-56 ~ W-59 | SB-7, GAME-27 | 완료 |
| GAME-29 | 정답 이미지 원본 비율 (R-59) | 사진 표시(`render-photo.js`)의 정답 이미지를 문제 사진 액자에서 빼 자기 비율 액자로 — 원본 비율로 가장 크게, 공개 때 문제 사진 페이드 아웃 · 정답 이미지 페이드 인, 불러오기 실패면 문제 사진 유지. 이모티콘 이미지 문제 · 관리 페이지 미리보기도 같은 모듈 | [05-screens.md](05-screens.md) 4-7, [games/photo-quiz.md](games/photo-quiz.md) 5-3 | E-12, E-12-2 | GAME-7 | 완료 |
| GAME-30 | 기록 · 통계 화면 (R-58) | ☰ 메뉴 📊 기록 · 통계, 탭 셋(`1` `2` `3` · `←` `→`) — 종합 점수 추이 꺾은선(SVG) · 지금 순위, 팀별 통계 카드 · 라운드 표, 문제 기록(안 낸 문제 · 공개 전 정답 감춤, 추가 문제, 줄줄이 주제). 계산은 `core/stats.js` (단위 테스트), 모니터용 큰 글씨 · 탭 내용만 넘김, 도움말 | [05-screens.md](05-screens.md) 4-12, [06-controls.md](06-controls.md) 3-6-2 | L-1 ~ L-8 | SB-8 | 완료 |
| GAME-31 | 명령 `history.credit` (R-60) | 진행자 명령 → 정답 기록 고치기 (모니터 토스트 없음, 거절 이유는 진행자 화면에만), 상태 보고 `creditLog` (id 와 상태만) | [07-state-model.md](07-state-model.md) 10 · 11장 | W-60 ~ W-64 | CORE-13 | 완료 |
| GAME-32 | 정답 영상 재생 (R-61) | `ui/clip.js` — 유튜브 IFrame API 플레이어를 사진 위에 덮어(16:9) 문제 화면에서 미리 불러 두고, 정답 공개로 넘어갈 때 자동 재생 · 끝 시간에 직접 멈추고 걷어냄 → 정답 띠. 영상이 덮는 동안 정답 띠 숨김, 정답 화면으로 바로 들어오면 자동 재생 안 함, `←` 면 처음 상태로. 자동 재생이 막히면 소리 없이 + 안내 · 클릭하면 소리, 못 틀면 바로 정답 띠. 명령 `clip.play` · `clip.pause` · `clip.skip` · 비상용 `V` · `Shift+V`, 상태 보고 `clip` (상태 번호에는 넣지 않음), 도움말 | [05-screens.md](05-screens.md) 4-7, [07-state-model.md](07-state-model.md) 3-5 · 10 · 11장, [06-controls.md](06-controls.md) 3-5 | E-24 ~ E-27 | CORE-14, GAME-7 | 완료 |
| GAME-33 | 릴레이 화면 (R-62) | 게임 홈 "팀당 대표" 스테퍼(0 = 끔, 라운드당 문제 숨김 · 요약 줄 · 부족 카드 "문제 3개 · 4개 필요" · 시작 불가 안내 · 배점 안내 문구), 게임 시작 때 배점표 사진 행을 세션에 · 배점이 바뀌면 진행 중 세션도. 라운드 소개 "팀당 대표 2명 — …", 문제 번호 "Q 5", 스코어보드 ●○ · 등수 메달 · 빠진 팀 흐리게, 정답 띠 "✔ 팀A 1/2" · "1등 확정", 숫자키 토스트, 라운드 종료 "이번 라운드 순위", 결과 게임 점수 · "라운드 1·2·1등" · 라운드 (순위) 표, 룰렛 부족 항목 · 점수 띠 게임 점수, 상태 보고 `relay` · `relayReps` · `gamePoints` · `roundEnding` · `result.perRound[].ranks`, 앱 안 설명서 | [05-screens.md](05-screens.md) 4-3 ~ 4-12, [01-app-flow.md](01-app-flow.md) 4 · 5 · 6장, [07-state-model.md](07-state-model.md) 10장 | Y-2 ~ Y-5, Y-7 ~ Y-9, Y-11 ~ Y-13, Y-15 | CORE-15 | 완료 |
| GAME-34 | 인당 문제 화면 (R-64) | 모니터 오른쪽 열 ●○ 를 대표마다 한 줄 ("●●" / "●○"), 정답 띠 "✔ 팀A 3/4", 라운드 소개 "팀당 대표 2명 · 인당 2문제 — …", 라운드 종료 "맞힌 문제 3/4", 게임 홈 요약 "× 인당 2문제" | [05-screens.md](05-screens.md) 4-3 · 4-5 · 4-7 · 4-10 · 4-11 | Y-18, Y-19 | CORE-16 | 완료 |
| GAME-35 | 줄줄이 주제 고르는 중 화면 (R-65) | 원판 · 룰렛 준비 대신 "진행자가 다음 주제를 고르고 있습니다" + 지난 주제, 키 도움말, 게임 홈 [▶ 게임 시작] · 주제 카드 · 제외 토글 없음 (저장된 제외 무시 — 보완), 주제 수 요약 · 안내 문구 · 문제 순서 옵션도 없음 (저장된 순서 무시 — 보완 3) · 게임 화면은 문제를 내는 동안에도 주제 카드 그대로 (문제 화면 없앰, 키 `H` 는 예시만 · 관리 페이지 문제 편집 미리보기 안내 — 보완 2) | [05-screens.md](05-screens.md) 4-9, [06-controls.md](06-controls.md) 3-7 | H-1, H-2, H-12, H-13, H-24, H-26 | CORE-17 | 완료 |
| GAME-36 | 룰렛 준비 게임 화면은 원판만 (R-72) | 왼쪽 카테고리 목록 · 키보드 커서 · 부제 "이번 판에 넣을 카테고리" 없앰, 원판 가운데. 게임 창 `↑` `↓` `X` `A` 없앰 (넣기 · 빼기는 진행자 명령만 — `wheelToggle` 은 `categoryId` 필수), 키 도움말 | [05-screens.md](05-screens.md) 4-4, [06-controls.md](06-controls.md) 3-4 | D-1 ~ D-6, D-24, D-27 | — | 완료 |
| GAME-37 | 게임 화면 `M` · `?` · 제목 화면 키 없앰 (R-73) | 전역 키에서 `M` 메뉴 · `?` `/` 도움말 처리 삭제, 메뉴 안 `M` 닫기 · 도움말 `/` 닫기 삭제 (`Esc` 만), 도움말 공통 키 `F` · `Esc` 만, ☰ 툴팁 · 앱 안 설명서 "M" 표기 삭제, 제목 화면 `→` `Enter` `Space` `C` 처리 · "이어하기 (C)" 표기 삭제 | [06-controls.md](06-controls.md) 1 · 2장 | A-3, A-4, A-9, K-7 | — | 완료 |
| GAME-38 | 게임 화면 `←` · `PageUp` 없앰 (R-74) | 룰렛 · 라운드 소개 · 문제 · 라운드 종료 · 결과 · 주제 고르는 중 · 주제 카드의 `prev` 키, 점수판 발표 화면 되돌리기, 통계 이전 탭 삭제. 도움말 `←` 줄 삭제 | [06-controls.md](06-controls.md) 3장 | D-16, E-2, H-7, H-15, K-14, L-1 | — | 완료 |
| GAME-39 | `Enter` · `Space` 같은 기능은 `Enter` 만 (R-75) | 룰렛 준비 `Space` 무시(정지 후는 다시 돌리기) · 문제 없음 화면 `Space` 뺌, 주제 고르는 중 `Space` 뺌, 문제 화면 정답 공개 전 `Space` 무시, 확인창 · 게임 홈 버튼 `Space` 막기, 도움말 | [06-controls.md](06-controls.md) 2 · 3장 | C-11, D-6, D-8, E-28, H-26, K-15 | — | 완료 |
| GAME-40 | 게임 홈 단축키 없앰 (R-76) | 게임 홈 키 처리 삭제 — 포커스된 카드 · 버튼의 `Enter` · `Space` 기본 동작만 막음, "새로 시작 (N)" 표기 삭제, 도움말 공통 키만 | [06-controls.md](06-controls.md) 3-3 | C-11 | — | 완료 |
| GAME-41 | 룰렛 `E` · `R` 없앰 (R-77) | 룰렛 준비 · 정지 · 문제 없음 화면의 `E` · `R` 처리 삭제, 룰렛 도움말 `E` 줄 삭제 | [06-controls.md](06-controls.md) 3-4 | D-28 | — | 완료 |
| GAME-42 | `H` · `Z` 키 없앰 (R-78) | 주제 카드 `H`, 문제 화면 `Z` · `Shift+Z` · `H` 처리 삭제, 도움말 줄 삭제, 관리 페이지 가림 · 순차 공개 · 예시 안내 문구 | [06-controls.md](06-controls.md) 3-5 · 3-7 · 6장 | E-29, H-28 | — | 완료 |
| GAME-43 | 룰렛 키 `Enter` 만 (R-79) | 정지 후 `→` · `PageDown` 확정 · `Space` 다시 돌리기, 문제 없음 화면 `→` · `PageDown` 삭제, 문제 없음 문구의 키 안내 삭제, 도움말 | [06-controls.md](06-controls.md) 3-4 | D-8, D-9, D-21, D-29 | — | 완료 |
| GAME-44 | 진행 화면 `E` · `R` 없앰 (R-80) | 라운드 소개 · 문제 · 정답 · 라운드 종료 · 결과의 `E` · `R` 처리 삭제, 게임 창 진행 초기화 동작 삭제, 도움말 | [06-controls.md](06-controls.md) 3-5 · 3-6 | F-18, K-16 | — | 완료 |
| GAME-45 | 정답 화면 숫자 · `V` 키 없앰 (R-81) | `1`~`4` · `0` · `Shift+1`~`4` · `V` · `Shift+V` 처리 삭제, 게임 창 득점 취소 동작 · 영상 재생/일시정지 전환 삭제, 도움말 | [06-controls.md](06-controls.md) 3-5 · 4장 | E-30, W-21 | — | 완료 |
| GAME-46 | 라운드 소개 · 정답 공개 `Enter` 만 (R-82) | 라운드 소개 `→` · `Space` · `PageDown` 삭제(`Enter` 첫 문제), 문제 화면 정답 공개 전 `→` · `PageDown` 무시, 도움말 라운드 소개 줄 | [06-controls.md](06-controls.md) 3-5 | E-1, E-31 | — | 완료 |
| GAME-47 | 게임 화면 `Backspace` 되돌리기 없앰 (R-83) | 라운드 소개 · 문제 · 정답 · 라운드 종료 · 결과 `Backspace` 처리, `play.undo` · `score.undo` 명령 · `S.undo` 삭제 (테스트 정리), 도움말 | [06-controls.md](06-controls.md) 3-5 · 3-6 · 4-2 | K-17, F-6, F-7, W-13 | — | 완료 |
| GAME-48 | 룰렛 정지 후 `Backspace` 다시 돌리기 (R-84) | 룰렛 `onKey` 정지 후 `Backspace` → `respin`, 도움말 | [06-controls.md](06-controls.md) 3-4 | D-8, D-30 | — | 완료 |
| GAME-49 | 넘기기 `Enter` 통일 · 진행 화면 키 정리 (R-85) | 정답 · 라운드 종료 · 결과 · 주제 카드 · 발표 화면 `→` · `Space` · `PageDown` 삭제(득점형은 `Enter`), 정답 `N` · 라운드 종료 `Shift+N` · `B` · 결과 `S` · `B` · `H` · 채우기 창 `E` 삭제, 줄줄이 말해요 `onKey` 삭제, 동점 · 발표 안내 문구, 도움말 | [06-controls.md](06-controls.md) 3-5 · 3-6 · 3-7 | E-32, H-29, K-18 | — | 완료 |
| GAME-50 | 정답 화면 `Enter` 다음 전 맞힌 팀 확인 (R-86) | `question.js` 정답 화면 `Enter` — `replay` 로 이 문제의 맞힌 팀 · 없음을 보고 없으면 `app.confirm`, 확인 뒤에도 같은 문제의 정답 화면일 때만 `next`. 도움말 | [06-controls.md](06-controls.md) 3-5 · 4-1 | E-33 | — | 완료 |
| GAME-51 | 줄줄이 주제 고르는 중 멘트 (R-88) | `topic-wait.js` 문구 "진행자가 다음 주제를 고르고 있습니다" → "주제를 뽑아 주세요" | [05-screens.md](05-screens.md) 4-9 | H-2, H-24, W-22 | — | 완료 |
| GAME-52 | 게임 홈 규칙 한 줄에 하나씩 · 큰 글자 (R-89) | `style.css` `.home-rules` 세로 목록 · 3vh · 밝은 색, `.cat-grid` 넘치면 내부 스크롤 | [05-screens.md](05-screens.md) 3-2 · 4-3 | C-12 | — | 완료 |
| GAME-53 | 이모티콘 퀴즈 문제 고르기 화면 · 게임 홈 (R-90) | `question-pick.js` (게임 이름 · "카테고리를 골라 주세요" · 카테고리 카드 남은 수 · 점수 띠, 다 냈으면 `Enter` 결과), 문제 머리줄 "🎬 영화 · n번째 문제", 게임 홈 카드 · 제외 · 옵션 없음, 도움말 · 요약 설명서 | [05-screens.md](05-screens.md) 4-3 · 4-13, [06-controls.md](06-controls.md) 3-5 | E-34 | CORE-18 | 완료 |
| GAME-54 | 이모티콘 퀴즈 카테고리 카드 클릭 (R-91) | `S.pickInCategory` (문제 순서 옵션대로 하나 → `pickQuestion`), `play.pickInCategory`, `question-pick.js` 카드를 버튼으로 (다 낸 카드는 disabled), 포커스 남은 카드 `Enter` · `Space` 막기, 마우스 올림 강조 | [05-screens.md](05-screens.md) 4-13, [07-state-model.md](07-state-model.md) 5-4 | E-35 | GAME-53 | 완료 |
| GAME-55 | 게임 홈 진행 옵션 · 요약 줄 없앰 (R-92) | `game-home.js` `options()` · 옵션 저장 · [기본값으로] 삭제, `app.options` 는 데이터 `defaults` 만 (게임 홈 저장값 무시) | [05-screens.md](05-screens.md) 4-3, [03-settings.md](03-settings.md) 4장 | C-13 | — | 완료 |
| GAME-56 | 안내 페이지 팔레트 · 제목 화면 배경 (R-93) | `style.css` 토큰(`--bg` · `--surface` · `--surface-2` · `--card` · `--line` · `--text` · `--text-soft` · `--text-dim` · `--accent` · `--accent-2` · `--accent-ink` · `--ok`)과 직접 적은 회색 · 노랑 색, 제목 화면 하늘 · 달 · 별 · 산 · 모닥불 배경, `wheel.js` 조각 8색 · 가운데 원, 결과 · 발표 꽃가루, `host.css` · `admin.css` 강조 투명색 · 가림 상자 미리보기 | [05-screens.md](05-screens.md) 3-1 · 4-1 | A-11 | — | 완료 |
| GAME-57 | 점수 띠 대표 묶음 · 클릭 (R-94) | `score-bar.js` 대표마다 번호 + ● 묶음 (인당 1 도), 정답 화면 클릭 → `app.play.credit(team, rep)`, 고를 수 있음 · 고름 표시, 세 팀 같은 글자 크기 (`fitText` `box`), 정답 띠 "✔ 팀A 대표2 1/2", 라운드 소개 문구, 설명서 · 관리 페이지 안내 문구 ("릴레이" · "다음 대표" 뺌) | [05-screens.md](05-screens.md) 4-5 · 4-7 · 4-10, [06-controls.md](06-controls.md) 3-5 | Y-20 ~ Y-22 | CORE-19 | 완료 |
| GAME-58 | 공개 모드 화면 `/play` (R-96) | `play.html` · `app/play/main.js` · `play.css` — 꺼짐 안내 · 게임 목록(카드 · 방향키 · 이어하기 배지) · 게임 소개(혼자 하는 방법) · 문제 · 정답(render-photo · render-emoji · 정답 영상 그대로, 힌트 하나로) · 줄줄이 말해요 주제 카드 · 문제 · 정답 후보 · 모두 풀었습니다. 키 `Enter` · `H` · `Esc` + 버튼마다 키 이름, 마우스로 누른 버튼에 포커스 남기지 않음, 이어하기 `localStorage`, 휴대폰 폭 | [05-screens.md](05-screens.md) 7장, [06-controls.md](06-controls.md) 10장 | P-3, P-6 ~ P-8 | CORE-21 · SRV-8 | 완료 — 게임 소개 · 줄줄이 말해요 화면은 R-97 · R-98 로 바뀜 (GAME-59) |
| GAME-59 | 공개 모드 카테고리 목록 (R-97 · R-98) | `app/play/main.js` — 게임 목록 → 카테고리 목록(게임 소개 겸함 · 게임 홈 카테고리 카드 · 이어하기 / 다 풂 배지 · 방향키 · 마지막에 연 카드 기억) → 그 카테고리 문제 → 모두 풀었습니다([다시 풀기] · [카테고리 목록]). `Esc` 는 한 단계 위, 이어하기 · 다 풂은 카테고리마다 `localStorage` v2. 줄줄이 말해요 주제 카드 · 주제 문제 걷어냄. `play.css` 카테고리 카드 · 휴대폰 2열 | [05-screens.md](05-screens.md) 7장, [06-controls.md](06-controls.md) 10장 | P-2, P-3, P-6 ~ P-8 | CORE-22 | 완료 |
| GAME-60 | 공개 모드 UX 다듬기 (R-99) | `app/play/main.js` — 주소 해시 `#게임/카테고리` (`goDown` pushState · `goUp` back 또는 replaceState · `route` 가 popstate · 시작 때 해시대로, 없는 id 면 한 단계 위), [정답 보기] 하면 다음 위치 저장(`onReveal`), [↺ 처음부터](첫 문제가 아닐 때), 다 푼 카테고리 카드는 새 판으로, 새로고침한 끝 화면은 그대로. 게임 설명 `describe`(사진 고정 문구 · 이모티콘은 카테고리 이름), 공개용 데이터에서 `description` 뺌 | [01-app-flow.md](01-app-flow.md) 8장, [05-screens.md](05-screens.md) 7장, [06-controls.md](06-controls.md) 10장, [08-tech.md](08-tech.md) 11-8 | P-9 ~ P-11 | GAME-59 | 완료 |
| GAME-61 | 공개 모드 문제 순서 · 이어하기 초기화 (R-102 · R-103) | `app/play/main.js` — 판을 만들고 이을 때 게임의 `questionOrder`, [정답 보기] 저장에도 `order`, 카테고리 목록 안내 문구. 게임 목록 [↺ 이어하기 초기화] (남은 진행이 있을 때만 · 확인창 · `camp-game:play:v2:` 키 모두 지움) | [05-screens.md](05-screens.md) 7장, [06-controls.md](06-controls.md) 10장 | P-12, P-13 | GAME-60, CORE-23 | 완료 |

### 2-5. HOST — 진행자 화면 `/host` (10/16 ~ 10/18)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| HOST-1 | 입장 · 연결 | PIN 입력 · 잠금 안내, SSE 연결 · 자동 재연결, [가리기] · [나가기] | [12-host-view.md](12-host-view.md) 3 · 4-6 · 5장 | V-1 ~ V-5, V-14 ~ V-16 | SRV-7 | 완료 |
| HOST-2 | 상태 표시 | 현재 문제 카드(정답 · 메모 · 힌트 · 연출 단계), 이번 라운드 목록, 정답 수, 게임 화면 상태별 표시 | [12-host-view.md](12-host-view.md) 4-1 · 4-2 | V-6 ~ V-13, V-19 | HOST-1, GAME-12 | 완료 |
| HOST-3 | 조작 패널 | 룰렛(넣기/빼기 · 돌리기 · 확정 · 다시), 첫 문제, 정답 공개, 맞힌 팀 · 없음, 다음 문제 · 다음 라운드 · 결과 보기(정답 안 공개 시 확인), 종료, 되돌리기, 화면 버튼, 결과 공개 · 추가 문제, 점수판 채우기 창, 줄줄이 다시 추첨 · 끝내기 | [12-host-view.md](12-host-view.md) 4-2 ~ 4-5 · 6-2 | W-1 ~ W-23 | HOST-2 | 완료 |
| HOST-4 | 타이머 제거 (R-33) | 타이머 시작 · 리셋 버튼, 타이머 상태 표시, 서버 명령 허용 목록의 `timer.toggle` · `timer.reset` | [12-host-view.md](12-host-view.md) 4-1 · 6-2 | G-12, W-12 | GAME-13 | 완료 |
| HOST-5 | [다음으로] 버튼 (R-35) | 이번 라운드 목록의 아직 안 낸 문제마다 [다음으로], 다음 차례 문제에 "다음" 표시. 서버: 명령 허용 목록에 `question.setNext`, 목록 항목에 문제 id | [12-host-view.md](12-host-view.md) 4-1 · 4-2 · 6-2 | W-24 ~ W-26 | GAME-14 | 완료 |
| HOST-6 | 설명서 (R-38) | 머리줄 · PIN 화면 [❓ 설명서] → 겹쳐 여는 요약 설명서 (휴대폰 전체 화면, `Esc` · 바깥으로 닫기). 내용은 공용 모듈 `app/ui/guide.js` (서버 · 노트북 모드별 안내) | [12-host-view.md](12-host-view.md) 4-7 | W-28, W-29 | — | 완료 |
| HOST-7 | 한 라운드 더 · 표시 (R-40 · R-41 · R-42) | 계획한 라운드 뒤 정답 화면 [결과 보기 ▶] + [한 라운드 더 ▶], 머리줄 · 룰렛 준비 "(추가 · 계획 n)", "모니터: 정답 이미지만" 배지, 가림 단계 표시("가림 힌트 n/m · 마지막 상자는 정답 공개 때") | [12-host-view.md](12-host-view.md) 4-1 · 4-2 · 6-2 | W-30 | GAME-16 | 완료 |
| HOST-8 | [한 문제 더 ▶] (R-43) | 라운드 마지막 정답 화면 진행 줄에 [한 문제 더 ▶] (남은 문제가 있을 때), 앱 안 설명서 줄 | [12-host-view.md](12-host-view.md) 4-2 · 6-2 | W-32 | GAME-19 | 완료 |
| HOST-9 | 줄줄이 말해요 문제 · 정답 후보 (R-44) | 주제 카드 [첫 문제 ▶] · 남은 수, 문제 카드(문제 글자 · 정답 후보 가나다순 · 메모 · n번째 · 낸 문제 목록), [다음 문제 ▶] · [정답 후보 표시/숨김]. 서버: 명령 허용 목록, 지금 문제의 정답 후보만 붙임 | [12-host-view.md](12-host-view.md) 4-2 · 6-2 | W-33 ~ W-35 | GAME-20 | 완료 |
| HOST-10 | "이 주제 문제" 목록 · [내기] (R-45) | 주제 카드 · 문제 화면에 문제 글자 목록(지금 · 냄 · 다음 · [내기]), [다음 문제 ▶] 에 순서 표시, 룰렛 준비 "문제 모두 냄 — 자동으로 뺌" 안내. 서버: 목록에 문제 글자만 | [12-host-view.md](12-host-view.md) 4-2 · 6-2 | W-36, W-37, H-20 ~ H-22 | GAME-21 | 완료 |
| HOST-11 | 룰렛 결과 지정 줄 (R-48) | 룰렛 준비 [무작위] · 원판 후보마다 버튼, 한 번만 · 원판에서 빠지면 풀림 (`D-27`), [가리기] 대상, 앱 안 설명서 줄 | [12-host-view.md](12-host-view.md) 4-8 · 6-2 | W-38 ~ W-44 | GAME-22 | 완료 |
| HOST-12 | 점수 표시 · 정답 수 채우기 (R-49) | 게임 상태에 1개당 점수(`per`) · 채우기 행 방식, 팀별 띠 "팀A 150점", 결과 표 점수 열, 점수를 주는 게임은 [추가 문제 열기] 없음, 채우기 창 정답 수 행 미리보기 "3개 (150)" · [점수 고치기] 정답 수 입력 | [12-host-view.md](12-host-view.md) 4-5 | T-31 ~ T-35 | GAME-23, SB-6 | 완료 |
| HOST-13 | 후보 목록 (R-52) | 서버: 후보 id 에 정답을 붙여 `roundCandidates` (id 목록은 지움). 진행자 화면: 이번 라운드 목록 아래 후보 칸 — 정답 · [다음으로], 제목줄에 무엇이 바뀌는지(문제 수 그대로 / 한 문제 더), [가리기] 대상 | [12-host-view.md](12-host-view.md) 4-1 · 4-2 · 5-1 | W-45 ~ W-47 | GAME-24, HOST-5 | 완료 |
| HOST-14 | 추가 문제 고르기 (R-54) | 서버: 후보에 카테고리 이름 · 아이콘 · 정답을 붙임. 진행자 화면: 결과 카드 아래 "추가 문제 — 팀A · 팀B 동점" — 카테고리 버튼(남은 n) → 문제 · 정답 목록 [내기] · [◀ 카테고리], [가리기] 대상. 채우기 창 · 앱 안 설명서 문구 | [12-host-view.md](12-host-view.md) 4-5 · 5-1 · 6-2 | W-48, W-49 | GAME-26 | 완료 |
| HOST-15 | 라운드 종료 안내 · 라운드 점수 (R-56) | 라운드 마지막 정답 화면에 안내 카드 "🏁 라운드가 종료되었습니다" + [한 문제 더 ▶] · [라운드 종료 ▶] (맞힌 팀 먼저 안내, 남은 문제 없음 안내), 진행 줄 [다음 라운드 ▶] · [결과 보기 ▶] · [한 라운드 더 ▶] 를 라운드 종료 화면으로. 라운드 종료 화면 표(이번 라운드 · 누적) + [다음 라운드 ▶] / [결과 보기 ▶] · [한 라운드 더 ▶] · [◀ 라운드로 돌아가기] · [↶ 되돌리기] · [종료]. 서버: 명령 허용 목록에 `round.back`. 앱 안 설명서 줄 | [12-host-view.md](12-host-view.md) 4-2 · 4-4 · 4-7 · 4-9 · 6-2 | W-51 ~ W-55 | GAME-27 | 완료 |
| HOST-16 | 종합 점수판 반영 카드 (R-57) | 라운드 종료 화면에 "종합 점수판에 반영" 카드 — 행 × 팀 미리보기, 반영 뒤 종합 합계, [팀 점수에 반영] / ✔ 반영했습니다 / 점수가 바뀌었습니다 [다시 반영], 덮어쓰기 경고, 연결된 행 없음 안내. 서버 명령 허용 목록 `round.reflect`, 앱 안 설명서 줄 | [12-host-view.md](12-host-view.md) 4-9 · 6-2 | W-56 ~ W-59 | GAME-28 | 완료 |
| HOST-17 | [📝 정답 기록] · [↶ 되돌리기] 빼기 (R-60) | 머리줄 [📝 정답 기록] → 맨 위 카드 (라운드별 · 추가 문제, 정답 · 팀 버튼 · [없음], 진행 중 표시, [가리기] 대상), 진행 줄 · 라운드 종료 화면의 [↶ 되돌리기] 삭제. 서버: 명령 허용 목록 `history.credit`, 낸 문제의 정답만 붙임. 앱 안 설명서 줄 | [12-host-view.md](12-host-view.md) 4-10 · 5-1 · 6-2 | W-13, W-60 ~ W-64 | GAME-31 | 완료 |
| HOST-18 | 정답 영상 카드 (R-61) | 현재 문제 카드 "🎬 정답 영상" 배지, 영상 카드 — 공개 전 안내 · 소리 막힘 미리 경고 · 못 트는 이유, 공개 뒤 재생 상태 + [⏸ 일시정지] · [▶ 계속] · [⏭ 영상 끝내기] · [↺ 영상 다시 재생] · [▶ 영상 재생]. 서버: 명령 허용 목록 `clip.*`, 문제에 구간(`question.clip`)을 붙임. 앱 안 설명서 줄 | [12-host-view.md](12-host-view.md) 4-1 · 4-2 · 6-1 · 6-2 | W-65 ~ W-67 | GAME-32 | 완료 |
| HOST-19 | 릴레이 진행자 화면 (R-62) | 문제 카드 "Q 3 · 팀당 대표 2명", 맞힌 팀 "팀A 🥇1등 · 빠짐" 비활성 + 진행 줄, 라운드 종료 안내 "🏁 순위가 정해졌습니다" · "🏁 이 카테고리에 낼 문제가 없습니다" + [라운드 종료 ▶] ([한 문제 더] 없음), 라운드 종료 표(등수 · 맞힌 대표 · 게임 점수), 점수 줄(라운드 중 맞힌 대표 · 그 밖에 게임 점수), 룰렛 목록 "부족 · 남은 3/4" · 결과 지정 제외, 결과 "게임 점수 (라운드 배점 합)" · 라운드별 순위 표, 앱 안 설명서 줄 | [12-host-view.md](12-host-view.md) 4-1 · 4-2 · 4-3 · 4-5 · 4-7 · 4-9 · 4-10 | Y-3 ~ Y-6, Y-14 | GAME-33 | 완료 |
| HOST-20 | 인당 문제 진행자 화면 (R-64) | 배지 "Q 3 · 대표 2명 × 2문제", 점수 줄 · 진행 줄 "팀A 3/4 · 대표2 1/2", 맞힌 팀 아래 교체 안내 "🔄 팀A 대표1 — 2문제를 다 맞혔습니다. 다음 문제부터 대표2 차례" (참고용), 라운드 종료 안내 "(3/4)" · "맞힌 문제 수로", 라운드 종료 표 "맞힌 문제" | [12-host-view.md](12-host-view.md) 4-2 · 4-7 | Y-16 ~ Y-18 | GAME-34 | 완료 |
| HOST-21 | 줄줄이 주제 고르기 패널 (R-65) | 주제 버튼(누르면 공개) · [🎲 무작위 (n개 중)] · ×횟수, [다시 추첨 ▶] → [다음 주제 ▶], 다 낸 주제 안내 문구, 문제 카드에서 [정답 후보 표시] 빼고 배지 "게임 화면: 주제 카드 (문제는 여기만)" (보완 2) | [12-host-view.md](12-host-view.md) 4-2 · 6-2 | H-5, H-25, W-33, W-43 | CORE-17 | 완료 |
| HOST-22 | 진행자 다음 버튼 맞힌 팀 확인 (R-87) | `play.answerDecided` (게임 창 `Enter` 와 같이 씀), `question.next` 정답 화면 미지정 → `needConfirm: "noCredit"`, `key` 다르면 거절, 진행자 화면 `handleCommandResult` 확인창 → `noCredit` · `key` 로 다시 보내기 | [12-host-view.md](12-host-view.md) 4-4 · 6-2 | W-68 | GAME-50 | 완료 |
| HOST-23 | 이모티콘 퀴즈 문제 고르기 패널 (R-90) | 진행 상태 `pickMode` · `askedCount` · `pickChoices`(id — 서버가 이모지 · 정답을 붙임), 명령 `question.pick` (서버 허용 목록), 카테고리 → 문제 [내기] 패널(문제 고르기 · 정답 화면), 머리줄 · 배지 ROUND 대신 카테고리 · n번째 문제, 정답 화면 [카테고리 목록 ▶], 맞힌 팀 확인 뒤 보낸 명령 그대로 다시 | [12-host-view.md](12-host-view.md) 4-11 · 5-1 · 6-2 | W-69 | CORE-18 | 완료 |
| HOST-24 | 맞힌 사람 버튼 (R-94) | 정답 화면 팀마다 [대표1 ●○] [대표2 ○○] (`answer.credit {team, rep}`), 빠진 대표 · 팀 비활성, "🚪 … 빠집니다" 안내 (교체 안내 없앰), 점수 줄 · 진행 줄 대표 ●○ 묶음, 정답 기록 고치기 팀마다 [대표1] [대표2] (`history.credit {questionId, team, rep}`, 서버 `record.reps`) | [12-host-view.md](12-host-view.md) 4-3 · 4-10 | Y-20 · Y-21 · Y-23 | CORE-19 | 완료 |

### 2-6. SB — 배점표 · 종합 점수판 (10/16 ~ 10/18)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| SB-1 | 배점표 | 표 · 크게 보기 · 수정 모드 · 기본값으로, 게임 홈 배점 구역 | [13-scoreboard.md](13-scoreboard.md) 4 · 5장 | T-1 ~ T-5, C-10 | GAME-2 | 완료 |
| SB-2 | 종합 점수판 | 등수 · 성공 여부 · 직접 입력, 칸별 점수 직접 수정(✎), 합계 · 순위, 초기화 | [13-scoreboard.md](13-scoreboard.md) 3 · 6장 | T-6 ~ T-14, T-16 ~ T-18, T-20 | SB-1 | 완료 |
| SB-3 | 발표 화면 | 하위 순위부터 공개 · 꽃가루 · 라운드별 점수 표 | [13-scoreboard.md](13-scoreboard.md) 7장 | T-15 | SB-2 | 완료 |
| SB-4 | 라운드 설정 | 라운드 추가 · 삭제 · 순서 · 방식 · 연결 게임 · 카테고리 | [13-scoreboard.md](13-scoreboard.md) 8장 | T-12, T-13 | SB-2 | 완료 |
| SB-5 | 결과 → 점수판 채우기 | [확인] 자동 입력 · [점수 고치기] · [취소], 덮어쓰기 경고, 동점 안내 | [13-scoreboard.md](13-scoreboard.md) 10장 | T-21 ~ T-27, T-29 | SB-2, GAME-10, HOST-3 | 완료 |
| SB-6 | 라운드 방식 "정답 수" (R-49) | `count` · 1개당 점수 `per` — 검증 · 직렬화, 점수판 칸 정답 수 입력("3개 150"), 배점표 · 크게 보기 · 게임 홈 · 라운드 설정에서 1개당 점수, 채우기 창 정답 수 행(미리보기 · 고치기 — 게임 화면 비상용 · 진행자 화면), 등수 행이 없으면 동점 안내 없음. 기본값 이모티콘 3행 → 1행(1개당 50) | [13-scoreboard.md](13-scoreboard.md) 3 ~ 6 · 8 ~ 10장, [02-data-schema.md](02-data-schema.md) 7장 | T-1, T-30, T-34 ~ T-39 | SB-5 | 완료 |
| SB-7 | 라운드마다 반영 · 라운드별 등수 칸 (R-57) | 채우기 계산을 라운드 단위로 — 등수 행은 라운드별 등수 목록(정답 없는 라운드는 등수 없음), 정답 수 행은 라운드 정답 수 합, 반영할 라운드 지정. 칸 `ranks` — 점수 · 표시("1·2·-등 150") · 직접 수정 · 직렬화, 자동 입력 표시에 진행 시작 시각(같은 진행은 덮어쓰기 경고 없음). 결과 채우기 창 · 고치기 창(게임 화면 비상용 · 진행자 화면)의 라운드별 등수 | [13-scoreboard.md](13-scoreboard.md) 3 · 6 · 9-1 · 10장 | T-40, T-41, W-58, W-59 | SB-5, CORE-12 | 완료 |
| SB-8 | 종합 점수 추이 기록 (R-58) | 점수판 상태 `log` — 합계가 바뀔 때마다 `{ at, what, totals }` (바뀐 행 이름 · 라운드 반영 · 결과 채우기 이름), 같은 것 3분 안이면 합침, 200개, 초기화 때 비움. 게임 창 · 관리 페이지 저장 모두. 직렬화 · 상태 파일 형식 검사 | [13-scoreboard.md](13-scoreboard.md) 9-1 | L-2, L-3 | SB-2 | 완료 |

### 2-7. ADMIN — 관리 페이지 `/admin` (10/16 ~ 10/18)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| ADMIN-1 | 페이지 · 잠금 | `admin.html`, PIN 화면 · `sessionStorage` 보관 · 요청마다 `X-Admin-Pin` · [잠그기] · 401 이면 다시 입력 후 재전송, 서버 상태 표시 | [04-admin.md](04-admin.md) 1 · 2장 | I-1, I-2, I-28 ~ I-34, I-36, I-38 | SRV-6 | 완료 |
| ADMIN-2 | 관리 홈 · 게임 · 카테고리 | 게임 카드(검증 상태), git 안내, 게임 편집(기본 정보 · 진행 기본값), 카테고리 추가 · 편집 · 숨김 · 삭제 · 순서 | [04-admin.md](04-admin.md) 3-1 ~ 3-4 | I-4 ~ I-7, I-17, I-23 | ADMIN-1 | 완료 |
| ADMIN-3 | 사진 문제 편집 | 문제 목록(분량 안내 W10), 이미지 선택 · 축소 · EXIF 방향 · 업로드, 연출(확대 지점 · 배율 · 단계 / 가림 상자 그리기 · 순서), 정답 이미지, 미리보기, id 발급 | [04-admin.md](04-admin.md) 3-5 · 3-6 · 4장 | I-8 ~ I-14, I-16, I-18, I-19, I-37 | ADMIN-2, CORE-3 | 완료 |
| ADMIN-4 | 여러 장 한 번에 추가 | 여러 장 선택 → 표 입력 → 한 번 저장, 설정이 필요한 문제는 숨김으로 | [04-admin.md](04-admin.md) 3-7 | I-15 | ADMIN-3 | 완료 |
| ADMIN-5 | 이모티콘 · 붙여넣기 | 이모지 문제 편집 · 순차 공개 미리보기, 표 붙여넣기(미리보기 ✔ ⚠ ✕ · 새 카테고리), 템플릿 복사, 줄줄이 주제 붙여넣기 | [04-admin.md](04-admin.md) 3-8 · 3-9, [02-data-schema.md](02-data-schema.md) 6장 | I-20 ~ I-22 | ADMIN-2 | 완료 |
| ADMIN-6 | 저장 · 백업 · 검증 | 저장 절차(409 · 422 · 401), 백업 목록 · 복원, 전체 검증(없는 · 안 쓰는 이미지) | [04-admin.md](04-admin.md) 5장 | I-24 ~ I-26, I-39 | ADMIN-2 | 완료 |
| ADMIN-7 | 점수 입력 | 종합 점수판 입력 표(게임 창과 같은 모듈 · 상태 API) + 배점표 · 라운드 설정 | [04-admin.md](04-admin.md) 3-1, [13-scoreboard.md](13-scoreboard.md) 10-5 | T-28 | ADMIN-1, SB-2 | 완료 |
| ADMIN-8 | 상태 초기화 | 대상 표 · 묶음 버튼 · 자동 함께 선택 · 확인 창 · 커밋 안내 | [04-admin.md](04-admin.md) 3-10 | I-40 ~ I-44 | ADMIN-1, SRV-6 | 완료 |
| ADMIN-9 | 타이머 입력 제거 (R-33) | 게임 편집 진행 기본값의 타이머, 사진 · 이모티콘 문제 편집의 타이머 | [04-admin.md](04-admin.md) 3-2 · 3-6 · 3-8 | G-13 | CORE-6 | 완료 |
| ADMIN-10 | 클립보드 이미지 붙여넣기 (R-34) | 사진 문제 편집(문제 이미지 · 정답 이미지 — 누른 칸으로, 테두리 표시) · 이모티콘 문제 편집(이미지로 등록)에서 `⌘V`. 글자 칸의 글자 붙여넣기는 그대로, 이미지가 없으면 안내. 판단 로직은 따로 모듈로 두고 단위 테스트 | [04-admin.md](04-admin.md) 3-6 · 3-8 | I-45 ~ I-50 | ADMIN-3, ADMIN-5 | 완료 |
| ADMIN-11 | 진행자 설명서 화면 (R-38) | 맨 위 [📖 설명서] → 설명서 화면 (공용 모듈 + 관리 페이지 구역) | [04-admin.md](04-admin.md) 3-12 | I-51 | HOST-6 | 완료 |
| ADMIN-12 | 이모티콘 정답 이미지 편집 (R-39) | 이모티콘 문제 편집에 "정답 이미지 (선택)" — 파일 선택 · 끌어다 놓기 · `⌘V`(누른 칸으로), 빼기, 미리보기, 저장 `<id>-answer`. 문제 목록 연출 열 "정답 이미지" | [04-admin.md](04-admin.md) 3-5 · 3-8 | I-22-1 | ADMIN-5, GAME-15 | 완료 |
| ADMIN-13 | 정답 글자 숨기기 · 가림 순서 안내 (R-41 · R-42) | 사진 · 이모티콘 문제 편집의 정답 이미지 아래 ☐ 정답 글자 숨기기 (정답 이미지가 있을 때만), 미리보기 · 저장, 문제 목록 "정답 이미지만". 가림 안내 "마지막 번호는 정답 공개 때만", 미리보기 단계 수 | [04-admin.md](04-admin.md) 3-5 · 3-6 · 3-8 | I-11-1 | GAME-17, GAME-18 | 완료 |
| ADMIN-14 | 줄줄이 말해요 문제 관리 (R-44) | 주제 [문제 관리], 문제 목록(문제 글자 · 후보 요약 · 검색), 문제 편집(문제 글자 + [○ 넣기], 정답 후보 태그 입력 — 쉼표 · 줄바꿈 붙여넣기 · 중복 하나만, 메모, 미리보기), 개수 열 "예시 n · 문제 m" | [04-admin.md](04-admin.md) 3-2 · 3-5 · 3-13 | I-52 ~ I-57 | CORE-8 | 완료 |
| ADMIN-15 | 줄줄이 진행 기본값 (R-45) | 게임 편집 진행 기본값에 문제 순서(랜덤 / 작성 순서), 문제 목록 안내 | [04-admin.md](04-admin.md) 3-2 · 3-5 | H-23 | CORE-9 | 완료 |
| ADMIN-16 | 사진 문제 미리보기 비율 (R-53) | 사진 문제 편집 미리보기 창을 오른쪽 열 화면의 사진 칸 비율(92vh × (100vw − 16vh))로. 이모티콘은 그대로 | [04-admin.md](04-admin.md) 3-6 | E-23 | GAME-25 | 완료 |
| ADMIN-17 | 정답 영상 입력 (R-61) | 사진 문제 편집 "🎬 정답 영상 — 유튜브" — 주소 · 시작 · 끝 칸(주소의 `t=` 로 빈 칸 채움), 상태 줄, [▶ 구간 미리보기] (게임과 같은 플레이어 — 퍼가기 금지 확인), [빼기], 저장 검사 · `https://youtu.be/<id>` + `clipStart` · `clipEnd` 로 저장. 문제 목록 "+ 🎬 영상" | [04-admin.md](04-admin.md) 3-5 · 3-6 | I-58 ~ I-60 | CORE-14, GAME-32 | 완료 |
| ADMIN-18 | 팀당 대표 기본값 · 문제 수 안내 (R-62) | 게임 편집 진행 기본값 "팀당 대표 (0 = 끔)" — 사진 게임만, 데이터에 없으면 2. 문제 목록 요약 · 안내를 릴레이 기준(3팀 × 대표 수 — 최소 수 미만 "이 카테고리를 쓰지 않습니다", + 2 미만 권장 안내)으로 | [04-admin.md](04-admin.md) 3-2 · 3-5 | Y-11 | CORE-15 | 완료 |
| ADMIN-19 | 인당 문제 기본값 · 안내 (R-64) | 게임 편집 진행 기본값 "인당 문제" (1 ~ 5, 사진 게임만, 팀당 대표 옆). 문제 목록 요약 "× 인당 2문제", 순위가 다 정해지는 수(3팀 × 대표 × 인당)보다 적으면 회색 안내 — 최소 수 경고는 그대로 | [04-admin.md](04-admin.md) 3-2 · 3-5 | Y-19 | CORE-16 | 완료 |
| ADMIN-20 | 안 쓰는 이미지 정리 (R-68) | `GET /api/admin/images/unused`(큰 것부터 · 크기 · 시각, 못 읽는 게임은 skipped) · `DELETE /api/admin/assets/…`(게임 저장 줄에서 다시 확인 — 쓰는 이미지 409). `app/admin/images.js`: 한 장씩 크게 · 이전 / 다음(← →) · 지우기 · 목록. 관리 홈 · [전체 검증] 에서 들어감. Redis `stat` · `unlink` 는 머리말만(`GETRANGE`), 쓰기 요청 검사에 `DELETE` | [04-admin.md](04-admin.md) 3-14 | X-54 | ADMIN-11 | 완료 (배포 전) |
| ADMIN-21 | 이미지 Blob 옮기기 화면 · 올릴 때 줄이기 (R-67, `D-35`) | `app/admin/images.js` `blobPage`: 현황(옮긴 수 · 남은 쓰는 이미지 · 안 쓰는 이미지) · [☁ n개 옮기기] 한 장씩 · 진행 · [■ 멈추기] · 실패 목록 · 다시 하기, 관리 홈(서버 모드만). `app/admin/image.js` `shrinkPlan`: 500KB 넘는 PNG · JPEG 는 JPEG 0.85 (투명한 PNG 그대로, 작아지지 않으면 원본) | [04-admin.md](04-admin.md) 3-15 · 4장 | X-55, X-56 | DEP-26 | 완료 — 옮기기 화면은 10/27 옮긴 뒤 걷어냄 (DEP-27) |
| ADMIN-22 | 공개 모드 스위치 (R-96) | 관리 홈 "🌐 공개 모드" — 상태 · [공개 모드 켜기](확인창 — 숨기기 안내) · [공개 모드 끄기] · [↗ /play 열기], 읽지 못해도 관리 홈은 그림. `api.publicMode` · `setPublicMode` | [04-admin.md](04-admin.md) 3-1 · 3-16 | P-4 | SRV-8 | 완료 |

### 2-8. DEP — 서버 모드 (R-36, 10/08 ~) · Vercel 로 옮기기 (R-51, 10/14 ~)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| DEP-1 | 서버 모드 시작 | `server.mjs`: 환경 변수(`CAMP_PUBLIC_ORIGIN` · `CAMP_PIN` · `CAMP_DATA_DIR` · `CAMP_HOST` · `CAMP_PORT`), 서버 모드 로그(PIN 없음). `app.mjs`: 코드 폴더 · 저장 폴더 분리, 받을 주소, `/api/health` 를 Host 검사 앞에 | [08-tech.md](08-tech.md) 11 · 11-1장 | X-1, X-2, X-14 | — | 완료 |
| DEP-2 | 볼륨 처음 채우기 | 저장 폴더에 `data/` · `assets/` · `state/` 가 없으면 코드 폴더의 것을 복사 (`.backup/` · 숨김 파일 제외), 있으면 그대로 | [08-tech.md](08-tech.md) 11-3 | X-3 | DEP-1 | 완료 |
| DEP-3 | 서버 모드 잠금 | 서명 쿠키(PIN + 볼륨의 `.camp-secret`, 7일, 나가기 목록), IP별 실패 잠금(`X-Forwarded-For` 마지막 주소), Host · Origin 에 공개 주소, `/data/**` · `/assets/**` · `/api/state*` · `/api/live*` 로그인 필요, `/api/login` · `/api/session`, 관리 PIN 확인 때 쿠키, https 면 `Secure`. 노트북 모드는 지금 그대로 | [08-tech.md](08-tech.md) 11-2, [12-host-view.md](12-host-view.md) 5-4 | X-4, X-5, X-9 ~ X-16 | DEP-1 | 완료 |
| DEP-4 | 게임 화면 PIN 화면 · 안내 문구 | 서버 모드에서 로그인 전이면 게임 화면에 PIN 입력. 진행자 화면 · 관리 페이지의 PIN 안내 문구를 모드별로 ("서버 터미널에 표시된" ↔ "운영자에게 받은"). 서버 모드 [나가기] 확인 창, 게임 화면은 상태 보고 401 이면 PIN 화면으로 | [12-host-view.md](12-host-view.md) 3 · 5-4 | X-6, X-7, X-23 | DEP-3 | 완료 |
| DEP-5 | 진행자 화면 휴대폰 배치 | 760px 미만에서 한 열 · 버튼 채우기 · 표 가로 스크롤 상자 | [12-host-view.md](12-host-view.md) 2-2 · 4-1 | X-17 | — | 완료 |
| DEP-6 | 이미지 빌드 | 이전 운영 환경의 컨테이너 이미지 · 빌드 워크플로 — **R-51 로 뺌** (DEP-14) | — | X-18, X-19 | DEP-1 | 제외 (R-51) |
| DEP-7 | 매니페스트 · 운영 절차 | 이전 운영 환경의 매니페스트 · 절차 — **R-51 로 뺌** (DEP-14). Vercel 절차는 DEP-15 ~ | — | X-20 ~ X-22 | DEP-6 | 제외 (R-51) |
| DEP-8 | 이전 운영 환경 첫 배포 | 회사 서버에 서버 모드로 첫 배포 · 도메인 · 노트북에서 만들던 문제를 서버로 [백업 올리기] (10/08 ~ 10/14 운영). **R-51 로 Vercel 로 옮김** | — | X-24 | DEP-7, DEP-10 | 제외 (R-51) |
| DEP-9 | 저장 폴더 시작 점검 · 처음 채우기 (R-37) | 시작할 때 저장 폴더 점검(만들기 · 이름 바꾸기 덮어쓰기 · 읽기 · 지우기) · 로그 · 쓰기 불가면 시작 안 함. `state/` 는 빈 폴더로 시작 | [08-tech.md](08-tech.md) 11-3 | X-3, X-24 | DEP-2 | 완료 |
| DEP-10 | 백업 내려받기 · 올리기 (R-37) | 공용 tar 모듈(화면 · 서버), `GET` · `POST /api/admin/archive` (검사 후 한꺼번에 쓰기 · 올리기 전 자동 백업 3개 · `reload`), 자동 백업 목록 · 내려받기, 관리 페이지 화면(미리보기 · 고르기 · 확인 창) | [04-admin.md](04-admin.md) 3-11, [08-tech.md](08-tech.md) 4-3 | X-25 ~ X-29, J-10, J-13, K-3-8 | ADMIN-6 | 완료 |
| DEP-11 | git 에서 현장 상태 빼기 · 안내 문구 (R-37) | `.gitignore` 에 `state/`, 저장소에서 `state/` 추적 해제. 관리 홈 "git 안내" → "데이터 보관" (백업 버튼), 상태 초기화 결과 안내, 저장 충돌 안내 문구, README 사용법 | [08-tech.md](08-tech.md) 5장, [04-admin.md](04-admin.md) 3-1 · 3-10 | I-43, K-3-7 | — | 진행 중 |
| DEP-12 | Redis 저장소 · 서버 여러 개 (R-50) | `server/store.mjs`(파일 · Redis — 400KB 조각 · 폴더 목록 HASH · 잠금 키 `SET NX EX` + 확인 뒤 `DEL`), `server/redis.mjs`(RESP2 · 기본 명령만 · 재연결 · 20초 쉰 연결 새로), 저장 · 백업 · 정적 파일 · 백업 올리기를 저장소로, 실시간 중계 공유 상태 · 알림 번호 0.2초 폴링, PIN 실패 · 나가기 공유, 서명 키 없을 때만 쓰기, `CAMP_REDIS_URL` · `CAMP_REDIS_PASSWORD` · `CAMP_REDIS_PREFIX` · `CAMP_SEED`, 시작 점검 | [08-tech.md](08-tech.md) 11-6 | X-32 ~ X-41 | DEP-9, DEP-10 | 완료 |
| DEP-13 | 이전 운영 환경에서 Redis 저장소 확인 (R-50) | 회사 서버에서 Redis 저장소 · 서버 2개로 확인 — 백업으로 데이터 옮기기(192개 파일 · 바이트 일치), 서버 데이터로 한 판 진행, 서버 하나를 지워도 이어짐, 게임 화면 · 진행자 화면을 다른 서버에 붙여 양방향 전달 (15-qa 17장 X-42). **R-51 로 Vercel 로 옮김** | [08-tech.md](08-tech.md) 11-6 | X-42, X-21 | DEP-12 | 완료 (이전 운영 환경) |
| DEP-14 | 사내 설정 제거 (R-51, `D-30`) | `vercel` 브랜치: 매니페스트(`deploy/`) · `Dockerfile` · `.dockerignore` · 이미지 워크플로 삭제, 이전 저장소 전용 명령을 빼고 잠금은 확인 뒤 `DEL`, 연결 유지 190초 삭제, 화면 안내 VPN → 인터넷 연결, 앱 안 설명서 링크 → `/docs/manual.md`(서버가 내줌), 문서에서 사내 주소 · 시스템 · 절차 제거 (16-deploy 다시 씀) | [08-tech.md](08-tech.md) 3 · 11장, [16-deploy.md](16-deploy.md) | W-29, X-5 | DEP-12 | 완료 |
| DEP-15 | Vercel 함수 진입점 · 공개 파일 막기 (R-51) | 서버 시작을 `createApp`(요청 처리기) · `createAppServer`(포트 열기)로 나눔, 환경 변수 읽기 공용(`server/config.mjs`). `api/index.js`(첫 요청 때 앱 — 설정이 틀리면 503 · 로그) + `vercel.json`(모든 경로를 함수로, 리전 `icn1`, 300초, 빌드 `npm test`), 함수에는 화면 코드 · 설명서 · 템플릿 · 초기 데이터만(`includeFiles`), 공개 폴더 `public/` 은 robots.txt 뿐, `.vercelignore` | [08-tech.md](08-tech.md) 3 · 11-5장, [16-deploy.md](16-deploy.md) 2-1 | X-43, X-44 | DEP-14 | 완료 |
| DEP-16 | 실시간 알림 구독 (R-51) | 알림을 번호를 붙여 저장한 뒤 `PUBLISH`, SSE 연결이 있는 서버만 구독 연결(`createSubscriber` — 15초 `PING`, 끊기면 다시 붙어 저장된 번호로 채움)로 받음 — 쉬는 동안 명령 0. 구독을 못 하는 저장소면 로그를 남기고 0.2초 번호 확인으로 | [08-tech.md](08-tech.md) 11-6 | X-48, X-39 | DEP-15 | 완료 |
| DEP-17 | 300초 연결 상한 대응 (R-51) | `CAMP_STREAM_MAX_S`(Vercel 함수 270초)마다 서버가 먼저 `bye` 로 끊고 0.3초 뒤 다시 붙음 — 연결 표시 유지(진행자 화면은 탭 id), 알림 번호(SSE `id` · `hello` 에 지금 번호) · 다시 붙으면 15초 안의 놓친 명령 · 다시 읽기 · 닫기를 다시 보냄(서버 여럿이면 명령은 앞쪽 20개도, 게임 화면은 명령 id 로 한 번만), 게임 화면 · 진행자 화면은 `bye` 면 끊김 표시 없이 | [08-tech.md](08-tech.md) 11-4, [12-host-view.md](12-host-view.md) 6-1 · 6-2 | X-45 | DEP-15 | 완료 |
| DEP-18 | 4.5MB 요청 상한 (R-51) | 백업 나눠 올리기 — 시작(목록 · JSON 검사 · 자동 백업) → 이미지(4MB 조각, 마지막 조각에서 이어 붙임) → 끝(문제 · 상태 쓰기), 임시 사본 없음 · 서버 여럿이어도. 올리기 전 자동 백업은 문제 · 현장 상태만. 이미지 하나 4MB 상한(화면은 화질을 낮춰 맞춤). 백업 내려받기는 파일마다 한 번에 읽기 (300초 안 확인은 DEP-19) | [04-admin.md](04-admin.md) 3-11 · 4장, [08-tech.md](08-tech.md) 4-3, [16-deploy.md](16-deploy.md) 4장 | X-47, X-21 | DEP-15 | 완료 |
| DEP-19 | 데이터 옮기기 · 첫 배포 (R-51) | Upstash · Vercel 만들기 · 환경 변수(운영자 — Production 에만), 배포 → 지금 서버 [백업 내려받기] → 새 서버 [백업 올리기] → 게임 화면 · 진행자 화면을 다른 인스턴스에 붙여 확인, 백업 내려받기가 300초 안에 끝나는지 | [16-deploy.md](16-deploy.md) 2-1 · 4장 | X-42, X-43 ~ X-48 (실제 환경) | DEP-15 ~ DEP-18 | 완료 — 배포 · 이관 · 명령 전달 · 백업 내려받기 16.6초 · 한 판 진행 (10/14, 15-qa 20장) |
| DEP-20 | 이미지 ETag (R-51) | `/assets/**` 에 ETag(크기 · 저장 시각 — 서버가 여럿이어도 같은 값) · `private, no-cache`, 바뀌지 않았으면 304. 저장소에 내용 · 크기 · 시각을 한 번에 읽기(`readWithInfo` — Redis 작은 파일은 GET 한 번) | [08-tech.md](08-tech.md) 4-2 | X-46 | DEP-15 | 완료 |
| DEP-21 | 닫은 화면 바로 지우기 (R-51) | Vercel 은 브라우저가 닫은 연결을 함수가 모른다(10/14 실제 환경 — 닫은 진행자 화면이 1분 넘게 남음) → 게임 화면 · 진행자 화면이 `pagehide` 에 `POST /api/live/leave`(`keepalive`), 서버는 연결 표시를 바로 지우고 진행자 수 · 명령 받을 창을 고친다. 뒤로 가기 캐시에서 돌아오면 다시 붙음. 알릴 틈 없이 끊긴 경우(휴대폰 잠김)의 남는 시간 줄이기(270초 → 60초)는 하지 않음 (사용자 결정 — 1번 안만 적용) | [08-tech.md](08-tech.md) 4-4 · 11-4 | X-49 | DEP-17 | 완료 |
| DEP-22 | 점수 입력은 바뀔 때만 (R-55) | 관리 페이지 [점수 입력] 의 3초 다시 읽기(켜 둔 동안 Upstash 시간당 약 9,600 명령)를 없앰 → `GET /api/live/changes`(SSE — 상태 파일 `reload` 만, 연결 표시 없음 · 서버가 먼저 끊음 · 서버를 건넘). 점수판 · 팀 설정이 바뀌었을 때만 `/api/state`, 내가 저장한 리비전 · 저장 중에 온 내 알림은 건너뜀, 끊겼다 다시 붙으면 한 번 | [08-tech.md](08-tech.md) 4-4, [13-scoreboard.md](13-scoreboard.md) 10-5 | X-50 | DEP-16, DEP-17 | 완료 (10/15 배포 — 확인은 로컬 · 자동 테스트) |
| DEP-23 | 게임 화면 열기를 가볍게 (R-55) | 10/15 실제 환경: 게임 홈을 열자 이미지 141장 요청이 한꺼번에 가 Vercel 인스턴스가 약 90개 새로 켜짐(로그 "함수 시작" 92줄, Upstash 연결 102개) → 미리 받기 · 없는 이미지 확인을 한 번에 4장씩, 없는 이미지 확인(`HEAD`)은 머리말만(본문 · 조각을 안 읽음), Vercel 함수의 시작 점검은 `SET … EX 60` · `GET` 두 명령(전부 하면 약 12) | [08-tech.md](08-tech.md) 4-2 · 7-1 · 11-5 · 11-6 | X-51 | DEP-15, DEP-20 | 완료 — 10/15 배포 뒤 게임 홈 열기: 새 인스턴스 92 → 5(화면 코드만), Upstash 연결 102 → 7 (15-qa 24-3) |
| DEP-24 | 도메인 `display-ad-camp.fun` · 공개 주소를 시스템 환경 변수로 (R-63) | 도메인 구매 · Vercel 연결(운영자, 10/21 — Vercel DNS, 인증서 · `www` → apex 307 확인). `server/config.mjs`: Vercel 운영 배포(`VERCEL_ENV=production`)면 `VERCEL_PROJECT_PRODUCTION_URL`(대표) · `VERCEL_URL` · `VERCEL_BRANCH_URL` 로 공개 주소, `CAMP_PUBLIC_ORIGIN` 은 그 뒤에 더함. `api/index.js`: 미리보기 배포는 503 "미리보기 배포(preview)는 쓰지 않습니다", 시작 로그에 다른 주소도. 배포 → 새 주소 `/` PIN 화면 · 로그인 · 저장 확인. Vercel DNS 루트 A 레코드 64.29.17.65 · 216.198.79.65 (TTL 300) 고정 — 행사 뒤 지울지 결정. 진행자에게 새 주소만 안내 | [08-tech.md](08-tech.md) 11-1 · 11-5, [16-deploy.md](16-deploy.md) 2 · 2-1 · 2-2 · 7장 | X-31, X-52 | DEP-19 | 완료 (10/21 배포 — 새 주소 확인, 15-qa 32장). 로그인 뒤 저장 · 진행자 화면 · LTE 는 리허설 |
| DEP-25 | 연결 끊김 비콘 (R-66) | `server/beacon.mjs`(정해진 화면 · 이유 · 숫자만 받아 로그 한 줄 — 화면 시각 · 응답 시간 구간별 · 도착 지연) + `POST /api/live/beacon`(로그인 필요). `app/ui/beacon.js`: 끊김 표시가 뜨는 순간 `/api/health` 한 번으로 응답 시간(Resource Timing) → 비콘(`keepalive`), 못 보내면 들고 있다가 다시 붙을 때, 10초에 한 번 · 5개까지. 게임 화면 `setConn(status, why)` · 관리 페이지 `setOnline(v, why)` · 진행자 화면 `onerror` 에서 부름 | [08-tech.md](08-tech.md) 11-4 | X-53 | DEP-17 | 완료 (배포 전) |
| DEP-26 | 이미지 Vercel Blob 저장소 (R-67) | `server/blob.mjs`(SDK `@vercel/blob` 2.8.1 — 켤 때만 동적 import, 공개 · 무작위 접미사) · `server/config.mjs`(운영 배포 + Redis + `BLOB_READ_WRITE_TOKEN`) · `server/store.mjs`(Redis 저장소의 `assets/` 이미지는 머리말 `{ s, t, u }` 만 — 쓰기 · 읽기 · 지우기 · `stat.url` · `moveToBlob`) · `server/static.mjs`(`/assets` 302) · `GET /api/admin/images/blob` · `POST …/move` · 함수 시작 로그 "이미지 …". 운영은 Blob 필수 — 토큰이 없거나 SDK 를 못 불러오면 ✕ 로그 · 이미지 저장 · 옮기기 503 (Redis 에 넣지 않음, 폴백 없음). 운영: 먼저 Blob 저장소(공개 · icn1) 만들어 연결 → 배포 → 안 쓰는 이미지 정리 → 백업 → 옮기기 (16-deploy 2-3) | [08-tech.md](08-tech.md) 11-7, [16-deploy.md](16-deploy.md) 2-3 | X-55, X-56 | DEP-17, ADMIN-20 | 완료 (10/27 배포 · 운영 옮기기 — Upstash 131MB → 988KB, 이미지 146개 모두 Blob, 15-qa 39장) |
| DEP-27 | Redis 이미지 읽기 걷어내기 (R-67 후속) | 운영 이미지를 모두 Blob 으로 옮긴 뒤 — `server/store.mjs`: 이미지는 쓰기 · 읽기 모두 Blob 만(Blob 이 없으면 쓰기 503, 주소 없는 이미지 키는 읽지 않음 — null), `moveToBlob` 삭제. `server/config.mjs`: Redis 저장소면 언제나 Blob 설정(토큰 없으면 null). `server/api-admin.mjs`: `/api/admin/images/blob*` 삭제. 관리 페이지 옮기기 화면 · 홈 버튼 삭제. 테스트: Redis 앱은 가짜 Blob 기본, 조각 시험은 이미지가 아닌 큰 파일로 | [08-tech.md](08-tech.md) 11-6 · 11-7, [04-admin.md](04-admin.md) 3-15 | X-56 | DEP-26 | 완료 (배포 전) |
| DEP-28 | Blob 저장소 방화벽 Referer (R-69) | `server/blob.mjs` `fetchBytes(url, referer)` · `createBlob({ referer })` · Redis 저장소 `referer` — 서버가 Blob 에서 받을 때 `<대표 주소>/` 를 Referer 로 (`server/app.mjs`). 운영: Blob 저장소 Firewall 켜기 → 규칙 "referer 가 `https://display-ad-camp.fun/` 로 시작하지 않음 → Deny" (16-deploy 2-4) | [08-tech.md](08-tech.md) 11-7, [16-deploy.md](16-deploy.md) 2-4 | X-57 | DEP-26 | 완료 (10/27 배포 · 규칙 게시 — curl 확인, 15-qa 38장) |
| DEP-29 | 이미지 주소 표 (R-70) | `server/store.mjs`: Redis HASH `u`(경로 → Blob 주소) — 이미지 쓰기 HSET · 지우기 HDEL · `assetUrls()`(처음 한 번 머리말로 채우고 `u:ok`), 파일 저장소는 `null`. `server/app.mjs` `GET /api/assets`(로그인 필요). 올리기 응답 `{ path, url }`. `app/core/assets.js`(`loadAssetUrls` · `assetUrl` · `assetKnown` · `setAssetUrl`) — 게임 화면(데이터 불러오기 · 다시 불러오기 · 미리 받기 · 없는 이미지 확인 · 사진 · 이모티콘 정답 이미지), 진행자 화면 썸네일, 관리 페이지(시작 · 썸네일 · 편집 미리보기 · 정리 화면 · 올리기) | [08-tech.md](08-tech.md) 4-3 · 7-1 · 11-6 · 11-7 | X-58 | DEP-26, DEP-27 | 완료 (배포 전) |
| DEP-30 | 저장소 공개 준비 (R-100) | `data/games/photo-quiz.json` 캐릭터 이름 문제를 검수용 샘플 4개로 · 실제 캐릭터 그림 11장 삭제 · 사진 후보 문서의 회사 관련 장소 줄 삭제 · 사내 플랫폼 이름을 "이전 서버" 로 · 문서의 말씀 인용을 요약으로. 복제본에서 `git filter-repo --invert-paths`(그림 11장) · `--replace-text`(같은 문구) → 맨 끝 커밋 트리가 바뀌지 않았는지 대조 → `main` 강제 푸시 → 작업 폴더를 새 이력으로 | [09-decisions.md](09-decisions.md) D-13 | — | DATA-4 | 완료 (11/02 — 15-qa 70장) |
| DEP-31 | 로그 시각을 Node 판과 상관없이 (R-101) | `server/files.mjs` `clock` — `toLocaleTimeString('ko-KR')` 대신 `stamp` 와 같은 한국 시간 부분(`formatToParts`, `h23`)으로 `<시>시 <분>분 <초>초` 조립. `test/time.test.js` 자정 · 한 자리 분 · 초 | [08-tech.md](08-tech.md) 11-5 | X-53 | DEP-19 | 완료 (11/02 — 15-qa 71장) |
| DEP-32 | 공개 뒤 민감정보 정리 (R-104) | 문서의 보안 프로그램 이름 · 사내망 정책 · 사람 별칭 · 사내 계정 ID 를 역할 이름으로, `test/beacon.test.js` 의 실제 IP 를 `203.0.113.7` 로. 이력은 그대로 | — | X-53 | DEP-30 | 완료 (11/02 — 15-qa 73장) |
| DEP-33 | 고정 PIN 없애기 (R-105) | 테스트 8개 파일의 `const PIN` 을 무작위 6자리로, 틀린 PIN · 다른 PIN 을 `wrongPin(n)` 으로 (`server` · `server-mode` · `redis` 테스트). `docs/12-host-view.md` 터미널 예시 PIN 가림. 복제본에서 `git filter-repo --replace-text` (같은 규칙) → 맨 끝 커밋 트리 대조 → 강제 푸시 | — | V-5, I-29, X-6, X-11 | DEP-32 | 완료 (11/02 — 15-qa 74장) |

## 3. 데이터 (구현과 함께)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| DATA-1 | 앱 · 점수판 기본값 | `data/app.json`(제목 "2026 디광 캠핑" · 부제 · 게임 목록), `data/scoreboard.json`(라운드 9개 · 시트 배점) | [02-data-schema.md](02-data-schema.md) 2-3 · 7장 | T-1 | CORE-2 | 완료 |
| DATA-2 | 게임 데이터 초기 파일 | `chain-talk.json`(주제 4개 · 예시), `emoji-quiz.json`(카테고리 3개 · 문제 0), `photo-quiz.json`(카테고리 14개 · 연출별 샘플 3문제) | [02-data-schema.md](02-data-schema.md) 4-4 | A-8, C-1, H-1 | CORE-2 | 완료 |
| DATA-3 | 이모티콘 템플릿 | `docs/templates/emoji-quiz-template.tsv` + 작성 안내 (10/17 이모티콘 담당자에게 전달) | [02-data-schema.md](02-data-schema.md) 6-1, [games/emoji-quiz.md](games/emoji-quiz.md) 5장 | I-20 | DATA-2 | 완료 |
| DATA-4 | 검수용 샘플 | 사진 14카테고리 × 4문제(연출 섞어서, 테스트 이미지 재사용 가능), 이모티콘 3카테고리 × 4문제. 검수가 끝나면 실제 문제로 교체. 샘플 문제는 모두 `note` 가 "검수용 샘플 (DATA-4)" 로 시작 — QA-4 에서 이 표시로 찾아 지운다 (이미지 포함). 검수 시나리오용 문제 포함: 정답 이미지(E-12), `focus [0,0]`(E-7), 40자 정답(E-20), 문제 `prompt`(E-3), 이미지 파일 없음(E-19), 이모지 순차 · 공백 12개 · 이미지(E-13 ~ E-15) | [11-acceptance-tests.md](11-acceptance-tests.md) 기본 조건 | — | ADMIN-3 | 완료 |

## 4. 검수 (10/19 ~ 10/21)

| ID | 할 일 | 내용 | 스펙 | 검수 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| QA-1 | 검수 시나리오 전체 | S · A · B · C · D · E · F · G · H · V · W · T · I · J · K 모두 통과. 1차(10/06) 결과 · 고친 결함은 [15-qa-results.md](15-qa-results.md) — Safari · 전체화면 등 실제 장비 확인(15-qa-results 3장)만 남음 | [11-acceptance-tests.md](11-acceptance-tests.md) | 전부 | 2 · 3장 전부 | 진행 중 |
| QA-2 | 해상도 · 가독성 | 1280×720 · 1920×1080 · 3840×2160 레이아웃, 3m 거리 가독성(정답 · 점수 · 14칸 원판 글자). 세 해상도 레이아웃은 1차에서 확인 — 외부 모니터 · 3m 가독성이 남음 | [08-tech.md](08-tech.md) 9 · 10장 | K-8, D-25 | QA-1 | 진행 중 |
| QA-3 | 안정성 · 복구 | 1시간 연속 진행, 서버 재시작 · 새로고침 · 브라우저 데이터 삭제 후 복구. 복구 항목은 1차에서 확인 — 1시간 연속 진행이 남음 | [08-tech.md](08-tech.md) 10장 | K-1, K-3-2, K-3-4, V-14 | QA-1 | 진행 중 |
| QA-4 | 검수 흔적 정리 | 샘플 문제 삭제(`note` "검수용 샘플 (DATA-4)" · 그 이미지), 관리 페이지 상태 초기화 [전부 초기화] → 커밋 · 푸시 | [04-admin.md](04-admin.md) 3-10 | I-40 ~ I-43 | QA-1 | 대기 |
| QA-5 | 타이머 제거 확인 (R-33) | 게임 화면 · 진행자 화면 · 관리 페이지에 타이머가 남지 않았는지, 예전 파일의 타이머 값 처리. 자동 테스트 · 브라우저 확인 | [11-acceptance-tests.md](11-acceptance-tests.md) G | G-10 ~ G-14, A-7, W-12 | GAME-13, HOST-4, ADMIN-9 | 완료 |
| QA-6 | 클립보드 붙여넣기 확인 (R-34) | 붙여넣기 이벤트로 사진 · 정답 · 이모티콘 이미지, 글자 칸, 이미지 없음 안내 확인. 실제 `⌘V` (화면 캡처 · Finder 복사 · Safari)는 행사 노트북에서 | [11-acceptance-tests.md](11-acceptance-tests.md) I | I-45 ~ I-50 | ADMIN-10 | 완료 |
| QA-7 | 다음 문제 지정 확인 (R-35) | 게임 창 + 진행자 화면으로 라운드 소개 · 문제 · 정답 공개에서 순서 바꾸기, 거절, 결과 · 채우기까지 | [11-acceptance-tests.md](11-acceptance-tests.md) W | W-24 ~ W-27 | HOST-5 | 완료 |
| QA-8 | 서버 모드 확인 (R-36) | 노트북에서 서버 모드를 흉내 내 X-1 ~ X-17 · X-23 (자동 테스트 · 브라우저 · 휴대폰 폭), 노트북 모드 회귀(S · V). 실제 배포 환경 확인(X-20 · X-21)은 DEP-19 뒤. 결과는 [15-qa-results.md](15-qa-results.md) 7장 | [11-acceptance-tests.md](11-acceptance-tests.md) X | X-1 ~ X-23 | DEP-1 ~ DEP-7 | 진행 중 |
| QA-9 | 서버 저장 · 백업 확인 (R-37) | 자동 테스트(저장 폴더 점검 · tar 만들기 · 풀기 · 올리기 검사), 노트북에서 백업 내려받기 → 다른 서버에 올리기 · 현장 상태 끄기 · 잘못된 파일, 컨테이너로 서버 모드 점검 로그 | [11-acceptance-tests.md](11-acceptance-tests.md) X · I · J · K | X-24 ~ X-30, I-43, J-10, J-13, K-3-7, K-3-8 | DEP-9 ~ DEP-11 | 진행 중 |
| QA-10 | 앱 안 설명서 확인 (R-38) | 진행자 화면(넓은 화면 · 휴대폰 폭 · PIN 화면) · 관리 페이지 설명서 열기 · 닫기, 모드별 안내, 링크 | [11-acceptance-tests.md](11-acceptance-tests.md) W · I | W-28, W-29, I-51 | HOST-6, ADMIN-11 | 완료 |
| QA-11 | 이모티콘 정답 이미지 확인 (R-39) | 관리 페이지에서 정답 이미지 넣기 · 빼기 · 저장, 게임 화면 정답 공개 (이모지 · 순차 · 이미지 문제), 자동 테스트(검증 · 저장 순서) | [11-acceptance-tests.md](11-acceptance-tests.md) E · I | E-15-1, I-22-1 | GAME-15, ADMIN-12 | 완료 |
| QA-12 | 한 라운드 더 · 정답 글자 숨기기 · 가림 힌트 확인 (R-40 ~ R-42) | 로컬 서버로 라운드 1 · 문제 1 게임 → [한 라운드 더 ▶] 두 번 → 결과의 라운드별 정답 수, 가림 상자 1개 문제 힌트 단계 없음 · 정답 공개 때 벗김, 편집 화면 체크박스 · 미리보기. 자동 테스트 3개 | [11-acceptance-tests.md](11-acceptance-tests.md) W · E · I | W-30, W-31, E-10-1, E-12-1, I-11-1 | GAME-16 ~ GAME-18, HOST-7, ADMIN-13 | 완료 |
| QA-13 | 한 문제 더 확인 (R-43) | 자동 테스트(작성 순서 · 다 쓰면 막힘 · 정답 수), 로컬 서버로 라운드당 문제 1 게임 → [한 문제 더 ▶] → Q 2 / 2 | [11-acceptance-tests.md](11-acceptance-tests.md) W | W-32 | GAME-19, HOST-8 | 완료 |
| QA-14 | 룰렛 결과 지정 확인 (R-48) | 자동 테스트(원판 각도 · 지정 순번 · 명령 전달), 로컬 서버로 조각 수를 바꿔 가며 지정 → 회전 · 한 번만 · 빼면 풀림 · 줄줄이 말해요 | [11-acceptance-tests.md](11-acceptance-tests.md) W | W-38 ~ W-44 | GAME-22, HOST-11 | 완료 |
| QA-15 | 이모티콘 퀴즈 정답당 점수 확인 (R-49) | 자동 테스트(정답 수 라운드 계산 · 채우기 · 직렬화 · 기본값), 로컬 서버로 이모티콘 게임 → +50 · 스코어보드 점수 → 결과 점수 · 정답 수 → 채우기(게임 화면 · 진행자 화면 고치기) → 점수판 · 라운드 설정 · 배점표. 서버는 배포 뒤 저장소의 점수판 기본값 사본 교체(T-39) | [11-acceptance-tests.md](11-acceptance-tests.md) T | T-30 ~ T-39 | GAME-23, HOST-12, SB-6 | 진행 중 (서버 배포 · 사본 교체 완료 — 서버 화면 배점표 확인 남음) |
| QA-16 | Redis 저장소 · 서버 여러 개 확인 (R-50) | 자동 테스트(로컬 `redis-server` — 클라이언트 · 저장소 · 잠금 · 빈 저장소 · 서버 두 개), 로컬 Redis + 서버 두 개(1329 · 1330)로 게임 화면 ↔ 진행자 화면 · 키 접두어 · 빈 저장소에서 관리 페이지. 이전 운영 환경은 DEP-13, Vercel 은 DEP-19 | [11-acceptance-tests.md](11-acceptance-tests.md) X | X-32 ~ X-42 | DEP-12 | 완료 (X-42 — Vercel 에서도, 15-qa 20장) |
| QA-17 | Vercel 진입점 · 연결 상한 · 이미지 ETag 확인 (R-51) | 자동 테스트(함수 처리기 · `vercel.json` · 다시 붙기 — 서버 하나 · Redis 서버 둘 · ETag), 연결 상한 6초 로컬 서버로 게임 화면 + 진행자 화면 (명령 전달 · 끊김 표시 없음), 브라우저 ETag 304. 실제 Vercel 은 DEP-19 | [11-acceptance-tests.md](11-acceptance-tests.md) X | X-43 ~ X-46 | DEP-15, DEP-17, DEP-20 | 완료 (실제 Vercel 은 DEP-19 뒤) |
| QA-18 | 백업 나눠 올리기 · 실시간 알림 구독 확인 (R-51) | 자동 테스트(나눠 올리기 — 파일 · Redis 서버 둘, 구독 — 바로 받기 · 쉬는 동안 GET 없음 · 끊겨도 채움 · 못 하면 번호 확인), 로컬 서버 관리 페이지에서 백업 올리기 (이미지 69개 · 진행 표시 · 자동 백업). 실제 Vercel 은 DEP-19 | [11-acceptance-tests.md](11-acceptance-tests.md) X | X-47, X-48 | DEP-16, DEP-18 | 완료 (실제 Vercel 은 DEP-19 뒤) |
| QA-19 | 라운드 밖 후보 고르기 확인 (R-52) | 자동 테스트(라운드 소개 · 진행 중 · 라운드 마지막 · 거절 · 진행자 상태의 후보), 로컬 서버에서 게임 창 + 진행자 화면으로 라운드 소개에서 후보를 첫 문제로 | [11-acceptance-tests.md](11-acceptance-tests.md) W | W-45 ~ W-47 | HOST-13 | 완료 |
| QA-20 | 사진 문제 오른쪽 열 확인 (R-53) | 1920×1080 에서 세로 · 정사각 · 16:9 · 가장 넓은 사진 크기 실측, 맞힌 팀 효과 · 추가 문제 · 긴 팀 이름 × 4팀, 이모티콘 아래 띠, 관리 페이지 미리보기, 1280×720 · 3840×2160 | [11-acceptance-tests.md](11-acceptance-tests.md) E · K | E-21 ~ E-23, K-8 ~ K-10 | GAME-25, ADMIN-16 | 완료 |
| QA-21 | 추가 문제 고르기 확인 (R-54) | 자동 테스트(후보 범위 · 제외 카테고리 · 골라 열기 · 거절 · 무작위 범위 · 진행자 상태), 로컬 서버에서 게임 창 + 진행자 화면으로 동점 → 카테고리 → 문제 [내기] → 추가 문제 진행 → 결과 | [11-acceptance-tests.md](11-acceptance-tests.md) W · F | W-48 ~ W-50, F-16 | HOST-14 | 완료 |
| QA-22 | Upstash 명령 줄이기 확인 (R-55) | 자동 테스트(변경 알림 · 서버 건넘 · 짧은 점검 명령 수 · HEAD 가 본문을 안 읽음 · 이미지 4장씩), 로컬 서버에서 점수 입력 화면 — 3초 다시 읽기 없음 · 다른 창 저장에 한 번 · 내 저장에는 안 읽음. 배포 뒤 실제 Vercel 에서 게임 홈 열기의 "함수 시작" 수 · Upstash 명령 수 | [11-acceptance-tests.md](11-acceptance-tests.md) X | X-50, X-51 | DEP-22, DEP-23 | 완료 — 실제 Vercel 은 게임 홈 열기(15-qa 24-3), 점수 입력은 로컬 · 자동 테스트 |
| QA-23 | 라운드 종료 안내 · 라운드 점수 확인 (R-56) | 자동 테스트(전이 · 한 라운드 더 위치 · 되돌아가기 · 복원 · 형식 검사), 로컬 서버로 사진 퀴즈(라운드당 문제 2 · 라운드 2) · 이모티콘 퀴즈(점수) — 안내 카드 → 한 문제 더 → 라운드 종료 화면 → 되돌리기 · 돌아가기 → 다음 라운드 → 마지막 라운드 [결과 보기 ▶] · [한 라운드 더 ▶] | [11-acceptance-tests.md](11-acceptance-tests.md) W | W-10, W-30 ~ W-32, W-51 ~ W-55 | CORE-12, GAME-27, HOST-15 | 완료 |
| QA-24 | 라운드마다 반영 확인 (R-57) | 자동 테스트(라운드별 등수 · 정답 없는 라운드 · 다시 계산 · 결과 채우기와 같은 값 · 칸 표시 · 직렬화), 로컬 서버로 사진 퀴즈 두 라운드 반영 → 되돌아가 고치기 → 다시 반영 → 결과 창 안 뜸, 이모티콘 퀴즈 정답 수 합 | [11-acceptance-tests.md](11-acceptance-tests.md) W · T | W-56 ~ W-59, T-40, T-41 | SB-7, GAME-28, HOST-16 | 완료 |
| QA-25 | 기록 · 통계 확인 (R-58) | 자동 테스트(추이 기록 · 합치기 · 초기화, 문제 기록 감추기, 팀별 통계), 로컬 서버로 점수판 입력 · 라운드 반영 · 진행 중 문제 기록 · 1920×1080 표시 | [11-acceptance-tests.md](11-acceptance-tests.md) L | L-1 ~ L-8 | GAME-30, SB-8 | 완료 |
| QA-26 | 정답 기록 고치기 확인 (R-60) | 자동 테스트(고칠 수 있는 문제 · 교체 · 없음 · 추가 문제 동점 팀 · 결과 화면 다시 공개 · 거절), 로컬 서버로 문제 화면에서 지난 문제 고치기 → 모니터 그대로 · 점수 반영 → 라운드 종료 [다시 반영] → 결과에서 고치기 | [11-acceptance-tests.md](11-acceptance-tests.md) W | W-13, W-60 ~ W-64 | CORE-13, GAME-31, HOST-17 | 완료 |
| QA-27 | 정답 영상 확인 (R-61) | 자동 테스트(주소 · 시간 읽기, 검증 · 정리 · 저장 순서), 로컬 서버로 관리 페이지 입력 · 구간 미리보기 · 저장 → 명대사 문제 정답 공개 자동 재생 → 끝 시간에 정답 띠 → 진행자 일시정지 · 계속 · 끝내기 · 다시 재생 · 재생 중 맞힌 팀 → 비상용 키 · `←` · 이어하기 → 못 트는 영상 | [11-acceptance-tests.md](11-acceptance-tests.md) E · W · I | E-24 ~ E-27, W-65 ~ W-67, I-58 ~ I-60 | GAME-32, HOST-18, ADMIN-17 | 완료 |
| QA-28 | 릴레이 확인 (R-62) | 자동 테스트(라운드 등수 · 최소 수 뽑기 · 하나 더 · 한 팀만 남으면 종료 · 문제가 떨어지면 종료 · 빠진 팀 · 정답 기록 고치기 · 부족한 카테고리 · 결과 배점 합 · 점수판 채우기 · 옵션 기본값), 로컬 서버로 사진 퀴즈 3팀 × 2명 두 라운드 — 정답자 없음 섞기 → 라운드 종료 순위 → 반영 → 결과 동점 추가 문제, 부족 카테고리 · 배점 변경 | [11-acceptance-tests.md](11-acceptance-tests.md) Y | Y-1 ~ Y-15 | CORE-15, GAME-33, HOST-19, ADMIN-18 | 완료 |
| QA-29 | 인당 문제 확인 (R-64) | 자동 테스트(대표 × 인당 문제로 끝 · 처음 뽑는 수 그대로 · 카테고리 그대로 후보 · 문제가 떨어지면 종료 · 옵션 검증 · 저장 · R-64 전 세션), 로컬 서버로 관리 페이지 인당 문제 2 저장 → 게임 홈 요약 → 사진 퀴즈 한 라운드 — 교체 안내 · 묶은 ●○ · 순위 | [11-acceptance-tests.md](11-acceptance-tests.md) Y | Y-16 ~ Y-19 | CORE-16, GAME-34, HOST-20, ADMIN-19 | 완료 |
| QA-30 | 줄줄이 주제 고르기 확인 (R-65) | 자동 테스트(고르기 · 첫 문제 자동 · 주제 카드 · 취소 · 무작위 후보 · 거절 · 명령), 로컬 서버로 게임 화면 + 진행자 화면 — 모니터에 후보가 안 보이는지, 문제 있는 주제 · 없는 주제 공개, 다음 주제 | [11-acceptance-tests.md](11-acceptance-tests.md) H · W | H-11 ~ H-15, H-24 ~ H-27, W-33, W-43 | CORE-17, GAME-35, HOST-21 | 완료 (보완 2 — 34-1) |
| QA-31 | 연결 끊김 원인 조사 · 비콘 확인 (R-66) | 10/27 리허설 — Vercel 로그(요청 도착 · 함수 실행 · 응답 시간) + 크롬 별도 탭 · 셸에서 1초마다 응답 시간 구간별 · 게이트웨이 ping · Vercel / Google 연결 동시 측정 · Wi-Fi 기록. 비콘은 자동 테스트 + 로컬 서버로 세 화면 · 서버 껐다 켜기 | [11-acceptance-tests.md](11-acceptance-tests.md) X | X-53 | DEP-25 | 완료 (15-qa 35장) |
| QA-32 | 안 쓰는 이미지 정리 확인 (R-68) | 자동 테스트(목록 · 크기 순 · 쓰는 이미지 409 · 앱 헤더 · 다른 출처 403 · 404 · 경로 400, Redis 서버 둘 — 목록 A · 지우기 B · 조각까지 지움), 로컬 서버 관리 페이지 — 한 장 보기 · ← → · 목록 클릭 · 지우기 · 토스트 · 파일 삭제 · 서버 로그 · [전체 검증] 버튼 | [11-acceptance-tests.md](11-acceptance-tests.md) X-54 | X-54 | ADMIN-20 | 완료 (로컬) |
| QA-33 | 이미지 Blob 저장소 확인 (R-67) | 자동 테스트(가짜 Blob — 머리말만 · 새 주소 · 옛 Blob 지움 · 지우기, Blob 없는 서버 A 와 Blob 서버 B — 옮기기 · 건너뜀 · 저장 시각 · 302 · HEAD · 401 · 백업 바이트 · 409 · 503 · 400 · 404, 환경 변수, SDK 불러오기 · 못 불러올 때, 줄이기 규칙), 로컬 서버 모드(로컬 redis + 브라우저가 받을 수 있는 가짜 Blob 서버)로 관리 페이지 옮기기 화면 · 진행 · 302 이미지 표시 | [11-acceptance-tests.md](11-acceptance-tests.md) X-55 · X-56 | X-55, X-56 | DEP-26, ADMIN-21 | 완료 (로컬) — 운영 옮기기 뒤 다시 |
| QA-34 | Blob 방화벽 Referer 확인 (R-69) | 크롬 — Blob 저장소 Firewall(꺼짐 · "Protect your store"), WAF 규칙 편집기 조건 목록(저장 안 함). 자동 테스트 — Referer 없으면 403 인 흉내 서버로 `fetchBytes` · `createBlob().get`. 규칙을 건 뒤 운영 확인은 16-deploy 2-4 의 3번 | [11-acceptance-tests.md](11-acceptance-tests.md) X-57 | X-57 | DEP-28 | 완료 (10/27 — 운영 규칙 curl 확인, 이미지 옮긴 뒤 화면에서 다시) |
| QA-35 | 이미지 주소 표 확인 (R-70) | 자동 테스트(Redis 서버 둘 — 표 · 401 · 올리기 url · 교체 · 지우기 · 처음 채우기, 노트북 모드 null, 화면 모듈 — 표로 주소 · 없는 이미지를 요청 없이), 로컬 서버 모드(로컬 redis + 가짜 Blob 서버)로 게임 홈 · 미리 받기 · 관리 페이지 썸네일 — 이미지 요청이 어디로 가는지 | [11-acceptance-tests.md](11-acceptance-tests.md) X-58 | X-58 | DEP-29 | 완료 (로컬) |
| QA-37 | 룰렛 준비 게임 화면 확인 (R-72) | 로컬 서버로 이모티콘 퀴즈 룰렛 준비 1920×1080 — 목록 · 커서 없음, 진행자 화면 [빼기] → 원판 조각 사라짐, `Space` 회전 · 정지 | [11-acceptance-tests.md](11-acceptance-tests.md) D | D-1, D-2, D-5, D-6, D-27 | GAME-36 | 완료 |
| QA-38 | `M` · `?` 키 없앰 확인 (R-73) | 로컬 서버 제목 화면에서 `M` · `?` · `→` · `Enter` · `Space` · `C` → 변화 없음, [이어하기] 클릭 정상, ☰ → [도움말] → 표 (`F` · `Esc` 만 공통) → `Esc` 로 닫힘 | [11-acceptance-tests.md](11-acceptance-tests.md) A · K | A-3, A-4, A-9, K-7 | GAME-37 | 완료 |
| QA-39 | `←` · `PageUp` 없앰 확인 (R-74) | 로컬 서버 이모티콘 퀴즈 라운드 소개 · 정답에서 `←` → 변화 없음 | [11-acceptance-tests.md](11-acceptance-tests.md) D · E | D-16, E-2 | GAME-38 | 완료 |
| QA-40 | `Enter` 통일 확인 (R-75) | 로컬 서버 이모티콘 퀴즈 룰렛 · 문제 · 확인창, 줄줄이 말해요 주제 고르는 중 | [11-acceptance-tests.md](11-acceptance-tests.md) D · E · H · K | D-6, D-8, E-28, H-26, K-15 | GAME-39 | 완료 |
| QA-41 | 게임 홈 키 없앰 확인 (R-76) | 로컬 서버 이모티콘 퀴즈 게임 홈 — 키 무시, 클릭 동작 그대로 | [11-acceptance-tests.md](11-acceptance-tests.md) C | C-11 | GAME-40 | 완료 |
| QA-42 | 룰렛 `E` · `R` 없앰 확인 (R-77) | 로컬 서버 이모티콘 퀴즈 룰렛 준비 · 정지 후 `E` · `R` | [11-acceptance-tests.md](11-acceptance-tests.md) D | D-28 | GAME-41 | 완료 |
| QA-43 | `H` · `Z` 키 없앰 확인 (R-78) | 로컬 서버 이모티콘 퀴즈 문제 화면 · 줄줄이 말해요 주제 카드에서 키 무시, 진행자 명령은 그대로 | [11-acceptance-tests.md](11-acceptance-tests.md) E · H | E-29, H-28 | GAME-42 | 완료 |
| QA-44 | 룰렛 키 `Enter` 만 확인 (R-79) | 로컬 서버 이모티콘 퀴즈 룰렛 정지 후 `Space` · `→` · `PageDown` 무시, `Enter` 확정 | [11-acceptance-tests.md](11-acceptance-tests.md) D | D-9, D-29 | GAME-43 | 완료 |
| QA-45 | 진행 화면 `E` · `R` 없앰 확인 (R-80) | 로컬 서버 이모티콘 퀴즈 문제 · 정답 화면에서 `E` · `R` | [11-acceptance-tests.md](11-acceptance-tests.md) F · K | F-18, K-16 | GAME-44 | 완료 |
| QA-46 | 정답 화면 숫자 · `V` 키 없앰 확인 (R-81) | 로컬 서버 이모티콘 퀴즈 정답 화면에서 숫자 · `V` 무시, 진행자 맞힌 팀 버튼 그대로 | [11-acceptance-tests.md](11-acceptance-tests.md) E · F | E-30, F-1 | GAME-45 | 완료 |
| QA-47 | 라운드 소개 · 정답 공개 `Enter` 만 확인 (R-82) | 로컬 서버 이모티콘 퀴즈 라운드 소개 · 문제 화면에서 `→` · `Space` · `PageDown` 무시, `Enter` 첫 문제 · 정답 공개, 정답 화면 `→` 다음 문제 | [11-acceptance-tests.md](11-acceptance-tests.md) E | E-1, E-31 | GAME-46 | 완료 |
| QA-48 | 게임 화면 `Backspace` 없앰 확인 (R-83) | 로컬 서버 이모티콘 퀴즈 라운드 소개 · 문제 · 정답 화면에서 `Backspace` 무시, 점수 그대로 | [11-acceptance-tests.md](11-acceptance-tests.md) K | K-17 | GAME-47 | 완료 |
| QA-49 | 룰렛 정지 후 `Backspace` 확인 (R-84) | 로컬 서버 이모티콘 퀴즈 룰렛 정지 후 `Backspace` → 준비, 다시 `Enter` 회전 · 확정, 라운드 소개 `Backspace` 무시 | [11-acceptance-tests.md](11-acceptance-tests.md) D | D-8, D-30 | GAME-48 | 완료 |
| QA-50 | 넘기기 `Enter` 통일 · 진행 화면 키 정리 확인 (R-85) | 로컬 서버 이모티콘 · 사진 퀴즈 정답 · 라운드 종료 · 결과 · 발표 화면, 줄줄이 말해요 주제 고르기 · 주제 카드 | [11-acceptance-tests.md](11-acceptance-tests.md) E · H · K | E-32, H-29, K-18 | GAME-49 | 완료 |
| QA-51 | 정답 화면 맞힌 팀 확인창 확인 (R-86) | 로컬 서버 이모티콘 퀴즈 정답 화면 — 미지정 `Enter` · `Esc` · 지정 뒤 `Enter` | [11-acceptance-tests.md](11-acceptance-tests.md) E | E-33 | GAME-50 | 완료 |
| QA-52 | 진행자 다음 버튼 맞힌 팀 확인 확인 (R-87) | 로컬 서버 사진 퀴즈 — 진행자 [다음 문제 ▶] 미지정 · 지정 · 확인 중 게임 화면에서 넘김 | [11-acceptance-tests.md](11-acceptance-tests.md) W | W-68 | HOST-22 | 완료 |
| QA-53 | 줄줄이 주제 고르는 중 멘트 확인 (R-88) | 로컬 서버 줄줄이 말해요 [게임 시작] → 모니터 문구 (W-22 다음 주제로 돌아온 화면은 같은 화면이라 코드 확인) | [11-acceptance-tests.md](11-acceptance-tests.md) H · W | H-2, H-24, W-22 | GAME-51 | 완료 |
| QA-54 | 게임 홈 규칙 표시 확인 (R-89) | 로컬 서버 1600×900 — 줄줄이 말해요 · 이모티콘 퀴즈 · 사진 퀴즈 게임 홈 | [11-acceptance-tests.md](11-acceptance-tests.md) C | C-12 | GAME-52 | 완료 |
| QA-55 | 이모티콘 퀴즈 문제 고르기 확인 (R-90) | 자동 테스트(고르기 · 묶음 · 거절 · 다 냄 → 결과 · 예전 진행 기록 · 서버 목록), 로컬 서버 게임 화면 + 진행자 화면 — 게임 홈 · 카테고리 목록 · [내기] · 맞힌 팀 확인 · [카테고리 목록 ▶] · [종료] → 결과 | [11-acceptance-tests.md](11-acceptance-tests.md) E · W | E-34, W-69 | CORE-18, GAME-53, HOST-23 | 완료 |
| QA-56 | 카테고리 카드 클릭 확인 (R-91) | 자동 테스트(작성 순서 · 낸 문제 건너뜀 · 랜덤 범위 · 없는 카테고리 · 다 낸 카테고리), 로컬 서버 게임 화면 — 카드 클릭으로 문제 | [11-acceptance-tests.md](11-acceptance-tests.md) E | E-35 | GAME-54 | 완료 |
| QA-57 | 게임 홈 옵션 없앰 확인 (R-92) | 로컬 서버 사진 보고 맞추기 게임 홈 1600×900 | [11-acceptance-tests.md](11-acceptance-tests.md) C | C-13 | GAME-55 | 완료 |
| QA-58 | 안내 페이지 팔레트 확인 (R-93) | 로컬 서버 1600×900 — 제목 화면 · 사진 퀴즈 게임 홈 · 룰렛 · 확인창 · 메뉴 · 진행자 화면 | [11-acceptance-tests.md](11-acceptance-tests.md) A | A-11 | GAME-56 | 완료 |
| QA-59 | 맞힌 사람 기록 확인 (R-94) | 자동 테스트(대표 기록 · 바꾸기 · 빠짐 거절 · 대표 없이 · 예전 기록 · 정답 기록 고치기) + 로컬 서버 1600×900 — 인당 1 · 인당 2 게임에서 진행자 버튼 · 모니터 묶음 클릭 · 빠짐 · 정답 기록 고치기 | [11-acceptance-tests.md](11-acceptance-tests.md) Y | Y-20 ~ Y-23 | CORE-19 · GAME-57 · HOST-24 | 완료 |
| QA-60 | 라운드당 문제 수 뽑기 확인 (R-95) | 자동 테스트(12개 뽑기 · 순위가 정해지면 8개로 줄이고 4개 돌려놓기 · 최소 수 · 카테고리에 있는 만큼) + 로컬 서버 — 라운드당 문제 12 저장 → 새 게임 문제 11개 카테고리 확정 → 진행자 화면 목록 11개 | [11-acceptance-tests.md](11-acceptance-tests.md) Y | Y-24 | CORE-20 | 완료 |
| QA-61 | 공개 모드 확인 (R-96) | 자동 테스트(공개용 데이터 · 한 판 순서 · 이어하기 · 스위치 · 로그인 없이 받는 것과 그대로 잠긴 것 · 백업 제외 · `vercel.json`) + 로컬 서버 모드(1696) — 관리 홈 켜기, 로그인 없는 브라우저로 키보드만 · 마우스만 진행, 사진 힌트 · 이모지 순차 공개 · 줄줄이 말해요 주제 · 문제, 이어하기, 휴대폰 폭, 서버 요청 | [11-acceptance-tests.md](11-acceptance-tests.md) P | P-1 ~ P-8 | GAME-58 · ADMIN-22 | 완료 — 운영(Vercel · Blob) 확인은 배포 뒤 (16-deploy 8장) |
| QA-62 | 공개 모드 줄줄이 말해요 빼기 · 카테고리 고르기 확인 (R-97 · R-98) | 자동 테스트(줄줄이 말해요 null · 카테고리 한 판 · 다른 카테고리 문제 · 다 풂 저장값 · 서버 게임 목록) + 로컬 서버 모드(1696) — 게임 목록 2개, 카테고리 목록 키보드 · 마우스, 이어하기 · 다 풂 배지, 모두 풀었습니다, 휴대폰 폭 | [11-acceptance-tests.md](11-acceptance-tests.md) P | P-1 ~ P-3, P-6 ~ P-8 | GAME-59 | 완료 |
| QA-63 | 공개 모드 UX 다듬기 확인 (R-99) | 자동 테스트(공개용 게임 필드에 설명 없음) + 로컬 서버 모드(1696) — 주소 · 뒤로 · 앞으로 가기, `Esc` 뒤 뒤로 가기, 정답 본 뒤 새로고침, [↺ 처음부터], 다 풂 · 끝 화면 새로고침, 잘못된 주소, 설명 문구, 휴대폰 폭 버튼 띠 | [11-acceptance-tests.md](11-acceptance-tests.md) P | P-9 ~ P-11 | GAME-60 | 완료 |
| QA-64 | 저장소 공개 준비 확인 (R-100) | 자동 테스트 · 새 이력에서 그림 11장 · 바꾼 문구가 어느 커밋에도 없는지 · 맨 끝 커밋 트리가 다시 쓰기 전과 같은지 · 커밋 수 | [15-qa-results.md](15-qa-results.md) 70장 | — | DEP-30 | 완료 |
| QA-65 | 공개 모드 문제 순서 · 이어하기 초기화 확인 (R-102 · R-103) | 자동 테스트(공개 필드 · 작성 순서 한 판 · 순서가 바뀐 판) + 로컬 서버 모드(1696) — 작성 순서 · 무작위 게임, 옛 무작위 판, 정답 본 뒤 새로고침, 초기화 취소 · 확인, 휴대폰 폭 | [11-acceptance-tests.md](11-acceptance-tests.md) P | P-12, P-13 | GAME-61 | 완료 |

## 5. 콘텐츠 (관리 페이지가 생기면 바로, ~10/24 — 누구나)

| ID | 할 일 | 내용 | 관련 | 기한 | 상태 |
| --- | --- | --- | --- | --- | --- |
| CNT-1 | 사진 문제 | 14개 카테고리 × 최소 5문제(70), 여유가 되면 카테고리당 10문제. 정답 글자 노출 확인, 확대 지점 · 가림 상자 지정, 애매한 정답은 `note` 에. 문제 0개 카테고리는 룰렛에 안 들어가므로 모이는 대로 | [games/photo-quiz.md](games/photo-quiz.md) 3 · 6 · 8장 | ~10/24 | 대기 |
| CNT-2 | 이모티콘 문제 | 이모티콘 담당자가 템플릿에 작성 → 누구나 관리 페이지 [표 붙여넣기] 로 탑재. 10/13: 슬라이드 「10/29 캠핑 :이모티콘퀴즈」 1 ~ 33장(영화 7 · 속담 8, 정답 이미지 9장)을 관리 API 로 일괄 등록하는 스크립트 준비 — 서버 반영은 PIN 을 가진 사람이 실행. 노래 제목(34장 ~)은 아직 | [games/emoji-quiz.md](games/emoji-quiz.md) 5 · 6장 | ~10/24 | 진행 중 |
| CNT-3 | 줄줄이 말해요 주제 | 주제 확정 · 규칙 문구 · 예시 | [games/chain-talk.md](games/chain-talk.md) 2장 | ~10/24 | 대기 |
| CNT-4 | 콘텐츠 점검 | 중복 정답 · 난이도 · 이모지 모양(macOS) · 카테고리별 문제 수 | [10-schedule.md](10-schedule.md) 2장 "콘텐츠" | 리허설 전 | 대기 |

## 6. 리허설 · 행사

| ID | 할 일 | 내용 | 관련 | 기한 | 상태 |
| --- | --- | --- | --- | --- | --- |
| EVT-1 | 리허설 | 리허설 체크리스트 전체 (장비 · 서버 · 앱 · 콘텐츠) | [10-schedule.md](10-schedule.md) 2장 | 10/27 | 대기 |
| EVT-2 | 리허설 뒤 정리 | 서버 관리 페이지 → [백업 내려받기] (리허설 기록 보관) → 상태 초기화 → [리허설 기록 지우기] | [04-admin.md](04-admin.md) 3-10 · 3-11, R-37 | 10/27 | 대기 |
| EVT-3 | 최종 점검 | 리허설이 끝난 배포를 그대로 두기(새로 배포하지 않음) → 메뉴에 데이터 오류 없음 · 카테고리 제외 확인 → [백업 내려받기] (노트북 비상용 보관) | [10-schedule.md](10-schedule.md) 1장, [16-deploy.md](16-deploy.md) 4 · 6장 | 10/28 | 대기 |
| EVT-4 | 현장 진행 | 당일 진행 순서대로 (팀 설정은 팀 정하기 직후) | [10-schedule.md](10-schedule.md) 3장 | 10/29 | 대기 |
| EVT-5 | 결과 보존 | 행사가 끝나면 관리 페이지 [백업 내려받기] → 팀 드라이브에 보관 (최종 점수판 · 진행 기록) | [08-tech.md](08-tech.md) 5-1, R-37 | 10/29 | 대기 |
