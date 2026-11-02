# 07. 상태 모델

구현은 이 문서 기준으로 한다. 다른 문서와 충돌하면 이 문서를 고치고 관련 문서도 맞춘다.

## 1. 상태 계층

| 계층 | 내용 | 저장 | 수명 |
| --- | --- | --- | --- |
| 데이터 | `data/app.json`, `data/games/*.json` (서버가 제공) | 서버 저장 폴더의 파일 (R-37) | 앱 실행 동안 고정 (관리 페이지에서 저장 · 백업 올리기를 하면 서버 `reload` 알림으로 다시 읽음) |
| 설정 | 팀 · 표시 · 게임별 옵션 | 파일 `state/settings.json` (+ 브라우저 임시 사본) | 영구 ([03-settings.md](03-settings.md) 5장) |
| 세션 | 게임 1판의 진행 상태 (게임별 1개) | 파일 `state/sessions/<게임 id>.json` (+ 브라우저 임시 사본) | 새로 시작 · 초기화 전까지 |
| 점수판 | 배점 · 라운드 설정 변경분 + 종합 점수판 입력값 | 파일 `state/scoreboard.json` (+ 브라우저 임시 사본) | 초기화 전까지 ([13-scoreboard.md](13-scoreboard.md) 9-1) |
| 화면 | 현재 보고 있는 화면 · 오버레이 | 메모리 (`route` 만 파일 `state/route.json`) | 실행 동안 |

- 설정 · 세션 · 점수판 · route 는 **로컬 서버가 파일로 저장**한다 (R-28). 브라우저 저장소는 서버가 꺼졌을 때를 위한 임시 사본이고, 재연결되면 파일로 올린다 ([08-tech.md](08-tech.md) 6장).

## 2. 화면 위치 (Route)

```ts
type Route =
  | { view: 'title' }
  | { view: 'gameHome'; gameId: string }
  | { view: 'teamSettings'; back: Route }
  | { view: 'play'; gameId: string }    // 세부 화면은 세션의 screen 이 결정
  | { view: 'stats'; tab?: 'trend' | 'teams' | 'questions' }; // 기록 · 통계 (R-58, 05-screens 4-12)
```

- 앱 시작 시 route 는 **항상 `title`** (R-3). 저장된 route 는 이어하기 카드 문구에만 쓴다.
- 관리는 게임 창의 route 가 아니라 별도 페이지 `/admin` 이다 (R-31, [04-admin.md](04-admin.md) 2장).
- 메뉴는 route 가 아니라 오버레이 (어느 route 위에도 열림).

## 3. 세션

### 3-1. 공통

```ts
interface SessionBase {
  version: 1;
  gameId: string;
  type: 'photo' | 'emoji' | 'roulette';
  status: 'active' | 'finished';
  startedAt: string;            // ISO
  updatedAt: string;
  snapshot: {                   // 시작 시 고정 (01-app-flow 4-5)
    teamCount: number;          // 득점형만. 룰렛형은 팀을 쓰지 않아 0 (D-7)
    candidates: string[];       // 시작 시 넣은 카테고리 id (게임 홈 제외 반영) — 첫 룰렛 준비의 초기 선택
    options: Record<string, unknown>; // 라운드 수 등 게임 옵션 값 — 득점형은 rounds · questionsPerRound · questionOrder · relay · perRep (3-2)
    points?: number[];          // 릴레이 결과 순위에 쓰는 라운드 배점 (1등 · 2등 …) — R-62, 3-2
  };
  wheel: string[];              // 지금 룰렛 준비에서 "넣음" 상태인 카테고리 id (R-21). 시작 시 = snapshot.candidates, 이후 진행자가 바꾼 값을 다음 판이 이어받음
  // picks: 룰렛 확정 결과 (순서대로) — 모양은 type 별로 3-2 · 3-3
}
```

- 상태 초기화([04-admin.md](04-admin.md) 3-10)로 비운 진행 기록 파일은 `{ "version": 1, "gameId": "<게임 id>", "empty": true }` 로 덮어쓴다 (파일을 지우지 않음). 읽는 쪽은 진행 기록이 없는 것과 같게 다룬다.

### 3-2. 득점형 세션 (`photo`, `emoji`)

```ts
type ScoreScreen =
  | 'roulette' | 'round' | 'question' | 'answer' | 'roundEnd'
  | 'result' | 'tiebreakQuestion' | 'tiebreakAnswer';
// roundEnd = 라운드 종료 화면 (R-56) — 라운드 마지막 문제 다음. roundIndex 는 그 라운드, questionIndex 는 그 라운드 마지막 문제

interface ScorePick { categoryId: string; questionIds: string[] } // 라운드별 출제 목록 (확정 시 고정)

interface ScoreSession extends SessionBase {
  picks: ScorePick[];
  screen: ScoreScreen;
  roundIndex: number;           // picks 인덱스
  questionIndex: number;        // picks[roundIndex].questionIds 인덱스
  stage: number;                // 연출 단계 — 5-1 아래 표 (photo 확대 단계 · 제거한 가림 상자 수 / emoji 공개된 이모지 수)
  hintVisible: boolean;
  resultRevealCount: number;    // 결과 화면에서 공개한 등수 그룹 수
  scoreboardFill: null | "filled" | "skipped"; // "점수판에 채울까요?" 처리 결과 (D-18). null 이면 모두 공개 후 창을 띄움
  history: ScoreOp[];
  tiebreak: { used: string[]; groups: number[][] }; // 추가 문제(D-3)로 낸 문제 id 목록 · 그 문제를 연 동점 그룹(팀 번호) — 같은 순서
  reflectedRounds?: number[];   // 라운드 종료 화면에서 종합 점수판에 반영한 라운드 번호(picks 인덱스, 오름차순) — R-57. 게임 결과 채우기 [확인] 뒤에는 모든 라운드. 없으면 []
}

type ScoreOp =
  | { op: 'add';     q: string; team: number; rep?: number; at: number }
  | { op: 'remove';  q: string; team: number; none?: true; at: number }
  | { op: 'replace'; q: string; from: number; team: number; rep?: number; at: number }
  | { op: 'none';    q: string; at: number };
// q = 문제 id. 추가 문제(동점 처리)는 'tb:<문제 id>' — 정답 수에 더하지 않음
// none = "맞힌 팀 없음" 표시 (정답 수 영향 없음, 진행자 화면 · 정답 띠 표시용). remove 의 none: true = 맞힌 팀을 "없음" 으로 바꿈
// rep = 맞힌 대표 번호 (팀당 대표 방식의 라운드 문제, 0부터 — R-94). 같은 팀의 다른 대표로 바꾸면 replace (from = team). 없으면 대표 기록 없음 (R-94 전 · 정답 수 방식)
```

