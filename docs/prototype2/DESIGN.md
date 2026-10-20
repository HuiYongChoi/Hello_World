# prototype2 설계서 — 단지 상세 · 동네 시세판 · 시장 온도 · 오늘 볼 것

> 브랜치 `prototype2` · 배포 `/hyrealty-p2/` (운영 `/hyrealty/` 와 별개) · 작성 2026-10-21
> 코드는 없고 설계만 있습니다. 두 갈래가 이 문서만 보고 병렬로 구현합니다 (§6).

## 0. 전제 — 바뀌지 않는 것

- **탭 6개 그대로.** `TabId` 유니온을 늘리지 않습니다. 넷 다 기존 탭의 하위 단계·패널·카드입니다.
- **엔트리 하나 · 외부 요청 0건 · 정책 수치는 JSON · 계산부는 React 를 모름 · 점수 합산 금지.**
- **새 API 키·크롤링 없음.** 쓰는 자료는 이미 있는 다섯 스냅샷과 서버의 `signals.json` 뿐입니다.
- 모든 숫자 옆에 **표본 수**를 적고, 얇으면 색을 칠하지 않고 `—` 로 둡니다. 기준은 §1.4.

### 0.1 쓰는 자료와 그 모양 (실제 파일에서 확인한 값)

| 자료 | 범위 | 한 칸의 단위 | 쓸 필드 |
|---|---|---|---|
| `market-2026-08.json` → `engine/market.ts` `MARKET` | 2016Q1~2026Q3 (`q`=64~106, 기준연도 2000). 수집이 202608 이라 **2026Q3 은 두 달짜리** | 단지(`id`·`umd`·`regionCode`·`buildYear`) × 평형(`area`) × 분기 `{q, n, price}` | 15개 시군구 — 창원 5구·부산 5구·경기 5구 |
| `masan-rent-2026-09.json` → `rentfinder/data.ts` `COMPLEXES` | 2024Q4~2026Q3 (`q`=99~106, 8분기 전부 완결) | 단지 × 평형: `jeonse{n,deposit}`·`wolse{n,deposit,rent}` 는 **2년 중위**, `trend[{q,n,deposit}]` 는 **전세만** 분기 중위, `renewalShare`, `lastYm` | 창원 5구 + 함안·의령. 876곳 중 725곳이 `MARKET` 과 같은 `id` |
| `board-2026-09.json` → `board/boardDoc.ts` `BOARD_SNAPSHOT` | 전세 34줄 · 월세 91줄 | 줄 id = `단지id_면적`. `jh`·`sh` 는 최근 6분기, `rank`·`tier`, `seed.jeonse.excluded` | 후보판 iframe 과 같은 자료 |
| `applyhome-2026-09.json` → `engine/applyhome.ts` `NOTICES` | 2023-01~2026-09-06 | 공고 `noticeDate`·`region`·`sigungu`·`models` | 권역별 최신 공고: 경기 09-04 · 부산 07-30 · 창원 07-16 |
| `signals.json` (서버, 매일 08:00) | 만기 6개월 안 · 새 계약 45일 안 | `rows[줄id] = { upcoming[{end:'2026-11', gap, floor, dep, type, locked}], recent[{date, floor, dep, rent, type, term}] }`, `windowMonths: 3` | 감시 목록(후보판 전세 줄)만. 없으면 `null` |

**없는 것 (설계의 경계):** 개별 거래(전부 분기 중위로 접혀 있음), 월세 분기 추이, 동·호수, 근저당, 매물·호가, 부산·경기의 동별 전월세(`rent-2026-08.json` 은 시군구 비율 집계뿐).

## 1. 공통 규칙

### 1.1 화면 배치

```
탭 ＋ 청약 · 전월세   OPTIONAL_STEPS 에 'town' 추가 → [청약] [전월세 찾기] [동네 시세판 ← B] [후보판]
탭 4 실거래 수익률    맨 위 카드 → C 시장 온도 (기존 단지 검색·백테스트 카드는 아래 그대로)
어디서나            A 단지 상세 — 오른쪽 슬라이드 패널 (설명서 서랍과 대칭, 윈도 이벤트로 열림)
머리줄 아래          D 오늘 볼 것 — 카드. 하루 한 번 접을 수 있고 머리줄의 "오늘 볼 것" 으로 다시 폄
머리줄 맨 위         배너 — VITE_PROTOTYPE=2 빌드에서만
```

오른쪽 서랍을 뺐던 이유는 "곁가지 분석" 이었습니다. A 는 분석이 아니라 **방금 누른 줄 하나의 근거**라 성격이 다릅니다 — 패널은 단지 하나를 보이고 닫히며 자기 상태를 저장하지 않습니다.

### 1.2 분기 창

두 스냅샷의 마지막 분기 완결 여부가 다르므로 **스냅샷마다 마지막 완결 분기**를 잽니다.

