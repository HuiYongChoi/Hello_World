# UI 재구성 설계서 — 가독성 · 넓은 화면 · 동선

> 브랜치 `ui-refresh` · 작성 2026-10-21
> 요청: "가독성이 너무 떨어져. 화면과 빈공간을 잘 활용해서 UI를 가시성이 좋게끔, UX도 조금 더 동선에 맞게끔 재구성해서 배치해줘."
> 전제: 계산(`engine/`, `rentfinder/*.ts`, `boardDoc.ts`)은 손대지 않습니다. 상시 탭 6개 · 엔트리 하나 · 외부 요청 0건 · 점수 합산 금지 · 부정적 결과 숨기지 않기 · 인쇄 동등성(가이드 검수 ①~⑤)은 그대로 지킵니다.
> 사용 환경: 2000px 데스크톱 · 어두운 테마 · 마산 → 함안의령지사 출퇴근 전세(우선)·월세 찾기.

---

## 1. 진단 — 가독성을 떨어뜨리는 원인 (코드로 확인한 것)

| # | 원인 | 근거 |
|---|---|---|
| 1 | **10~11px 글자가 본문 역할을 함.** `text-[10px]`·`text-[11px]` 가 화면 파일에 **300곳**(TenurePage 47 · SubscriptionPage 42 · MarketPage 36 · ComplexDetailDrawer 28 · RentFinderApp 26 …). 표 전체가 11px 인 곳이 많음 | `RentFinderApp.tsx:181,415,502` `<table … text-[11px]>` · `ComplexDetailDrawer.tsx:371,415` · `ReportPage.tsx:133` · `ui.tsx:57` Badge 11px · `ui.tsx:137` "가정" 배지 **9px** · `ui.tsx:151,177,214` ProvenanceValue 출처·Chip·Foldable 10px · `App.tsx:138` 탭 그룹 라벨 10px |
| 2 | **대비 부족.** `text-slate-600`(≈#45556c, 배경 #070a12 대비 ≈2.6:1) 이 본문·숫자 보조설명에 **100곳+**, `text-slate-500`(≈4.3:1) 이 **200곳+**. 둘 다 11px 이하와 겹쳐 읽히지 않음 | `TenurePage.tsx` slate-600 22곳 · `MarketPage.tsx` 12곳 · `PropertiesPage.tsx` 11곳 · `ui.tsx:151` 출처 slate-600 10px · `ui.tsx:464,466` Stat 라벨·힌트 slate-500 11px |
| 3 | **넓은 화면을 안 씀.** 본문 컨테이너가 `max-w-7xl`(1280px) 라 2000px 화면에서 **좌우 360px 씩 빈 채** 카드가 세로로만 쌓임. 후보판 iframe 도 이 폭 안에 갇혀 표(최소 1720px)가 항상 가로 스크롤 | `App.tsx:102,180,254` `max-w-7xl` · `BoardFrame.tsx:93` `w-full` · `template.html` `.wrap{max-width:1320px}` `table{min-width:1720px}` |
| 4 | **설명이 숫자보다 먼저·많이.** 화면마다 소개 카드 + 긴 subtitle + 하단 "못 하는 것" 카드가 상시 펼쳐짐. 핵심 숫자(최대 보증금·전세가율·월 이자)가 그 사이에 묻힘 | `RentFinderApp.tsx:339-358` 소개 카드 2문단 · `:638-648` 캐비엇 카드 상시 · `MarketPage.tsx:623-624` subtitle 3줄 · `TenurePage.tsx:1222` · `TownBoardPage.tsx:263-277` · `template.html` `.rule`(읽는 법)·`.weights`·`#spanel[open]` 세 블록이 표 위에 상시 |
| 5 | **입력과 결과가 같은 열에 순서대로.** 찾기 화면은 ① 조건 → ② 한도 → ③ 발굴 → ④ 대출이 세로 한 줄이라 조건을 고치고 결과를 보려면 매번 스크롤. 입력 탭도 요약(`ScenarioPage` "현재 프로필 요약")이 세 번째 단계 끝에 있음 | `RentFinderApp.tsx:338-649` · `ScenarioPage.tsx:130` |
| 6 | **동선이 실제 흐름과 어긋남.** 기본 탭이 `compare`, 선택 탭의 기본 단계가 `subscription`(청약). 매일 보는 후보판은 탭 → 4번째 단추로 두 번 들어가야 함. 단지 상세에서 "대출 확인"·"등기부 확인" 으로 이어지는 길이 없음 | `App.tsx:78-80` 기본값 · `:70-75` OPTIONAL_STEPS 순서 · `ComplexDetailDrawer.tsx` 액션 없음 (REGISTRY_CHECKLIST 는 후보판 맨 아래에만) |
| 7 | **후보판 토큰도 같은 문제.** `--faint #6f7c78`(배경 #161d1b 대비 ≈3.4:1) 이 `.sub`·`.hint`·`.small`·`.sig` 등 보조 정보 전부. `.pill 11px` `.mine-tag 10.5px` `.cn-n 11px` `.mv 9px` | `template.html` `<style>` 토큰 블록 |

공통 패턴: **작은 글자 × 낮은 명도 × 좁은 한 열 × 설명 우선.** 넷 중 하나만 고쳐서는 안 읽히고, 넷을 같이 고쳐야 합니다.

---

## 2. 시각 체계

### 2.1 글자 크기 — Tailwind 토큰 한 줄로 전역을 올립니다

`index.css` 의 `@theme` 에 아래를 추가합니다. `text-xs` 를 12→**13px** 로 올리면 기존 `text-xs` 60여 곳이 한 번에 커지고, 10~11px 임의값은 전부 토큰으로 바꿉니다.

```css
@theme {
  --text-2xs: 0.75rem;   --text-2xs--line-height: 1.45;  /* 12px  범례·각주·sup 만 */
  --text-xs:  0.8125rem; --text-xs--line-height: 1.5;    /* 13px  보조 본문·표 보조줄·힌트 */
  --text-sm:  0.875rem;  --text-sm--line-height: 1.55;   /* 14px  본문·표 본문·라벨 */
  --text-base: 1rem;     --text-base--line-height: 1.55; /* 16px  입력값·카드 소제목 */
  --text-lg:  1.125rem;  /* 18px 카드 제목 */
  --text-xl:  1.375rem;  /* 22px Stat 숫자 */
  --text-2xl: 1.625rem;  /* 26px 머리 숫자(단지 상세 최근 전세 등) */
}
```

| 역할 | 토큰 | 금지 |
|---|---|---|
| 본문·표 본문·필드 라벨 | `text-sm` (14) | — |
| 보조 본문·표 보조줄·힌트·Foldable 요약 | `text-xs` (13) | — |
| 범례·각주 번호·차트 축 | `text-2xs` (12) | 본문 문장에 쓰지 않음 |
| 숫자(Stat) | `text-xl` · 머리 숫자 `text-2xl` · `tabular-nums` | — |
| **임의값** `text-[9px]` `text-[10px]` `text-[11px]` | — | **금지.** 테스트로 걸어 둡니다 (§5 3단계) |

SVG 축 라벨(`fill-slate-500 text-[10px]`)은 `text-2xs` + `fill-slate-400` 으로.

### 2.2 대비 — 명도 3단만 씁니다

| 단 | 클래스 | 대비(#070a12 기준, 근사) | 쓰는 곳 |
|---|---|---|---|
| 1 본문 | `text-slate-100` / `text-slate-200` | 15:1 / 13:1 | 숫자·단지명·라벨 |
| 2 보조 | `text-slate-400` | 7.6:1 | 힌트·출처·보조줄·접힌 요약 |
| 3 최저 | `text-slate-500` | 4.3:1 | **13px 이상 + 숫자 아님** 에서만. 구분점(`·`) · 화살표 · 비활성 |
| 금지 | `text-slate-600` 이하 | 2.6:1 | 글자에 쓰지 않음. 선·배경(`border-slate-800`, `divide-slate-800`)에만 |

기계적 치환: `text-slate-600` → `text-slate-500`, 그다음 라벨·출처·힌트의 `text-slate-500` → `text-slate-400`. 치환 후 남는 `text-slate-500` 은 위 3단 조건을 만족하는지 눈으로 한 번.

### 2.3 색 — 강조색 하나 + 의미색 셋 (+ 부호색 하나)

가이드 07 "색은 한 가지 뜻만" 을 그대로 씁니다.

| 색 | 유일한 뜻 | 예 |
|---|---|---|
| `sky` | **선택·활성·행동** (탭·세그먼트·링크·"담기"·"상세 ▸") | 매수 갈래 색으로는 쓰지 않음 |
| `emerald` | **실행 가능 · 충족 · 위험 낮음** (판정) | 전세가율 <60% · 판정 A · "가능" |
| `amber` | **실행되지만 손해 · 표본 얇음** (경고) | 레버리지 역효과 · 거래 3건 미만 · 전세 신호 "만기 임박" |
| `rose` | **차단 · 위험** | 자격 미달 · 전세가율 ≥80% · 판정 C |
| `teal` | **부호 ＋ 전용** (변화율) | 동네 시세판·시장 온도의 +%. 판정색(emerald)과 섞이지 않게 유지 |
| `slate` | 나머지 전부 — 계열·순위·금액 구분은 명도로 | — |

배지 등급(`TierBadge` block/warn/cond)·가정값 점선 밑줄(`ProvenanceValue`)·근거 칩·접히는 방법론은 이미 있으니 **크기만** 올립니다.

### 2.4 간격 · 카드

- 섹션 사이 `space-y-6` (지금 5) · 그리드 `gap-4` · 카드 `p-5 xl:p-6`.
- 표: `th` `py-2.5` · `td` `py-2.5` · 본문 `text-sm` · 보조줄 `text-xs text-slate-400`. 11px 표 금지.
- 카드 제목 `text-lg font-semibold`, subtitle `text-sm text-slate-400 max-w-[72ch]`. **subtitle 이 두 문장을 넘으면** 첫 문장만 남기고 나머지는 `Foldable` 로.
- 카드 하나에 **머리 숫자(Stat) 가 있으면 숫자가 설명보다 위**. 설명은 숫자 아래 13px 또는 Foldable.
- 신뢰도 경고(표본 얇음·갈림·시세 불명)는 가이드 05 대로 **숫자 옆 amber 배지**, 방법론은 접기.

### 2.5 `ui.tsx` 공용 컴포넌트 — 바꿀 값

| 컴포넌트 | 지금 | 바꿈 |
|---|---|---|
| `Card` | title `text-base` · subtitle `text-xs slate-400` · `p-5` | title `text-lg` · subtitle `text-sm slate-400 max-w-[72ch]` · `p-5 xl:p-6` · `className` 에 `h-full` 허용(그리드 안 높이 맞춤) |
| `Badge` | `text-[11px] px-1.5` | `text-xs px-2 py-0.5` |
| `TierBadge` | `text-[11px]` · cond 라벨 slate-500 | `text-xs` · cond 라벨 `slate-400` |
| `ProvenanceValue` | 라벨 11px slate-500 · "가정" 9px · 출처 10px slate-600 · sm=`text-sm`/md=`text-lg` | 라벨 `text-xs slate-400` · "가정" `text-2xs` · 출처 `text-xs slate-400` · sm=`text-base` / md=`text-xl` |
| `ProvenanceChip` | 10px slate-500 · 버튼 10px | `text-xs slate-400` · 버튼 `text-xs` |
| `Foldable` | summary 10px slate-500 | summary `text-xs text-slate-300 hover:text-sky-300` · 본문 `text-xs text-slate-400` 기본 적용 |
| `Field` | 라벨 `text-xs slate-300` · 힌트 11px slate-500 | 라벨 `text-sm slate-200` · 힌트 `text-xs slate-400` |
| `inputClass` | `text-sm py-2` | `text-base py-2.5` · 포커스 링 유지 |
| `MoneyInput/NumberInput` 단위 | `text-xs slate-500` | `text-sm slate-400` |
| `Toggle` | 라벨 `text-xs` · 힌트 11px slate-500 | 라벨 `text-sm` · 힌트 `text-xs slate-400` |
| `Button` | sm `text-xs` md `text-sm` | sm `text-sm px-3 py-1.5` · md `text-base px-4 py-2` |
| `SegmentedControl` | `text-xs px-3 py-1.5` | `text-sm px-3.5 py-2` |
| `Stat` | 라벨 11px slate-500 · 값 `text-lg` · 힌트 11px slate-500 · `px-3.5 py-3` | 라벨 `text-xs slate-400` · 값 `text-xl` · 힌트 `text-xs slate-400` · `px-4 py-3.5` · 새 prop `size="lg"` → 값 `text-2xl` (머리 숫자용) |
| `InfoPopover` | 단추 `h-4.5 w-4.5 text-[10px]` · 패널 `w-72` 라벨 10px | 단추 `h-5 w-5 text-2xs` · 패널 `w-80 text-sm` 라벨 `text-xs slate-400` |
| `Empty` | `text-sm` | `text-base` |

새로 추가(둘 다 `ui.tsx`):

- `Rail`: `<aside className="space-y-4 xl:sticky xl:top-[7.5rem] xl:self-start">` — 넓은 화면에서 입력/요약을 왼쪽·오른쪽에 고정하는 자리. 모바일에서는 그냥 블록.
- `TwoCol`: `<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">` 또는 `rail="left"` 면 `xl:grid-cols-[22rem_minmax(0,1fr)]`. 화면마다 임의 그리드를 적지 않게 묶습니다.

### 2.6 후보판(`template.html`) 토큰 — 같은 원칙

```css
/* 다크 토큰 (두 블록 모두) */
--muted: #a3b0ab;   /* 9aa8a3 → 대비 ≈7:1 */
--faint: #8d9a95;   /* 6f7c78 → ≈5:1 — 보조 정보 하한 */
--line:  #2f3a37;
```

| 선택자 | 지금 | 바꿈 |
|---|---|---|
| `body` | 14px | 15px / 1.55 |
| `table` | 13px · `min-width:1720px` | **14px** · min-width 유지 |
| `thead th` | 12px | 13px |
| `.sub` `.hint` `.vlist .vd` `.small` `.sig` `.mine-tag` `.ied .basis` `.pop .pbasis` `.memo .foot` `.hist` | 10.5~12px | **12.5~13px** (`.mine-tag` 10.5→12.5, `.sig` 11.5→13) |
| `.pill` `.cn-n` `.dbtn` `button.strike` `.chip` | 11~12.5px | 12.5~13.5px |
| `.mv` | 9px | 11px, 영역 20×24 |
| `.wrap` | `max-width:1320px` | `max-width:1880px` — 2000px 화면에서 사이드 240 + 표 1720 이 **가로 스크롤 없이** 들어감 |
| `.side` | 236px | 240px |
| `h1` 30 / `h2` 20 | — | 유지 (디스플레이 서체는 사이트판에서 폴백되므로 `--display` 를 `--body` 와 같게 두어 굵기만 다르게) |

`.rule`(읽는 법) · `.weights`(인프라 가중치) 는 `<details>` 로 감싸 **기본 접힘**, `#spanel`(정렬 우선순위) 은 `open` 을 빼고 summary 에 현재 순서를 한 줄로("정렬 · 판정 → 전세가율 → 거리"). 세 블록이 표 위에서 사라지면 첫 화면에 표가 바로 보입니다. 스크립트가 `#spanel` 의 `open` 을 읽는 곳이 있으면 거기만 맞춥니다. 인쇄는 `details[open]` 강제(`@media print { details{display:block} details>*{display:block} }`).

---

## 3. 배치 — ≥1280px(xl) 2단 / ≥1536px(2xl) 넓게, ≤640px 1단

**컨테이너**: `App.tsx` 의 `max-w-7xl` 세 곳 → `max-w-[1800px]`, `px-5` → `px-6 2xl:px-10`. 후보판 단계에서는 `<main>` 이 `max-w-none px-3` 으로 **풀 블리드**.

| 화면 | xl 배치 | 왼쪽 | 오른쪽 | 비고 |
|---|---|---|---|---|
| 머리줄 | 한 줄 | 제목 + 부제(13px, `hidden xl:block`) | 탭 3그룹 + "오늘 볼 것" + 실행가능 N/M + 초기화 | 그룹 라벨 `text-2xs slate-400`, 탭 `text-sm`, 단계 번호칸 `h-5 w-5 text-xs` |
| 오늘 볼 것 | **4칸 타일 한 줄** `grid xl:grid-cols-4` | 타일 = 제목(13px slate-400) / 한 줄(15px slate-100) / → | ▸ 자세히는 타일 안 Foldable | 높이 1줄로 줄어 아래 화면이 바로 보임 |
| 입력 탭 | `TwoCol rail="right"` | 단계 폼(프로필 / 시나리오 / 물건) 2열 필드 | **Rail**: 현재 프로필 요약 Stat 6개 + 실행가능 조합 + "다음 단계 →" | `ScenarioPage` 의 "현재 프로필 요약" 카드를 `components/ProfileRail.tsx` 로 옮겨 세 단계 공통 |
| 비교 매트릭스 | 매트릭스 풀폭 → 아래 `xl:grid-cols-2` | 최적 조합 Stat 5 | 얼마까지 되나(가격 나침반) | 셀 상세 패널은 지금처럼 오른쪽 고정 |
| 매수·전세·월세 | 갈래 카드 4열 → `xl:grid-cols-2` 둘 → `xl:grid-cols-2` 둘 → 가정값 4열 | 손익분기 / 대체투자 | 덜 쓴 돈 / 자금 흐름 | "이 계산이 아닌 것" → Foldable |
| 실거래 수익률 | 시장 온도 풀폭 → `TwoCol rail="left"` → 백테스트 풀폭 | **Rail**: 검색 폼(지역·단지·평형·진입/청산) | 결과 Stat + 분포 띠 + 진입시점 카드 | 긴 subtitle → 한 문장 + Foldable |
| 전월세 · 청약 → 후보판 | iframe 풀 블리드, 높이 `100vh − 머리줄` | — | — | §2.6 |
| → 찾기 | `TwoCol rail="left"` | **Rail**: ① 내 조건(필드 1열, 토글 1열) + ② 얼마까지 Stat 3 세로 + "상품별 자세히 ▸"(Foldable) | ③ 발굴 표(풀폭) → ④ 대출 자세히 | 소개 카드 삭제(문장은 ① subtitle 로), 캐비엇 카드 → Foldable |
| → 동네 시세판 | 표 풀폭 | — | — | 창 설명 문단·캐비엇 → Foldable |
| → 청약 | `TwoCol rail="left"` | **Rail**: 공고 선택 + 손입력 3개 | 별점 4축 + 안전마진 + 자금 일정 | — |
| 리포트 | 인쇄용 — 1단 유지, 글자만 §2 | — | — | `print-open` 확인 |
| 단지 상세 서랍 | `max-w-[40rem]` → `max-w-[52rem]` | 머리 숫자 3개 `Stat size="lg"` | — | §4 액션 두 개 추가 |
| 대출 설명서 서랍 | `max-w-2xl` → `max-w-3xl` | 여는 세로 단추 11px → `text-sm` | — | `fixed … left-0` 는 채점표가 보므로 그대로 |

**≤640px**: `TwoCol` 과 `Rail` 은 그냥 블록(순서: 입력 → 결과). 표는 지금처럼 `overflow-x-auto`. 후보판은 자체 900px 미디어쿼리로 사이드가 위로 올라감. 타일·Stat 그리드는 `grid-cols-1 sm:grid-cols-2`.

---

## 4. 동선

### 4.1 흐름 A — 매일: 오늘 볼 것 → 후보판 → 단지 상세 → 대출 확인 → 등기부 확인

| 단계 | 지금 | 바꿈 | 파일 |
|---|---|---|---|
| 첫 화면 | 항상 `compare` | **마지막 탭·단계를 기억**(`localStorage` `ui-last-tab` / `ui-last-step`). 첫 방문은 `subscription` 탭 · `board` 단계 | `App.tsx` |
| 탭 라벨·순서 | `청약 · 전월세`, 단계 순서 청약 → 찾기 → 시세판 → 후보판 | 라벨 `전월세 · 청약`(TabId 는 그대로 `subscription`). 단계 순서 **후보판 → 찾기 → 동네 시세판 → 청약**, 기본 `board`. 라벨: `전·월세 후보판` / `찾기 — 내 조건 · 발굴` / `동네 시세판` / `청약 공고 · 안전마진` | `App.tsx` OPTIONAL_STEPS |
| 오늘 볼 것 | 4줄 목록 | 4타일. "남은 후보"·"전세 신호" → 후보판(이미 그렇게 감) | `TodayCard.tsx` |
| 후보판 → 단지 상세 | 단지명 옆 "상세" postMessage (있음) | 유지 | — |
| 단지 상세 → 대출 확인 | **없음** | 서랍 머리에 단추 **"이 보증금으로 대출 자세히 →"**: `onLoanDetail(deposit, area)` → App 이 `subscription/rent` 로 가며 `RentFinderApp` 에 `initialTarget`(+`key` 변경) 을 넘기고 `#loan-detail` 로 스크롤 | `ComplexDetailDrawer.tsx` · `App.tsx` · `RentFinderApp.tsx`(prop 추가만) |
| 단지 상세 → 등기부 확인 | 후보판 맨 아래 체크리스트에만 | 서랍 안 Foldable **"계약 전 서류로 볼 것 5"** = `safety.ts` 의 `REGISTRY_CHECKLIST` 그대로. 근저당 허용선 문장 바로 아래 | `ComplexDetailDrawer.tsx` |
| 대출 확인 → 돌아가기 | 없음 | ④ 대출 자세히 카드 action 에 "후보판으로 →" | `RentFinderApp.tsx` |

### 4.2 흐름 B — 조건이 바뀔 때: 내 조건 → 얼마까지 → 발굴 → 담기 → 후보판

- 찾기 화면을 **왼쪽 고정 레일(①②) + 오른쪽 결과(③)** 로. 조건을 고치면 스크롤 없이 ②③ 이 같이 바뀝니다.
- ③ 머리에 "후보판 열기 · 담은 집 N →" 단추를 **카드 action 으로 고정**(지금은 소개 카드에 있어 스크롤하면 사라짐).
- 담은 뒤의 초록 안내띠(`:622-631`)는 유지하되 `text-sm`.
- 동네 시세판 "이 구에서 발굴하기 →" 는 지금처럼 찾기 ③ 으로 (이미 연결됨).

### 4.3 접거나 옮기는 설명 (지우지 않습니다 — 인쇄에서는 전부 펼침)

| 위치 | 처리 |
|---|---|
| `RentFinderApp` 소개 카드(339-358) | 카드 삭제. "여기 넣은 조건은 후보판의 대출 칸도 다시 잽니다" 한 문장만 ① subtitle 로. 나머지는 ① 안 Foldable "이 화면의 역할 3" |
| `RentFinderApp` "이 자료가 못 하는 것" 카드 · ② 하단 10px 문단 · ④ 면책 문단 | Foldable (count 표시) |
| `TownBoardPage` 창 설명(263-268) · 캐비엇 카드 | Foldable |
| `MarketPage` 제목 subtitle 3줄 · "이 숫자가 아닌 것" 카드 | 첫 문장만 + Foldable |
| `TenurePage` "이 계산이 아닌 것" · 10px slate-600 방법론 문단들 | 숫자에 붙는 경고(표본 얇음·부족액)는 **그대로 숫자 옆**, 방법론만 Foldable |
| `ComparePage` 셀 상세 하단 10~11px 문단 | `text-xs slate-400`, 산출 조건은 Foldable |
| `BoardFrame` 상단 안내 문단 | 한 줄 `text-xs slate-400` ("전세 ↔ 월세는 왼쪽 사이드바 · 소거·메모는 이 브라우저 저장 · 기기 이동은 설정 옮기기") |
| 후보판 `.rule` 읽는 법 · `.weights` · `#spanel` | `<details>` 기본 접힘 (§2.6) |
| 머리줄 부제 · 푸터 면책 | `text-xs slate-400`. 부제는 xl 미만에서 숨김 |

---

## 5. 구현 지시 — 한 사람이 순서대로

검증 명령(매 단계 뒤):

```bash
cd simulator && npx tsc --noEmit -p . && npx vitest run
```

template.html 을 고친 단계 뒤에는 추가로 `node ../scripts/board/sync-template.mjs`(simulator 에서) 를 돌리고 다시 vitest. 마지막에 `cd .. && node scripts/scorecard.mjs` 가 **100점**이어야 합니다.

손대지 않는 것: `src/engine/**`, `src/rentfinder/*.ts`(`boardDoc.ts` 포함), `src/rules/**`, `src/data/**`, `TabId` 유니온(6개), `HandbookDrawer` 의 `fixed … left-0`, 엔트리·빌드 설정, 외부 글꼴·스크립트 링크 추가 금지.

| 단계 | 파일 | 할 일 |
|---|---|---|
| 0 | — | 기준선: 검증 명령 + scorecard 가 100 인지 기록 |
| 1 | `src/index.css` | §2.1 `@theme` 글자 토큰 추가(`--text-2xs` 신설, `--text-xs` 13px). `@media print` 에 `details{display:block} details>*{display:block}` 추가(후보판 외 공통) |
| 2 | `src/components/ui.tsx` | §2.5 표대로 크기·명도 교체. `Rail`·`TwoCol` 추가. `Stat` 에 `size?: 'md'|'lg'` |
| 3 | `src/pages/*.tsx` `src/rentfinder/*.tsx` `src/App.tsx` `src/components/*.tsx` | 기계 치환: `text-[9px]`·`text-[10px]` → `text-2xs`, `text-[11px]` → `text-xs`, `text-slate-600` → `text-slate-500`. SVG 의 `text-[10px]` 도 포함. 그다음 라벨·힌트·출처·표 보조줄의 `text-slate-500` → `text-slate-400`(표 헤더 `thead` 도). **가드 테스트** `src/components/__tests__/typography.test.ts` 추가: 위 파일들에서 `/text-\[(9|10|11)px\]/` 와 `/text-slate-600/` 이 0건이어야 통과 |
| 4 | `src/App.tsx` | `max-w-7xl` → `max-w-[1800px]`, `px-6 2xl:px-10`. 머리줄 글자 §3. 탭 라벨 `전월세 · 청약`, `OPTIONAL_STEPS` 순서·라벨 §4.1, 기본 `optionalStep='board'`. 마지막 탭·단계 `localStorage` 기억(읽기 실패는 기본값). 후보판 단계에서 `<main>` 풀 블리드. `ComplexDetailDrawer` 에 `onLoanDetail` 전달, `RentFinderApp` 에 `initialTarget`(+`key` 에 포함) 전달 |
| 5 | `src/pages/TodayCard.tsx` | 4타일 그리드. 제목 `text-xs slate-400`, 본문 `text-sm slate-100`, 자세히는 타일 안 Foldable. "오늘은 접기" `text-xs` |
| 6 | `src/rentfinder/RentFinderApp.tsx` | `TwoCol rail="left"`: 레일 = ① + ② (Stat 세로, 상품표 Foldable "상품별 자세히"); 오른쪽 = ③ + ④. 소개 카드 삭제·Foldable 들 §4.3. 표 `text-sm`. ③ action 에 "후보판 열기" 고정. props `initialTarget?: RentTarget` → 있으면 `target` 초기값으로 쓰고 마운트 시 `#loan-detail` 로 스크롤. ④ action "후보판으로 →"(`onOpenBoard`) |
| 7 | `src/rentfinder/ComplexDetailDrawer.tsx` | 폭 `max-w-[52rem]`. `HeadStat` → `Stat size="lg"`. 머리에 "이 보증금으로 대출 자세히 →"(최근 전세 값·평형, `onLoanDetail`). 근저당 문장 아래 Foldable "계약 전 서류로 볼 것"(`REGISTRY_CHECKLIST` import — `safety.ts` 는 읽기만). 표·차트 라벨 §2.1 |
| 8 | `src/rentfinder/board/template.html` | §2.6 토큰·크기·`.wrap` 폭·`details` 세 블록·인쇄 규칙. 그다음 `node ../scripts/board/sync-template.mjs` → vitest(`board.test` 의 template 동일성 통과) |
| 9 | `src/rentfinder/TownBoardPage.tsx` · `src/pages/TemperatureCard.tsx` | 표 `text-sm`, `N` 보조 `text-2xs slate-400`, 설명 문단 Foldable. teal/rose 부호색 유지 |
| 10 | `src/pages/MarketPage.tsx` | `TwoCol rail="left"`(검색 폼 레일) · subtitle 축약 + Foldable · Stat 교체 |
| 11 | `src/pages/ComparePage.tsx` · `AffordabilityCard.tsx` | 아래 두 카드 `xl:grid-cols-2`. 매트릭스 셀 글자 `text-sm`/보조 `text-xs`. 셀 상세 문단 §4.3 |
| 12 | `src/pages/TenurePage.tsx` | 카드 짝짓기 `xl:grid-cols-2` 두 쌍, 캐비엇 Foldable, 경고는 숫자 옆 유지 |
| 13 | `src/pages/ScenarioPage.tsx` → `src/components/ProfileRail.tsx`(새) · `ProfilePage.tsx` · `PropertiesPage.tsx` · `App.tsx` | "현재 프로필 요약" 을 `ProfileRail` 로 빼고 입력 탭 전체를 `TwoCol rail="right"` 로. 레일에 "다음 단계 →" |
| 14 | `src/pages/SubscriptionPage.tsx` · `PremiumCard.tsx` | `TwoCol rail="left"`(공고 선택·손입력), 별점 축 글자 §2.1 |
| 15 | `src/pages/ReportPage.tsx` · `HandbookDrawer.tsx` | 글자·폭만. 리포트 인쇄 미리보기에서 Foldable 전부 펼쳐지는지 확인 |
| 16 | — | 모바일 375px · 1280px · 2000px 세 폭에서 각 탭 한 번씩: 가로 스크롤 없음(후보판 2000px 포함), 레일 sticky 가 머리줄에 안 가림, 10~11px 글자 0건(가드 테스트). `.claude/launch.json` `built-realty` 로 `npm run deploy:realty` 산출물이 `#root` 를 채우는지 확인 |
| 17 | — | `cd .. && node scripts/scorecard.mjs` **100** 확인 · 커밋 메시지 한국어 |

### 완료 기준 (가이드 검수 ①~⑤ + 이번 둘)

1. 화면에만 있고 인쇄본에 없는 정보가 없다 (Foldable 은 `print-open`).
2. 점선 밑줄 없이 표시된 가정값이 없다.
3. 한 셀에 채워진 색 배지가 둘 이상 없다.
4. 신뢰도 경고가 카드 하단이 아니라 숫자 옆에 있다.
5. 같은 색이 두 뜻으로 쓰이지 않는다 (§2.3 표).
6. **글자 13px 미만은 범례·각주·축뿐이고, `text-slate-600` 이하로 적힌 글자가 없다** (가드 테스트).
7. **2000px 에서 모든 화면이 2단 이상이거나 풀폭 표이고, 후보판 표가 가로 스크롤 없이 들어간다.**
