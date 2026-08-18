#!/usr/bin/env node
/**
 * 해외지수(FRED)와 국내 금리·물가(ECOS)를 빌드 타임에 받습니다.
 *
 * ## 왜 두 소스인가
 *
 * - **FRED** — S&P 500·나스닥 100. KRX 로는 해외지수를 못 받습니다.
 * - **ECOS** — 전세자금대출 금리와 소비자물가. 자리표시자 4.2% 를 실측으로
 *   바꾸고, 명목 수익률을 실질로 환산할 근거를 만듭니다.
 *
 * ## 해외지수도 가격지수입니다
 *
 * FRED 의 SP500·NASDAQ100 은 배당이 빠진 가격지수입니다. 코스피와 같은 문제라
 * **같은 방식으로** 배당 가정을 더해 총수익 근사치를 만듭니다. 방식이 같아야
 * 지수끼리 비교가 성립합니다.
 *
 * S&P 500 은 FRED 가 10년치만 주므로 그 구간이 곧 비교 구간이 됩니다.
 * 코스피 스냅샷도 같은 10년이라 시작·끝이 맞습니다.
 *
 *   node scripts/fetch-rates.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 지수별 배당수익률 가정 — 실측이 아니라 총수익 근사에 쓰는 값입니다. */
const DIVIDEND_YIELD = { SP500: 0.015, NASDAQ100: 0.008 };

function envValue(name) {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`.env.local 에 ${name} 이 없습니다.`);
  return m[1].trim();
}

const num = (s) => Number(String(s).replace(/,/g, ''));

async function fredSeries(key, id) {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=asc`;
  const res = await fetch(u, { signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`);
  const rows = (await res.json()).observations ?? [];
  // 휴장일은 "." 로 옵니다.
  return rows.filter((r) => r.value !== '.' && num(r.value) > 0);
}

async function ecosAnnual(key, table, item, from, to) {
  const u = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/1/100/${table}/A/${from}/${to}/${item}`;
  const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`ECOS ${table} HTTP ${res.status}`);
  const j = await res.json();
  return (j.StatisticSearch?.row ?? []).map((r) => ({ time: r.TIME, value: num(r.DATA_VALUE) }));
}

const round4 = (v) => Math.round(v * 10000) / 10000;

async function main() {
  const fredKey = envValue('FRED_API_KEY');
  const ecosKey = envValue('ECOS_API_KEY');
  const thisYear = new Date().getFullYear();

  /*
   * 지수마다 제공 기간이 다릅니다 — NASDAQ100 은 1986년부터, SP500 은 최근 10년만.
   * 그대로 쓰면 40년 CAGR 과 10년 CAGR 을 나란히 놓게 되어 비교가 성립하지
   * 않습니다. **가장 늦게 시작하는 지수에 맞춰** 구간을 잘라 냅니다.
   */
  const series = {};
  for (const id of ['SP500', 'NASDAQ100']) series[id] = await fredSeries(fredKey, id);
  const commonStart = Object.values(series)
    .map((rows) => rows[0].date)
    .sort()
    .pop();
  console.log(`공통 시작일 ${commonStart} 로 구간을 맞춥니다\n`);

  const indexes = {};
  for (const id of ['SP500', 'NASDAQ100']) {
    const rows = series[id].filter((r) => r.date >= commonStart);
    const first = rows[0];
    const last = rows[rows.length - 1];
    const years =
      (new Date(last.date) - new Date(first.date)) / (365.2425 * 24 * 3600 * 1000);
    const priceCagr = Math.pow(num(last.value) / num(first.value), 1 / years) - 1;
    indexes[id] = {
      commonStart,
      from: first.date,
      to: last.date,
      years: Math.round(years * 100) / 100,
      fromIndex: num(first.value),
      toIndex: num(last.value),
      priceCagr: round4(priceCagr),
      dividendYieldAssumed: DIVIDEND_YIELD[id],
      totalReturnApprox: round4(priceCagr + DIVIDEND_YIELD[id]),
    };
    console.log(
      `${id.padEnd(10)} ${first.date} ${first.value} → ${last.date} ${last.value}  ` +
        `가격 CAGR ${(priceCagr * 100).toFixed(2)}% (+배당 ${(DIVIDEND_YIELD[id] * 100).toFixed(1)}% 가정)`
    );
  }

  // 전세자금대출 금리 — 자리표시자 4.2% 를 대체합니다
  const jeonseRate = await ecosAnnual(ecosKey, '121Y006', 'BECBLA03041', '2015', String(thisYear));
  const mortgageRate = await ecosAnnual(ecosKey, '121Y006', 'BECBLA0302', '2015', String(thisYear));
  // 소비자물가지수 — 명목을 실질로 환산할 근거
  const cpi = await ecosAnnual(ecosKey, '901Y009', '0', '2015', String(thisYear));

  const latest = (rows) => rows[rows.length - 1];
  const cpiCagr =
    cpi.length >= 2
      ? Math.pow(latest(cpi).value / cpi[0].value, 1 / (Number(latest(cpi).time) - Number(cpi[0].time))) - 1
      : null;

  const out = {
    version: `${thisYear}-08`,
    asOf: new Date().toISOString().slice(0, 10),
    sources: {
      fred: { name: 'St. Louis Fed (FRED)', note: 'SP500·NASDAQ100 은 가격지수라 배당은 가정입니다.' },
      ecos: { name: '한국은행 ECOS', note: '예금은행 대출금리(신규취급액 기준) 연간 · 소비자물가지수' },
    },
    indexes,
    rates: {
      jeonseLoan: latest(jeonseRate)
        ? { year: latest(jeonseRate).time, rate: round4(latest(jeonseRate).value / 100) }
        : null,
      mortgage: latest(mortgageRate)
        ? { year: latest(mortgageRate).time, rate: round4(latest(mortgageRate).value / 100) }
        : null,
    },
    inflation: cpiCagr !== null ? { from: cpi[0].time, to: latest(cpi).time, cagr: round4(cpiCagr) } : null,
  };

  const path = resolve(ROOT, `simulator/src/data/rates-${out.version}.json`);
  writeFileSync(path, JSON.stringify(out, null, 1));

  console.log(`\n✓ ${path}`);
  if (out.rates.jeonseLoan)
    console.log(`  전세자금대출 금리 ${(out.rates.jeonseLoan.rate * 100).toFixed(2)}% (${out.rates.jeonseLoan.year}년)`);
  if (out.rates.mortgage)
    console.log(`  주택담보대출 금리 ${(out.rates.mortgage.rate * 100).toFixed(2)}% (${out.rates.mortgage.year}년)`);
  if (out.inflation)
    console.log(`  소비자물가 CAGR ${(out.inflation.cagr * 100).toFixed(2)}% (${out.inflation.from}~${out.inflation.to})`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
