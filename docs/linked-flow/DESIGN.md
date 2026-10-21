# 연결된 물건 흐름 설계서 — 시중 물건 고르기 · 자동 점수 · 섹션 연결

> 브랜치 `linked-flow` · 작성 2026-10-22 · 코드 없음, 설계만. 두 갈래가 이 문서만 보고 병렬 구현합니다 (§6).
> 요청: "시중 물건을 고르면 프로그램 기준으로 점수를 매기고 필요하면 고치게. 그 점수 항목이 가격 차트·대출상품·왜 그 가격인지·수익률과 전부 연결되게. 필요하면 UI 도 그 흐름으로 재구성."
> 전제(바뀌지 않음): 상시 탭 6개(`TabId` 유니온 그대로) · 엔트리 하나 · 외부 요청 0건 · 정책 수치는 JSON · `engine/` 은 React 를 모름 · 점수 합산 금지 · 부정적 결과 숨기지 않기 · 글자 12/13/14px 규칙(`docs/ui-refresh`) · 채점표 100점 유지(특히 `MarketPage` 의 `useStore()`+"등록한 물건에서", `ComparePage` 의 `<HandbookLink id={r.productId}`).

---

## 0. 진단 — 지금 끊겨 있는 곳 (코드로 확인)

| # | 사실 | 근거 |
|---|---|---|
| 1 | 물건은 **손으로만** 만듭니다. 실거래 스냅샷(3,150단지)과 `Property` 사이에 id 연결이 없어, 실거래 탭은 **이름으로 검색어만** 채웁니다 | `PropertiesPage.tsx:137-178` · `MarketPage.tsx:646-665` `setQuery(p.name)` |
| 2 | 미입력 지표에 `defaultRaw`(중간값)가 **조용히** 들어가 점수가 됩니다. 25개 중 손으로 안 넣은 것이 많을수록 "입지 68점" 은 중간값의 가중합입니다 | `scoring.ts:377-402` |
| 3 | 실측 신호는 2개만, 그것도 "어긋날 때만" 옆에 붙습니다(공급·인구). 준공연도는 자동이지만 출처 표시가 없습니다 | `PropertiesPage.tsx:415-530` |
| 4 | 화면마다 물건을 **따로** 고릅니다 — 매트릭스는 행, 3-way 는 셀렉트(`propertyId` 로컬 state), 실거래는 검색. 한 물건을 축으로 네 화면을 오가는 길이 없습니다 | `TenurePage.tsx:599-607` · `ComparePage.tsx:38` |
| 5 | "왜 그 가격인지" 를 답하는 계산이 없습니다. `propertyThesis` 는 성격(신축/재건축/애매)만, 같은 구·같은 평형대 안에서 이 가격이 어디쯤인지는 없습니다 | `thesis.ts` |

### 0.1 쓸 수 있는 자료 (항목별 자동 산정의 경계)

| 자료 | 있는 것 | 없는 것 |
|---|---|---|
| `market-2026-08.json` (15개 구, 3,150단지) | 단지 `id`·`name`·`umd`·`regionCode`·`buildYear`(전부 있음) · 평형(정수 ㎡) · 분기 `{q,n,price}` | **세대수** · 동·호수 · 주차·용적률·브랜드 |
| `board-2026-09.json` (마산 55단지 125줄) | `counts{walk,pet,shop,med,bus,life}`(반경 내 OSM 시설 수) · `auto`(후보끼리 5분위, `med` 는 `null`) · `min`·`km`(함안의령지사까지 OSRM 도로 최소시간) | 창원 성산·의창·진해, 부산, 경기는 **없음** |
| `presale-2026-08.json` → `supply.ts` | 시군구별 미준공 단지 비율 → `supplyFeedback(sigungu).suggestedScore` | 세대수·입주시기 |
| `population.json` → `population.ts` | 권역(시도) 단위 10년 인구 → `populationScale5` | 시군구 |
| `rules.appraisal.districtTierReference` | 창원 생활권 티어 참고표(용호동 5 · 가음정 4 · 상남·중앙 4 · 그 외 성산·의창 3 · 마산·진해 2) | 부산·경기 |
| `rent-2026-08.json` · `masan-rent-2026-09.json` | 구 단위 전세가율(3권역) · 창원 단지·평형 단위 전세가율(`complex.ts`) | 부산·경기 단지 단위 |
| 어디에도 없음 | 지하철·GTX 도보분, 학교 배정·학원가, 종합병원, 브랜드, 주차, 향·평면, 용적률, 재건축 단계, 개발 호재, 세대수 | → **"자료 없음 — 직접 입력"** |

