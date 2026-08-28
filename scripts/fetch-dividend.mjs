/**
 * 코스피 배당수익률 실측 — 한국은행 ECOS.
 *
 * 지금까지 `DIVIDEND_YIELD = 0.02` 라는 상수가 두 스크립트에 박혀 있었습니다.
 * KRX 에 코스피 총수익지수가 없어 가격지수 CAGR 에 배당을 더해야 하는데,
 * 그 배당이 근거 없는 숫자였습니다. **총수익 근사의 절반이 가정**이었던 셈입니다.
 *
 * ECOS `901Y014` 통계표에 `KOSPI_배당수익률`(항목 1100000)이 연 단위로 있습니다.
 * 실측이므로 이걸 씁니다.
 *
 * ## 왜 장기 평균인가
 *
 * 배당수익률은 분모가 주가라 **주가가 빠진 해에 저절로 올라갑니다.** 특정 연도
 * 값을 쓰면 그해 시장 상태가 총수익 가정에 섞입니다. 가격지수 CAGR 이 장기
 * 구간의 값이므로 배당도 같은 구간의 평균을 써야 자가 맞습니다.
 *
 * ```
 * node scripts/fetch-dividend.mjs
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'simulator/src/data/dividend.json');

function envValue(name) {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`.env.local 에 ${name} 이 없습니다.`);
  return m[1].trim();
}

const num = (s) => Number(String(s).replace(/,/g, ''));

async function main() {
  const key = envValue('ECOS_API_KEY');
  const thisYear = new Date().getFullYear();
  const from = thisYear - 20;

  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/1/100/901Y014/A/${from}/${thisYear}/1100000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);
  const rows = ((await res.json()).StatisticSearch?.row ?? [])
    .map((r) => ({ year: Number(r.TIME), value: num(r.DATA_VALUE) / 100 }))
    .filter((r) => Number.isFinite(r.value) && r.value > 0);

  if (rows.length < 5) throw new Error(`표본이 ${rows.length}건뿐입니다 — 통계표 코드를 확인하세요.`);

  /*
   * 마지막 해는 연중 집계라 확정치가 아닐 수 있습니다. 평균에서 빼지는 않되
   * 화면에 마지막 연도를 같이 내어 어디까지 반영됐는지 보이게 합니다.
   */
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  const values = sorted.map((r) => r.value).sort((a, b) => a - b);
  const mean = sorted.reduce((s, r) => s + r.value, 0) / sorted.length;
  const median = values[Math.floor(values.length / 2)];

  const out = {
    note:
      '코스피 배당수익률 실측 (한국은행 ECOS 901Y014, 항목 1100000). ' +
      '가격지수 CAGR 에 더해 총수익을 근사하는 데 씁니다. ' +
      '배당수익률은 분모가 주가라 주가가 빠진 해에 저절로 올라갑니다 — ' +
      '특정 연도가 아니라 가격지수와 같은 장기 구간의 평균을 씁니다.',
    source: '한국은행 ECOS · 901Y014 주식시장(월,년) · KOSPI_배당수익률',
    asOf: new Date().toISOString().slice(0, 10),
    from: sorted[0].year,
    to: sorted[sorted.length - 1].year,
    n: sorted.length,
    mean: Math.round(mean * 10000) / 10000,
    median: Math.round(median * 10000) / 10000,
    min: Math.round(values[0] * 10000) / 10000,
    max: Math.round(values[values.length - 1] * 10000) / 10000,
    byYear: sorted.map((r) => [r.year, Math.round(r.value * 10000) / 10000]),
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`✓ ${OUT}`);
  console.log(
    `  ${out.from}~${out.to} ${out.n}년 · 평균 ${(out.mean * 100).toFixed(2)}% · ` +
      `중위 ${(out.median * 100).toFixed(2)}% · 범위 ${(out.min * 100).toFixed(2)}~${(out.max * 100).toFixed(2)}%`
  );
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
