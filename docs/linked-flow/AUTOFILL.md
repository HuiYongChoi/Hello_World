# 입지 점수표 자동 채우기 — 진행 상황 (2026-10-22, 중단본)

> 요청: "자료 없음 — 중간값입니다" 가 너무 많다(25개 중 자동 4 · 근거 22%). 근거 없는 숫자는 짓지 않고
> 자동 항목을 최대한 늘린다. **다른 작업이 먼저라 중간에 멈췄습니다.** 아래는 된 것 · 남은 것 · 이어 하는 법입니다.

## 된 것 (이 커밋에서 화면에 반영됨)

| 항목 | 상태 | 근거 |
|---|---|---|
| 브랜드 `brand` | **대리 (새로)** | 단지 이름에 시공능력평가 상위 10위권 10개사 브랜드(래미안·힐스테이트·푸르지오·e편한세상·자이·더샵·롯데캐슬·SK뷰·아이파크)가 있으면 4단계. 못 찾으면 직접 입력(브랜드가 없다는 뜻 아님). 규칙은 `simulator/src/rules/location-2026-10.json` 의 `indicators.brand` |
| 변환 기준 룰셋 | 작성 | `rules/location-2026-10.json` — 도보·차 분 · 초품아 단계 구간 · 5분위 · 0곳 40% 규칙 · 고용중심지·직장 후보·서울 도심·GTX 역 좌표(출처 문장 포함) |
| 위치 스냅샷 로더 | 작성 | `engine/location.ts` — 단지·법정동 행 해석, 5분위, 초품아 단계, 브랜드 |
| 수집 스크립트 | 작성 · **법정동 좌표 단계에서 중단** | `scripts/location/collect.mjs` (아래) |
| 위치 스냅샷 | **빈 자리표시자** | `data/location-2026-10.json` 은 `complete:false · stage:"geocode"` · 단지 행 0 — 위치 항목은 아직 자동으로 안 채웁니다 |

### 전후 비교 — 지금 커밋 기준 (브랜드만 추가)

| 물건 | 권역 | 자동 항목 전 → 후 | 근거 가중치 전 → 후 |
|---|---|---|---|
| 창원푸르지오더플래티넘1단지 (마산 후보판) | 창원 | 8 → 9 | 45% → 46% |
| 꿈에그린 (성산) | 창원 | 4 → 4 | 22% → 22% |
| 거제센트럴자이 | 부산 | 3 → 4 | 14% → 16% |
| 고덕국제신도시 포레스트자이 | 경기 | 3 → 4 | 10% → 12% |
| (188-0) — 이름 없는 단지 | 부산 | 3 → 3 | 14% → 14% |
| **전체 3,150단지 평균** | — | 3.35 → 3.43 | 15.5% → 15.6% |

브랜드 가중치가 3이라 근거 %는 거의 안 움직입니다. **큰 변화는 위치 스냅샷이 들어와야** 납니다 —
교통·직주근접·학군·생활 인프라(창원 기준 가중치 81, 세대수 뺀 전체 166의 약 49%)가 거기서 채워집니다.

## 남은 것

1. **수집 끝내기** — `node scripts/location/collect.mjs` (캐시 `scripts/location/work/` 는 gitignore, 이 기기에만 있음).
   멈춘 지점: Nominatim 법정동 중심 185질의 캐시됨(법정동 259곳 중 일부). 이어 돌리면 캐시는 건너뜁니다.
   단계: 법정동 좌표 → Overpass 3권역(아파트 · 정류장·역·학교·학원·마트·병원·공원·IC) → 단지명 짝짓기 →
   OSRM 보행 table(정류장·역·초등학교) → OSRM 차 table(IC·마트·병원) → 법정동 단위 차 table(고용중심지·직장·서울·GTX)
   → `simulator/src/data/location-2026-10.json`. 예상 30~60분(OSRM 한 번 8초 안팎, 요청 사이 1초).
2. **autoScore 연결** — 위치 항목을 쓰는 판이 `scripts/location/autoScore.next.ts` 에 있습니다(컴파일 대상 밖).
   스냅샷이 차면 `simulator/src/engine/autoScore.ts` 로 옮기고 `Property.workplaceId?: string`(types.ts) 을 더합니다.
   채우는 항목: 지하철역 도보 · GTX(경기) · 버스 정류장 도보 · IC · 본인 통근(직장 선택) · 서울 도심(경기) ·
   고용중심지 · 초품아 · 중·고 수 · 학원 수 · 대형마트 · 병원급 · 공원. 좌표가 법정동 근사인 단지는 도보·반경 항목을 비움.
   후보판(board) 기반 brt·mart·park·통근은 새 자료로 대체 — `autoScore.test.ts` 의 후보판 기대값(50/75/100)을 바꿔야 합니다.
3. **화면** — 점수표 본인 통근 줄에 직장 고르기(`workplaceOptions(region)`), "자료 없음 — 중간값입니다" 두 줄을
   `자료 없음 · 이유` 한 줄(slate-400)로, `[입력]` 을 덜 튀게. 머리 줄 "자동 n · 직접 n · 근거 n%".
4. 이 표를 위치 스냅샷 기준으로 다시 재서 갱신 (샘플 + 전체 평균, 좌표 맞춘 비율).

여전히 자료가 없는 항목(수집이 끝나도): 배우자 통근 · 세대수 · 주차 · 향 · 평면 · 개발 호재 · 재건축 단계 · 용적률 ·
생활권 티어(부산·경기).

## 재시작

```bash
cd /Users/huiyong/Desktop/realty-flow
node scripts/location/collect.mjs > scripts/location/work/log.txt 2>&1 &   # 캐시에서 이어서
tail -f scripts/location/work/log.txt
# 끝나면: autoScore.next.ts → engine/autoScore.ts, types.ts 에 workplaceId, 테스트 갱신
cd simulator && npx tsc --noEmit -p . && npx vitest run && cd .. && node scripts/scorecard.mjs
```