---

## 1. 시중 물건 고르기 — `Property` 에 스냅샷 고리를 답니다

### 1.1 모델 (`engine/types.ts`)

```ts
export interface Property {
  …기존 필드 그대로…
  /** 실거래 스냅샷의 단지·평형. 있으면 "시중 물건". 손 입력 물건은 undefined */
  link?: { complexId: string; area: number };
  /** 자동 점수 적용 여부. 고르기로 만든 물건은 true, 손 입력은 "자동 채우기" 를 눌러야 true */
  autoFill?: boolean;
  /** 매매가를 어디서 가져왔나 — 사용자가 price 를 고치면 그대로 둔 채 화면이 "직접 수정" 으로 표시 */
  priceBasis?: { price: number; window: string; n: number; thin: boolean };
}
```

- `scores` 의 뜻은 바뀌지 않습니다: **사용자가 직접 넣은 값만** 들어 있습니다. 자동값은 저장하지 않고 매번 스냅샷에서 다시 냅니다 → 되돌리기 = `delete scores[id]`, 스냅샷을 갱신하면 자동값도 따라옵니다.
- 기존 localStorage 물건은 새 필드가 전부 optional 이라 그대로 읽힙니다. `autoFill` 이 없으면 **지금과 완전히 같은 점수**가 나옵니다 (기존 테스트 전부 보존).

### 1.2 고르기 계산 — `engine/pick.ts` (새 파일, 순수 TS)

```ts
export interface PickDraft {
  name: string; region: RegionId; sigungu: string;        // MARKET.regions[code] → label·region
  areaSqm: number;                                        // 스냅샷 정수 ㎡ (반올림된 값임을 화면에 적음)
  builtYear: number;                                      // buildYear
  householdCount: 0;                                      // 자료 없음 — 0 으로 두고 화면이 "직접 입력" 요구
  price: number | null;                                   // 최근 4분기(마지막 완결 분기 기준) 거래 가중 중위
  priceBasis: { price: number; window: string; n: number; thin: boolean } | null;
  link: { complexId: string; area: number };
}
export function pickFromMarket(complexId: string, area: number): PickDraft | null;
export function pickCandidates(query: string, opts?: { region?: RegionId; districtCode?: string }): MarketComplex[]; // searchComplexes 위에 지역 필터
```

- 가격 묶음 규칙은 `rentfinder/complex.ts` 의 `pooled`(거래건수 가중 중위, `lastCompleteQ` 기준 4분기)와 **같은 규칙**입니다. `market.ts` 에 `pooledMedian(points, lastQ, quarters)` 를 공개하고 `pick.ts` 가 씁니다 (complex.ts 는 이번에 안 건드림 — 같은 값을 내는지 테스트로 대조).
- 4분기 합계 거래가 3건 미만이면 `thin: true` 로 내고, 화면은 가격을 채우되 amber 배지 "표본 n건" 을 숫자 옆에 붙입니다. 0건이면 `price: null` → 사용자가 넣어야 합니다.
- **면적 85㎡ 경계**: 스냅샷은 정수 반올림이라 84.97 → 85 입니다. 디딤돌 85㎡ 판정이 걸리는 84~86 구간은 힌트로 "등기부 전용면적으로 확인" 을 적습니다.

### 1.3 화면 — 물건 추가 두 갈래 (`pages/PropertiesPage.tsx` + 새 `pages/PropertyPicker.tsx`)

```
[＋ 시중 단지에서 고르기]  [＋ 직접 입력]  [샘플 불러오기]
```

고르기 패널(인라인, 모달 아님): 지역군 세그먼트(창원/부산/경기) → 시군구 셀렉트(`MARKET.regions`) → 단지 검색(`pickCandidates`) → 평형(거래 건수 표시, 기본 `mainSize`) → 미리보기 한 줄(최근 매매 중위 · n건 · 준공 · 전용) → **[이 물건으로 추가]** → `addProperty(draft)` 후 그 물건이 펼쳐지고 `focusPropertyId` 가 됩니다. 손 입력 물건에는 기본정보 칸 옆에 "실거래 단지와 잇기 ▸" 가 있어 같은 패널로 `link` 만 붙일 수 있습니다 (값은 덮지 않음, 고리만).

---

## 2. 자동 점수 — 항목마다 출처를 적고, 없는 것은 없다고 말합니다

### 2.1 계산 — `engine/autoScore.ts` (새 파일)

