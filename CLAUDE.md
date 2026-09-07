# CLAUDE.md

이 저장소에서 작업할 때 Claude Code가 참고하는 가이드입니다.

## 프로젝트 개요

**자스민과 알라딘의 매직카펫 라이드** — 두 사람만 쓰는 개인용 기록 웹앱(운동·식단·일정·가계부·여행 타임라인).

- repo: `changroullee-hub/workout-log`
- 배포: Vercel (`workout-log-lilac.vercel.app`) — `main`에 push하면 자동 배포
- DB/인증: Supabase 프로젝트 `workout` (`ohlssimixnkmfuuecxfr`)
- ⚠️ `valuation-engine`(감정평가)과 **다른 프로젝트**입니다. 코드·설정을 섞지 마세요.

## 구조

빌드 도구, 패키지 매니저, 테스트가 **없습니다.** 정적 파일 + Vercel 서버리스 함수뿐입니다.

```
index.html      전체 프론트엔드 (HTML+CSS+JS 한 파일, ~2100줄)
api/*.js        Vercel 서버리스 함수 (ESM, export default handler)
bg.jpg, og.png  로그인 배경 / 링크 썸네일
```

`index.html`은 의도적으로 단일 파일입니다. 모듈로 쪼개지 마세요. 파일 안은 `/* ===== 섹션명 ===== */` 배너로 구분되어 있고(CONFIG / utils / 암호화 / AUTH / 데이터 로드 / 기록하기 / 기록 목록 / 신체정보 / 칼로리 / 일정 / 알림 / 가계부 / 여행 타임라인 / 분석 / 타이머 / 탭 전환), 새 기능은 해당 섹션 안에 넣습니다.

파일 맨 위 주석의 `build:` 줄은 릴리스마다 갱신합니다 (예: `build: 2026-09-01aa`).

## 데이터 모델 — 중요

Supabase 테이블은 `workouts` **하나뿐**입니다. 모든 도메인이 여기 들어가고, `data` JSONB의 `kind` 필드로 구분합니다.

| `data.kind` | 내용 |
|---|---|
| (없음) | 운동 기록 (`exercises`, `vol`, `sets`, `durMin`) |
| `food` | 식단 |
| `task` / `taskdone` | 일정, 반복 일정의 날짜별 완료 표시 |
| `expense` | 가계부 |
| `trip` / `tripitem` | 여행, 여행 항목(항공·기차·장소) |
| `metrics` | 신체정보 (아래 암호화 참고) |

공통 컬럼: `id`, `title`, `workout_date`, `total_volume`, `total_sets`, `data`, `created_at`.
새 도메인이 필요하면 **테이블을 만들지 말고** 새 `kind`를 추가하고 `refreshData()`의 분기와 전역 배열에 연결하세요.

## 인증·암호화

- Supabase 이메일/비밀번호 인증. `ALLOWED_EMAILS` 화이트리스트 밖의 계정은 로그인·가입 모두 거부합니다.
- 신체정보만 클라이언트에서 AES-GCM 암호화해 저장합니다. 키는 **로그인 비밀번호**에서 PBKDF2(150k, salt=`wlog-metrics::<user.id>`)로 파생 — 서버는 평문을 못 봅니다. 세션만 복원된 새로고침 상태에서는 키가 없어 신체정보가 잠깁니다.
- "자동 로그인" 체크 시 파생 키를 `localStorage`(`wlog_mk_<uid>`)에 보관합니다.
- Supabase anon 키는 index.html에 그대로 들어갑니다(정상 — RLS 전제). **서비스 롤 키는 절대 넣지 마세요.**

## API 함수 (`api/`)

전부 Vercel 서버리스이며 목적은 **API 키를 브라우저에서 숨기는 것**입니다. 외부 API를 새로 붙일 때도 같은 패턴을 따르세요.

| 파일 | 역할 | 환경변수 |
|---|---|---|
| `food.js` | 식약처 식품영양성분 검색 프록시 | `FOOD_API_KEY` |
| `gmaps.js` | 장소 검색 / 이동시간(matrix) | `GOOGLE_MAPS_API_KEY` |
| `ocr.js` | 카드 결제 알림 이미지 → 지출 항목(Claude 비전) | `ANTHROPIC_API_KEY` |
| `ticket.js` | 항공권/기차표/숙소 바우처 1장 판독 | `ANTHROPIC_API_KEY` |
| `trip-plan.js` | 티켓 이미지 여러 장 → 전체 여정 | `ANTHROPIC_API_KEY` |

환경변수는 Vercel 프로젝트 설정에 있습니다. 키가 없으면 500 + 한국어 안내 메시지를 반환하는 기존 방식을 유지하세요.

### 비전 프롬프트 수정 시 주의

`ocr.js` / `ticket.js` / `trip-plan.js`의 프롬프트는 실제 오인식을 하나씩 고쳐가며 쌓인 규칙 모음입니다. 커밋 이력이 곧 그 기록입니다. 프롬프트를 다시 쓰지 말고 필요한 규칙만 더하세요. 특히 살아 있어야 하는 규칙:

- 항공/기차 판별: '전자항공권·편명·PNR' 등 항공 신호가 있으면 무조건 항공
- 출발시각(`depTime`)이 없는 행(e티켓 번호·좌석표 등)은 구간에서 제외
- IATA 3글자 코드가 실제로 보일 때만 `depAp`/`arrAp`에 채우기 (T1/T2 터미널 번호 금지, 추측 금지)
- 같은 편에 승객이 여러 명이면 구간을 중복시키지 말고 `pax`로 합치기
- 누적/합계 같은 요약 금액은 결제 건이 아님

## 관례

- UI 문구·주석·커밋 메시지는 **한국어**.
- 커밋 메시지: `MAGIC CARPET <빌드태그>: <바뀐 내용>` (예: `MAGIC CARPET 0901aa: 빈 날짜 도착지 표시 + 붙여넣기`). 빌드태그는 `MMDD` + 그날의 알파벳 순번.
- 코드 스타일은 index.html의 기존 밀집한 한 줄 스타일을 따릅니다. 포매터를 돌려 파일 전체를 다시 쓰지 마세요 — diff가 못 읽게 됩니다.
- 사용자 노출 문자열은 `escapeHtml()`을 거칩니다. 알림은 `toast()`.
- 모바일 우선(`max-width:560px`) 하단 탭 네비. 새 탭은 `<section class="tab" id="tab-X">` + `switchTab('X')` 버튼으로 추가합니다.

## 확인 방법

빌드도 테스트도 없습니다. 확인은 브라우저로 합니다.

- 로컬: `python -m http.server` 등으로 열면 UI는 되지만 `/api/*`는 동작하지 않습니다(Vercel 함수). API까지 보려면 `vercel dev` 또는 배포 후 확인.
- 진짜 검증은 배포된 `workout-log-lilac.vercel.app`에서 허용된 계정으로 로그인해 확인하는 것입니다.