```
lastCompleteQ(rangeTo, baseYear) = rangeTo 의 월이 3·6·9·12 면 그 분기, 아니면 직전 분기
매매  range.to=202608 → 105 (2026Q2)   최근 4분기 102~105 · 이전 4분기 98~101
전세  range.to=202609 → 106 (2026Q3)   최근 4분기 103~106 · 이전 4분기 99~102
```

화면은 창 라벨을 항상 적습니다 (`2025Q3~2026Q2 대 2024Q3~2025Q2`). 매매·전세 창이 한 분기 어긋나는 것은 숨기지 않고 적습니다.

### 1.3 같은 칸끼리

비율·변화율은 전부 **같은 단지·평형(칸)** 안에서 내고 칸들의 중위를 씁니다. 수준(동 평균가)을 나누거나 시점끼리 빼지 않습니다 — `rent.ts`·`growth.ts` 와 같은 이유(구성 변화). 평형 짝은 `safety.ts` 와 같이 ±2㎡.

### 1.4 얇은 표본 (한 곳에 상수로, 테스트로 고정)

| 값 | 최소 | 모자라면 |
|---|---|---|
| 분기 점 하나 | `THIN_DEAL_COUNT`=3 (market.ts 재사용) | 차트에 빈 점, 표에 회색 |
| 동 단위 전세가율 | 짝지은 칸 3개 | `null` → "표본 부족 (n칸)" |
| 구 단위 전세가율 추세 한 분기 | 짝지은 칸 8개 (`MIN_LINKED_PAIRS` 준용) | 그 분기 비움 |
| 1년 변화율 (매매·전세) | 칸 5개 | `null` |
| 거래량 변화율 | 이전 창 10건 | `null` → "기준 적음" |
| 단지 상세 최근 전세 | `recentJeonse()` 규칙 그대로 (3건↑, 갈림 1.5배) | 후보판과 같은 문구 |

## 2. A 단지 상세 — 호갱노노식, 그러나 분기 중위까지

**묻는 것:** "이 줄 하나를 믿어도 되나" — 후보판·찾기 목록의 한 줄 뒤에 있는 추이를 안 떠나고 봅니다.

### 2.1 여는 곳

| 어디서 | 어떻게 |
|---|---|
| 후보판 (iframe `template.html`) | 단지 이름 옆 `상세` 버튼 → `parent.postMessage({kind:'board:open-complex', cx, area}, '*')`. 버튼은 `PROFILE.detail` 가 참일 때만 그림 — `boardDoc.ts` 가 사이트 문서에만 `detail: true` 를 넣음 (아티팩트판에는 버튼이 없음). 새 자리표시자는 만들지 않음 |
| 전월세 찾기 ③ 목록 | 단지 이름을 버튼으로 → `openComplexDetail(row.cx, row.area)` |
| 동네 시세판 (B) | 동 펼침 안 단지 줄 → `onOpenComplex(cx, area)` prop (App.tsx 가 `openComplexDetail` 로 이음) |

`openComplexDetail(cx, area?)` 는 `window.dispatchEvent(new CustomEvent('complex:open', {detail:{cx, area}}))` — `HandbookDrawer` 의 `handbook:open` 과 같은 패턴. `BoardFrame` 은 `message` 이벤트에서 `e.source === iframe.contentWindow && e.data?.kind === 'board:open-complex'` 만 받습니다.

### 2.2 계산 — `src/rentfinder/complex.ts` (순수 TS)

```ts
export interface ComplexDetail {
  cx: string; name: string; umd: string; region: string; built: number;
  area: number;                       // 고른 평형 (없으면 거래 최다 평형)
  sale: { q: number; n: number; price: number }[];     // MARKET 같은 칸, 2016~ 전부
  jeonse: { q: number; n: number; deposit: number }[]; // COMPLEXES trend, 8분기
  ratioSeries: { q: number; ratio: number; thin: boolean }[]; // 두 점이 다 있는 분기만
  headline: { recent: RecentJeonse; safety: JeonseSafety | null; ratio: number | null }; // 후보판과 같은 규칙
  sizes: SizeRow[];                   // 두 스냅샷 평형의 합집합, 면적 오름차순
  recentQuarters: { q: number; sale?: {n, price}; jeonse?: {n, deposit} }[]; // 최근 6분기 — "최근 거래" 는 이것
  signals: MaturityItem[] | null;     // signals.rows[`${cx}_${area}`].upcoming → 월 축, null = 감시 밖/서버 없음
  missing: ('sale' | 'rent')[];       // 한쪽 스냅샷에 없을 때
}
export interface SizeRow { area: number; sale: {price, n} | null /* 최근 4분기 가중중위 */; jeonse: {deposit, n} | null /* 2년 중위 */;
  wolse: {deposit, rent, n} | null; ratio: number | null; renewalShare: number | null; lastYm: string | null }
export function complexDetail(cx: string, area?: number, signals?: BoardSignals | null): ComplexDetail | null
export function pickArea(cx: string): number | null   // 전월세 거래 최다 평형, 없으면 매매 최다(mainSize)
```