```ts
export type AutoStatus = 'measured' | 'proxy' | 'none';
export interface AutoIndicator {
  id: string;                 // INDICATORS 의 id — 25개 전부 들어 있어야 함 (테스트가 빠짐을 잡음)
  status: AutoStatus;
  raw?: number;               // 지표의 원래 단위로 낼 수 있을 때 (연도·단계·분)
  score?: number;             // 0~100 으로만 낼 수 있을 때 (대리지표). raw 와 둘 중 하나
  basis: string;              // "후보판 OSM 반경 800m 마트·시장 8곳 → 후보 55단지 중 상위 5분위" 처럼 근거 한 문장
  scope: string;              // '단지' | '시군구' | '권역' | '—'
  n?: number; thin?: boolean; // 표본 수·얇음
  caveat?: string;            // 그 축이 못 말하는 것 (SUPPLY_CAVEATS 류 한 줄)
}
export function autoIndicators(property: Property): AutoIndicator[];
```

| 항목 | 상태 | 어디서 | 비고 |
|---|---|---|---|
| 지하철역 도보 `subwayWalk` | none | — | 역 좌표 자료 없음 |
| GTX `gtx` | none | — | |
| BRT·간선버스 `brt` | proxy | 후보판 `auto.bus`(400m 정류장 수 5분위) → `(단계−1)/4×100` | 마산 55단지만. 분(分)이 아니라 상대 점수 |
| 간선도로 `arterialRoad` | none | — | IC 좌표 없음 |
| 본인 통근 `commuteSelf` | proxy | 후보판 `min`(함안의령지사 OSRM 도로 최소시간) → raw 분 | **직장이 함안의령지사일 때만** 뜻이 있어 basis 에 목적지를 적음. 신호·정체 제외 |
| 배우자 통근 `commuteSpouse` | none | — | |
| 서울 통근 `commuteSeoul` | none | — | 창원·부산은 가중치 0 |
| 고용중심지 `jobCenter` | none | — | |
| 초품아·중고·학원가 | none | — | 학교 자료 없음 |
| 대형마트 `mart` | proxy | 후보판 `auto.shop`(800m 마트·시장) | 마산 55단지만 |
| 종합병원 `hospital` | none | — | OSM `med` 는 `sparse`(의원 누락 40%↑) → 점수로 쓰지 않음 |
| 공원·녹지 `park` | proxy | 후보판 `auto.walk`(800m 공원·산책로) | 마산 55단지만 |
| 세대수 `householdCount` | none | — | **국토부 자료에 없음**. 0이면 화면이 "직접 입력" 을 요구하고 그때까지 가중치에서 제외(§2.3) |
| 준공연도 `builtYear` | measured | 스냅샷 `buildYear` → raw | 단지 단위 |
| 브랜드·주차·향·평면 | none | — | |
| 향후 공급 `futureSupply` | proxy | `supplyFeedback(sigungu).suggestedScore` | 시군구, 단지 수 기준·하한 (`SUPPLY_CAVEATS`) |
| 인구 추이 `populationTrend` | measured | `populationFeedback(region).suggested` → raw 단계 | **권역(시도)** 단위 — 같은 권역은 전부 같은 값 |
| 개발 호재 · 재건축 단계 · 용적률 | none | — | 건축물대장 API 미신청 |
| 생활권 티어 `districtTier` | proxy | `rules.appraisal.districtTierReference`(창원) — `umd` 가 용호동 → 5, 가음정·상남·중앙 → 4, 그 외 성산·의창 → 3, 마산·진해 → 2 | **합의된 주관 참고표**이지 실측이 아님을 basis 에 적음. 부산·경기 none |

> 25개 중 measured 2 · proxy 6 · none 17. 그래서 이 화면의 정직한 머리글은 "자동으로 채운 것 8 / 직접 넣을 것 17" 입니다 — 숫자를 감추지 않습니다.

### 2.2 점수에 넣는 규칙 — `engine/scoring.ts` 수정

```
resolveRaw(property, ind, auto):
  scores[id] 가 있으면            → 사용자값      source='user'
  else autoFill && auto.raw       → 자동 raw      source='measured'|'proxy'
  else autoFill && auto.score     → 정규화 생략, 그 점수 그대로   source='proxy'
  else                            → defaultRaw    source='default'   ← 지금과 같음
```

- `scoreProperty(property, auto = property.autoFill ? autoIndicators(property) : [])` — 두 번째 인자 기본값이라 `matrix.ts` 호출부는 안 바뀝니다. `autoFill` 이 없으면 결과가 **비트 단위로 지금과 같습니다** (회귀 테스트).
- `ScoreResult.byIndicator[]` 에 `source` 를 추가하고, `ScoreResult.coverage` 를 추가합니다:

