#!/usr/bin/env node
/**
 * KRX 지수를 빌드 타임에 받아 대체투자 수익률 실측치를 만듭니다.
 *
 * ## 코스피에는 총수익지수(TR)가 없습니다
 *
 * 승인된 `idx/kospi_dd_trd` 는 51개 지수를 주는데 **전부 가격지수**입니다.
 * 배당이 빠져 있어 그대로 쓰면 대체투자가 부당하게 불리해집니다 — 배당 연 2%면
 * 10년에 20%p 넘게 벌어집니다. 그래서 가격지수 CAGR 에 **배당수익률 가정을
 * 더해** 총수익 근사치를 만들고, 그 사실을 스냅샷에 박아 둡니다. 근사라는 것이
 * 화면에서 보여야 합니다.
 *
 * 채권은 다릅니다 — `idx/bon_dd_trd` 가 `TOT_EARNG_IDX`(총수익지수)를 직접 줍니다.
 * 이쪽은 근사가 아니라 실측입니다.
 *
 *   node scripts/fetch-index.mjs
 *   node scripts/fetch-index.mjs --from 20160104
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://data-dbg.krx.co.kr/svc/apis';

/** 코스피 배당수익률 가정 — 실측이 아니라 총수익 근사에 쓰는 값입니다. */
const DIVIDEND_YIELD = 0.02;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadKey() {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(/^KRX_API_KEY=(.+)$/m);
  if (!m) throw new Error('.env.local 에 KRX_API_KEY 가 없습니다.');
  return m[1].trim();
}

/** 그 날이 휴장이면 며칠 앞으로 물러서며 찾습니다. */
async function fetchNearest(key, path, ymd, pick, maxBack = 10) {
  for (let back = 0; back < maxBack; back++) {
    const d = new Date(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(4, 6)) - 1,
      Number(ymd.slice(6, 8)) - back
    );
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const res = await fetch(`${BASE}/${path}?basDd=${day}`, {
      headers: { AUTH_KEY: key },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const rows = (await res.json()).OutBlock_1 ?? [];
    const hit = pick(rows);
    if (hit) return { day, value: hit };
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

const num = (s) => Number(String(s).replace(/,/g, ''));

async function main() {
  const key = loadKey();
  const to = arg('to', new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const from = arg('from', `${Number(to.slice(0, 4)) - 10}${to.slice(4)}`);
  const years = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) || 10;

  console.log(`KRX 지수 수집: ${from} → ${to} (${years}년)`);

  const kospiPick = (rows) => {
    const r = rows.find((x) => x.IDX_NM === '코스피' && num(x.CLSPRC_IDX) > 0);
    return r ? num(r.CLSPRC_IDX) : null;
  };
  const bondPick = (rows) => {
    const r = rows.find((x) => num(x.TOT_EARNG_IDX) > 0);
    return r ? num(r.TOT_EARNG_IDX) : null;
  };

  const [kFrom, kTo, bFrom, bTo] = await Promise.all([
    fetchNearest(key, 'idx/kospi_dd_trd', from, kospiPick),
    fetchNearest(key, 'idx/kospi_dd_trd', to, kospiPick),
    fetchNearest(key, 'idx/bon_dd_trd', from, bondPick),
    fetchNearest(key, 'idx/bon_dd_trd', to, bondPick),
  ]);

  if (!kFrom || !kTo) throw new Error('코스피 지수를 가져오지 못했습니다.');

  const cagr = (a, b) => Math.pow(b / a, 1 / years) - 1;
  const round4 = (v) => Math.round(v * 10000) / 10000;

  const kospiPrice = cagr(kFrom.value, kTo.value);
  const out = {
    version: `${to.slice(0, 4)}-${to.slice(4, 6)}`,
    asOf: new Date().toISOString().slice(0, 10),
    source: {
      name: 'KRX Open API 지수 시세정보',
      endpoint: 'data-dbg.krx.co.kr/svc/apis/idx',
      license: 'KRX 정보데이터시스템 이용약관',
    },
    range: { from: kFrom.day, to: kTo.day, years },
    kospi: {
      label: '코스피',
      fromIndex: kFrom.value,
      toIndex: kTo.value,
      priceCagr: round4(kospiPrice),
      dividendYieldAssumed: DIVIDEND_YIELD,
      totalReturnApprox: round4(kospiPrice + DIVIDEND_YIELD),
      measured: 'price-only',
      note:
        '가격지수 실측 CAGR 에 배당수익률 가정을 더한 총수익 근사치입니다. ' +
        'KRX 지수 API 에 코스피 총수익지수(TR)가 없어 근사가 불가피합니다.',
    },
    bond: bFrom && bTo
      ? {
          label: 'KRX 채권지수 (총수익)',
          fromIndex: bFrom.value,
          toIndex: bTo.value,
          totalReturnCagr: round4(cagr(bFrom.value, bTo.value)),
          measured: 'total-return',
          note: 'TOT_EARNG_IDX 는 총수익지수라 배당·이자 재투자가 이미 반영돼 있습니다. 근사가 아닙니다.',
        }
      : null,
  };

  const path = resolve(ROOT, `simulator/src/data/index-${out.version}.json`);
  writeFileSync(path, JSON.stringify(out, null, 1));

  console.log(`\n✓ ${path}\n`);
  console.log(
    `  코스피  ${kFrom.day} ${kFrom.value} → ${kTo.day} ${kTo.value}` +
      `\n          가격 CAGR ${(kospiPrice * 100).toFixed(2)}% + 배당 가정 ${(DIVIDEND_YIELD * 100).toFixed(1)}%` +
      ` = 총수익 근사 ${(out.kospi.totalReturnApprox * 100).toFixed(2)}%`
  );
  if (out.bond) {
    console.log(
      `  채권    ${bFrom.day} ${bFrom.value} → ${bTo.day} ${bTo.value}` +
        `\n          총수익 CAGR ${(out.bond.totalReturnCagr * 100).toFixed(2)}%  (실측, 근사 아님)`
    );
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
