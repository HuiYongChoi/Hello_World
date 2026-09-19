#!/usr/bin/env node
/**
 * 마산 생활권 **아파트 전월세 실거래**를 받아 스냅샷으로 굽습니다.
 *
 * 매수 시뮬레이터와 목적이 다릅니다. 여기는 **지금 살 집을 고르는** 자료입니다 —
 * 창원 5개 구와 함안군의 전월세 거래를 단지 단위로 접어, 어느 단지가 어느
 * 면적대에 얼마에 나가는지를 봅니다.
 *
 *   node scripts/fetch-masan-rent.mjs                 # 최근 24개월
 *   node scripts/fetch-masan-rent.mjs --months 36
 *
 * ## 이것은 매물이 아니라 거래입니다
 *
 * **지금 나와 있는 매물 목록이 아닙니다.** 국토부에 신고된 **체결된 계약**이라
 * 이미 나간 집들입니다. 그래서 이 자료로 할 수 있는 일은 "이 단지 59㎡가 최근
 * 얼마에 나갔나" 까지이고, "지금 빈 집이 있나" 는 답할 수 없습니다.
 *
 * 네이버 부동산 같은 매물 사이트는 공식 API 가 없고 약관상 크롤링이 금지돼
 * 있습니다. 그래서 **시세로 후보를 좁히고 매물 확인은 사람이** 하는 구조입니다.
 *
 * ## 전세와 월세를 갈라 담습니다
 *
 * `monthlyRent` 가 0이면 순수 전세, 아니면 (반)월세입니다. 둘을 섞어 중위를
 * 내면 보증금 분포가 뭉개집니다 — 월세 보증금 1천만원과 전세 1.5억이 같은
 * 줄에 들어가기 때문입니다.
 *
 * ## 함안·의령은 거래가 거의 없습니다
 *
 * 함안군은 월 4건, 의령군은 0건입니다. 그래서 "거기 살 집" 이 아니라
 * **마산에 살며 그쪽으로 출퇴근** 하는 그림이 맞고, 함안은 참고용으로만
 * 담습니다. 0건이 오류가 아니라 사실이므로 지역별 건수를 반드시 찍습니다.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

/**
 * 대상 시군구.
 *
 * `commute` 는 **함안·의령 방향 출퇴근 접근성**에 대한 판단이고 소요시간이
 * 아닙니다. 지도 API 가 없어 분 단위를 낼 수 없으므로, 지어낸 숫자 대신
 * 등급과 이유를 남깁니다 — 화면에서 사용자가 고쳐 쓸 수 있어야 합니다.
 */
const REGIONS = [
  {
    code: '48127',
    label: '창원시 마산회원구',
    short: '마산회원',
    commute: 'near',
    note: '내서읍(중리·삼계)이 함안 칠원과 맞붙어 있어 함안 방향이 가장 가깝습니다. 남해고속 서마산IC·함안IC 접근이 좋습니다.',
  },
  {
    code: '48125',
    label: '창원시 마산합포구',
    short: '마산합포',
    commute: 'mid',
    note: '구도심·해안권입니다. 함안 방향은 시내를 한 번 지나야 하지만 생활 인프라가 두껍습니다.',
  },
  {
    code: '48121',
    label: '창원시 의창구',
    short: '의창',
    commute: 'mid',
    note: '창원 시내 북쪽. 함안까지 국도·고속 모두 붙지만 마산회원보다 한 겹 멉니다.',
  },
  {
    code: '48123',
    label: '창원시 성산구',
    short: '성산',
    commute: 'far',
    note: '창원 남동쪽이라 함안·의령과 가장 멉니다. 대신 시세와 인프라는 창원에서 가장 두껍습니다.',
  },
  {
    code: '48129',
    label: '창원시 진해구',
    short: '진해',
    commute: 'far',
    note: '부산 방향입니다. 함안·의령 출퇴근에는 맞지 않습니다.',
  },
  {
    code: '48730',
    label: '함안군',
    short: '함안',
    commute: 'onsite',
    note: '지사 소재지 쪽입니다. 다만 아파트 전월세 거래가 월 몇 건뿐이라 선택지가 거의 없습니다.',
  },
  {
    code: '48720',
    label: '의령군',
    short: '의령',
    commute: 'onsite',
    note: '아파트 전월세 거래가 사실상 없습니다. 담아 두되 결과가 비는 것이 정상입니다.',
  },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadKey() {
  let text = '';
  try {
    text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  } catch {
    throw new Error('.env.local 이 없습니다. MOLIT_API_KEY 를 넣어 주세요.');
  }
  const m = text.match(/^MOLIT_API_KEY=(.+)$/m);
  if (!m) throw new Error('.env.local 에 MOLIT_API_KEY 가 없습니다.');
  // Encoding 키(%2B·%3D 포함)를 한 번 풀어 둡니다. URL.searchParams 가 다시
  // 인코딩하므로 여기서 안 풀면 이중 인코딩이 되어 "등록되지 않은 서비스키"가
  // 돌아옵니다 — 문구는 미등록이라 말하지만 실제로는 인코딩 사고입니다.
  const raw = m[1].trim();
  return /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;
}

const TAG = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};

