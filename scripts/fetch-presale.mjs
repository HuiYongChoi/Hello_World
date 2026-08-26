#!/usr/bin/env node
/**
 * 국토교통부 아파트 **분양권·입주권 전매** 실거래가를 받아 스냅샷으로 굽습니다.
 *
 * 청약 축(로드맵 4번)에 필요한 자료입니다. 분양가로 들어간 뒤 실제로 얼마에
 * 거래되는지 — 즉 프리미엄이 얼마나 붙는지가 여기 있습니다.
 *
 * ## 0건이 정상인 지역이 있습니다
 *
 * 전매제한이 걸린 곳은 거래 자체가 없습니다. 화성 동탄·병점이 그렇고, 평택은
 * 월 30~100건씩 나옵니다. 매매 수집기와 달리 **0건을 오류로 보면 안 됩니다** —
 * 대신 지역별 건수를 반드시 찍어 어디가 비었는지 보이게 합니다.
 *
 * `ownershipGbn` 이 분양권(분)과 입주권(입)을 가릅니다. 입주권은 재건축·재개발
 * 조합원 물건이라 성격이 달라 따로 셉니다.
 */

/**
 * (원본 주석) 국토교통부 실거래가를 **빌드 타임에** 받아 스냅샷으로 굽습니다.
 *
 * 이 저장소는 공개이고 결과물은 단일 정적 HTML이라, API 키를 런타임에 둘 수 없습니다.
 * 그래서 여기서 받아 `simulator/src/data/market-YYYY-MM.json` 으로 구워 넣고,
 * 화면은 그 스냅샷만 읽습니다. 키는 `.env.local` (gitignore) 에서만 옵니다.
 *
 *   node scripts/fetch-market.mjs                       # 기본 범위
 *   node scripts/fetch-market.mjs --from 201601 --to 202608
 *   node scripts/fetch-market.mjs --regions 48123,48121
 *
 * 원자료는 거래 한 건 단위라 그대로 담으면 수만 건이 됩니다. 화면에 필요한 건
 * "단지 × 평형 × 분기 중위가"뿐이라 **분기 중위가로 접어서** 저장합니다.
 * 중위가를 쓰는 이유는 층·향 차이로 생기는 이상치에 평균이 끌려가기 때문입니다.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';

/**
 * 대상 지역은 `simulator/src/data/regions.json` 에서 옵니다 (`collect: true` 만).
 * 후보군과 제외 사유도 같은 파일에 있어, 무엇을 왜 안 받는지가 코드가 아니라
 * 데이터로 남습니다.
 *
 * 법정동코드는 **행정구역이 바뀌면 같이 바뀝니다.** 화성시는 구가 설치되면서
 * 41590 이 폐지되고 동탄·병점 등으로 갈렸습니다. 폐지된 코드는 오류가 아니라
 * `totalCount=0` 으로 조용히 돌아오므로, 수집 후 지역별 건수를 반드시 확인하세요.
 * 라벨도 마찬가지입니다 — 26260 을 수영구로 적어 뒀다가 실제로는 동래구였던
 * 적이 있습니다. API 의 `estateAgentSggNm` 로 대조하세요.
 */
const REGIONS = JSON.parse(
  readFileSync(resolve(ROOT, 'simulator/src/data/regions.json'), 'utf8')
).regions.filter((r) => r.collect);

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
  // 발급 화면에서 Encoding 키를 복사하면 %2B·%3D 가 섞여 옵니다. 한 번 풀어 둡니다.
  const raw = m[1].trim();
  return /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;
}

