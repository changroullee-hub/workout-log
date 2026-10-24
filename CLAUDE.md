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
| `trip` / `tripitem` | 여행(`budget` 항공·호텔 예산, `prep` 출발 전 체크리스트, `countries`도 함께), 여행 항목(항공·기차·장소). 여행 data를 고칠 땐 `tripData(t)`로 기존 필드를 보존 |
| `metrics` | 신체정보 (아래 암호화 참고) |
| `wish` | 찜한 추천 여행 (`url`=다시 찾을 `/api/flights` 쿼리, `hist`=날짜별 1인 최저가) — 여행 탭 열 때 하루 한 번 재확인, 내려가면 알림 |

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
| `flights.js` | 인천·김포·청주 출발 항공권 최저가 (1~4h / 5~9h / 10h+ 목적지 묶음, 직항·경유 방법, Travelpayouts 캐시가). `?legs=…&from=&to=&extra=` 는 경유 여행 탭의 최저가 일정 TOP3 탐색(출발일 범위 × 체류 +extra박, 귀국편 대체는 `hubs`로 넘긴 지역 환승지만, `end`=귀국 기한, `hop`=나라 간 최대 비행분). `?win=시작..끝&flex=` 은 꿀조합 휴가 맞춤(앞뒤 연차 flex일까지) 왕복 최저가 + 국가 안·육로 이동(`OPENJAW`, 동유럽·발칸 포함). `?scan=코드들&og=&deep=1&min=&max=&hol=` 은 한 나라 여행 탭: 앞으로 1년 왕복 날짜 조합마다 연차 일수(주말·`hol` 제외 근무일, 저녁 8시 이후 출발이면 출발일 제외)를 계산해 `low`(연차 적게)·`cheap`(연차 더 써도 싸게)·`byLeave`(연차 0~7+일별 싼 순 3개)·`best`(공항별 최저가) 반환, `fix=출발..귀국편출발` 은 그 날짜 왕복가(찜 재확인용). 요청 제한(429)은 재시도, 장거리는 인천만 조회. `vercel.json`에서 maxDuration 30초 | `TRAVELPAYOUTS_TOKEN` |
| `itinerary.js` | 다구간 추천 일정 → 날짜별 동선 + 도시별 숙박(체크인/아웃·추천 동네) JSON (Claude, `claude-opus-5-5`, json_schema 구조화 출력). `vercel.json` maxDuration 60초 | `ANTHROPIC_API_KEY` |
| `hotels.js` | 도시·날짜별 3성급+ 호텔 실제 가격(구글 호텔, SerpApi, 호스텔 제외) 중 평점 4.0+ 싼 순 3곳. Hotellook은 2025-10 종료돼서 대체 | `SERPAPI_KEY` |
| `gflights.js` | 추천 일정의 구글 항공권 실시간 가격 + 구간별 실제 편명·경유 공항(SerpApi `google_flights`, 다구간은 `departure_token`으로 구간마다 이어 조회 → 구간 수만큼 호출). 성인 1명 가격으로 받아 화면에서 인원수 곱함. `vercel.json` maxDuration 30초 | `SERPAPI_KEY` |
| `climate.js` | 그 기간 최근 3년 실제 날씨 평균(최고·최저·비 온 날 %) — Open-Meteo, 키 없음 | — |
| `fx.js` | 오늘 환율(open.er-api.com, 키 없음, 12시간 캐시) | — |

### API 호출 줄이기 (2026-10)

- 브라우저: GET은 `apiGet(url, ttl분, force)`로 부르세요 (서버 응답 모양을 바꾸면 `API_VER`를 올려 예전 캐시를 버리세요) — 메모리+localStorage(`wlog_api:`) 캐시, 진행 중 요청 공유, 실패는 저장 안 함. 항공 3시간·호텔 12시간·날씨/구글맵 30일·환율 12시간. `fetch`로 직접 부르지 마세요.
- 다구간 코스 조회는 `stopUrl()`/`stopFetch()` 하나로 — 꿀조합 추천 패널과 다구간 탭이 같은 결과를 공유합니다.
- 동선(Claude)은 같은 요청이면 localStorage(`wlog_itin:`)에 30일 보관해 다시 부르지 않습니다.
- 서버 `flights.js`: `cheapest()`는 10분 메모(인스턴스 안, 진행 중 공유)라 코스끼리 겹치는 구간(ICN→IST 등)은 한 번만 조회. 다구간은 구간마다 실제로 출발 가능한 달만 조회합니다.

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
- 모바일 우선(`max-width:560px`) 하단 탭 네비 4개: 항공권 예매(`trip`, 맨 위 연차 꿀조합 추천 버튼(`toggleVac`) — 공휴일은 `KR_HOL`(2027~2030, 대체공휴일 포함) / 안에 🌍 여러 나라 일주(기본, 구 다구간 항공권 예매, `tsub-stop`)·🚩 원픽 여행(`tsub-one`, 나라 하나 왕복, 나라 목록은 `ONE_REG`)·💸 항공권 최저가(`tsub-fare`)·🧳 우리 여행(`tsub-mine`) — 추천 코스는 `STOPOVERS` 배열) · 가계부 · 일정 · 운동. 운동은 `log`/`list`/`cal`/`timer`/`stat` 섹션을 상단 `#workSeg`로 전환합니다(`WORK_TABS`). 새 섹션은 `<section class="tab" id="tab-X">` + `switchTab('X')`로 추가하고, 운동 하위면 `WORK_TABS`와 `#workSeg`에도 넣으세요.

## 숨겨 둔 탭 (2026-10)

여행 계획에 집중하려고 **가계부·일정 탭을 숨겨 뒀습니다** — `index.html` CONFIG의 `const LIFE_TABS = false;`. `true`로 바꾸면 하단 탭·꿀조합 '일정에 넣기'·내 여행 '현지 지출(가계부)'·일정 알림이 전부 돌아옵니다. 데이터(`expense`/`task`)는 DB에 그대로 있고 지운 적 없습니다.

**운동 탭도 숨겼습니다** — `const WORK_TAB = false;` (기록하기·기록·칼로리·타이머·분석). 남은 탭이 항공권 예매 하나라 하단 탭 바도 자동으로 숨겨집니다. `true`로 바꾸면 돌아오고, 운동·식단·신체정보 데이터도 그대로입니다.

## 확인 방법

빌드도 테스트도 없습니다. 확인은 브라우저로 합니다.

- 로컬: `python -m http.server` 등으로 열면 UI는 되지만 `/api/*`는 동작하지 않습니다(Vercel 함수). API까지 보려면 `vercel dev` 또는 배포 후 확인.
- 진짜 검증은 배포된 `workout-log-lilac.vercel.app`에서 허용된 계정으로 로그인해 확인하는 것입니다.