```ts
coverage: {
  weightTotal: number;
  bySource: Record<'user'|'measured'|'proxy'|'default', number>;  // 가중치 합
  groundedShare: number;   // (user+measured+proxy) ÷ weightTotal — "근거 있는 가중치 비중"
}
```

### 2.3 기본값(미입력) 처리 — 지어내지 않되 산술은 바꾸지 않습니다

`defaultRaw` 를 빼면 점수 산술이 바뀌어 기존 테스트·샘플·사용자 저장값이 전부 흔들립니다. 대신 **보이게** 합니다.

- 등급 배지 옆에 `근거 71%` 를 항상 붙입니다. `groundedShare < 0.5` 면 등급을 `C?` 처럼 물음표 접미로 내고 툴팁 "가중치의 절반 이상이 미입력 중간값입니다".
- 세대수만 예외: `householdCount === 0` 이면 그 지표 가중치를 0 으로 둡니다(`effectiveWeights` 에서). 0세대는 "모름" 이지 "100세대 미만" 이 아니기 때문입니다 — 지금은 `log(0→1/100)` 로 0점을 받아 시중 물건이 전부 손해를 봅니다.
- 매트릭스 행의 입지 배지도 `입지 68점 · 근거 71%` 로 바꿉니다 (갈래 2).

### 2.4 화면 — 점수표 (`pages/PropertiesPage.tsx` 안 `ScoreTable`)

지금의 "항목 카드 그리드" 를 **표**로 바꿉니다. 25줄을 한눈에 훑어야 "무엇이 비었나" 가 보입니다.

| 항목 | 출처 | 값 | 점수 | w | 근거 | |
|---|---|---|---|---|---|---|
| 준공연도 | `실측` | 2019년 | 80 | 5 | 실거래 스냅샷 · 단지 | |
| 대형마트 | `대리` | 상위 5분위 | 75 | 4 | OSM 800m 마트 8곳 → 55단지 중 4/5 | ↺ |
| 세대수 | `직접` | — | — | 0 | 국토부 자료에 없음 — 입력하면 가중치 5 | [입력] |
| 초품아 | `기본` | 2 | 50 | 10 | 자료 없음 — 중간값입니다 | [입력] |

- 출처 배지 네 가지 색이 아니라 **글자**로: `실측` slate-100 굵게 · `대리` slate-200 · `직접` sky(사용자가 손댄 것) · `기본` slate-400 점선 밑줄(`ProvenanceValue` 와 같은 신호 — 가정값은 점선).
- 값 칸을 클릭하면 인라인 입력이 되고, 자동값이 있던 줄에는 `↺ 자동값으로` 가 생깁니다. 사용자값이 자동값과 어긋나면 근거 칸 끝에 amber 로 `자동 75 ↔ 내 값 40` 을 적습니다 (지금의 `MetricFeedback` 역할을 이 칸이 대신 — 그 컴포넌트는 지웁니다).
- 카테고리 머리줄에 `교통 · 가중치 24 · 근거 0/24` 처럼 **그 카테고리의 근거 비중**을 적습니다. 레이더 차트는 유지하되 근거 50% 미만인 축은 점선으로 그립니다.
- 표 위 한 줄: **"자동 8 · 직접 입력 필요 17 · 근거 있는 가중치 71%"**.

### 2.5 CLAUDE.md · UI 문구 — "주관적 입력의 가중합" 을 어떻게 고치나

원칙은 살리고 범위만 정확히 합니다. 자동 항목이 들어와도 **점수가 시세 예측이 아니라는 사실**은 그대로이고, 오히려 "근거 있는 가중치 비중" 이 생겨 더 정직해집니다.

- 카드 subtitle: "입지 점수는 항목별 입력의 가중합입니다. 항목마다 **실측 · 대리지표 · 직접 입력 · 기본값** 중 어디서 왔는지를 적습니다 — 자동으로 채운 것도 객관적 시세 예측이 아니라 비교용 점수입니다."
- CLAUDE.md "지켜야 할 설계 원칙" 의 `**입지 점수는 주관적 입력의 가중합**입니다.` → `**입지 점수는 항목별 입력의 가중합**이고 항목마다 출처(실측·대리·직접·기본)를 적습니다. 자료가 없는 항목은 점수를 지어내지 않고 "직접 입력" 으로 남기며, 근거 있는 가중치 비중을 점수 옆에 상시 노출합니다. 객관적 시세 예측이 아님은 그대로입니다.` 아키텍처 표에 `autoScore.ts`·`pick.ts`·`priceContext.ts` 세 줄 추가. (갈래 1)