- **릴레이 (R-62)**: `snapshot.options.relay` = 팀당 대표 수 (게임 시작 때 게임 옵션에서 고정, [01-app-flow.md](01-app-flow.md) 4-5). 1 이상이면 릴레이 — 라운드 등수 · 문제 뽑기 · 라운드 끝이 달라진다 (4 · 5장, [games/photo-quiz.md](games/photo-quiz.md) 4-1). 값이 없거나 0 이면 정답 수 방식 — 릴레이 전 세션은 그대로 읽는다.
- **인당 문제 (R-64)**: `snapshot.options.perRep` = 대표 한 명이 맞히고 빠지는 문제 수 (1 ~ 5, 없으면 1 — R-64 전 세션 포함). 팀이 대표를 모두 내보내는 정답 수 **goal = relay × perRep** — 아래 릴레이 계산의 "`relay` 번" 은 모두 goal 번이다. 최소 문제 수(`need`, (팀 수 − 1) × relay)에는 곱하지 않는다 — 처음 뽑는 수는 R-95 부터 `questionsPerRound` (need 보다 적으면 need) (참고값이라 카테고리를 더 막지 않음 — 모자라면 문제가 떨어진 데서 라운드 종료).
- **맞힌 대표 (R-94)**: 대표는 함께 나와 한 사람이 perRep 번까지 맞히고 빠진다. 기록의 `rep` 으로 대표마다 맞힌 수를 센다 — perRep 을 채운 대표는 그 라운드의 뒤 문제에서 고를 수 없다 (`credit` · `setCredit` 거절 "팀A 대표1 — 2문제를 다 맞혀 빠졌습니다"). `rep` 없이 온 지정은 같은 팀이면 그대로, 다른 팀이면 그 문제 전까지 안 빠진 첫 대표로 기록. 셀 때 `rep` 이 없거나 이미 다 채운 대표인 기록은 그때 남은 첫 대표로 센다 — 팀 맞힌 수 · finish · 등수는 대표 기록과 상관없이 예전과 같다.
- `snapshot.points` (릴레이만) = 결과 순위에 쓰는 라운드 배점 — 게임 시작 때 배점표의 이 게임 행(게임 전체에 연결된 등수 행)을 담는다. 배점표 · 관리 페이지에서 배점을 바꾸면 게임 창이 진행 중 릴레이 세션의 `points` 도 맞춘다 (게임 창을 연 때 · 점수판이 바뀔 때). 없으면 100 / 50 / 0 / 0 (`D-33`).

### 3-3. 룰렛형 세션 (`roulette`)

```ts
type RouletteScreen = 'roulette' | 'topic';

interface RoulettePick {
  categoryId: string;           // 확정한 주제. 팀 · 차례 정보 없음 (D-7)
  questionIds?: string[];       // 이 추첨에서 낸 문제 (낸 순서, R-44). 아직 안 냈거나 문제 없는 주제면 없음 · 빈 배열
}

interface RouletteSession extends SessionBase {
  picks: RoulettePick[];        // 확정 순서대로. 룰렛 준비의 "×n" (이번 게임 당첨 횟수) 계산용. 개수 제한 없음
  screen: RouletteScreen;       // 'topic' = 주제 카드 (마지막 pick 의 questionIds 가 비었으면 문제 전). 문제는 진행자 화면에만 — 모니터는 늘 주제 카드 (R-65)
  examplesVisible: boolean;     // 주제 카드의 예시 (H)
  answersVisible: boolean;      // 문제의 정답 후보 모니터 표시 (R-44). R-65 부터 모니터에 문제를 띄우지 않아 쓰지 않는다 (예전 세션 호환으로 남김)
}
```

- 룰렛형은 팀 차례 · 추첨 횟수 · 추첨 완료 화면이 없다 (`D-7`). `status` 는 진행자 [끝내기] 를 누를 때 (게임 창 `E` 는 R-85 에서 없앰) `finished` 가 된다.
- **지금 문제** = `screen === 'topic'` 일 때 마지막 pick 의 `questionIds` 마지막 id. 없으면 주제 카드.
- `snapshot.options` 는 `{ questionOrder: 'random' | 'fixed' }` — 게임 시작 때 관리 페이지 진행 기본값 "문제 순서"(`defaults.questionOrder`)를 고정 (R-45 — R-65 부터 게임 홈 옵션 · 저장값은 쓰지 않음). 예전 세션(빈 `options`)은 `random`.
- 예전 세션 파일(문제 기능 전 — `questionIds` · `answersVisible` 없음)은 빈 배열 · `false` 로 읽는다.

### 3-4. 룰렛 화면 단계 (메모리 전용)

```ts
type RoulettePhase = 'setup' | 'spinning' | 'stopped';
// setup    = 룰렛 준비 (카테고리 넣기/빼기, 원판 미리보기)
// spinning = 회전 중 (결과는 회전 시작 순간 정해져 있음 — 무작위 또는 진행자 지정, R-48)
// stopped  = 정지 · 당첨 카드 (확정 대기)
```

- 세션 `screen` 이 `roulette` 이면 이 단계를 메모리에만 둔다. 새로고침 · 이어하기 · 서버 재시작 후에는 항상 `setup` 으로 시작 (선택 `wheel` 은 세션에 저장돼 유지).
- 진행자의 결과 지정(R-48)은 세션에도 이 단계에도 두지 않는다 — 회전을 시작할 때 결과를 정하는 데만 쓰고 버린다. 진행 기록에는 지정했는지와 상관없이 확정한 결과(`picks`)만 남는다 (`D-27`).

### 3-5. 정답 영상 재생 상태 (메모리 전용, R-61)

```ts
type ClipState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';
// idle    = 아직 안 틀었음 (문제 화면 — 플레이어만 미리 불러 둠)
// loading · playing · paused = 영상이 메인 영역을 덮고 있음 → 정답 띠를 띄우지 않는다
// done    = 끝 시간 · 영상 끝 · [영상 끝내기] → 영상을 걷어내고 정답 띠
// error   = 못 틂 (인터넷 · 퍼가기 금지 · 삭제) → 정답 띠, 이유는 진행자 화면에
```

- 정답 영상이 있는 사진 문제의 문제 · 정답 화면에만 있고 **세션에 저장하지 않는다** — 재생 위치는 기록할 것이 아니다. 정답 공개(`question` → `answer`, 추가 문제도)로 넘어가는 순간 처음부터 재생하고, `←` 로 정답을 숨기면 `idle` 로. 새로고침 · 이어하기 · 라운드 종료에서 돌아오기처럼 **정답 화면으로 바로 들어오면 자동 재생하지 않는다** (`idle` — 정답 띠가 바로 보이고 진행자가 [▶ 영상 재생]).
- 정답 공개 · 맞힌 팀 · 점수 · `history` 와 상관이 없다 — 영상이 도는 동안에도 맞힌 팀은 고를 수 있고 모니터 표시만 영상이 끝난 뒤.

## 4. 파생 값 (저장하지 않고 계산)

