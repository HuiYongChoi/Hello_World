#!/usr/bin/env node
/**
 * 국토교통부 아파트 **전월세** 실거래가를 받아 전세가율·전월세전환율을 실측합니다.
 *
 * 3-way 비교 화면의 전세가율(72%)·전월세전환율(6.2%)은 제가 지어낸 자리표시자였습니다.
 * 이 둘은 매수/전세/월세 순위를 직접 뒤집는 값이라, 실측 전까지 그 화면의 절대 금액에는
 * 의미가 없었습니다.
 *
 * ## 어떻게 재는가
 *
 * 전월세 자료에는 매매 자료와 **같은 `aptSeq`** 가 들어 있습니다. 그래서 시장 평균끼리
 * 나누는 대신 **같은 단지 · 같은 평형 · 같은 분기**끼리 짝지어 비율을 냅니다. 시장 전체
 * 평균으로 나누면 매매가 많이 일어난 단지와 전세가 많이 일어난 단지가 뒤섞여, 실제로는
 * 없는 비율이 나옵니다.
 *
 *   전세가율     = 전세보증금 ÷ 같은 칸의 매매 중위가
 *   전월세전환율 = (월세 × 12) ÷ (전세보증금 − 월세보증금)
 *
 * 짝이 지어진 표본만 남기고 **중위값**을 씁니다. 평균은 이상치에 끌려갑니다.
 *
 *   node scripts/fetch-rent.mjs                    # 최근 3년
 *   node scripts/fetch-rent.mjs --from 202001
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
const MARKET_PATH = resolve(ROOT, 'simulator/src/data/market-2026-08.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadKey() {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(/^MOLIT_API_KEY=(.+)$/m);
  if (!m) throw new Error('.env.local 에 MOLIT_API_KEY 가 없습니다.');
  const raw = m[1].trim();
  return /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;
}

function* months(from, to) {
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4, 6));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(4, 6));
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}${String(m).padStart(2, '0')}`;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
}

const TAG = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};

const num = (s) => Number(String(s).replace(/[,\s]/g, '')) || 0;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const quantile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

async function fetchMonth(key, lawdCd, dealYmd) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('LAWD_CD', lawdCd);
  url.searchParams.set('DEAL_YMD', dealYmd);
  url.searchParams.set('numOfRows', '1000');
  url.searchParams.set('pageNo', '1');

  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const xml = await res.text();
  const code = TAG(xml, 'resultCode');
  if (code && code !== '000' && code !== '00') {
    throw new Error(`API 오류 ${code}: ${TAG(xml, 'resultMsg')}`);
  }

  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? [])
    .map((it) => ({
      aptSeq: TAG(it, 'aptSeq'),
      area: Number(TAG(it, 'excluUseAr')),
      deposit: num(TAG(it, 'deposit')),
      monthlyRent: num(TAG(it, 'monthlyRent')),
      year: Number(TAG(it, 'dealYear')),
      month: Number(TAG(it, 'dealMonth')),
    }))
    .filter((d) => d.aptSeq && d.area && d.deposit > 0);
}

async function main() {
  const key = loadKey();
  const market = JSON.parse(readFileSync(MARKET_PATH, 'utf8'));
  const QBASE = market.quarterBaseYear;
  const quarterIndex = (y, m) => (y - QBASE) * 4 + Math.floor((m - 1) / 3);

  // 매매 중위가 색인: aptSeq|area|q → 만원
  const sale = new Map();
  for (const c of market.complexes) {
    for (const s of c.sizes) {
      for (const [q, , med] of s.points) sale.set(`${c.id}|${s.area}|${q}`, med);
    }
  }
  const regionOf = new Map(market.complexes.map((c) => [c.id, c.regionCode]));

  const now = new Date();
  const to = arg('to', `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`);
  // 전세가율은 지금 얼마인지가 중요합니다. 10년 평균은 현재 의사결정에 안 맞습니다.
  const from = arg('from', `${now.getFullYear() - 3}${String(now.getMonth() + 1).padStart(2, '0')}`);
  const monthList = [...months(from, to)];

  console.log(`전월세 수집: 지역 ${market.regions.length}곳 × ${monthList.length}개월`);

  /** regionCode → 전세가율 표본 */
  const jeonseRatios = new Map();
  /** aptSeq|area|q → 전세보증금 목록 (전월세전환율 계산에 필요) */
  const jeonseByCell = new Map();
  const wolseDeals = [];
  const perRegion = new Map();
  let rows = 0;
  let failures = 0;

  for (const region of market.regions) {
    process.stdout.write(`\n${region.label} `);
    perRegion.set(region.code, 0);
    jeonseRatios.set(region.code, []);

    for (const ym of monthList) {
      let deals = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          deals = await fetchMonth(key, region.code, ym);
          break;
        } catch (e) {
          if (attempt === 2) {
            failures++;
            console.warn(`\n  ! ${region.label} ${ym}: ${e.message}`);
          } else {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
      }

      for (const d of deals) {
        rows++;
        perRegion.set(region.code, perRegion.get(region.code) + 1);
        const cell = `${d.aptSeq}|${Math.round(d.area)}|${quarterIndex(d.year, d.month)}`;

        if (d.monthlyRent === 0) {
          if (!jeonseByCell.has(cell)) jeonseByCell.set(cell, []);
          jeonseByCell.get(cell).push(d.deposit);

          const salePrice = sale.get(cell);
          // 같은 단지·평형·분기에 매매가 없으면 비율을 낼 수 없습니다.
          if (salePrice) {
            const ratio = d.deposit / salePrice;
            // 갱신·특수관계 거래에서 나오는 극단값은 버립니다.
            if (ratio > 0.2 && ratio < 1.1) jeonseRatios.get(region.code).push(ratio);
          }
        } else {
          wolseDeals.push({ cell, region: region.code, ...d });
        }
      }
      process.stdout.write('.');
    }
  }

  // 전월세전환율 — 같은 칸의 전세보증금과 짝지어야 성립합니다.
  const conversion = new Map(market.regions.map((r) => [r.code, []]));
  for (const w of wolseDeals) {
    const js = jeonseByCell.get(w.cell);
    if (!js || js.length === 0) continue;
    const jeonse = median(js);
    const gap = jeonse - w.deposit;
    if (gap <= 0) continue;
    const rate = (w.monthlyRent * 12) / gap;
    if (rate > 0.01 && rate < 0.2) conversion.get(w.region)?.push(rate);
  }

  const round4 = (v) => Math.round(v * 10000) / 10000;
  const summarize = (xs) =>
    xs.length === 0
      ? null
      : {
          n: xs.length,
          median: round4(median(xs)),
          p25: round4(quantile(xs, 0.25)),
          p75: round4(quantile(xs, 0.75)),
        };

  const byRegionCode = {};
  for (const r of market.regions) {
    byRegionCode[r.code] = {
      label: r.label,
      region: r.region,
      deals: perRegion.get(r.code) ?? 0,
      jeonseRatio: summarize(jeonseRatios.get(r.code) ?? []),
      conversionRate: summarize(conversion.get(r.code) ?? []),
    };
  }

  // 권역(창원·부산·경기) 단위로도 접어 둡니다 — 엔진이 지역군 단위로 씁니다.
  const byRegion = {};
  for (const key3 of ['changwon', 'busan', 'gyeonggi']) {
    const codes = market.regions.filter((r) => r.region === key3).map((r) => r.code);
    const j = codes.flatMap((c) => jeonseRatios.get(c) ?? []);
    const v = codes.flatMap((c) => conversion.get(c) ?? []);
    byRegion[key3] = { jeonseRatio: summarize(j), conversionRate: summarize(v) };
  }

  const out = {
    version: market.version,
    asOf: now.toISOString().slice(0, 10),
    source: {
      name: '국토교통부 아파트 전월세 실거래가 자료',
      endpoint: 'apis.data.go.kr/1613000/RTMSDataSvcAptRent',
      license: '공공누리 제1유형',
      note: '같은 단지·평형·분기끼리 짝지어 비율을 냈습니다. 짝이 없는 거래는 제외했습니다.',
    },
    range: { from, to },
    stats: { deals: rows, failedRequests: failures },
    method: {
      jeonseRatio: '전세보증금 ÷ 같은 단지·평형·분기의 매매 중위가 (0.2~1.1 밖은 제외)',
      conversionRate:
        '(월세×12) ÷ (같은 칸 전세보증금 중위 − 월세보증금), 1~20% 밖은 제외',
    },
    byRegion,
    byRegionCode,
  };

  const path = resolve(ROOT, `simulator/src/data/rent-${out.version}.json`);
  writeFileSync(path, JSON.stringify(out, null, 1));

  console.log(`\n\n✓ ${path}`);
  console.log(`  전월세 거래 ${rows.toLocaleString('ko-KR')}건 (요청 실패 ${failures}회)\n`);
  for (const [code, v] of Object.entries(byRegionCode)) {
    const j = v.jeonseRatio;
    const c = v.conversionRate;
    console.log(
      `  ${v.label.padEnd(18)} 전세가율 ${j ? (j.median * 100).toFixed(1) + '%' : '—'}` +
        ` (표본 ${j?.n ?? 0})   전환율 ${c ? (c.median * 100).toFixed(2) + '%' : '—'} (표본 ${c?.n ?? 0})`
    );
  }
  console.log('\n  권역 요약');
  for (const [k, v] of Object.entries(byRegion)) {
    console.log(
      `    ${k.padEnd(10)} 전세가율 ${v.jeonseRatio ? (v.jeonseRatio.median * 100).toFixed(1) + '%' : '—'}` +
        `  ·  전월세전환율 ${v.conversionRate ? (v.conversionRate.median * 100).toFixed(2) + '%' : '—'}`
    );
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