/** 월 단위 반복자 — 201601 형태 */
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

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out = [];
  for (const it of items) {
    // 해제된 거래는 실제로 일어나지 않은 거래입니다. 남기면 수익률이 오염됩니다.
    if (TAG(it, 'cdealType') === 'O') continue;

    const amount = Number(TAG(it, 'dealAmount').replace(/[,\s]/g, ''));
    const area = Number(TAG(it, 'excluUseAr'));
    if (!amount || !area) continue;

    out.push({
      aptSeq: TAG(it, 'aptSeq'),
      name: TAG(it, 'aptNm'),
      umd: TAG(it, 'umdNm'),
      buildYear: Number(TAG(it, 'buildYear')) || 0,
      area,
      floor: Number(TAG(it, 'floor')) || 0,
      year: Number(TAG(it, 'dealYear')),
      month: Number(TAG(it, 'dealMonth')),
      amountManwon: amount,
    });
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * 분기를 정수 하나로 접습니다 — 2000Q1 = 0, 2016Q1 = 64.
 * 스냅샷이 통째로 단일 HTML에 인라인되므로 바이트가 곧 로딩 시간입니다.
 * "2016Q1" 문자열 대신 64를 쓰면 전체 파일이 절반 가까이 줄어듭니다.
 */
const QUARTER_BASE_YEAR = 2000;
const quarterIndex = (year, month) =>
  (year - QUARTER_BASE_YEAR) * 4 + Math.floor((month - 1) / 3);

async function main() {
  const key = loadKey();
  const now = new Date();
  const to = arg('to', `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`);
  const from = arg('from', '201601');
  const only = arg('regions', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const targets = only.length ? REGIONS.filter((r) => only.includes(r.code)) : REGIONS;

  const monthList = [...months(from, to)];
  console.log(`수집: 지역 ${targets.length}곳 × ${monthList.length}개월 = ${targets.length * monthList.length}회 요청`);

  /** aptSeq → 단지 */
  const complexes = new Map();
  let rows = 0;
  let failures = 0;

  /** 지역별 수집 건수 — 0이면 코드가 폐지됐다는 신호입니다 */
  const perRegion = new Map();

  for (const region of targets) {
    process.stdout.write(`\n${region.label} `);
    perRegion.set(region.code, 0);
    for (const ym of monthList) {
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

      for (const d of deals) {
        rows++;
        perRegion.set(region.code, perRegion.get(region.code) + 1);
        // 분양권 자료에는 aptSeq 가 없어 단지명+법정동으로 키를 만듭니다.
        const id = d.aptSeq || `${region.code}-${d.umd}-${d.name}`;
        if (!complexes.has(id)) {
          complexes.set(id, {
            id,
            name: d.name,
            umd: d.umd,
            regionCode: region.code,
            region: region.region,
            buildYear: d.buildYear,
            sizes: new Map(),
          });
        }
        const c = complexes.get(id);
        if (!c.buildYear && d.buildYear) c.buildYear = d.buildYear;

        // 같은 평형인데 소수점만 다른 경우가 많아 ㎡ 정수로 묶습니다.
        const bucket = Math.round(d.area);
        if (!c.sizes.has(bucket)) c.sizes.set(bucket, new Map());
        const q = quarterIndex(d.year, d.month);
        const qs = c.sizes.get(bucket);
        if (!qs.has(q)) qs.set(q, []);
        qs.get(q).push(d.amountManwon);
      }
      process.stdout.write('.');
    }
  }

  const out = {
    version: `${to.slice(0, 4)}-${to.slice(4, 6)}`,
    asOf: now.toISOString().slice(0, 10),
    unit: 'manwon',
    unitNote: '금액은 만원 단위 정수입니다. 엔진에서 10000을 곱해 원으로 씁니다.',
    quarterBaseYear: QUARTER_BASE_YEAR,
    pointFormat: ['quarterIndex', 'dealCount', 'medianManwon'],
    source: {
      name: '국토교통부 아파트 분양권전매 실거래가 자료',
      endpoint: 'apis.data.go.kr/1613000/RTMSDataSvcSilvTrade',
      license: '공공누리 제1유형',
      note: '해제(cdealType=O)된 거래는 제외했습니다. 분기 중위가로 접었습니다.',
    },
    range: { from, to },
    stats: { deals: rows, complexes: complexes.size, failedRequests: failures },
    regions: targets,
    complexes: [...complexes.values()]
      .map((c) => ({
        id: c.id,
        name: c.name,
        umd: c.umd,
        regionCode: c.regionCode,
        region: c.region,
        buildYear: c.buildYear,
        sizes: [...c.sizes.entries()]
          .map(([area, qs]) => ({
            area,
            points: [...qs.entries()]
              .map(([q, amounts]) => [q, amounts.length, median(amounts)])
              .sort((a, b) => a[0] - b[0]),
          }))
          // 분양권은 거래가 드물어 매매만큼 요건을 세우면 다 걸러집니다.
          .filter((s) => s.points.length >= 2)
          .sort((a, b) => a.area - b.area),
      }))
      // 거래가 손에 꼽는 단지는 수익률을 낼 수 없습니다.
      .filter((c) => c.sizes.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  };

  const dir = resolve(ROOT, 'simulator/src/data');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `presale-${out.version}.json`);
  writeFileSync(path, JSON.stringify(out));

  console.log(`\n\n✓ ${path}`);
  console.log(
    `  거래 ${rows.toLocaleString('ko-KR')}건 → 단지 ${out.complexes.length}개 (요청 실패 ${failures}회)`
  );
  console.log(`  파일 크기 ${(JSON.stringify(out).length / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n  지역별 거래 건수');
  for (const r of targets) {
    const n = perRegion.get(r.code) ?? 0;
    console.log(`    ${r.label.padEnd(18)} ${n.toLocaleString('ko-KR').padStart(9)}건${n === 0 ? '   ← 0건! 법정동코드가 폐지됐는지 확인하세요' : ''}`);
  }
  const dead = targets.filter((r) => (perRegion.get(r.code) ?? 0) === 0);
  if (dead.length > 0) {
    console.warn(
      `\n  ! ${dead.length}개 지역이 0건입니다: ${dead.map((r) => `${r.label}(${r.code})`).join(', ')}`
    );
    console.warn('    분양권은 전매제한이 걸리면 거래가 없습니다 — 이 자료에서는 정상일 수 있습니다.');
    console.warn('    다만 매매 수집에서도 0건이면 그때는 법정동코드를 의심하세요.');
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
