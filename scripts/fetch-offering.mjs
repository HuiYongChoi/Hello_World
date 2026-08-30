/**
 * 청약홈 분양정보 수집 — 한국부동산원 (data.go.kr / odcloud).
 *
 * 공고 안전마진 화면(`offering.ts`)은 지금 분양가·전용면적·입주예정월을 손으로
 * 받습니다. 새 공고가 뜰 때마다 공고문 PDF 를 열어 옮겨 적어야 하니, 5분 안에
 * 거르자는 화면의 취지가 입력에서 먼저 무너집니다. 이 수집기가 `SubscriptionPlan`
 * 의 대부분을 미리 채워 **목록에서 고르기**로 바꿉니다.
 *
 * ## 두 API 를 이어 붙입니다
 *
 * ```
 * getAPTLttotPblancDetail  공고 단위 — 주택명·공급위치·총세대·모집공고일·입주예정월
 * getAPTLttotPblancMdl     주택형 단위 — 전용면적·공급세대·분양가
 * ```
 *
 * 조인 키는 `HOUSE_MANAGE_NO` 입니다. 분양권전매를 단지명으로 조인해야 했던 것과
 * 달리 여기는 키가 있어 안전합니다.
 *
 * ## 면적을 SUPLY_AR 로 받으면 안 됩니다
 *
 * `SUPLY_AR` 는 **공급면적**입니다. 엔진의 `areaSqm` 은 전용면적이고 ㎡당 가격과
 * LTV 면적 요건에 쓰이므로, 공급면적을 넣으면 전용 84㎡ 가 110㎡ 로 들어가
 * ㎡당 가격이 30% 가까이 싸 보입니다. 전용면적은 **주택형(`HOUSE_TY`)** 에
 * 있습니다 — `"084.9500A"` 의 앞 숫자가 전용 84.95㎡ 입니다. 그래서 주택형을
 * 파싱해 쓰고 공급면적은 참고로만 남깁니다.
 *
 * ## API 에 없는 것
 *
 * **중도금 조건(이자후불 여부·금리)과 전매제한은 단지 공고문에만 있습니다.**
 * 이 둘은 채우지 않고 `null` 로 둡니다. 0 으로 채우면 화면이 "전매제한 없음"
 * 으로 읽어 계산이 조용히 틀립니다.
 *
 * ## 금액 단위
 *
 * `LTTOT_TOP_AMOUNT` 는 **만원 단위**입니다. 매매·전월세 스냅샷과 같은 규약으로
 * 만원 정수로 저장하고 엔진에서 10000 을 곱합니다 (결과물이 단일 HTML 이라
 * 바이트가 곧 로딩 시간입니다).
 *
 * ```
 * node scripts/fetch-offering.mjs                 # 최근 12개월 · 수집 대상 시군구
 * node scripts/fetch-offering.mjs --months 24
 * node scripts/fetch-offering.mjs --probe         # 원문 1건을 그대로 출력 (필드명 대조용)
 * node scripts/fetch-offering.mjs --all-regions   # 지역 필터 없이 (표본 확인용, 저장 안 함)
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1';

function envValue(name) {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`.env.local 에 ${name} 이 없습니다.`);
  return m[1].trim();
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

/**
 * 키는 Encoding 키입니다 — URL 에 그대로 붙이고 다시 인코딩하지 마세요.
 * `%2B` 가 `%252B` 가 되면 SERVICE_KEY_IS_NOT_REGISTERED 로 돌아옵니다.
 * 문구는 "미등록" 이라고 말하지만 실제로는 인코딩 사고입니다.
 */
let _key = null;
const key = () => (_key ??= envValue('MOLIT_API_KEY'));

async function call(path, params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${BASE}/${path}?serviceKey=${key()}&${qs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();

  if (text.includes('SERVICE_KEY_IS_NOT_REGISTERED')) {
    throw new Error(
      `${path} — SERVICE_KEY_IS_NOT_REGISTERED.\n` +
        `    활용신청이 아니라 이중 인코딩일 수 있습니다. 이미 되는 API 로 대조하세요:\n` +
        `    cd simulator && npm run fetch:market -- --regions 48123`
    );
  }
  if (!res.ok) throw new Error(`${path} — HTTP ${res.status}\n${text.slice(0, 400)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} — JSON 이 아닙니다.\n${text.slice(0, 400)}`);
  }
  // odcloud 는 {page, perPage, totalCount, currentCount, data:[...]} 를 줍니다.
  // data 가 없으면 응답 모양이 바뀐 것이라 조용히 빈 배열로 넘기지 않습니다.
  if (!Array.isArray(json?.data)) {
    throw new Error(
      `${path} — 응답에 data 배열이 없습니다. 명세가 바뀌었을 수 있습니다.\n` +
        `${JSON.stringify(json).slice(0, 400)}`
    );
  }
  return json;
}