| 값 | 계산 |
| --- | --- |
| 문제별 득점 팀 `scored[q]` | `history` 를 처음부터 재생 (`add` 추가, `remove` 제거, `replace` = `from` 제거 + `team` 추가) |
| 팀별 정답 수 | `tb:` 로 시작하지 않는 모든 `q` 에서 해당 팀이 `scored[q]` 에 있는 수 (R-22 — 종합 점수는 계산하지 않음) |
| 라운드별 정답 수 | `picks[r].questionIds` 에 속한 `q` 만 세어 팀별 정답 수 (결과 화면 라운드별 표, [13-scoreboard.md](13-scoreboard.md) 10장). 라운드 종료 화면의 **이번 라운드 점수**는 `roundIndex` 라운드의 이 값 (점수를 주는 게임은 × 1개당 점수, R-49 · R-56) |
| 릴레이 라운드 (R-62) | 라운드의 `questionIds` 를 순서대로 보며 맞힌 팀의 **맞힌 대표 수**를 센다 — `relay` × `perRep` 번(goal, R-64) 맞힌 팀은 "대표를 모두 내보냄" (`finish`, 순서대로). 이미 다 내보낸 팀의 뒤 기록(정답 기록을 고쳐 생긴 것)은 세지 않는다. **라운드 등수** = 다 내보낸 순서, 못 끝낸 팀은 그 뒤에 맞힌 대표 수로 1224 (같으면 공동). 정답이 하나도 없으면 등수 없음. **순위가 정해짐**(`decided`) = 다 내보낸 팀 ≥ 팀 수 − 1. 정답 수 방식 라운드의 등수는 그 라운드 정답 수 1224 (R-57) |
| 릴레이 최소 문제 수 `need` | (팀 수 − 1) × 대표 수 (2팀이면 대표 수). 라운드 확정 때 뽑는 수이자, 카테고리를 쓸 수 있는 남은 문제 수 기준 (`D-33`) |
| 게임 점수 (릴레이) | 라운드마다 등수의 배점(`snapshot.points`, 없으면 100 / 50 / 0 / 0)을 더한 값 — 종합 점수판 등수 행과 같은 계산 |
| 순위 | (나보다 위인 팀 수) + 1 (1224 방식). 정답 수가 같으면 추가 문제를 먼저 맞힌 팀(`tiebreak.used` 앞쪽 문제의 `tb:` 득점)이 위 — 동점 그룹 안 순위 재배정. 릴레이는 정답 수 대신 **게임 점수**로 (같으면 추가 문제 — 같은 규칙) |
| 결과 공개 그룹 | 순위 내림차순으로 같은 순위끼리 묶은 목록 |
| 룰렛 원판 후보 | `wheel` − (데이터에서 사라졌거나 숨겨진 카테고리) − (득점형: 남은 문제 0개 카테고리) − (릴레이: 남은 문제 < `need` 인 카테고리 — 부족, R-62). 룰렛형의 문제를 다 낸 주제는 [다시 추첨] 때 `wheel` 에서 자동으로 빠지지만(6장, `D-26`) 진행자가 다시 넣으면 후보. **이미 뽑힌 카테고리도 넣은 상태면 그대로 후보** (R-16) |
| 룰렛 준비 목록 | 이 게임의 숨김 아닌 카테고리 전부 — 항목마다 넣음 여부(`wheel` 포함), 남은 문제 수 (룰렛형은 문제가 있는 주제만, 없으면 표시 안 함), 이번 게임 당첨 횟수(`picks` 에서 셈). 릴레이는 부족 여부(`short` — 남은 문제가 1개 이상이고 `need` 보다 적음)와 `need` (R-62) |
| 더 낼 라운드가 있음 | 남은 문제가 한 라운드 분량(정답 수 방식 1개, 릴레이 `need` 개) 이상인 카테고리가 있다 — 없으면 "더 출제할 문제가 없습니다", [한 라운드 더 ▶] 도 막힘 |
| 카테고리별 남은 문제 | 그 카테고리의 사용 가능한(`disabled` 아닌) 문제 − 모든 `picks` 의 `questionIds` − `tiebreak.used` (한 게임에서 같은 문제는 다시 안 나옴 — 추가 문제로 연 문제 포함). 룰렛형 주제도 같은 계산 (R-44) — 단 0개여도 원판 후보에서 빼지 않는다 (`D-26`) |
| 추가 문제 후보 (R-54) | 이 게임에 포함된 카테고리(`snapshot.candidates`, 데이터에서 사라졌거나 숨겨진 것 제외) 각각의 남은 문제 — 데이터 순서. 진행자 화면 고르기와 게임 창 `S`(무작위) 모두 여기서 |
| `photo` 확대 배율 (`effect: "zoom"`) | `zoom ^ (1 − stage / steps)` |
| `photo` 남은 가림 상자 (`effect: "mask"`) | `masks` 중 앞에서 `stage` 개를 뺀 나머지 |
| `emoji` 공개 수 | `reveal: "all"` 이면 전체, 아니면 `stage` |
| 이어하기 문구 | "<게임 이름> · R<roundIndex+1> · <questionIndex+1>번 문제" / 라운드 종료 화면 "<게임 이름> · R<roundIndex+1> 종료" / 룰렛형 "<게임 이름> · 주제 <picks 수>개 추첨" |

## 5. 득점형 화면 전이

### 5-1. 다음 (`Enter` — R-85, 예전 `→`)

- `answer` · `tiebreakAnswer` 에서 게임 창 `Enter` 는 그 문제에 맞힌 팀(`scored`)도 정답자 없음(`none`)도 없으면 전이 전에 확인창을 띄운다 — [넘어가기] 일 때만, 그때도 아직 같은 문제의 정답 화면이면 아래대로. 그 사이 진행자가 넘기면 확인창은 닫힌다 (R-86). 진행자 `question.next` 도 같은 경우 거절하고 진행자 화면에서 묻는다 (11장, R-87).

| 현재 | 조건 | 다음 |
| --- | --- | --- |
| 게임 시작 | — | `roulette` (round 0), 단계 `setup`, `wheel = snapshot.candidates` |
| `roulette` `setup` | `Enter` (R-75 — 예전 `Space` 도), 원판 후보 ≥ 2 | 단계 `spinning` (결과를 이때 결정 — 무작위, 진행자 명령 `roulette.spin {categoryId}` 면 그 카테고리 · R-48) → 회전 끝나면 `stopped` |
| `roulette` `setup` | `Enter` (R-75 — 예전 `Space` 도), 원판 후보 = 1 | 단계 `stopped` (회전 없이 그 카테고리가 당첨) |
| `roulette` `setup` | `Enter` (R-75 — 예전 `Space` 도), 원판 후보 = 0 | 변화 없음 — "카테고리를 1개 이상 넣으세요" |
| `roulette` `stopped` | `Enter` (확정 — `→` 는 R-79 에서 뺌) | `picks` 에 추가 (문제 뽑기, [01-app-flow.md](01-app-flow.md) 5-4 — 릴레이는 `need` 개) → `round` |
| `roulette` `stopped` | 진행자 [다시 돌리기] (`roulette.respin`) · 게임 창 `Backspace` (R-84 — 예전 `Space` 는 R-79 에서 뺌) | 단계 `setup` (결과 버림, `wheel` 유지) |
| `round` | `Enter` (R-82 — 예전 `→` · `Space` · `PageDown`) | `question` q=0, stage=초기값, hint=false |
| `question` | `Enter` (정답 공개 — `→` · `PageDown` 은 R-82, `Space` 는 R-75 에서 뺌) | `answer` |
| `answer` (정답 수 방식) | 라운드에 다음 문제 있음 | `question` q+1, stage=초기값, hint=false |
| `answer` (정답 수 방식) | 라운드 끝 (진행자 화면 [라운드 종료 ▶], R-56) | `roundEnd` — roundIndex · questionIndex 그대로, hint=false |
| `answer` (릴레이, R-62) | 지금 문제까지로 순위가 안 정해짐 · 라운드에 다음 문제 있음 | `question` q+1, stage=초기값, hint=false |
| `answer` (릴레이) | 순위가 안 정해짐 · 뽑아 둔 문제를 다 냄 · 그 카테고리에 이 게임에서 안 낸 문제 ≥ 1 | 그 라운드 `questionIds` 끝에 하나 추가 (랜덤 · 작성 순서 옵션대로) → `question` q+1 |
| `answer` (릴레이) | 순위가 정해짐(한 팀만 남음) **또는** 그 카테고리에 낼 문제가 없음 | 뽑아 두고 안 낸 문제를 `questionIds` 에서 뺀다 (다시 남은 문제 · 후보로) → `roundEnd` — roundIndex · questionIndex 그대로, hint=false. 진행자 화면은 그 전에 안내 카드 (`relay.ending`, 10장) |
| `answer` + 한 문제 더 (`question.more` — 게임 창 `N` 은 R-85 에서 없앰, R-43 — 릴레이는 거절 "릴레이는 순위가 정해질 때까지 [다음 문제] 가 문제를 더 냅니다", R-62) | 지금 라운드의 마지막 문제, 그 카테고리에 이 게임에서 안 낸 문제 ≥ 1 | 그 라운드 `questionIds` 끝에 문제 하나 추가 (랜덤 · 작성 순서 옵션대로) → `question` q+1, stage=초기값, hint=false. 라운드 끝이 아니거나 남은 문제가 없으면 무시 |
| `roundEnd` | picks 수 < 라운드 수, 남은 문제가 있는 카테고리 ≥ 1 (릴레이는 `need` 개 이상 — R-62) | `roulette` (round+1), 단계 `setup` (`wheel` 은 직전 판 그대로) |
| `roundEnd` | picks 수 < 라운드 수, 모든 카테고리의 남은 문제 = 0 (릴레이는 모두 `need` 미만) | "더 출제할 문제가 없습니다" 안내 → `Enter` (진행자 [결과 보기 ▶]) 로 `result` (R-79) |
| `roundEnd` | picks 수 ≥ 라운드 수 | `result`, revealCount=0, status 그대로 |
| `roundEnd` + 한 라운드 더 (`round.more` — 게임 창 `Shift+N` 은 R-85 에서 없앰, R-40) | 남은 문제가 있는 카테고리 ≥ 1 | `roulette` (round+1), 단계 `setup` — 계획한 라운드 수와 관계없이 (진행자 화면 버튼은 picks 수 ≥ 라운드 수일 때만 — 남았으면 [다음 라운드 ▶] 와 같으므로). 남은 문제가 없으면 무시 · "더 출제할 문제가 없습니다". R-56 전에는 라운드 마지막 `answer` 에서였다 |
| `result` | 공개 안 된 그룹 있음 | revealCount+1. 모두 공개되면 `status = finished` |
| `tiebreakQuestion` | — | `tiebreakAnswer` |
| `tiebreakAnswer` | — | `result`, revealCount=전체 (재계산 결과 바로 표시) |