---

## 3. 왜 그 가격인지 — `engine/priceContext.ts` (새 파일)

점수 항목이 가격을 **설명**하지는 못합니다(대부분 주관). 설명할 수 있는 실측 축은 **구 · 평형대 · 연식** 셋뿐이고, 그 셋 안에서 이 가격이 어디쯤인지와 나머지 점수를 **대조**하는 것이 정직한 답입니다.

```ts
export interface PriceContext {
  perSqm: number;                                     // 이 물건 ㎡당 가격
  district: { code: string; label: string };
  band: { areaFrom: number; areaTo: number };         // 전용 ±10㎡
  peers: PeerRow[];                                   // 같은 구·평형대, 최근 4분기 거래 3건↑ 단지·평형 (자기 제외)
  percentile: number | null;                          // peers 중 ㎡당 가격 백분위 (0=가장 쌈). peers<8 이면 null
  byAge: { band: '신축≤7년'|'8~20년'|'20년↑'; percentile: number | null; n: number }; // 같은 연식대 안에서
  jeonseRatio: { value: number; scope: '단지'|'시군구'; n: number } | null;        // 창원은 complex.ts headline, 그 외 rent.ts 구 중위
  deals4q: number;                                    // 최근 4분기 거래 건수 (유동성)
  thesis: PropertyThesis;                             // 그대로 가져다 붙임
  gaps: string[];                                     // 어긋남 문장 — 아래 규칙
}
export function priceContext(property: Property): PriceContext | null;  // link 없거나 구를 못 찾으면 null
```

`gaps` 규칙(테스트 대상): ① 구 안 백분위 ≥ 0.75 인데 연식대 백분위 < 0.5 → "같은 연식대에선 중간인데 구 전체에선 비싼 편 — 평형·연식이 아닌 다른 이유(위치·브랜드)를 사용자가 점수에 넣었는지 봐야 합니다" ② 백분위 ≤ 0.25 인데 입지 점수 근거 비중 < 50% → "싸게 보이지만 입지 점수의 절반이 중간값입니다" ③ `thesis.kind==='ambiguous'` 이고 백분위 ≥ 0.5 → "애매 구간인데 싸지도 않음". 문장은 상수 배열로 두고 조건만 코드.

화면(`pages/PropertiesPage.tsx` 오른쪽 열, `id="price-context"`): 머리 숫자 `㎡당 612만 · 성산구 70~100㎡ 중 상위 38%` (`Stat size="lg"`), 아래 연식대 백분위 · 전세가율 · 거래 4분기 · 판정 배지, `gaps` 를 amber 로, 이웃 5개(가까운 가격순) 표에 단지명·준공·㎡당가·**[이 단지로 바꾸기]**·**[차트]**(§4). peers<8 이면 숫자 대신 "표본 n개 — 구 전체로 넓히려면 평형대를 풀어서 보세요" 토글(±20㎡).

---

## 4. 연결 흐름 — 물건 하나를 축으로 네 화면

### 4.1 상태 — `state/store.tsx`

```ts
focusPropertyId: string | null;        // 영속(localStorage). 없으면 properties[0]
setFocusProperty(id: string | null): void;
addProperty(draft?: Partial<Property>): string;   // 기존 시그니처 호환 — draft 없으면 emptyProperty
```

`removeProperty` 가 focus 를 지우면 다음 물건으로. `focusProperty` 파생값은 `useStore()` 에 같이 노출.

### 4.2 이동 고리 — `pages/focusLink.ts` (새, `districtChartLink.ts` 와 같은 패턴)

```ts
export type FocusTarget = 'chart' | 'loan' | 'why' | 'returns' | 'tenure' | 'edit';
export const FOCUS_GO_EVENT = 'focus:go';
export function goFocus(target: FocusTarget): void;        // CustomEvent
export function takePendingFocus(): FocusTarget | null;    // 받는 화면이 한 번 꺼냄
```