- `headline` 은 **직접 계산하지 않고** `recentJeonse()`(boardRow.ts) 와 `jeonseSafety()`(safety.ts) 를 부릅니다. 후보판 줄과 숫자가 어긋나면 "어느 쪽이 맞나" 가 됩니다.
- `ratioSeries` 는 분기마다 `jeonse.deposit ÷ sale.price`, 양쪽 `n`≥1 이면 내고 어느 쪽이든 `n`<3 이면 `thin`.
- 매매 짝은 `MARKET` 에서 같은 `id`, 평형 ±2㎡ 중 가장 가까운 것.

테스트 (`rentfinder/__tests__/complex.test.ts`):
1. 후보판 전세 줄 아무거나 → `headline.ratio` 가 `BOARD_SNAPSHOT` 그 줄의 `ratio` 와 같다 (소수 6자리).
2. `ratioSeries` 의 모든 분기는 `sale`·`jeonse` 양쪽에 점이 있다; 한쪽 `n`<3 이면 `thin`.
3. 매매 스냅샷에만 있는 단지(부산 id) → `missing` 에 `'rent'`, `jeonse`·`ratioSeries` 빈 배열, 예외 없음. 거짓 id → `null`.
4. `sizes` 는 면적 오름차순이고 두 스냅샷 평형이 모두 들어간다.
5. `signals` 없음 → `null`; 있고 줄 id 가 없음 → 빈 배열(`[]`) — "없음" 과 "모름" 을 가른다.
6. `pickArea` 는 전월세 거래가 가장 많은 평형이다.

### 2.3 화면 — `src/rentfinder/ComplexDetailDrawer.tsx`

`export function ComplexDetailDrawer()` · `export function openComplexDetail(cx, area?)`. `fixed right-0`, 폭 `max-w-[40rem]`, ESC·바깥 클릭으로 닫힘, `no-print`. 신호는 `fetch('signals.json')` 1.5초 제한(`BoardFrame` 과 같은 규칙) — 패널을 열 때 한 번.

위에서 아래로:
1. 머리 — 이름 · 동 · 준공 · 평형 선택(세그먼트) · `missing` 경고.
2. **추이 SVG** — `MarketPage` 의 `Series` 처럼 자체 SVG(recharts 안 씀). 매매 전 구간(2016~) 선 + 전세 8분기 선을 같은 분기 축에. `n`<3 점은 빈 원. 축 아래 "분기 중위 · 거래 n건" 범례.
3. **전세가율 추이** — 작은 막대 8개, 60·70·80% 가로선(`SAFETY_RULES.ratioCuts`). 머리 숫자는 `headline.ratio` + "후보판과 같은 계산".
4. **평형별 표** — `sizes`. 열: 전용(평·공급 약) · 매매 최근1년(n) · 전세 2년(n) · 월세(n) · 전세가율 · 갱신비율 · 마지막 거래.
5. **최근 6분기** — 분기별 매매·전세 중위와 건수. 제목을 "최근 거래" 가 아니라 **"최근 분기"** 로 — 개별 거래는 자료에 없습니다.
6. **전세 만기 타임라인** — 이번 달~+6개월 가로축, `upcoming` 을 점으로(갱신 끝남은 진한 색), 층 표기. `signals === null` 이면 섹션 자체를 생략(요구사항), `[]` 면 "6개월 안 만기 없음".
7. 못 말하는 것 — 동·호수 없음 / 근저당 없음 / 매물 아님 / 분기 중위라 층·향 섞임.

## 3. B 동네 시세판 — 동별 한 표

**묻는 것:** "어느 동네에서 찾나" — ③ 발굴의 지역 필터와 ④ 전세·월세 선택을 바꾸는 표입니다.

### 3.1 위치

`OptionalStep` 에 `'town'` ("동네 시세판 — 동별 전세·매매·전세가율") 추가. 컴포넌트 `src/rentfinder/TownBoardPage.tsx`, prop `onOpenComplex?: (cx: string, area?: number) => void`.

### 3.2 계산 — `src/rentfinder/town.ts` (순수 TS)

```ts
export interface TownRow {
  key: string; label: string; regionCode: string; umd: string | null;   // level='sgg' 면 umd=null
  complexes: number; jeonseDeals2y: number; wolseDeals2y: number;
  jeonsePerSqm: { v: number; n: number } | null;   // 최근 4분기(전세 창) trend 점의 deposit/area 를 건수 가중 중위
  salePerSqm:   { v: number; n: number } | null;   // 최근 4분기(매매 창) 점의 price/area 를 건수 가중 중위
  ratio:        { v: number; cells: number } | null;   // 칸별 (최근 전세 ÷ 최근 4분기 매매 가중중위) 의 중위, 칸≥3
  jeonseDealsChange: { recent: number; prior: number; change: number | null };   // 전세 창
  saleDealsChange:   { recent: number; prior: number; change: number | null };   // 매매 창, 이전 창 <10 이면 change null
  salePrice1y:  { v: number; cells: number } | null;  // 같은 칸 q 대 q−4 가격비 중위, 마지막 완결 분기 기준, 칸≥5
  jeonse1y:     { v: number; cells: number } | null;  // 같은 칸 보증금 q 대 q−4, 칸≥5
  newShare:     { v: number; deals: number } | null;  // 전월세 2년 거래 중 준공 ≤5년(asOf 연도−5 이상) 단지 거래 비중
  windows: { sale: string; rent: string };           // "2025Q3~2026Q2 대 2024Q3~2025Q2"
}
export function townRows(opts: { regionCodes: string[]; level: 'umd' | 'sgg' }): TownRow[]
export function townComplexes(regionCode: string, umd: string): { cx, name, built, sizes: SizeRow-유사 }[]  // 동 펼침
export const TOWN_CAVEATS: string[]
```