- stage 값의 뜻:

| 문제 | stage 초기값 | [힌트 단계 ▶] 1회 | stage 최종값 (정답 공개 · 이전 이동 시) |
| --- | --- | --- | --- |
| `photo` `effect: "none"` | 0 | 변화 없음 | 0 |
| `photo` `effect: "zoom"` | 0 (최대 확대) | 한 단계 축소 | `steps` (원본) |
| `photo` `effect: "mask"` | 0 (상자 모두 덮임) | 상자 하나 제거 — **마지막 상자는 남김** (R-42) | `masks.length − 1` (마지막 상자만 남음 — 정답 공개 화면은 stage 와 무관하게 모두 제거) |
| `emoji` `reveal: "sequential"` | 1 (첫 이모지만) | 하나 더 공개 | 이모지 수 |
| `emoji` `reveal: "all"` · 이미지 | 전체 | 변화 없음 | 전체 |

- `answerImage` 는 stage 와 무관하게 `answer` 화면에서만 보인다.
- 가림 문제의 마지막 상자는 `answer` 화면에서만 벗겨진다 — 그래서 상자가 1개면 [힌트 단계 ▶] 로 바뀌는 단계가 없다 (R-42). 정답에서 `←` 로 돌아가면 마지막 상자가 다시 덮인다.

### 5-2. 이전 (`←`)

> **R-74 부터 게임 창 `←` · `PageUp` 이 없다.** 아래 전이 중 화면에서 쓰는 것은 진행자 화면 [◀ 라운드로 돌아가기] (`round.back` — 라운드 종료 → 마지막 문제 정답) 뿐이고, 나머지는 코드(`prev`)에만 남는다.

| 현재 | 조건 | 이전 |
| --- | --- | --- |
| `roulette` `setup` | round 0 | 게임 홈 (세션 유지) |
| `roulette` `setup` | round > 0 | 이전 라운드 `roundEnd` (R-56) |
| `roulette` `stopped` | — | 같은 룰렛 `setup` (결과 버림) |
| `round` | — | 확인창 "룰렛 결과를 취소하고 다시 추첨할까요?" → 확인 시 마지막 pick 제거 → `roulette` 회전 전. 단, 그 라운드에 득점 이력이 있으면 취소 불가 (토스트) |
| `question` | q = 0 | `round` |
| `question` | q > 0 | `answer` q−1 |
| `answer` | — | `question` 같은 q, **stage = 최종값** (원본 · 가림 해제 · 전체 공개) |
| `roundEnd` | — | 그 라운드 마지막 문제 `answer`, stage = 최종값 (진행자 화면 [◀ 라운드로 돌아가기] `round.back`, R-56 — 맞힌 팀 고치기 · 한 문제 더) |
| `result` | — | 마지막 라운드 마지막 문제 `answer` (revealCount=0, status=active) |
| `tiebreakQuestion` | — | `result` (추가 문제 취소, 이미 연 문제는 used 에 남음) |
| `tiebreakAnswer` | — | `tiebreakQuestion` |

- 이전 · 다음 이동은 `history` 를 바꾸지 않는다.

### 5-3. 기타 액션