| target | App 이 하는 일 | 받는 화면이 하는 일 |
|---|---|---|
| `chart` | `setTab('market')` · `openDistrictChart(link.regionCode)` | `MarketPage`: focus 에 `link` 가 있으면 `setComplexId(link.complexId)`·`setAreaKey(String(link.area))`·query 를 이름으로 → 단지 차트 + 구별 차트 둘 다 그 물건으로 |
| `loan` | `setTab('compare')` | `ComparePage`: focus 행에 `ring-sky-500/40`, `pendingDetail` 로 focus × 첫 시나리오 `DetailDrawer` 자동 오픈 → 거기서 상품명 `HandbookLink`·필요소득이 보임 |
| `why` | `setTab('input')` · `setInputStep('properties')` | `PropertiesPage`: focus 펼침 + `#price-context` 로 스크롤 |
| `returns` | `setTab('market')` | `MarketPage`: 위와 같이 단지 선택 + `#complex-returns` 로 스크롤. `BacktestCard` 에 칩 **"이 물건의 구만"** (`rollingBacktest({ …, districtCodes: [link.regionCode] })` — 이미 지원) |
| `tenure` | `setTab('tenure')` | `TenurePage`: `propertyId` 초기값을 focus 로 (셀렉트는 그대로 두되 바꾸면 `setFocusProperty` 도 호출) |
| `edit` | `setTab('input')` · `setInputStep('properties')` | focus 펼침, 기본정보로 스크롤 |

### 4.3 따라다니는 요약 — `components/FocusBar.tsx` (새)

`compare` · `tenure` · `market` 탭에서 머리줄 바로 아래 한 줄(sticky 아님, `no-print`). 입력 탭에서는 물건 화면 자체가 있으니 안 띄웁니다.

```
▣ 창원 A아파트  창원 · 성산구  3.80억(최근 4분기 16건)  전용 84㎡  2019년   입지 68점 · 근거 71%   신축
   [차트] [대출] [왜 이 가격] [수익률] [매수·전세·월세] [수정]            물건 바꾸기 ▾
```

- 값은 `scoreProperty`·`propertyThesis` 로만 냅니다(갈래 1 의 새 엔진을 안 기다려도 됨 — 근거 % 는 `coverage` 가 들어온 뒤 한 줄 추가).
- "물건 바꾸기" 는 셀렉트 → `setFocusProperty`. 현재 탭 버튼은 비활성.
- `link` 가 없는 손 입력 물건은 `[차트]`·`[수익률]` 이 "실거래 단지와 잇기 ▸"(→ `edit`) 로 바뀝니다. 없는 연결을 있는 척하지 않습니다.

### 4.4 화면 안의 작은 고리 (양방향)

| 어디 | 추가 |
|---|---|
| 매트릭스 행 머리(물건명) | 클릭 → `setFocusProperty` + 행 강조. 배지 `입지 68 · 근거 71%` |
| 매트릭스 셀 상세 | 머리에 `[이 물건 차트]`·`[3-way]` (goFocus) — 상품명 `HandbookLink` 는 그대로 |
| 실거래 "등록한 물건에서" 버튼 | 문구·`useStore()` 유지(채점표). `link` 있으면 검색어 대신 **단지·평형을 직접 선택**하고 `setFocusProperty` |
| 실거래 단지 결과 카드 | `[이 단지를 물건으로 추가]`(`pickFromMarket` → `addProperty`) — 실거래 탭에서 둘러보다 바로 담는 길 |
| 3-way 물건 셀렉트 | 바뀌면 `setFocusProperty` |
| 가격 위치 이웃 표 | `[차트]` → focus 를 그 단지로 **바꾸지 않고** `MarketPage` 에 임시 단지로 넘김(`openDistrictChart` + 보조 이벤트 `market:show-complex`) |

---

## 5. 물건 화면 재구성 (`pages/PropertiesPage.tsx`)

App 의 `TwoCol rail="right"`(프로필 레일) 안에서, 넓은 화면(`2xl`)에 **다시 2단**:

```
┌ 물건 목록 (한 줄 카드 × N) ────────────────────────────────────────────────┐
│ [＋ 시중 단지에서 고르기] [＋ 직접 입력] [샘플]                              │
│ ▸ 창원 A아파트  성산구  3.80억  84㎡  입지 68 · 근거 71%  신축   ★focus   삭제 │
└───────────────────────────────────────────────────────────────────────────┘
┌ 펼친 물건 ──────────────────────────────────┬ 오른쪽 24rem ───────────────┐
│ ① 기본정보 2열 — 각 칸 아래 출처 한 줄       │ 카테고리 레이더(근거<50% 점선) │
│    매매가 3.80억 [실거래 2025Q3~2026Q2 16건] │ 판정 배지 + 이유 (thesis)     │
│    전용 84㎡ [스냅샷 반올림 · 85 경계 확인]   │ ③ 왜 이 가격 (§3)             │
│    세대수 — [자료 없음 · 직접 입력]           │    #price-context             │
│ ② 점수표 (§2.4) + 가중치 조절 토글           │ 감점 항목                     │
│                                             │ 연결: [차트][대출][수익률][3-way]│
└─────────────────────────────────────────────┴──────────────────────────────┘
```

