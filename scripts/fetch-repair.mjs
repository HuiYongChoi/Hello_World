/**
 * 장기수선충당금 실측 — K-apt (data.go.kr).
 *
 * `maintenanceRate` 는 매수·청약 갈래만 부담하는 값이라 결론을 직접 흔듭니다.
 * 기본값 0.5% 는 통상값일 뿐 근거가 없었습니다.
 *
 * ## 세 API 를 이어 붙입니다
 *
 * ```
 * AptListService4/getSigunguAptList4      시군구 → 단지코드
 * AptBasisInfoServiceV5/getAphusBassInfoV5 단지코드 → 세대수·총전용면적
 * AptRepairsCostServiceV3/getHsmpMonthFeeInfoV3  단지코드 → 월 부과액
 * ```
 *
 * ## 왜 원/㎡ 로 내는가
 *
 * 월 부과액은 **단지 전체** 금액이라 그대로는 못 씁니다. 세대수로 나누면
 * 세대 크기가 섞이고(84㎡ 단지와 59㎡ 단지가 뒤섞임), 주택가격으로 나누려면
 * 단지별 시세를 또 붙여야 합니다.
 *
 * **총 전용면적으로 나눈 원/㎡/월** 이 가장 안정적입니다. 화면에서 그 물건의
 * ㎡당 가격으로 나누면 곧바로 비율이 됩니다.
 *
 * ## 이것은 수선유지비의 전부가 아닙니다
 *
 * 장기수선충당금은 **공용부 대규모 수선**(외벽·승강기·배관) 적립금입니다.
 * 세대 내부 수선(도배·싱크대·보일러)은 소유자가 따로 냅니다. 그래서 이 값은
 * 수선유지비의 **하한**이고, 그대로 `maintenanceRate` 에 넣으면 매수 갈래가
 * 부당하게 유리해집니다. 실측분과 가정분을 갈라서 씁니다.
 *
 * ```
 * node scripts/fetch-repair.mjs [--per-district 40]
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'simulator/src/data/repair.json');
const BASE = 'https://apis.data.go.kr/1613000';

function envValue(name) {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`.env.local 에 ${name} 이 없습니다.`);
  return m[1].trim();
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** 키는 Encoding 키입니다 — 다시 인코딩하면 안 됩니다. */
const KEY = envValue('MOLIT_API_KEY');

async function call(path, params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${BASE}/${path}?serviceKey=${KEY}&${qs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes('SERVICE_KEY_IS_NOT_REGISTERED')) {
    throw new Error(`${path} — 키가 등록되지 않았습니다. 활용신청을 확인하세요.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const quantile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

/** 최근 확정 월. 당월은 아직 안 올라와 있는 경우가 많습니다. */
function recentMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const regionsRaw = JSON.parse(
    readFileSync(resolve(ROOT, 'simulator/src/data/regions.json'), 'utf8')
  );
  const districts = regionsRaw.regions.filter((d) => d.collect);
  const perDistrict = Number(arg('per-district', 40));
  const searchDate = arg('month', recentMonth());

  console.log(`장기수선충당금 수집 — ${districts.length}개 시군구 · 단지당 ${perDistrict}개 · ${searchDate}\n`);

  const samples = [];
  const byDistrict = {};
  let failed = 0;

  for (const d of districts) {
    const list = await call('AptListService4/getSigunguAptList4', {
      sigunguCode: d.code,
      pageNo: 1,
      numOfRows: perDistrict,
    });
    const items = list?.response?.body?.items ?? [];
    const rows = Array.isArray(items) ? items : [items];
    const perM2 = [];

    for (const it of rows) {
      if (!it?.kaptCode) continue;
      try {
        const [basis, fee] = await Promise.all([
          call('AptBasisInfoServiceV5/getAphusBassInfoV5', { kaptCode: it.kaptCode }),
          call('AptRepairsCostServiceV3/getHsmpMonthFeeInfoV3', {
            kaptCode: it.kaptCode,
            searchDate,
          }),
        ]);
        const b = basis?.response?.body?.item;
        const f = fee?.response?.body?.item;
        const marea = Number(b?.kaptMarea);
        const levy = Number(f?.sLevy);
        const da = Number(b?.kaptdaCnt);
        // 전용면적이 없거나 부과액이 0이면 그 달에 안 걷은 것이라 표본에서 뺍니다.
        if (!(marea > 0) || !(levy > 0) || !(da > 0)) continue;
        const v = levy / marea; // 원/㎡/월
        perM2.push(v);
        samples.push({
          district: d.label,
          region: d.region,
          name: b.kaptName,
          households: da,
          areaTotal: marea,
          levy,
          perM2: Math.round(v * 100) / 100,
        });
      } catch {
        failed++;
      }
    }

    if (perM2.length >= 3) {
      byDistrict[d.code] = {
        label: d.label,
        region: d.region,
        n: perM2.length,
        median: Math.round(median(perM2) * 100) / 100,
        p25: Math.round(quantile(perM2, 0.25) * 100) / 100,
        p75: Math.round(quantile(perM2, 0.75) * 100) / 100,
      };
    }
    console.log(
      `  ${d.label.padEnd(14)} 단지 ${String(rows.length).padStart(3)}개 → 표본 ${String(perM2.length).padStart(3)}개` +
        (perM2.length >= 3 ? `  중위 ${median(perM2).toFixed(1)}원/㎡/월` : '  (표본 부족)')
    );
  }

  if (samples.length < 20) throw new Error(`표본이 ${samples.length}건뿐입니다.`);

  const byRegion = {};
  for (const region of ['changwon', 'busan', 'gyeonggi']) {
    const vs = samples.filter((s) => s.region === region).map((s) => s.perM2);
    if (vs.length < 3) continue;
    byRegion[region] = {
      n: vs.length,
      median: Math.round(median(vs) * 100) / 100,
      p25: Math.round(quantile(vs, 0.25) * 100) / 100,
      p75: Math.round(quantile(vs, 0.75) * 100) / 100,
    };
  }

  const all = samples.map((s) => s.perM2);
  const out = {
    note:
      '공동주택 장기수선충당금 월 부과액 ÷ 총 전용면적 = 원/㎡/월. ' +
      '단지 전체 금액이라 그대로는 못 쓰고, 세대수로 나누면 세대 크기가 섞이므로 ' +
      '면적으로 나눕니다. **이 값은 공용부 대규모 수선 적립금뿐이고 세대 내부 ' +
      '수선(도배·싱크대·보일러)은 빠져 있어 수선유지비의 하한입니다.**',
    source: 'data.go.kr · 국토교통부 K-apt (단지목록 + 기본정보 + 관리비)',
    unit: '원/㎡/월',
    searchDate,
    asOf: new Date().toISOString().slice(0, 10),
    stats: { complexes: samples.length, districts: Object.keys(byDistrict).length, failed },
    overall: {
      n: all.length,
      median: Math.round(median(all) * 100) / 100,
      p25: Math.round(quantile(all, 0.25) * 100) / 100,
      p75: Math.round(quantile(all, 0.75) * 100) / 100,
    },
    byRegion,
    byDistrict,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\n✓ ${OUT}`);
  console.log(`  표본 ${samples.length}개 단지 · 전체 중위 ${out.overall.median}원/㎡/월`);
  for (const [r, v] of Object.entries(byRegion)) {
    console.log(`  ${r.padEnd(9)} ${v.median}원/㎡/월 (${v.p25}~${v.p75}, n=${v.n})`);
  }
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