- 동 이름은 두 스냅샷 모두 `umd` 가 같은 표기(`내서읍 상곡리`)라 `regionCode+umd` 로 붙입니다. 매매에만 있는 동은 전세 칸이 `null`, 전세에만 있는 동은 매매 칸이 `null` — 둘 다 표에 남깁니다.
- ㎡당 중위를 쓰는 이유: 동마다 평형 구성이 달라 보증금 중위를 그대로 견주면 "큰 집이 많은 동이 비싼 동" 이 됩니다. 평형대 열은 두지 않습니다(§5).
- `engine/temperature.ts` 의 `saleTemperature()`(§4) 를 **그대로 불러** 매매 쪽 거래량·1년 변화·신축 비중을 냅니다 — 같은 계산을 두 곳에 두지 않습니다.

테스트 (`rentfinder/__tests__/town.test.ts`):
1. 마산회원 `level:'umd'` 에 `내서읍 삼계리`·`양덕동` 줄이 있고 `complexes` 가 양쪽 스냅샷 합집합과 같다.
2. `ratio.cells` <3 이면 `ratio` 가 `null` 이다 (인위적 작은 동으로).
3. 거래량 창이 §1.2 와 같다 — `windows.rent` 가 `'2025Q4~2026Q3 대 2024Q4~2025Q3'`, `windows.sale` 이 `'2025Q3~2026Q2 대 2024Q3~2025Q2'` (스냅샷 `range.to` 에서 계산되므로 스냅샷을 갈면 같이 움직임).
4. `salePrice1y` 는 가격 **비율의 중위**이지 수준 차가 아니다 — 모든 칸 가격을 2배 하면 값이 불변.
5. `newShare` 는 0~1, 분모는 전월세 2년 거래 수.
6. `level:'sgg'` 줄의 `jeonseDeals2y` 는 그 구 `umd` 줄들의 합이다.
7. `TOWN_CAVEATS` 에 "매물 아님"·"월세 추이 없음" 문구가 있다.

### 3.3 화면 — `src/rentfinder/TownBoardPage.tsx`

- 위: 범위 칩 [마산회원·합포(기본)] [창원 5구] [+함안·의령], 수준 [동] [구].
- 표: 열 머리 클릭 정렬(기본 전세 2년 거래 수 내림차순). 숫자 셀 `tabular-nums`, 모든 값 옆 `(n)`.
- 색 칸 — 규칙이 있는 것만: 전세가율은 `ratioCuts` 60·70·80 으로 4단, 1년 변화·거래량 변화는 부호(＋청록 / −장미), `null` 은 회색 `—`. 신축 비중·㎡당 가격은 색 없음(좋고 나쁨이 없는 값).
- 동 줄 클릭 → 아래로 펼쳐 `townComplexes()` 목록(이름·준공·평형·최근 전세·전세가율) → `onOpenComplex`.
- 발굴로 잇기: 동 펼침 머리에 "이 구에서 발굴하기 →" (구 코드로 `rent` 단계 이동은 App.tsx 가 `onDiscover?(regionCode)` 로 이어 주며, 이번엔 **구 단위**까지만 — `discover()` 에 동 필터를 넣는 건 boardRow.ts 를 건드려 갈래 경계를 넘으므로 뺍니다).
- 하단 "이 자료가 못 하는 것": 매물·호가 없음 / 월세는 2년 중위뿐 추이 없음 / 공급면적 추정 / 학군·교통 없음(§5) / 창 어긋남(매매 Q2·전세 Q3).

## 4. C 시장 온도 — 판단지표 대체, 합산 없음

**묻는 것:** "지금 전세로 버티나, 매수 쪽으로 기우나" 의 **방향**만. 부동산원 심리·수급지수는 호가·설문이라 재현 불가능하고, 우리가 가진 실거래로 되는 축만 나란히 둡니다.

### 4.1 위치

`pages/MarketPage.tsx` 맨 위 카드 `TemperatureCard` (`src/pages/TemperatureCard.tsx`). 기존 검색·백테스트 카드는 아래 그대로.

### 4.2 계산

**매매 축 — `src/engine/temperature.ts`** (engine 규율: React·rentfinder import 없음)