| 액션 | 허용 화면 | 변화 |
| --- | --- | --- |
| 정답 공개 (`Enter`) | `question`, `tiebreakQuestion` | 다음과 같음 |
| 룰렛 준비 넣기 / 빼기 (진행자 화면 [넣기/빼기] · [모두 넣기] — R-72 부터 게임 창 키 없음) | `roulette` `setup` | `wheel` 에 추가 / 제거 (남은 문제 0개 카테고리는 추가 불가 — 득점형만. 릴레이에서 부족한 카테고리는 넣기 · 빼기 · 모두 넣기 모두 무시 — R-62. 룰렛형의 문제를 다 낸 주제는 하나씩은 넣을 수 있고 `A` [모두 넣기] 로는 안 넣음, `D-26`). 세션 저장. 게임 홈 제외 설정은 바꾸지 않음 |
| 단계 +1 (진행자 [힌트 단계 ▶] — 게임 창 `Z` 는 R-78 에서 없앰) | `question`, `tiebreakQuestion` | stage = min(stage+1, 최종) |
| 단계 −1 (진행자 [◀]) | 같음 | stage = max(stage−1, 초기값) |
| 힌트 (진행자 [💡 힌트] — 게임 창 `H` 는 R-78 에서 없앰) | `question`, `answer`, 추가 문제 두 화면 | hintVisible 반전 |
| 정답 영상 재생 · 일시정지 · 끝내기 (진행자 `clip.*`, R-61 — 게임 창 `V` · `Shift+V` 는 R-81 에서 없앰) | `answer`, `tiebreakAnswer` (정답 영상이 있는 사진 문제) | 세션은 그대로 — 재생 상태(3-5)만 바꾼다 |
| 맞힌 팀 지정 / 없음 (진행자 맞힌 팀 버튼 · [없음] — 게임 창 `1`~`4` · `0` · `Shift+1~4` 는 R-81 에서 없앰) | `answer`, `tiebreakAnswer` (정답 공개 후에만, R-29) | ScoreOp 1개 추가 ([06-controls.md](06-controls.md) 4장). 릴레이(R-62)에서 **이 문제 전에 대표를 모두 내보낸 팀**은 지정 불가 — 무시 + 토스트 "팀A — 대표가 모두 맞혀 이번 라운드에서 빠졌습니다". 추가 문제에는 이 제한이 없다 |
| 다음 문제 지정 (진행자 화면 [다음으로], R-35 · R-52 — 키 없음) | `round`, `question`, `answer` | 고른 문제를 **다음 차례 자리**로 — 다음 차례 = `round` 면 첫 문제(0번), `question` · `answer` 면 `questionIndex + 1`. **이번 라운드 문제**(`picks[roundIndex].questionIds`)면 그 자리로 옮기고 나머지는 순서를 지킨 채 한 칸씩 뒤로 (R-35) — 다음 차례보다 앞(현재 · 지난 문제)이면 거절, 이미 다음 차례면 그대로. **라운드에 안 뽑힌 후보**(이번 라운드 카테고리의 남은 문제 — 4장, R-52)면 그 자리에 넣고 목록 끝 문제를 뺀다 — 문제 수는 그대로, 뺀 문제는 다시 남은 문제 (`D-31`). 다음 차례가 목록 끝 다음(지금 문제가 라운드 마지막)이면 빼지 않고 하나 더 붙는다 (한 문제 더와 같음, R-43). 그 밖의 문제(다른 카테고리 · 이미 낸 문제)는 거절. `history` · 정답 수 · Q 번호는 바뀌지 않는다 |
| ~~되돌리기~~ — 진행자 화면 버튼은 R-60, 게임 창 `Backspace` 는 R-83 에서 없앰 | — | (예전: 화면과 상관없이 `history` 마지막 항목 제거) — 고치기는 아래 정답 기록 고치기 |
| 정답 기록 고치기 (진행자 화면 [📝 정답 기록] `history.credit`, R-60 — 키 없음) | `round` 이후 모든 득점형 화면 | 이 게임에서 이미 낸 문제(공개 전 지금 문제 · 안 낸 문제 제외, 추가 문제는 `tb:<id>`)의 맞힌 팀을 맞힌 팀 지정과 같은 규칙으로 바꾼다 — `history` 에 add · replace · remove(none) · none 을 붙인다. 추가 문제는 그 동점 그룹 팀만. 릴레이(R-62)는 그 문제 전에 대표를 모두 내보낸 팀을 고를 수 없다 (거절 "그 문제 전에 대표가 모두 맞힌 팀입니다 (릴레이)") — 앞 문제를 고치면 다 내보낸 순서 · 라운드 등수를 다시 계산한다. 화면은 그대로. `result` 에서 바뀌면 revealCount=0 · `scoreboardFill = null` (순위 공개 · 점수판 채우기를 다시) |
| 추가 문제 (진행자 화면 고르기 — 게임 창 `S` 는 R-85 에서 없앰, D-3 · R-54) | `result` (모두 공개 + 동점 그룹 있음 + 추가 문제 후보 ≥ 1) | 진행자가 고른 문제(`result.tiebreak {questionId}` — 추가 문제 후보가 아니면 거절), 게임 창 `S` 면 후보 중 무작위 1개를 `tiebreak.used` 에 추가 → `tiebreakQuestion`, stage=초기값 |
| 팀 점수에 반영 (진행자 [팀 점수에 반영] `round.reflect` — 게임 창 `B` 는 R-85 에서 없앰, R-57) | `roundEnd` | `reflectedRounds` 에 지금 라운드를 넣고, 그 라운드들로 연결된 점수판 행을 다시 계산해 쓴다 (점수판 저장소, [13-scoreboard.md](13-scoreboard.md) 10-6). `history` · 화면은 그대로 |
| 일찍 끝내기 (진행자 [종료] `game.end` — 게임 창 `E` 는 R-77 · R-80 에서 없앰) | `roulette`, `round`, `question`, `answer`, `roundEnd` | `result` (지금까지 점수). 라운드 도중이어도 라운드 종료 화면을 거치지 않는다 (R-56) |
| 점수판 채우기 확인 (`Enter`) | `result` 모두 공개 + 채우기 창 | 연결된 점수판 라운드에 등수 기록 (점수판 저장소, [13-scoreboard.md](13-scoreboard.md) 10-2), `scoreboardFill = "filled"` |
| 점수 고치기 (창의 [점수 고치기] — `E` 는 R-85 에서 없앰) → 입력 | 같음 | 고친 등수 · 점수(직접 수정)로 기록, `scoreboardFill = "filled"` |
| 채우기 취소 (`Esc`) | 같음 | 기록 없음, `scoreboardFill = "skipped"` (진행자 [점수판에 채우기] 로 다시 열면 `null` 처럼 창 표시 — 게임 창 `B` 는 R-85 에서 없앰) |
| 초기화 — 게임 창 `R` 은 R-77 · R-80 에서 없앰. 진행 기록은 게임 홈 [새로 시작] 으로 지운다 | — | — |

### 5-4. 이모티콘 퀴즈 — 진행자가 문제를 고름 (R-90)

`emoji` 세션은 룰렛 · 라운드 없이 진행한다 (`pickMode`). 세션 모양(3-2)은 그대로 — `screen: "roulette"` 을 **문제 고르기** 화면으로 쓰고(룰렛 화면 단계 3-4 는 쓰지 않음), `picks` 는 **카테고리마다 한 묶음**(처음 고른 순서, 같은 카테고리 문제는 그 묶음 뒤에)이라 4장의 라운드별 값 · 결과 · 기록 · 통계의 라운드는 카테고리다. `picks` 에는 실제로 낸 문제만 들어간다.

| 현재 | 액션 | 조건 | 다음 |
| --- | --- | --- | --- |
| `roulette` (문제 고르기) · `answer` · (예전 진행) `roundEnd` | 문제 고르기 (진행자 [내기] `question.pick {questionId}`) | 숨김 아닌 카테고리의 숨김 아닌 문제, 이 게임에서 아직 안 낸 것 | 그 카테고리 묶음 뒤에 붙이고(없으면 새 묶음) `roundIndex` · `questionIndex` 를 그 문제로 → `question`, stage=초기값, hintVisible=false. `answer` 에서는 먼저 아래 "문제 고르기로" 처럼 지금 묶음을 정리 |
| `roulette` | 카테고리로 고르기 (게임 화면 카테고리 카드 클릭 — R-91) | 그 카테고리에 이 게임에서 안 낸 문제가 있음 | 문제 순서 옵션대로 하나(`fixed` 면 남은 문제의 첫 번째, `random` 이면 무작위)를 골라 위 "문제 고르기" 와 같이. 남은 문제가 없으면 거절 |
| `question` | 문제 고르기 | — | 거절 "정답을 공개한 뒤에 다음 문제를 고를 수 있습니다" |
| `answer` | 다음 (`Enter` · 진행자 [카테고리 목록 ▶] `question.next`) | 맞힌 팀 미지정이면 확인 (R-86 · R-87) | **문제 고르기로** — 지금 묶음을 지금 문제까지로 자르고(예전 진행에서 뽑아 두고 안 낸 문제는 남은 문제로 돌아감) `roulette`, `roundIndex = picks.length`, `questionIndex = 0`. 라운드 종료 화면 없음 |
| `roundEnd` (R-90 전에 시작한 진행) | 다음 | — | 문제 고르기로 (계획 라운드 수와 상관없이) |
| `roulette` | 다음 (`Enter` · 진행자 [결과 보기 ▶]) | 남은 문제 0개 (`anyRemaining` 거짓) | `result`. 남은 문제가 있으면 아무 일 없음 |
| `roulette` · `question` · `answer` | 일찍 끝내기 (진행자 [종료]) | — | `result` (5-3 과 같음) |

- `round` (예전 진행의 라운드 소개)에서 다음은 5-1 그대로 첫 문제.
- 이모티콘 퀴즈에서 `roulette.*` · `question.setNext` · 한 문제 더 · 한 라운드 더 · 팀 점수에 반영은 쓰지 않는다 (진행자 화면에 버튼 없음, `roulette.*` · `question.setNext` 명령은 거절).
- 이어하기 문구: 문제 고르기 "이모티콘 퀴즈 · 문제 n개 냄", 문제 · 정답 "이모티콘 퀴즈 · n번째 문제".

## 6. 룰렛형 화면 전이