/** 최근 N개월 — `202608` 형태로 뒤에서부터 */
function recentMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out.reverse();
}

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
    throw new Error(`API 오류 ${code}: ${TAG(xml, 'resultMsg') || TAG(xml, 'errMsg')}`);
  }

  const out = [];
  for (const it of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const deposit = Number(TAG(it, 'deposit').replace(/[,\s]/g, ''));
    const rent = Number(TAG(it, 'monthlyRent').replace(/[,\s]/g, '')) || 0;
    const area = Number(TAG(it, 'excluUseAr'));
    if (!deposit || !area) continue;
    out.push({
      aptSeq: TAG(it, 'aptSeq'),
      name: TAG(it, 'aptNm'),
      umd: TAG(it, 'umdNm'),
      road: TAG(it, 'roadnm'),
      buildYear: Number(TAG(it, 'buildYear')) || 0,
      area,
      floor: Number(TAG(it, 'floor')) || 0,
      year: Number(TAG(it, 'dealYear')),
      month: Number(TAG(it, 'dealMonth')),
      deposit,
      rent,
      renewal: TAG(it, 'contractType') === '갱신',
    });
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
};

/** 전용면적을 사람이 고르는 단위로 접습니다 — 59.97 과 59.99 는 같은 평형입니다. */
const areaBucket = (a) => Math.round(a);

const QUARTER_BASE_YEAR = 2000;
const quarterIndex = (year, month) =>
  (year - QUARTER_BASE_YEAR) * 4 + Math.floor((month - 1) / 3);