async function callAll(path, params, cap = 3000) {
  const perPage = 500;
  const rows = [];
  for (let page = 1; ; page++) {
    const json = await call(path, { ...params, page, perPage });
    rows.push(...json.data);
    if (rows.length >= (json.totalCount ?? rows.length) || json.data.length < perPage) break;
    if (rows.length >= cap) break;
  }
  return rows;
}

/** 시도 — 시군구명만으로 자르면 부산 남구와 대구 남구가 섞입니다. */
const SIDO = {
  changwon: ['경상남도', '경남'],
  busan: ['부산광역시', '부산'],
  gyeonggi: ['경기도', '경기'],
};

/**
 * 라벨에서 시/군/구 토큰만 뽑습니다.
 *   "창원시 성산구"      → ["창원시", "성산구"]
 *   "부산 해운대구"      → ["해운대구"]        ("부산" 은 시도라 SIDO 로 거릅니다)
 *   "경기 화성시 동탄구" → ["화성시", "동탄구"]
 */
export const tokensOf = (label) => label.split(/\s+/).filter((t) => /[시군구]$/.test(t) && t.length > 1);

export function matchDistrict(address, districts) {
  if (!address) return null;
  for (const d of districts) {
    if (!SIDO[d.region].some((s) => address.includes(s))) continue;
    if (d.tokens.every((t) => address.includes(t))) return d;
  }
  return null;
}