```ts
export interface SaleTemperature {
  deals: { recent: number; prior: number; change: number | null; series: { q: number; n: number }[] /* 최근 12분기 */ };
  price1y: { v: number; cells: number } | null;   // 같은 칸 q 대 q−4 가격비 중위 (lastCompleteQ 기준), 칸≥5
  newShare: { v: number; deals: number } | null;  // 최근 4분기 매매 거래 중 준공 ≤5년 단지 비중
  window: { recent: [number, number]; prior: [number, number]; label: string };
}
export function lastCompleteQ(rangeTo: string, baseYear: number): number
export function saleTemperature(complexes: MarketComplex[], opts?: { asOfQ?: number }): SaleTemperature
export function districtTemperature(code: string): SaleTemperature          // 15개 시군구
export function regionTemperature(region: RegionId): SaleTemperature
export const TEMPERATURE_CAVEATS: string[]
```

**전세 축 — `src/rentfinder/town.ts` 에 같이** (마산 스냅샷을 아는 쪽)

```ts
export function jeonseRatioSeries(regionCodes: string[]): { q: number; ratio: number | null; cells: number }[]  // 8분기, 칸≥8
export function jeonseTemperature(regionCodes: string[]): { deals: {...}; jeonse1y: {...} | null; ratioLatest: {...} | null; series }
```

테스트 (`engine/__tests__/temperature.test.ts`):
1. `lastCompleteQ('202608', 2000)` = 105, `('202609', 2000)` = 106, `('202612', 2000)` = 107.
2. `change` 는 `recent/prior − 1`, `prior` <10 이면 `null`.
3. `price1y` 는 비율 중위 — 전 칸 2배에 불변; 칸 <5 → `null`.
4. 결과 객체에 `score`·`total`·`index`·`temperature` 숫자 필드가 **없다** (rating.ts 테스트와 같은 금지).
5. `districtTemperature` 가 15개 시군구 모두에서 예외 없이 돈다.
6. `TEMPERATURE_CAVEATS` 에 "신고 지연"·"호가 없음" 문구.

### 4.3 화면 — `src/pages/TemperatureCard.tsx`

줄 = 시군구. 창원 5구 + 함안·의령(전세 축만, 참고) + 부산·경기 10구(매매 축만, 전세 열은 "자료 없음"). 열:

| 거래량 12분기 스파크 + 최근4Q/이전4Q | 매매 1년 변화 (칸) | 전세 1년 변화 (칸) | 전세가율 8분기 스파크 + 최근값 (칸) | 신축 비중 |

- 색은 부호와 `ratioCuts` 만. **줄 합계·종합 온도 없음** — 제목 옆에 "축마다 따로 읽습니다" 를 적습니다.
- 각 열 머리에 `ƒ` 팝오버(`InfoPopover`)로 식과 창 라벨.
- 하단 **"이 자료가 못 하는 것"** (`TEMPERATURE_CAVEATS` + `TOWN_CAVEATS` 중 전세 항목):
  - 호가·매물·심리가 없다 — 실거래는 체결 뒤 30일 안 신고라 **최근 분기는 늘 적게 잡힌다** (마지막 완결 분기까지만 쓰는 이유).
  - 미분양·입주 물량이 없다 (`supply.ts` 대리지표는 분양권 거래 기반, 여기 섞지 않음).
  - 전세 축은 창원·함안·의령 2년치뿐 — 추세라기엔 짧다. 부산·경기는 매매만.
  - 분기 중위라 층·향·수리 상태가 섞인다. 지수가 아니다(연쇄 드리프트 없음 대신 구성 편차 있음).
  - 금리 국면이 바뀌면 전세가율은 상수가 아니다 (`rent.ts` 경고 재사용).

## 5. D 오늘 볼 것 — 첫 화면 카드

**묻는 것:** "오늘 아침에 뭘 봐야 하나" — 네 줄, 누르면 그 화면.

### 5.1 위치·동작

`src/pages/TodayCard.tsx` · `export function TodayCard({ onGo }: { onGo: (t: TodayTarget) => void })` · `export type TodayTarget = 'board' | 'town' | 'subscription' | 'market'`. App.tsx 가 `<main>` 맨 위에 모든 탭에서 그립니다. 접기 버튼 → `localStorage['today-folded'] = 'YYYY-MM-DD'` 로 그날만 접히고, 머리줄 "오늘 볼 것" 버튼이 다시 폅니다. 인쇄 제외(`no-print`).

### 5.2 계산 — `src/rentfinder/today.ts` (순수 TS, 입력을 전부 받음)

```ts
export interface TodayItem { key: 'signals' | 'shortlist' | 'notices' | 'temperature'; title: string; line: string; detail: string[]; target: TodayTarget; muted: boolean }
export function todayItems(input: {
  signals: BoardSignals | null;                 // fetch 결과, 없으면 null
  excluded: Record<string, unknown>;            // 후보판 LS `masan-jeonse-board-v2`.excluded, 없으면 BOARD_SNAPSHOT.seed.jeonse.excluded
  today: string;                                // 'YYYY-MM-DD'
}): TodayItem[]
```

