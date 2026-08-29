/**
 * 권역 인구 추세 실측 — 행정안전부 통계연보 (data.go.kr).
 *
 * `populationTrend` 는 창원 가중치가 **10** 으로 입지 지표 중 가장 높은데
 * 지금까지 순수 주관 입력이었습니다.
 *
 * ## 시도 단위입니다 — 시군구가 아닙니다
 *
 * 이 API 가 주는 `regi` 는 "경남", "부산", "경기" 같은 **시도**입니다.
 * 창원 성산구와 마산회원구를 가르지 못합니다. 다행히 이 도구의 대상이
 * 정확히 경남(창원) · 부산 · 경기 세 권역이라 **권역 축에서는 그대로 유효**하고,
 * 같은 권역 안에서는 모든 시군구가 같은 값을 받습니다. 화면에 그렇게 적습니다.
 *
 * ## 표기가 해마다 바뀝니다
 *
 * 같은 지역이 어떤 해에는 "경남", 어떤 해에는 "경상남도" 로 옵니다.
 * 정규화하지 않으면 시계열이 두 조각으로 끊기고, 각각은 구간이 짧아
 * 엉뚱한 추세가 나옵니다. 법정동코드가 행정구역 개편으로 바뀌던 것과
 * 같은 종류의 함정입니다.
 *
 * ```
 * node scripts/fetch-population.mjs
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'simulator/src/data/population.json');

/**
 * `.env.local` 의 키는 **Encoding 키**(`%` 포함)입니다.
 * 그대로 URL 에 붙여야 합니다 — 한 번 더 인코딩하면 `%2B` 가 `%252B` 가 되어
 * "등록되지 않은 서비스키" 로 돌아옵니다. 실제로 그 함정에 빠진 적이 있습니다.
 */
function envValue(name) {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`.env.local 에 ${name} 이 없습니다.`);
  return m[1].trim();
}

/** 같은 지역의 다른 표기 → 하나로. 안 맞추면 시계열이 끊깁니다. */
const ALIAS = {
  전국: '계', 합계: '계',
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천',
  광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
  경기도: '경기', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남',
  전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남',
  제주특별자치도: '제주',
};
const norm = (s) => ALIAS[s] ?? s;

/** 이 도구의 권역 → 통계 지역명. 창원은 경남에 속합니다. */
const REGION_OF = { changwon: '경남', busan: '부산', gyeonggi: '경기' };

const cagr = (a, b, years) => Math.pow(b / a, 1 / years) - 1;
const round5 = (v) => Math.round(v * 100000) / 100000;

async function main() {
  const key = envValue('MOLIT_API_KEY');
  const url =
    `https://apis.data.go.kr/1741000/RegistrationPopulationByRegion/getRegistrationPopulationByRegion` +
    `?serviceKey=${key}&pageNo=1&numOfRows=1000&type=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const blocks = json.RegistrationPopulationByRegion;
  if (!Array.isArray(blocks)) throw new Error(`응답 구조가 다릅니다: ${JSON.stringify(json).slice(0, 300)}`);

  const rows = blocks.flatMap((b) => b.row ?? []);
  if (rows.length < 50) throw new Error(`표본이 ${rows.length}건뿐입니다.`);

  const byRegion = new Map();
  for (const r of rows) {
    const k = norm(r.regi);
    const y = Number(r.wrttimeid);
    const pop = Number(String(r.population_tot).replace(/,/g, ''));
    const hh = Number(String(r.houshol ?? 0).replace(/,/g, ''));
    if (!Number.isFinite(y) || !Number.isFinite(pop) || pop <= 0) continue;
    if (!byRegion.has(k)) byRegion.set(k, new Map());
    // 같은 해가 두 표기로 오면 나중 것으로 덮습니다 — 같은 값이라 무해합니다.
    byRegion.get(k).set(y, { pop, hh });
  }

  const national = byRegion.get('계');
  if (!national) throw new Error('전국 계열을 찾지 못했습니다.');

  const trend = (series) => {
    const years = [...series.keys()].sort((a, b) => a - b);
    const first = years[0];
    const last = years[years.length - 1];
    const from10 = Math.max(first, last - 10);
    return {
      from: first,
      to: last,
      population: series.get(last).pop,
      households: series.get(last).hh,
      cagrAll: round5(cagr(series.get(first).pop, series.get(last).pop, last - first)),
      cagr10: round5(cagr(series.get(from10).pop, series.get(last).pop, last - from10)),
      byYear: years.map((y) => [y, series.get(y).pop]),
    };
  };

  const nat = trend(national);
  const regions = {};
  for (const [id, label] of Object.entries(REGION_OF)) {
    const series = byRegion.get(label);
    if (!series) throw new Error(`${label} 계열을 찾지 못했습니다.`);
    const t = trend(series);
    regions[id] = {
      label,
      ...t,
      // 전국이 함께 줄면 그건 그 지역 문제가 아닙니다. 초과분으로 봅니다.
      excess10: round5(t.cagr10 - nat.cagr10),
    };
  }

  const out = {
    note:
      '행정안전부 통계연보 지역별 주민등록인구 실측. **시도 단위**라 같은 권역 안 시군구는 ' +
      '같은 값을 받습니다 — 창원 성산구와 마산회원구를 가르지 못합니다. ' +
      '지역 표기가 해마다 달라(경남↔경상남도) 정규화한 뒤 이었습니다.',
    source: 'data.go.kr · 행정안전부_통계연보_지역별 주민등록인구',
    granularity: '시도',
    asOf: new Date().toISOString().slice(0, 10),
    national: nat,
    regions,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`✓ ${OUT}\n`);
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  console.log(`  전국  ${nat.from}~${nat.to}  최근10년 ${pct(nat.cagr10)}/년`);
  for (const [id, r] of Object.entries(regions)) {
    console.log(
      `  ${id.padEnd(9)} ${r.label}  ${r.population.toLocaleString('ko-KR')}명  ` +
        `최근10년 ${pct(r.cagr10)}/년  전국 대비 ${pct(r.excess10)}p`
    );
  }
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