/** "084.9500A" → 84.95 · "59.9800" → 59.98. 전용면적입니다. */
export function exclusiveArea(houseTy) {
  const m = String(houseTy ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? Math.round(Number(m[1]) * 100) / 100 : null;
}

/** "2026-05-11" · "20260511" 둘 다 받습니다. */
export function toDate(s) {
  const t = String(s ?? '').replace(/[^0-9]/g, '');
  if (t.length !== 8) return null;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/** 입주예정월 "202808" → 모집공고일로부터 몇 년인가. 계약~입주 대기기간입니다. */
export function waitYears(pblancDate, mvnYm) {
  const t = String(mvnYm ?? '').replace(/[^0-9]/g, '');
  if (!pblancDate || t.length !== 6) return null;
  const from = new Date(pblancDate);
  const to = new Date(Number(t.slice(0, 4)), Number(t.slice(4, 6)) - 1, 1);
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return months > 0 ? Math.round((months / 12) * 10) / 10 : null;
}

/** 법정동 — "경상남도 창원시 성산구 가음동 123" 에서 동/읍/면을 집습니다. */
export function umdOf(address, district) {
  if (!address) return undefined;
  const after = address.split(district.tokens[district.tokens.length - 1]).pop() ?? '';
  const m = after.match(/([가-힣]+[동읍면])(?![가-힣])/);
  return m ? m[1] : undefined;
}

async function main() {
  const regionsRaw = JSON.parse(
    readFileSync(resolve(ROOT, 'simulator/src/data/regions.json'), 'utf8')
  );
  const districts = regionsRaw.regions
    .filter((d) => d.collect)
    .map((d) => ({ ...d, tokens: tokensOf(d.label) }));

  const months = Number(arg('months', 12));
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString().slice(0, 10);

  if (flag('probe')) {
    const detail = await call('getAPTLttotPblancDetail', { page: 1, perPage: 1 });
    const mdl = await call('getAPTLttotPblancMdl', { page: 1, perPage: 1 });
    console.log('=== getAPTLttotPblancDetail ===');
    console.log(JSON.stringify(detail.data[0], null, 2));
    console.log(`\ntotalCount ${detail.totalCount}`);
    console.log('\n=== getAPTLttotPblancMdl ===');
    console.log(JSON.stringify(mdl.data[0], null, 2));
    console.log(`\ntotalCount ${mdl.totalCount}`);
    return;
  }

  console.log(`청약홈 분양정보 수집 — 최근 ${months}개월 (${sinceStr} 이후)\n`);

  const details = await callAll('getAPTLttotPblancDetail', {});
  console.log(`  공고 ${details.length}건 수신`);

  const picked = [];
  for (const it of details) {
    const pblancDate = toDate(it.RCRIT_PBLANC_DE);
    if (!pblancDate || pblancDate < sinceStr) continue;
    const address = it.HSSPLY_ADRES;
    const d = flag('all-regions')
      ? { code: '-', label: '-', region: 'gyeonggi', tokens: [''] }
      : matchDistrict(address, districts);
    if (!d) continue;
    picked.push({ raw: it, district: d, pblancDate });
  }
  console.log(`  대상 지역·기간 안 ${picked.length}건`);

  if (picked.length === 0) {
    throw new Error(
      '조건에 맞는 공고가 0건입니다. --months 를 늘리거나 --all-regions 로 표본을 먼저 보세요.'
    );
  }

  const mdlRows = await callAll('getAPTLttotPblancMdl', {});
  const byHouse = new Map();
  for (const m of mdlRows) {
    const k = String(m.HOUSE_MANAGE_NO);
    if (!byHouse.has(k)) byHouse.set(k, []);
    byHouse.get(k).push(m);
  }
  console.log(`  주택형 ${mdlRows.length}건 수신\n`);

  const offerings = [];
  let noModel = 0;

  for (const { raw, district, pblancDate } of picked) {
    const models = (byHouse.get(String(raw.HOUSE_MANAGE_NO)) ?? [])
      .map((m) => ({
        houseTy: m.HOUSE_TY,
        areaSqm: exclusiveArea(m.HOUSE_TY),
        supplyAreaSqm: Number(m.SUPLY_AR) || null,
        households: Number(m.SUPLY_HSHLDCO) || null,
        specialHouseholds: Number(m.SPSPLY_HSHLDCO) || null,
        // 만원 단위 정수. 엔진에서 10000 을 곱합니다.
        price: Number(String(m.LTTOT_TOP_AMOUNT ?? '').replace(/[^0-9]/g, '')) || null,
      }))
      .filter((m) => m.areaSqm && m.price);

    if (models.length === 0) {
      noModel++;
      continue;
    }

    offerings.push({
      id: String(raw.HOUSE_MANAGE_NO),
      pblancNo: String(raw.PBLANC_NO ?? ''),
      name: raw.HOUSE_NM,
      region: district.region,
      sigungu: district.label,
      sigunguCode: district.code,
      umd: umdOf(raw.HSSPLY_ADRES, district),
      address: raw.HSSPLY_ADRES,
      totalHouseholds: Number(raw.TOT_SUPLY_HSHLDCO) || null,
      pblancDate,
      receiptFrom: toDate(raw.RCEPT_BGNDE),
      receiptTo: toDate(raw.RCEPT_ENDDE),
      winnerDate: toDate(raw.PRZWNER_PRESNATN_DE),
      contractFrom: toDate(raw.CNTRCT_CNCLS_BGNDE),
      moveInYm: String(raw.MVN_PREARNGE_YM ?? '').replace(/[^0-9]/g, '') || null,
      waitYears: waitYears(pblancDate, raw.MVN_PREARNGE_YM),
      url: raw.PBLANC_URL ?? null,
      // 공고문에만 있는 값들 — 채우지 않습니다. 0 으로 채우면 "제한 없음" 으로 읽힙니다.
      resaleBanMonths: null,
      interimDeferred: null,
      interimLoanRate: null,
      models: models.sort((a, b) => a.areaSqm - b.areaSqm),
    });
  }

  offerings.sort((a, b) => b.pblancDate.localeCompare(a.pblancDate));

  const byRegion = {};
  for (const o of offerings) byRegion[o.region] = (byRegion[o.region] ?? 0) + 1;

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const out = {
    note:
      '청약홈 분양정보 스냅샷. 면적은 주택형(HOUSE_TY)에서 뽑은 **전용면적**이고 ' +
      'SUPLY_AR(공급면적)은 supplyAreaSqm 에 따로 둡니다 — 둘을 섞으면 ㎡당 가격이 ' +
      '30% 가까이 어긋납니다. 중도금 조건과 전매제한은 단지 공고문에만 있어 ' +
      'null 로 두고 화면에서 손입력합니다.',
    source: 'data.go.kr · 한국부동산원 청약홈 분양정보 조회 서비스 (ApplyhomeInfoDetailSvc)',
    unitNote: '금액은 만원 단위 정수입니다. 엔진에서 10000을 곱해 원으로 씁니다.',
    windowMonths: months,
    since: sinceStr,
    asOf: now.toISOString().slice(0, 10),
    stats: {
      received: details.length,
      inScope: picked.length,
      withModels: offerings.length,
      droppedNoModel: noModel,
      byRegion,
    },
    offerings,
  };

  if (flag('all-regions')) {
    console.log('--all-regions 는 표본 확인용이라 저장하지 않습니다.');
    console.log(`  공고 ${offerings.length}건`);
    return;
  }

  const OUT = resolve(ROOT, `simulator/src/data/offering-${stamp}.json`);
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`✓ ${OUT}`);
  console.log(`  공고 ${offerings.length}건 · 주택형 ${offerings.reduce((n, o) => n + o.models.length, 0)}개`);
  for (const [r, n] of Object.entries(byRegion)) console.log(`  ${r.padEnd(9)} ${n}건`);
  if (noModel) console.log(`  주택형이 안 붙은 공고 ${noModel}건은 뺐습니다.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
  });
}