| 항목 | 계산 | 문구 예 | 이동 |
|---|---|---|---|
| 전세 신호 | 소거 안 한 전세 줄 중 `upcoming.gap ≤ windowMonths` 건수·그중 `locked`·`recent` 건수. `signals` 가 `null` 이면 `muted` | "3개월 안 만기 4건 (갱신 끝남 2) · 새 계약 1 — 기준 09-27" / "서버판에서만 — 신호 파일 없음" | board |
| 남은 후보 상위 | 소거 안 한 전세 줄을 `rank` 순 3개, 판정 라벨 | "1 푸르지오더플래티넘1단지 84 (B) · 2 … " | board |
| 청약 새 공고 | 권역별 `NOTICES` 최신 `noticeDate`; `APPLYHOME.asOf` 기준 30일 안이면 그 공고들, 아니면 "N일째 없음" (SubscriptionPage 의 45일 규칙과 같은 자료) | "경기 1건 (09-04 시흥 은계…) · 부산 38일째 없음 · 창원 52일째 없음" | subscription |
| 시장 온도 한 줄 | `jeonseTemperature(['48127','48125'])` + `saleTemperature(마산회원·합포 단지)` | "마산 매매 거래 −12% · 전세가율 71% (↑1.5%p) · 전세 1년 +3.2%" | market |

소거 LS 키는 `template.html` 의 `MODES.jeonse.ls` 와 같은 문자열 — **LS 읽기는 화면(TodayCard)에서** 하고 순수 함수에는 값만 넘깁니다. 같은 출처(srcdoc)라 부모가 읽을 수 있습니다.

테스트 (`rentfinder/__tests__/today.test.ts`):
1. `signals: null` → 전세 신호 항목이 `muted` 이고 나머지 셋은 정상.
2. 소거한 줄은 "남은 후보" 와 신호 건수에서 빠진다.
3. 신호 건수는 `gap ≤ windowMonths` 만 센다(4~6개월은 뒤 문구로).
4. 새 공고는 `asOf` 기준 30일 안만; 없으면 "N일째" 가 `asOf − 최신공고일` 과 같다.
5. 항목이 늘 4개이고 순서가 고정.

### 5.3 신호 파일 — `src/rentfinder/signals.ts`

`export function fetchSignals(timeoutMs = 1500): Promise<BoardSignals | null>` — `BoardFrame` 의 fetch 규칙(동일 출처 `signals.json`, no-store, `isBoardSignals` 검증, 시간 초과 시 `null`) 을 함수로 뺀 것. TodayCard·ComplexDetailDrawer 가 씁니다. BoardFrame 은 이번엔 손대지 않습니다(갈래 경계).

## 6. 배너 — `src/components/PrototypeBanner.tsx`

`import.meta.env.VITE_PROTOTYPE === '2'` 일 때만 그립니다(아니면 `null`). 머리줄 맨 위 한 줄 + 펼치면 4줄, 세션 동안 접힘(`sessionStorage`). `src/vite-env.d.ts` 가 없으면 `/// <reference types="vite/client" />` 한 줄 추가. 운영 빌드(`npm run deploy:realty`)는 변수가 없어 안 나옵니다 — 테스트: 변수 없이 `PrototypeBanner` 가 빈 렌더.

**문구 초안**

```
prototype2 — 바뀐 것 4가지 · 운영 사이트(/hyrealty/)에는 없습니다 · 자료 기준 매매 2026-08 · 전월세 2026-09
① 단지 이름 → 상세 패널: 같은 단지·평형의 매매·전세 분기 추이, 전세가율, 평형별 표, 전세 만기 (후보판·찾기·시세판 어디서든)
② 동네 시세판: 마산회원·합포(창원 5구까지) 동별 ㎡당 전세·매매 중위, 전세가율, 거래량·1년 변화, 신축 비중 — 열을 눌러 정렬
③ 시장 온도: 구별 거래량 추세·매매/전세 1년 변화·전세가율 추이를 나란히 — 합산 점수는 일부러 없습니다 (실거래 수익률 탭 맨 위)
④ 오늘 볼 것: 전세 신호·남은 후보·새 공고·시장 온도 한 줄 — 누르면 그 화면으로 (하루 한 번 접힘)
```

## 7. 넣지 않을 것과 이유

