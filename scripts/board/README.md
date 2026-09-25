# 전·월세 후보판 스냅샷 만드는 순서

`simulator/src/data/board-YYYY-MM.json` 은 여기 스크립트로 만듭니다. 결과물만
화면이 읽고, 스크립트는 **어떻게 만들었는지**를 남기는 용도입니다. 중간 파일은
`scripts/board/work/` (gitignore) 에 쌓입니다.

| 순서 | 스크립트 | 하는 일 | 외부 |
|---|---|---|---|
| 1 | `export-jeonse.board.ts` (vitest) | 짚은 단지·평형의 전세 이력·매매 이력 → `rows.json` | — |
| 2 | `calc.mjs` | 튀는 거래를 빼고 최근 전세·전세가율·허용선·판정·자동 순위 → `ranked.json` | — |
| 3 | `geo.mjs` · `geo2.mjs` · `fixgeo.mjs` | 단지 앞 도로 좌표 + 지사까지 도로거리 → `dist.json` | Nominatim, FOSSGIS OSRM |
| 4 | `bulk.mjs` | 마산 전체 POI 한 번에 받아 반경별 시설 수 → `infra-bulk.json` | Overpass |
| 5 | `data.mjs` → `data2.mjs` → `data3.mjs` | 전세·월세 행 조립, 인프라 자동 점수(후보끼리 5분위) | — |
| 6 | `tiles.mjs` | 지도 조각(z15 동네 · z11 전체)을 data URI 로 → `map.json` | OSM 타일 (한 번, 소량) |
| — | `infra.mjs` | 단지별 Overpass 질의 (느림 · `bulk.mjs` 로 대체, 2026-09 전세 19곳은 이 값) | Overpass |
| — | `report-pdf.mjs` | 순위 보고서 PDF (크롬 headless) | — |

지켜야 할 것

- **소요시간은 신호·정체를 뺀 최소치**입니다. 화면에 그렇게 적습니다.
- 좌표는 도로 단위라 수백 m 어긋납니다. 긴 도로(3·15대로 등)로만 잡히면 동 중심으로 바꾸고 `approx: 'dong'` 을 답니다.
- 한국 OSM 은 의원·동물병원이 많이 빠집니다. 0곳이 40% 넘는 축은 0을 점수로 만들지 않습니다(비워 둠).
- 타일은 OSM 타일 정책상 대량 수집 금지 — 후보 주변만, 한 번 받아 캐시합니다.
