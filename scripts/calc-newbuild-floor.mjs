#!/usr/bin/env node
/**
 * 신축 하한가를 실거래로 계산해 룰셋에 넣을 값을 냅니다.
 *
 * "이 지역 신축은 얼마 아래로는 없다"는 선인데, 지금까지는 제가 찍은 자리표시자였습니다.
 * 그런데 이 값 하나가 **애매 구간 판정**을 가릅니다 — 신축도 재건축도 아닌 물건을
 * "매수할 이유가 약하다"로 넘길지 말지가 여기서 갈립니다.
 *
 * ## 왜 최저가가 아니라 하위 25%인가
 *
 * 최저가는 이상치입니다. 외곽 나홀로 단지 한 건이 전체 판정을 흔듭니다. 실제로
 * 창원 전체 최저는 1.29억(동읍 용잠리)인데 성산구 신축 중위는 7.38억이었습니다.
 * 하위 25%는 "이 아래는 사실상 없다"에 훨씬 가깝습니다.
 *
 * ## 왜 권역이 아니라 시군구인가
 *
 * 창원 하나로 묶으면 성산구(4억 미만 8%)와 마산·진해(76%)가 평균으로 상쇄돼
 * 어느 쪽 현실도 아닌 값이 나옵니다.
 *
 *   node scripts/calc-newbuild-floor.mjs            # 값만 출력
 *   node scripts/calc-newbuild-floor.mjs --write    # 룰셋에 반영
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKET = resolve(ROOT, 'simulator/src/data/market-2026-08.json');
const RULES = resolve(ROOT, 'simulator/src/rules/2026-08.json');

/** 신축 판정 기준 — 룰셋의 newBuildMaxAge 와 맞춥니다 */
const NEW_BUILD_SINCE_YEAR = new Date().getFullYear() - 7;
/** 전용면적 대역 — 84㎡ 안팎만 봅니다. 소형·대형이 섞이면 분포가 흐려집니다 */
const AREA_MIN = 70;
const AREA_MAX = 100;
/** 최근 거래만 — 오래된 가격은 지금 하한이 아닙니다 */
const RECENT_QUARTERS = 8;

const quantile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

const eok = (v) => `${(v / 1e8).toFixed(2)}억`;

// Math.max(...xs) 는 20만 개 배열에서 스택을 넘깁니다. 스냅샷이 그 규모입니다.
const maxOf = (xs) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);
const minOf = (xs) => xs.reduce((a, b) => (b < a ? b : a), Infinity);

function main() {
  const market = JSON.parse(readFileSync(MARKET, 'utf8'));
  const rules = JSON.parse(readFileSync(RULES, 'utf8'));

  let lastQ = -Infinity;
  for (const c of market.complexes) {
    for (const s of c.sizes) {
      for (const p of s.points) if (p[0] > lastQ) lastQ = p[0];
    }
  }
  const cutoffQ = lastQ - RECENT_QUARTERS;

  const byDistrict = new Map();
  const byRegion = new Map();

  for (const c of market.complexes) {
    if (!c.buildYear || c.buildYear < NEW_BUILD_SINCE_YEAR) continue;
    for (const s of c.sizes) {
      if (s.area < AREA_MIN || s.area > AREA_MAX) continue;
      for (const [q, , med] of s.points) {
        if (q < cutoffQ) continue;
        const won = med * 10000;
        if (!byDistrict.has(c.regionCode)) byDistrict.set(c.regionCode, []);
        byDistrict.get(c.regionCode).push(won);
        if (!byRegion.has(c.region)) byRegion.set(c.region, []);
        byRegion.get(c.region).push(won);
      }
    }
  }

  const label = new Map(market.regions.map((r) => [r.code, r.label]));
  /**
   * 판정에는 하위 25%를 쓰지만 최저가도 같이 남깁니다.
   * 둘의 간격이 곧 그 지역 신축 가격대의 폭이고, 간격이 크면 하위 25%도
   * 그만큼 덜 단단하다는 뜻이라 화면에서 함께 읽어야 합니다.
   */
  const districtOut = {};
  console.log(
    `신축 = ${NEW_BUILD_SINCE_YEAR}년 이후 준공 · 전용 ${AREA_MIN}~${AREA_MAX}㎡ · 최근 ${RECENT_QUARTERS}분기\n`
  );
  console.log('시군구             표본   하위10%    하위25%     중위      최저');
  for (const [code, xs] of [...byDistrict].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (xs.length < 8) {
      console.log(`${(label.get(code) ?? code).padEnd(18)} ${String(xs.length).padStart(4)}  표본 부족 — 권역값을 씁니다`);
      continue;
    }
    const round = (v) => Math.round(v / 1e6) * 1e6;
    const entry = {
      p25: round(quantile(xs, 0.25)),
      lowest: round(minOf(xs)),
      median: round(quantile(xs, 0.5)),
      n: xs.length,
    };
    districtOut[code] = entry;
    console.log(
      `${(label.get(code) ?? code).padEnd(18)} ${String(xs.length).padStart(4)}  ` +
        `${eok(quantile(xs, 0.1)).padStart(7)}  ${eok(entry.p25).padStart(7)}  ` +
        `${eok(entry.median).padStart(7)}  ${eok(entry.lowest).padStart(7)}`
    );
  }

  const regionOut = {};
  console.log('\n권역               표본   하위25%      최저');
  for (const [region, xs] of byRegion) {
    const round = (v) => Math.round(v / 1e6) * 1e6;
    regionOut[region] = {
      p25: round(quantile(xs, 0.25)),
      lowest: round(minOf(xs)),
      median: round(quantile(xs, 0.5)),
      n: xs.length,
    };
    console.log(
      `${region.padEnd(18)} ${String(xs.length).padStart(4)}  ` +
        `${eok(regionOut[region].p25).padStart(7)}  ${eok(regionOut[region].lowest).padStart(7)}`
    );
  }

  if (!process.argv.includes('--write')) {
    console.log('\n( --write 를 붙이면 룰셋에 반영합니다 )');
    return;
  }

  rules.appraisal.newBuildMinPrice = regionOut;
  rules.appraisal.newBuildMinPriceByDistrict = districtOut;
  rules.appraisal.newBuildMinPriceNote =
    `${NEW_BUILD_SINCE_YEAR}년 이후 준공 · 전용 ${AREA_MIN}~${AREA_MAX}㎡ · 최근 ${RECENT_QUARTERS}분기 실거래. ` +
    '판정에는 하위 25%(p25)를 씁니다 — 최저가는 외곽 나홀로 단지 한 건에 흔들립니다. ' +
    '다만 최저가(lowest)도 같이 담아 화면에 병기합니다. p25 와 lowest 의 간격이 크면 그 지역 신축 가격대가 넓다는 뜻이고, p25 도 그만큼 덜 단단합니다. ' +
    '시군구 값이 있으면 그것을, 없으면 권역값을 씁니다.';
  rules.appraisal.newBuildMinPriceAsOf = new Date().toISOString().slice(0, 10);

  writeFileSync(RULES, JSON.stringify(rules, null, 2) + '\n');
  console.log('\n✓ 룰셋 반영 완료');
}

main();