| 뺀 것 | 이유 — "행동을 바꾸는가" |
|---|---|
| 종합 온도·동네 점수 | 합산 금지. 거래량 ↓ 와 전세가율 ↑ 는 해야 할 일이 반대인데 한 숫자가 되면 둘 다 지워집니다 |
| 지도 히트맵(호갱노노식) | 타일 추가 = HTML 수 MB. 후보판 지도가 이미 위치를 보이고, 동별 표가 같은 정보를 더 적은 바이트로 답합니다 |
| 학군·교통·상권 점수 | 자료가 없습니다. 후보판 인프라 축(OSM 시설 수)이 이미 그 자리이고 의원 누락 문제가 큽니다 |
| 개별 실거래 목록 | 스냅샷이 분기 중위로 접혀 있어 **없습니다**. 수집기를 바꾸면 되지만 44만 건을 인라인하면 로딩이 깨집니다. "최근 분기" 로 대체 |
| 평형대별(59·84) 동 시세 열 | 동 × 평형대면 칸 대부분이 3건 미만 — 없는 정확도를 만듭니다. ㎡당 중위 + 단지 펼침으로 대신 |
| R114식 수익률 순위·전망 | 백테스트가 이미 "공통점의 절반은 시기였다" 고 답했습니다(재현율 52%). 전망은 도구가 "오릅니다" 라고 말하는 것 |
| 심리·수급·매물 지수 | 호가·설문 자료가 없고 크롤링은 금지. 못 하는 것을 못 한다고 적는 쪽이 맞습니다 |
| 부산·경기 동네 시세판 | 전월세 스냅샷이 마산권만. `rent-2026-08.json` 은 시군구 비율 집계라 동별이 안 됩니다. 매매 축만 C 에 |
| 알림·푸시 | 메일이 이미 매일 갑니다. 화면은 메일과 같은 `signals.json` 을 읽는 데까지 |
| 상세 패널 안 대출 계산 | 후보판 대출 칸과 찾기 ④ 가 이미 그 자리. 세 번째로 두면 어느 숫자가 맞나가 됩니다 |
| 발굴의 동 단위 필터 | 쓸모는 있으나 `boardRow.ts` 를 건드려 갈래 경계를 넘습니다. 다음 라운드 |

**자료가 못 말하는 것 (모든 새 화면 하단에 붙는 문구의 원천):** 매물·호가 · 동호수 · 근저당 · 리모델링 · 방 개수 · 개별 거래가 · 월세 추이 · 2024Q4 이전 전세 · 신고 지연(최근 분기 과소) · 부산·경기 전세 동별.

## 8. 두 갈래 작업 지시

**같은 파일을 두 갈래가 고치지 않습니다.** 아래 표가 소유권이고, 상대 갈래 것은 import 만 합니다. 서로 필요한 이름은 §8.3 계약으로 못 박습니다.

### 8.1 갈래 1 — 단지 상세 · 후보판 · 통합

| 파일 | 작업 |
|---|---|
| `simulator/src/rentfinder/complex.ts` | 신규 — §2.2 |
| `simulator/src/rentfinder/__tests__/complex.test.ts` | 신규 — §2.2 테스트 6건 |
| `simulator/src/rentfinder/ComplexDetailDrawer.tsx` | 신규 — §2.3. `openComplexDetail` export |
| `simulator/src/rentfinder/board/template.html` | 이름 칸에 `상세` 버튼(`PROFILE.detail` 일 때만) + `postMessage`. 고친 뒤 `node ../scripts/board/sync-template.mjs` (`template.ts` 자동 생성 — 직접 편집 금지) |
| `simulator/src/rentfinder/board/boardDoc.ts` | `profile` 객체에 `detail: true` (사이트 문서) — 새 자리표시자 없음 |
| `simulator/src/rentfinder/BoardFrame.tsx` | `message` 수신 → `openComplexDetail` |
| `simulator/src/rentfinder/RentFinderApp.tsx` | ③ 목록 단지 이름 → 버튼 → `openComplexDetail(row.cx, row.area)` |
| `simulator/src/App.tsx` | (1) `<ComplexDetailDrawer />` 를 `<HandbookDrawer />` 옆에 장착. (2) **갈래 2 머지 뒤** 통합: `OPTIONAL_STEPS` 에 `town` 추가 + `<TownBoardPage onOpenComplex={openComplexDetail} />`, `<main>` 맨 위 `<TodayCard onGo={...} />` (board→tab subscription+step board, town→step town, subscription→step subscription, market→tab market), 머리줄 `<PrototypeBanner />` + "오늘 볼 것" 펴기 버튼 |

순서: A 를 먼저 끝내고 커밋(App.tsx 는 서랍 장착만) → 갈래 2 가 머지되면 통합 커밋. 통합 전까지 갈래 2 의 새 화면은 고아라 `scorecard` 고아 검사가 실패하는 것이 **정상**이고, 통합 커밋에서 풀립니다.

끝에 돌릴 검사:
```bash
cd simulator && npx tsc --noEmit -p . && npx vitest run && node ../scripts/board/sync-template.mjs && git diff --quiet src/rentfinder/board/template.ts
```
(마지막은 sync 를 이미 돌렸다는 확인 — 바뀌면 안 돌린 것.) 통합 커밋 뒤에는 `npm run scorecard` 까지.

### 8.2 갈래 2 — 동네 시세판 · 시장 온도 · 오늘 볼 것 · 배너 · 빌드