| 현재 | 키 | 조건 | 다음 |
| --- | --- | --- | --- |
| 게임 시작 | — | — | `roulette` (주제 고르기 — R-65, 원판 없음), `wheel = snapshot.candidates` (무작위 후보의 바탕 — 룰렛형은 게임 홈 제외가 없어 숨김 아닌 주제 전부) |
| `roulette` | 진행자 주제 버튼 (`topic.pick {categoryId}`, R-65) | 숨김 아닌 주제 (다 낸 주제도 됨) | `picks` 에 추가 → `topic` (주제 카드 — 문제가 있는 주제도 첫 문제가 바로 나오지 않음, `D-25` 그대로), examplesVisible = answersVisible = false |
| `roulette` | 진행자 [🎲 무작위] (`topic.pick {}`) · 게임 창 비상용 `Enter` (R-75) | 무작위 후보 ≥ 1 | 무작위 후보 = `wheel` 중 원판 후보(4장) − 문제를 다 낸 주제 (`topicPool`). 그중 하나를 골라 위와 같이 |
| `roulette` | 위와 같음 | 무작위 후보 = 0 | 변화 없음 — "무작위로 고를 주제가 없습니다 — 목록에서 직접 고르세요" (진행자 화면에만) |
| `roulette` | 진행자 명령 `roulette.*` | — | 거절 "줄줄이 말해요는 룰렛 없이 진행자가 주제를 고릅니다" (R-65) |
| `topic` | 진행자 [첫 문제 ▶] · [다음 문제 ▶] (`topic.question`, R-44 — 게임 창 `N` 은 R-85 에서 없앰) | 이 주제에 남은 문제 ≥ 1 | 남은 문제 중 1개를 마지막 pick 의 `questionIds` 끝에 추가 → 진행자 화면에 그 문제 (모니터는 주제 카드 그대로 — R-65), answersVisible = false. 고르는 법은 `snapshot.options.questionOrder` — `random` 무작위 / `fixed` 데이터 순서로 첫 번째 (`D-24`, R-45) |
| `topic` | 진행자 목록 [내기] (`topic.question` `{questionId}`, R-45) | 그 문제가 지금 주제의 남은 문제 | 위와 같이 그 문제를 추가 → 표시. 다른 주제 문제 · 낸 문제 · 숨긴 문제면 거절 (이유는 진행자 화면에만) |
| `topic` | `topic.question` | 남은 문제 0개 | 변화 없음 — "이 주제에 남은 문제가 없습니다" (문제 없는 주제는 "문제가 없는 주제입니다") |
| `topic` | 진행자 [예시 표시] (`topic.examples` — 게임 창 `H` 는 R-78 에서 없앰) | — | examplesVisible 토글 (문제를 낸 뒤에도 — 정답 후보는 모니터에 띄우지 않는다, R-65) |
| `topic` | 진행자 [다음 주제 ▶] (`topic.next`, 예전 [다시 추첨 ▶] — 게임 창 `→` / `Space` 는 R-85 에서 없앰) | — | `roulette` (주제 고르기 — 앞에서 나온 주제도 다시 고를 수 있음, R-16). 횟수 제한 없음. **단 이 주제에서 문제를 내다가 다 떨어졌으면 그 주제를 `wheel` 에서 뺀다** — 무작위 후보에서 빠짐 (`D-26`, R-45 · R-65 — 다 낸 그 순간 한 번만) |
| `topic` (문제를 낸 뒤) | (`←` — R-74 에서 키 없앰) | — | 마지막 문제를 `questionIds` 에서 제거 (안 낸 것으로 — 다시 나올 수 있음) → 직전 문제, 없으면 문제 전. answersVisible = false |
| `topic` (문제 전) | (`←` — R-74 에서 키 없앰) | — | 마지막 pick 제거 (방금 고른 주제 취소) → `roulette` |
| `roulette` | (`←` — R-74 에서 키 없앰) | — | 게임 홈 (세션 유지) |
| `roulette` · `topic` | 진행자 [끝내기] (`game.end` — 게임 창 `E` 는 R-85 에서 없앰) | — | status = finished → 게임 홈 |

## 7. 저장 · 복원

| 시점 | 저장 대상 |
| --- | --- |
| 세션이 바뀌는 모든 액션 직후 | `state/sessions/<게임 id>.json` |
| 설정 변경 직후 | `state/settings.json` |
| 점수판 · 배점 변경 직후 | `state/scoreboard.json` |
| route 변경 | `state/route.json` (이어하기 문구용) |

- 모두 브라우저 사본에 즉시 쓰고, 파일에는 300ms 묶어서 쓴다 ([08-tech.md](08-tech.md) 4-6-1 · 6-2).

### 복원 규칙
1. 앱 시작 → 상태 파일 읽기(`GET /api/state`, 없으면 브라우저 사본을 파일로 옮김 — [08-tech.md](08-tech.md) 6-1) → 설정 → 모든 게임 세션 → 점수판 → 제목 화면.
2. 세션 검증 실패 시 해당 세션을 빈 상태로 덮어씀(직전 내용은 버림) + 토스트 "○○ 진행 기록을 불러올 수 없어 지웠습니다".
   - `version` 불일치
   - `picks` 의 문제 id 가 데이터에 없음 (어드민에서 삭제됨) → 해당 문제만 건너뛰기 가능하면 건너뛰고(토스트), 현재 위치 문제가 없으면 다음 문제로 이동
   - 인덱스가 범위를 벗어남
3. 이어하기 → `play` route + 세션의 screen 그대로 (`roundEnd` 도 — 라운드 점수 화면에서 이어짐, R-56). 단 `roulette` 화면은 항상 회전 전(또는 이미 확정된 pick 이 있으면 그 다음) 상태로. 관리에서 문제를 지워 그 라운드가 비면 `round` · `question` · `answer` · `roundEnd` 는 `roulette` 로.
4. 힌트 · 오버레이는 복원하지 않음 (힌트는 숨김).

### 다른 창에서 파일이 바뀌었을 때 (`reload`)
- 서버가 게임 창 채널(`/api/live/commands`)로 `reload { kind, name, revision }` 을 보낸다 ([08-tech.md](08-tech.md) 4-4). 게임 창은 자기가 방금 쓴 리비전이면 무시하고, 아니면 그 파일만 다시 읽는다.
- `kind: "data"` (관리 페이지에서 게임 데이터 저장 · 백업 복원): 그 게임 데이터를 메모리에서 교체. 진행 중 세션은 문제 id 로 참조하므로 위치 · 점수는 그대로 ([04-admin.md](04-admin.md) 5-2). 지금 보고 있는 문제의 정답 · 연출이 바뀌었으면 화면을 다시 그린다.
- `kind: "state"` (관리 페이지의 점수 입력 · 상태 초기화, 다른 게임 창): 그 상태 파일을 다시 읽는다. 지금 보고 있는 게임의 세션이 비워졌으면(상태 초기화) 제목 화면으로 + 토스트 "관리 페이지에서 현장 상태를 초기화했습니다".
- 회전 중 · 애니메이션 중에 오면 끝난 뒤 적용한다.

## 8. 초기 세션

```json
{
  "version": 1,
  "gameId": "photo-quiz",
  "type": "photo",
  "status": "active",
  "startedAt": "2026-10-29T16:40:00+09:00",
  "updatedAt": "2026-10-29T16:40:00+09:00",
  "snapshot": {
    "teamCount": 3,
    "candidates": ["character", "food-zoom", "title", "famous-line", "snack", "person", "brand", "object-zoom", "meme", "mv-scene", "debut", "cartoon", "drawing", "landmark"],
    "options": { "rounds": 3, "questionsPerRound": 5, "questionOrder": "random", "relay": 2, "perRep": 1 },
    "points": [100, 50, 0]
  },
  "wheel": ["character", "food-zoom", "title", "famous-line", "snack", "person", "brand", "object-zoom", "meme", "mv-scene", "debut", "cartoon", "drawing", "landmark"],
  "picks": [],
  "screen": "roulette",
  "roundIndex": 0,
  "questionIndex": 0,
  "stage": 0,
  "hintVisible": false,
  "resultRevealCount": 0,
  "scoreboardFill": null,
  "history": [],
  "tiebreak": { "used": [], "groups": [] }
}
```

## 9. 불변 조건 (개발 중 assert)