- 1280~1535px 에서는 오른쪽 열이 점수표 아래로 내려갑니다(지금 `lg:grid-cols-[1fr_360px]` 를 `2xl:grid-cols-[minmax(0,1fr)_24rem]` 로).
- 글자: 표 본문 `text-sm`, 출처·근거 `text-xs text-slate-400`, 머리 숫자 `Stat size="lg"`. `text-[10px]`·`slate-600` 금지(가드 테스트가 이미 있음).
- 인쇄: 점수표·가격 위치 전부 `print-plain`, Foldable 은 `print-open`.

---

## 6. 구현 지시 — 두 갈래, 파일 겹침 없음

검증(각 단계 끝): `cd simulator && npx tsc --noEmit -p . && npx vitest run`. 두 갈래 머지 뒤 `cd .. && node scripts/scorecard.mjs` **100**, `.claude/launch.json` `built-realty` 로 `npm run deploy:realty` 산출물의 `#root` 가 채워지는지 확인.

### 6.0 공통 기반 (먼저, 한 커밋 — 갈래 둘 다 이 위에서 시작)

| 파일 | 할 일 |
|---|---|
| `engine/types.ts` | `Property` 에 `link?`·`autoFill?`·`priceBasis?` (§1.1) |
| `state/defaults.ts` | `emptyProperty` 그대로(새 필드 비움). 샘플 물건 불변 |
| `state/store.tsx` | `focusPropertyId` 영속 + `setFocusProperty` + `addProperty(draft?)` (§4.1). `initialState` 에서 없으면 `properties[0]?.id ?? null` |

세 파일 합쳐 50줄 안팎. 이후 두 갈래는 **서로 다른 파일만** 건드립니다.

### 6.1 갈래 1 — 계산 · 물건 선택 · 자동 점수 · 왜 이 가격

| 순서 | 파일 | 할 일 |
|---|---|---|
| 1 | `engine/market.ts` | `pooledMedian(points, lastQ, quarters)` 공개 (complex.ts `pooled` 과 같은 규칙) |
| 2 | `engine/pick.ts` (새) · `engine/__tests__/pick.test.ts` | §1.2. 테스트: 성산구 단지 → `region='changwon'`·`sigungu='창원시 성산구'`; 4분기 n≥3 이면 price·window 라벨, <3 이면 `thin`, 0 이면 null; `householdCount===0`; `builtYear` 일치; 지역 필터가 다른 권역 단지를 뺌; `pooledMedian` 이 `complexDetail(cx).sizes[].sale` 과 같은 값 |
| 3 | `engine/autoScore.ts` (새) · `engine/__tests__/autoScore.test.ts` | §2.1. `board-2026-09.json` 은 `{jeonse,wolse}[].{cx,area,counts,auto,min}` 만 좁은 타입으로 직접 import (rentfinder 를 import 하지 않음). 테스트: **`INDICATORS` 의 모든 id 가 결과에 있다**(빠지면 실패); `none` 은 raw·score 둘 다 없음; 후보판 단지(예 `48125-555`, 84㎡)는 `brt/mart/park` proxy·`hospital` none; 후보판에 없는 부산 단지는 생활 인프라 전부 none; `populationTrend` 는 세 권역 모두 measured; `districtTier` 용호동 5 · 가음정 4 · 마산 2 · 부산 none; `builtYear` measured |
| 4 | `engine/scoring.ts` · `engine/__tests__/scoring.test.ts` | §2.2~2.3. `resolveRaw` 에 auto 주입, `byIndicator[].source`, `coverage`, `householdCount===0` 이면 가중치 0. 테스트: `autoFill` 없는 기존 fixture 의 `total` 이 바뀌지 않음(기존 케이스 전부 그대로 통과); `autoFill:true`+`link` 물건은 `builtYear`·`populationTrend` 가 measured 로 들어감; `scores[id]` 가 있으면 사용자값 우선, 지우면 자동값 복귀; `coverage.groundedShare` 가 (user+measured+proxy)÷total; 세대수 0 → 그 가중치 0 |
| 5 | `engine/priceContext.ts` (새) · `engine/__tests__/priceContext.test.ts` | §3. 테스트: 백분위 0~1 · 자기 제외 · peers<8 이면 null · 연식대 분류 경계(7/20년) · `gaps` 세 규칙 각각 켜지는 fixture · link 없으면 null |
| 6 | `pages/PropertyPicker.tsx` (새) | §1.3 패널. `addProperty(draft)`·`setFocusProperty` 는 store 에서(기반 커밋에 있음) |
| 7 | `pages/PropertiesPage.tsx` | §2.4 점수표 · §5 배치 · §3 가격 위치 카드(`id="price-context"`) · `MetricFeedback` 삭제 · `focusPropertyId` 로 펼침 · 연결 버튼은 `goFocus` 가 아직 없으므로 **갈래 2 머지 전까지 비표시**(머지 후 한 줄 추가) |
| 8 | `CLAUDE.md` | §2.5 문구 · 아키텍처 표 세 줄 |
| 9 | — | 검증 명령. 기존 530건 + 새 테스트 전부 통과 |