| 파일 | 작업 |
|---|---|
| `simulator/src/engine/temperature.ts` | 신규 — §4.2 매매 축. engine 규율(React·rentfinder import 금지) |
| `simulator/src/engine/__tests__/temperature.test.ts` | 신규 — §4.2 테스트 6건 |
| `simulator/src/rentfinder/town.ts` | 신규 — §3.2 + §4.2 전세 축 |
| `simulator/src/rentfinder/__tests__/town.test.ts` | 신규 — §3.2 테스트 7건 |
| `simulator/src/rentfinder/today.ts` · `__tests__/today.test.ts` | 신규 — §5.2 |
| `simulator/src/rentfinder/signals.ts` | 신규 — §5.3 |
| `simulator/src/rentfinder/TownBoardPage.tsx` | 신규 — §3.3 |
| `simulator/src/pages/TemperatureCard.tsx` | 신규 — §4.3 |
| `simulator/src/pages/TodayCard.tsx` | 신규 — §5.1 |
| `simulator/src/components/PrototypeBanner.tsx` | 신규 — §6 |
| `simulator/src/vite-env.d.ts` | `import.meta.env` 타입이 없으면 신규 |
| `simulator/src/pages/MarketPage.tsx` | 맨 위에 `<TemperatureCard />` |
| `simulator/package.json` | `"deploy:realty-p2": "npm run build && node scripts/build-standalone.mjs --full && mkdir -p ../realty-p2 && cp dist/realty.html ../realty-p2/index.html"` |
| `scripts/deploy-aws.sh` | `DEPLOY_BUILD_SCRIPT`(기본 `deploy:realty`) · `DEPLOY_ARTIFACT`(기본 `realty/index.html`) 환경변수화. `DEPLOY_SITE_PATH` 가 `hyrealty` 가 아니면 서버에서 `sudo ln -sfn ../hyrealty/signals.json "$TARGET/signals.json"` — p2 도 같은 신호를 읽게 |
| `.gitignore` | `realty-p2/` (산출물은 커밋하지 않음 — GitHub Pages 는 운영만) |
| `scripts/scorecard.mjs` | "계산이 UI 를 모름" 의 `pure` 목록에 `src/rentfinder/town.ts`·`complex.ts`·`today.ts` 추가 |

p2 배포 명령 (문서에만, 실행은 사용자):
```bash
VITE_PROTOTYPE=2 DEPLOY_BUILD_SCRIPT=deploy:realty-p2 DEPLOY_ARTIFACT=realty-p2/index.html DEPLOY_SITE_PATH=hyrealty-p2 ./scripts/deploy-aws.sh
```
배포 전 `.claude/launch.json` 의 `built-realty` 처럼 `realty-p2/` 를 정적으로 띄워 `#root` 가 채워지는지 봅니다 — 크기만 보고 배포해 백지를 올린 전력이 있습니다.

끝에 돌릴 검사:
```bash
cd simulator && npx tsc --noEmit -p . && npx vitest run
```
(`template.html` 을 안 건드리므로 sync 불필요. 고아 검사는 갈래 1 통합 뒤에 통과.)

### 8.3 갈래 사이 계약 (이름·시그니처를 바꾸면 상대가 깨짐)

| 제공 | 이름 | 쓰는 쪽 |
|---|---|---|
| 갈래 2 | `TownBoardPage({ onOpenComplex?: (cx: string, area?: number) => void; onDiscover?: (regionCode: string) => void })` — `src/rentfinder/TownBoardPage.tsx` | 갈래 1 App.tsx |
| 갈래 2 | `TodayCard({ onGo: (t: TodayTarget) => void })`, `type TodayTarget = 'board' \| 'town' \| 'subscription' \| 'market'` — `src/pages/TodayCard.tsx` | 갈래 1 App.tsx |
| 갈래 2 | `PrototypeBanner()` — `src/components/PrototypeBanner.tsx` | 갈래 1 App.tsx |
| 갈래 2 | `fetchSignals(timeoutMs?)` — `src/rentfinder/signals.ts` | 갈래 1 ComplexDetailDrawer (갈래 2 머지 전에는 BoardFrame 과 같은 fetch 를 패널 안에 임시로 두고, 통합 커밋에서 `fetchSignals` 로 바꿈) |
| 갈래 2 | `saleTemperature`, `lastCompleteQ` — `src/engine/temperature.ts` | 갈래 2 내부(town.ts) |
| 갈래 1 | `openComplexDetail(cx, area?)`, `ComplexDetailDrawer` — `src/rentfinder/ComplexDetailDrawer.tsx` | 갈래 1 App.tsx 만. 갈래 2 는 import 하지 않고 prop 으로 받음 |
| 양쪽 공통(기존) | `recentJeonse`(boardRow.ts) · `jeonseSafety`·`SAFETY_RULES`(safety.ts) · `MARKET`·`THIN_DEAL_COUNT`(market.ts) · `COMPLEXES`·`RENT_REGIONS`(data.ts) · `BOARD_SNAPSHOT`·`BoardSignals`·`isBoardSignals`(boardDoc.ts) · `NOTICES`·`APPLYHOME`(applyhome.ts) · `InfoPopover`·`Card`·`Badge`·`Foldable`(components/ui.tsx) | 읽기만, 고치지 않음 |

커밋 메시지·주석·문구는 한국어. 금액은 `engine/format.ts` 의 `money()`·`percent()`.