- `0 ≤ roundIndex < picks.length` (`roulette` 화면 제외)
- `0 ≤ questionIndex < picks[roundIndex].questionIds.length`
- `picks` 의 카테고리 id 는 모두 이 게임의 카테고리 (**같은 카테고리 반복 가능**, R-16). 지금 `wheel` 에 없어도 됨 (뽑힌 뒤 룰렛 준비에서 뺄 수 있으므로)
- `wheel` 의 id 는 모두 이 게임의 카테고리, 중복 없음
- 모든 `picks` 의 `questionIds` 를 합치면 서로 다름 (한 게임에서 같은 문제 두 번 출제 금지)
- `picks.length` 는 `options.rounds` 를 넘을 수 있다 — 라운드 수는 계획값 (R-40)
- 모든 문제의 `scored[q].size ≤ 1` (선착순 — 문제당 맞힌 팀 최대 1팀, `D-2`)
- 모든 ScoreOp 의 `team < snapshot.teamCount`
- 팀별 정답 수 ≥ 0

## 10. 진행 상태 보고 (진행자 화면용, R-19)

게임 화면은 상태가 바뀔 때마다(100ms 묶음) 그리고 30초마다 현재 상태를 서버에 보낸다 (`POST /api/live`, [08-tech.md](08-tech.md) 4-4). **id 와 상태값만** 보내고 정답 텍스트는 보내지 않는다 — 서버가 데이터 파일에서 찾아 진행자 페이지에 붙여 준다 ([12-host-view.md](12-host-view.md) 6장).

```json
{
  "v": 1,
  "seq": 128,
  "sentAt": 1761723600000,
  "view": "play",
  "gameId": "photo-quiz",
  "type": "photo",
  "screen": "question",
  "roulettePhase": null,
  "wheel": null,
  "roundIndex": 1,
  "questionIndex": 2,
  "picks": [
    { "categoryId": "title", "questionIds": ["title-8rjn", "title-5bva", "title-wq3k", "title-6tey", "title-h2ps"] },
    { "categoryId": "food-zoom", "questionIds": ["food-zoom-k7q2", "food-zoom-3fhx", "food-zoom-p9de", "food-zoom-2mwa", "food-zoom-t4cz"] }
  ],
  "questionId": "food-zoom-p9de",
  "stage": 1,
  "scores": [3, 2, 1],
  "scoredTeams": [0],
  "fill": null,
  "teams": [{ "name": "<팀 이름>", "color": "#3b82f6" }]
}
```

| 필드 | 설명 |
| --- | --- |
| `view` | route 의 view (`title` · `gameHome` · `play` …). `play` 가 아니면 진행자 화면은 "진행 중인 문제가 없습니다" |
| `screen` | 세션 screen (득점형 · 룰렛형) |
| `roulettePhase` · `wheel` | 룰렛 화면이면 단계(`setup` · `spinning` · `stopped`)와 지금 넣은 카테고리 — 진행자 화면 "카테고리 고르는 중" 표시용. 룰렛 화면이 아니면 `null`. 준비 목록 `wheelList` 는 4장 룰렛 준비 목록 그대로 (릴레이는 항목마다 `short` · `need` — 진행자 화면 "부족 · 남은 3/4", R-62) |
| `result.perRound` | 결과 화면: 라운드별 `{ categoryId, counts }` (라운드별 정답 수 표). 릴레이는 `ranks` (그 라운드 등수, 없으면 `null`)도 — 진행자 화면 "라운드별 순위" (R-62) |
| `picks` | 득점형: 이번 게임 라운드별 출제 목록 (진행자 화면 "이번 라운드 목록" 용) / 룰렛형: `[{ categoryId }]` |
| `result.tiebreakChoices` | 결과 화면 · 모두 공개 · 동점 그룹 있음 · 점수를 주지 않는 게임: 추가 문제 후보 `[{ categoryId, questionIds }]` (4장, 남은 문제가 있는 카테고리만 — R-54). 서버가 카테고리 이름 · 아이콘 · 정답을 붙여 `[{ id, name, icon, questions: [{ id, answer }] }]` 로 준다 |
| `roundCandidateIds` | 득점형 라운드 소개 · 문제 · 정답 공개: 이번 라운드 카테고리의 남은 문제 id (4장, 데이터 순서) — 진행자 화면 "후보" 용 (R-52). 서버가 정답을 붙여 `roundCandidates` `[{ id, answer }]` 로 주고 id 목록은 지운다 |
| `topicId` · `topicQuestionIds` · `topicQuestionId` · `topicRemaining` · `topicList` · `topicNextId` · `questionOrder` · `examplesVisible` · `answersVisible` | 룰렛형 `topic` 화면: 지금 주제, 이 추첨에서 낸 문제 id 들, 지금 문제 id (주제 카드면 `null`), 이 주제에 남은 문제 수 (문제 없는 주제면 `null`), 이 주제의 문제 목록 `[{ id, state }]` (숨김 제외 · 데이터 순서, state = `current` · `asked`(이 게임에서 냄) · `left`, R-45), 작성 순서일 때 [다음 문제] 로 나올 문제 id (랜덤이면 `null`), 문제 순서 옵션, 모니터 예시 · 정답 후보 표시 여부 (정답 후보는 R-65 부터 쓰지 않음). 서버가 데이터에서 문제 글자 · (지금 문제의) 정답 후보 · 메모를 붙인다 (R-44) |
| `questionId` | 현재 문제 (추가 문제면 `tb:<id>`). 문제 화면이 아니면 `null` |
| `stage` | 연출 단계 (5-1 표) |
| `seq` | 상태 번호 (바뀔 때마다 +1). 진행자 명령의 `basedOn` 과 비교해 엇갈린 명령을 막는다 ([12-host-view.md](12-host-view.md) 6-2). `lastCommand` · `clip` 만 바뀐 것은 세지 않는다 |
| `clip` | 정답 영상이 있는 사진 문제의 문제 · 정답 화면 (R-61): `{ state, muted, error, soundReady }` — 재생 상태(3-5), 소리 없이 도는 중인지(브라우저가 소리를 막음), 못 튼 이유, 이 창이 클릭 · 키 입력을 받은 적이 있는지(`navigator.userActivation.hasBeenActive` — 없으면 소리가 막힐 수 있다고 진행자에게 미리 경고). 서버가 데이터에서 구간을 붙여 `question.clip` `{ id, start, end }` 로 준다 |
| `scores` · `scoredTeams` | 팀별 정답 수, 현재 문제의 맞힌 팀 (정답 공개 후 지정) |
| `isLastInRound` · `isLastRound` · `plannedRounds` · `canMoreQuestion` · `canMoreRound` | 득점형 라운드 소개 · 문제 · 정답 · 라운드 종료 화면: 지금 문제가 라운드 마지막인지(진행자 화면의 라운드 종료 안내 — R-56), 계획한 라운드를 다 했는지, 계획 라운드 수, [한 문제 더 ▶] (라운드 마지막 정답 화면 · 같은 카테고리에 남은 문제, R-43) · [한 라운드 더 ▶] (라운드 종료 화면 · 계획한 라운드를 다 함 · 남은 문제, R-40) 을 낼 수 있는지 |
| `relay` | 릴레이(R-62) 라운드 소개 · 문제 · 정답 · 라운드 종료 화면: 이번 라운드 진행 `{ relay, per, goal, need, counts, finish, ranks, decided, out, ending, short }` — 팀당 대표 수, 인당 문제 · 팀이 끝나는 정답 수 (relay × per, R-64), 최소 문제 수(4장), 팀별 맞힌 수 · 대표를 모두 내보낸 팀(순서대로) · 라운드 등수(정답이 없으면 `null`) · 순위가 정해졌는지 (지금 문제까지), `out` = 지금 문제 **전에** 다 내보낸 팀 (이 문제의 맞힌 팀이 될 수 없음 — 진행자 버튼 비활성), `ending` = 정답 화면에서 다음이 라운드 종료 (한 팀만 남음 · 낼 문제가 없음 — 진행자 화면 라운드 종료 안내), `short` = 낼 문제가 없어 순위가 다 안 정해진 채 끝남. R-94: `reps` = 팀별 대표마다 맞힌 수 (지금 문제까지), `repsBefore` = 지금 문제 전 (perRep 을 채운 대표 — 진행자 버튼 · 모니터 묶음 비활성), `scoredRep` = 지금 문제를 맞힌 대표 (없으면 `null`). 정답 수 방식 · 라운드 밖이면 `null` |
| `relayReps` · `gamePoints` | 득점형 진행 중: 팀당 대표 수 (릴레이가 아니면 `null`), 팀별 게임 점수 — 라운드 등수 배점 합 (4장, 릴레이가 아니면 `null`). 진행자 화면 점수 줄 · 라운드 종료 표 · 결과 표용. 릴레이면 `per` 는 `null` |
| `roundEnding` | 득점형 라운드 화면: 정답 화면에서 다음이 라운드 종료인지 — 릴레이는 `relay.ending`, 아니면 `isLastInRound` (진행자 화면이 라운드 종료 안내 · [다음 문제 ▶] 를 고른다) |
| `roundScores` | 득점형 `roundEnd` 화면: 이번 라운드 팀별 정답 수 (진행자 화면 표 — 누적은 `scores`, R-56). 그 밖에는 없음 |
| `creditLog` | 득점형 `round` 이후 화면: 정답 기록 고치기 목록 (R-60) — `rounds: [{ index, categoryId, counts, questions: [{ id, n, team, rep, none, live }] }]` · `tiebreak: [{ id, n, group, team, none, live }]` · `reps` (팀당 대표 방식이면 `{ relay, per }`, 아니면 `null` — R-94. `rep` = 맞힌 대표, 셀 때 쓴 대표). 이 게임에서 이미 낸 문제만 (공개 전 지금 문제는 `live: true`), id 와 상태만 — 정답은 서버가 붙인다 |
| `reflect` | 득점형 `roundEnd` 화면: 종합 점수판 반영 미리보기 (R-57) — `rows` (행마다 이름 · 방식 · 팀별 이번 라운드 등수 또는 정답 수 · 더하는 점수, 덮어쓰기 경고), `done` (이 라운드를 반영했는지), `stale` (반영했지만 지금 계산과 점수판 값이 다름), `totalsAfter` · `ranksAfter` (반영 뒤 종합 합계 · 순위). 연결된 행이 없으면 `rows` 가 빈 배열 |
| `per` | 득점형: 정답 1개당 점수 — 점수판 "정답 수" 라운드가 게임 전체에 연결돼 있으면 그 값, 없으면 `null`. 있으면 진행자 화면이 정답 수 × `per` 를 점수로 보여준다 (R-49) |
| `fill` | 결과 화면에서 점수판 채우기 창을 띄울 때의 미리보기 (행 · 팀별 등수 · 배점 점수, 정답 수 행은 `kind: "count"` · `per` · 팀별 `counts` — R-49) — 진행자 화면이 창을 그린다. 그 밖에는 `null` |
| `teams` | 팀 이름 · 색 (설정값) — 진행자 화면 표시용 |