### 6.2 갈래 2 — 연결 · 화면 흐름

| 순서 | 파일 | 할 일 |
|---|---|---|
| 1 | `pages/focusLink.ts` (새) | §4.2 이벤트·pending |
| 2 | `components/FocusBar.tsx` (새) | §4.3. `scoreProperty`·`propertyThesis`·`money` 만 사용. `link` 없으면 "실거래 단지와 잇기 ▸" |
| 3 | `App.tsx` | `FOCUS_GO_EVENT` 리스너(§4.2 표의 App 열) · `compare/tenure/market` 에서 `<FocusBar />` 장착 · `TabId` 불변 |
| 4 | `pages/MarketPage.tsx` | `takePendingFocus()` 로 단지·평형 직접 선택 · "등록한 물건에서" 버튼이 `link` 있으면 직접 선택+`setFocusProperty`(문구·`useStore()` 유지) · 결과 카드 `id="complex-returns"` + `[이 단지를 물건으로 추가]`(`pickFromMarket` 은 갈래 1 — 머지 전엔 `addProperty({name, region, sigungu, areaSqm, builtYear, link, autoFill:true})` 로 직접 채움) · `BacktestCard` 칩 "이 물건의 구만" |
| 5 | `pages/ComparePage.tsx` | focus 행 강조 · 물건명 클릭 → `setFocusProperty` · `pendingDetail` 자동 오픈 · 셀 상세 머리 `[차트][3-way]` · `HandbookLink` 그대로 |
| 6 | `pages/TenurePage.tsx` | `propertyId` 초기값 focus · 셀렉트 변경 시 `setFocusProperty` · `HandbookLink id="jeonse-loan"` 그대로 |
| 7 | — | 검증 명령. 375 · 1280 · 2000px 에서 FocusBar 가 한 줄(좁으면 두 줄)로 들어가고 가로 스크롤 없음 |

### 6.3 머지 뒤 (한 사람, 30분)

1. `PropertiesPage` 오른쪽 열 연결 버튼을 `goFocus` 로 잇기 · `FocusBar` 에 `근거 N%`(coverage) 추가 · `MarketPage` 의 "물건으로 추가" 를 `pickFromMarket` 으로 교체.
2. `node scripts/scorecard.mjs` 100 · `built-realty` 렌더 확인 · 커밋 메시지 한국어.

### 손대지 않는 것

`src/rules/**` · `src/data/**` · `rentfinder/**`(`complex.ts` 포함) · `engine/matrix.ts`·`loan.ts`·`tenure.ts`·`backtest.ts`(호출만) · `HandbookDrawer` 의 `fixed … left-0` · 엔트리·빌드 설정 · 외부 링크.

### 완료 기준

1. 시중 단지를 고르면 지역군·시군구·전용·준공·최근 매매 중위가 채워지고 **세대수는 비어 "직접 입력"** 으로 남는다.
2. 점수표 25줄 전부에 출처가 적혀 있고, `none` 항목은 어떤 경로로도 자동 점수를 받지 않는다 (테스트).
3. `autoFill` 없는 물건의 점수가 머지 전과 같다 (테스트).
4. 점수 옆에 `근거 N%` 가 항상 있고, 50% 미만이면 등급에 `?` 가 붙는다.
5. 한 물건에서 차트 · 대출(설명서 포함) · 왜 이 가격 · 수익률(단지+백테스트 구 필터) · 3-way 가 **클릭 한 번**으로 오가고, 돌아오면 같은 물건이 펼쳐져 있다.
6. 탭 6개 · 채점표 100 · 단일 HTML 렌더.