async function main() {
  const key = loadKey();
  const months = recentMonths(Number(arg('months', '24')));
  console.log(`수집: ${REGIONS.length}개 시군구 × ${months.length}개월`);

  /** aptSeq → 단지 */
  const complexes = new Map();
  const perRegion = new Map();
  let rows = 0;
  let failures = 0;

  for (const region of REGIONS) {
    process.stdout.write(`\n${region.label} `);
    perRegion.set(region.code, 0);
    for (const ym of months) {
      let deals = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          deals = await fetchMonth(key, region.code, ym);
          break;
        } catch (e) {
          if (attempt === 2) {
            failures++;
            console.warn(`\n  ! ${region.label} ${ym} 실패: ${e.message}`);
          } else {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
      }
      process.stdout.write('.');

      for (const d of deals) {
        rows++;
        perRegion.set(region.code, perRegion.get(region.code) + 1);
        const id = d.aptSeq || `${region.code}-${d.umd}-${d.name}`;
        if (!complexes.has(id)) {
          complexes.set(id, {
            id,
            name: d.name,
            umd: d.umd,
            road: d.road,
            regionCode: region.code,
            buildYear: d.buildYear,
            deals: [],
          });
        }
        const c = complexes.get(id);
        if (!c.buildYear && d.buildYear) c.buildYear = d.buildYear;
        c.deals.push(d);
      }
    }
  }
  process.stdout.write('\n');

  /*
   * 단지 × 전용면적대로 접습니다.
   *
   * 전세와 월세를 **갈라서** 담습니다. 섞으면 월세 보증금 1천만원과 전세
   * 1.5억이 한 줄에 들어가 중위가 뭉개집니다.
   */
  const out = [];
  for (const c of complexes.values()) {
    const bySize = new Map();
    for (const d of c.deals) {
      const a = areaBucket(d.area);
      if (!bySize.has(a)) bySize.set(a, []);
      bySize.get(a).push(d);
    }

    const sizes = [];
    for (const [area, ds] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
      const jeonse = ds.filter((d) => d.rent === 0);
      const wolse = ds.filter((d) => d.rent > 0);
      const last = ds.reduce((a, b) =>
        b.year * 12 + b.month > a.year * 12 + a.month ? b : a
      );
      const floors = ds.map((d) => d.floor).filter((f) => f > 0);

      sizes.push({
        area,
        n: ds.length,
        lastYm: `${last.year}${String(last.month).padStart(2, '0')}`,
        floorMin: floors.length ? Math.min(...floors) : 0,
        floorMax: floors.length ? Math.max(...floors) : 0,
        renewalShare: ds.length ? ds.filter((d) => d.renewal).length / ds.length : 0,
        jeonse: jeonse.length
          ? { n: jeonse.length, deposit: median(jeonse.map((d) => d.deposit)) }
          : null,
        wolse: wolse.length
          ? {
              n: wolse.length,
              deposit: median(wolse.map((d) => d.deposit)),
              rent: median(wolse.map((d) => d.rent)),
            }
          : null,
        // 전세 보증금 분기 중위 — 오르는 중인지 보려고 시계열 하나만 둡니다.
        trend: (() => {
          const byQ = new Map();
          for (const d of jeonse) {
            const q = quarterIndex(d.year, d.month);
            if (!byQ.has(q)) byQ.set(q, []);
            byQ.get(q).push(d.deposit);
          }
          return [...byQ.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([q, xs]) => [q, xs.length, median(xs)]);
        })(),
      });
    }

    out.push({
      id: c.id,
      name: c.name,
      umd: c.umd,
      road: c.road,
      regionCode: c.regionCode,
      buildYear: c.buildYear,
      sizes,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const now = new Date();
  const version = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const snapshot = {
    version,
    asOf: now.toISOString().slice(0, 10),
    unit: 'manwon',
    unitNote: '보증금·월세는 만원 단위 정수입니다. 엔진에서 10000을 곱해 원으로 씁니다.',
    quarterBaseYear: QUARTER_BASE_YEAR,
    trendFormat: ['quarterIndex', 'dealCount', 'medianDepositManwon'],
    source: {
      name: '국토교통부 아파트 전월세 실거래가 자료',
      endpoint: 'apis.data.go.kr/1613000/RTMSDataSvcAptRent',
      license: '공공누리 제1유형',
      note: '체결된 계약이지 매물이 아닙니다. 지금 빈 집이 있는지는 이 자료로 알 수 없습니다.',
    },
    range: { from: months[0], to: months[months.length - 1] },
    stats: {
      deals: rows,
      complexes: out.length,
      failedRequests: failures,
      perRegion: Object.fromEntries(perRegion),
    },
    regions: REGIONS,
    complexes: out,
  };

  const file = resolve(ROOT, `simulator/src/data/masan-rent-${version}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot), 'utf8');

  console.log('\n지역별 거래:');
  for (const r of REGIONS) {
    console.log(`  ${r.label.padEnd(14)} ${String(perRegion.get(r.code) ?? 0).padStart(6)}건`);
  }
  const kb = Math.round(Buffer.byteLength(JSON.stringify(snapshot)) / 1024);
  console.log(`\n저장: ${file} (${kb}KB · 단지 ${out.length}개 · 거래 ${rows}건)`);
  if (failures) console.log(`실패 요청 ${failures}건 — 다시 돌리면 채워집니다.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