- 서버는 이 상태를 메모리에 1개만 보관한다 (파일 저장 안 함). 크기 상한 16KB.

## 11. 진행자 화면 명령 적용 (R-26, R-29)

- 진행자 화면 버튼은 서버를 거쳐 게임 화면에 **명령**으로 온다 ([12-host-view.md](12-host-view.md) 6-2). 게임 화면은 명령을 **같은 키 입력과 똑같은 전이 규칙**(5 · 6장)으로 적용한다 — 명령 전용 상태 전이는 다음 문제 지정(`question.setNext`, 5-3) 과 정답 기록 고치기(`history.credit`, 5-3 · R-60) 둘이다.
- 명령의 `basedOn` 이 지금 `seq` 와 다르면 적용하지 않는다 (연타 · 지연으로 두 번 넘어가는 사고 방지). 진행자 화면에 "화면이 바뀌어 적용하지 않았습니다".
- 키 입력과 다른 점은 일곱 가지뿐이다.
  - `clip.play` · `clip.pause` · `clip.skip` (정답 영상, R-61) 은 거절 이유("정답 공개 뒤에 재생됩니다" · "재생 중이 아닙니다")를 진행자 화면에만 알린다 (게임 창 `V` · `Shift+V` 는 R-81 에서 없앰).
  - `question.next` 에 `skipReveal: false` 인데 아직 정답을 공개하지 않았으면 적용하지 않고 진행자 화면에 확인 창을 띄운다 ("정답을 공개하지 않고 넘어갈까요?"). 진행자가 [넘어가기] 를 누르면 `skipReveal: true` 로 다시 보낸다.
  - `question.next` 를 `answer` · `tiebreakAnswer` 에서 받았는데 그 문제에 맞힌 팀도 [없음] 도 없고 `noCredit` 이 없으면 적용하지 않고 `needConfirm: "noCredit"` — 진행자 화면에 확인 창 "맞힌 팀(정답자)을 체크하지 않았습니다. 이대로 다음으로 넘어갈까요?" (R-87). [넘어가기] 면 `{ skipReveal: true, noCredit: true, key }` 로 다시 보내고, `key` 가 지금 문제(`currentQuestion().key`)와 다르면 "이미 다음으로 넘어갔습니다" 로 거절한다.
  - `answer.credit` 은 정답 공개 화면(`answer` · `tiebreakAnswer`)에서만 적용한다. 그 밖의 화면에서 오면 무시한다 (R-29).
  - `question.setNext` (다음 문제 지정 — 이번 라운드 문제 R-35 · 라운드에 안 뽑힌 후보 R-52) 는 진행자 화면에만 있다 — 게임 창 키가 없고, 거절하면 이유를 진행자 화면에만 알린다 (모니터에 토스트 없음).
  - `question.pick` (이모티콘 퀴즈 문제 고르기, R-90 — 5-4) 도 진행자 화면에만 있다 — 거절 이유는 진행자 화면에만. 정답 화면에서 맞힌 팀 · 없음을 안 정했으면 `question.next` 처럼 `needConfirm: "noCredit"`, `noCredit` · `key` 를 붙여 다시 오면 적용 (`key` 가 지금 문제와 다르면 "이미 다음으로 넘어갔습니다").
  - `history.credit` (정답 기록 고치기, R-60) 도 진행자 화면에만 있다 — 고쳐도 모니터에 토스트를 띄우지 않고, 거절 이유는 진행자 화면에만.
  - `result.tiebreak` 에 `questionId` 가 있으면 (추가 문제 고르기, R-54) 문제는 그것으로 정해진다 (없으면 무작위 — 예전 게임 창 `S`, R-85 에서 없앰). 추가 문제 후보(4장)가 아니면 열지 않고 거절하며 이유는 진행자 화면에만 ("추가 문제로 낼 수 있는 문제가 아닙니다").
  - `roulette.spin` 에 `categoryId` 가 있으면 (결과 지정, R-48) 전이는 `Enter`(돌리기)와 같고 결과만 그 카테고리로 정해진다 — 게임 창 키(`Enter`, R-75)는 언제나 무작위. 룰렛 준비(`setup`)가 아니거나 그 카테고리가 지금 원판 후보(4장)가 아니면 돌리지 않고 거절하며 이유는 진행자 화면에만 알린다 — 무작위로 바꿔 돌리지 않는다 (`D-27`).
- 진행자 화면이 연결돼 있으면 결과 화면의 점수판 채우기 창(`fill`)은 진행자 화면에만 그리고, 게임 화면에는 그리지 않는다. 연결 여부는 서버가 게임 화면 채널로 보내는 `hosts` `{ count }` 로 안다 ([12-host-view.md](12-host-view.md) 6-2).
