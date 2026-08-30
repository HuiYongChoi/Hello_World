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
 * node scripts/fetch-offering.mjs --probe         # 응답 대조 — 읽는 키가 오는지 스크립트가 판정
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

export const median = (xs) => {
  if (!xs.length) return 0;
  const t = [...xs].sort((a, b) => a - b);
  const i = Math.floor(t.length / 2);
  const v = t.length % 2 ? t[i] : (t[i - 1] + t[i]) / 2;
  return Math.round(v * 100) / 100;
};

/** 법정동 — "경상남도 창원시 성산구 가음동 123" 에서 동/읍/면을 집습니다. */
export function umdOf(address, district) {
  if (!address) return undefined;
  const after = address.split(district.tokens[district.tokens.length - 1]).pop() ?? '';
  const m = after.match(/([가-힣]+[동읍면])(?![가-힣])/);
  return m ? m[1] : undefined;
}

/**
 * 수집기가 **실제로 읽는** 키만 적습니다. 이 목록이 곧 대조 대상입니다 —
 * 명세 문서를 옮겨 적으면 안 읽는 키까지 섞여 결측 경고가 소음이 됩니다.
 */
export const FIELDS = {
  getAPTLttotPblancDetail: {
    HOUSE_MANAGE_NO: '주택관리번호 — 두 API 를 잇는 조인 키',
    HOUSE_NM: '주택명',
    HSSPLY_ADRES: '공급위치 — 시군구·법정동을 여기서 뽑습니다',
    RCRIT_PBLANC_DE: '모집공고일 — 기간 필터와 대기기간 기산점',
    MVN_PREARNGE_YM: '입주예정월 — 대기기간의 끝',
    TOT_SUPLY_HSHLDCO: '총 공급세대수',
    PBLANC_NO: '공고번호',
    RCEPT_BGNDE: '접수 시작일',
    RCEPT_ENDDE: '접수 종료일',
    PRZWNER_PRESNATN_DE: '당첨자발표일',
    CNTRCT_CNCLS_BGNDE: '계약 시작일',
    PBLANC_URL: '공고 URL',
  },
  getAPTLttotPblancMdl: {
    HOUSE_MANAGE_NO: '조인 키',
    HOUSE_TY: '주택형 — **전용면적을 여기서 뽑습니다** (SUPLY_AR 아님)',
    LTTOT_TOP_AMOUNT: '분양최고금액 (만원)',
    SUPLY_AR: '공급면적 — 참고용',
    SUPLY_HSHLDCO: '공급세대수',
    SPSPLY_HSHLDCO: '특별공급 세대수',
  },
};

/** 결측 키에 대해 실제 응답에서 이름이 비슷한 키를 찾아 줍니다. */
export function similarKeys(missing, actual) {
  const core = missing.replace(/_/g, '').toUpperCase();
  return actual
    .filter((k) => {
      const c = k.replace(/_/g, '').toUpperCase();
      if (c === core) return true;
      const shorter = c.length < core.length ? c : core;
      const longer = c.length < core.length ? core : c;
      return shorter.length >= 4 && longer.includes(shorter);
    })
    .slice(0, 3);
}

/**
 * 필드 대조 — 있는지/몇 건에 채워졌는지/예시값.
 * 첫 실행에서 사람이 원문 JSON 을 읽고 판단하던 일을 스크립트가 합니다.
 */
export function audit(label, rows, spec) {
  console.log(`\n=== ${label} — ${rows.length}건 표본 ===`);
  const actual = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))].sort();
  const missing = [];

  for (const [k, why] of Object.entries(spec)) {
    const filled = rows.filter((r) => r?.[k] !== undefined && r?.[k] !== null && r?.[k] !== '').length;
    const sample = rows.find((r) => r?.[k] !== undefined && r?.[k] !== null && r?.[k] !== '')?.[k];
    if (filled === 0) {
      missing.push(k);
      // 키가 아예 없는 것과 키는 있는데 값이 전부 빈 것은 원인이 다릅니다 —
      // 전자는 명세가 바뀐 것이고, 후자는 그 공고에 그 값이 없는 것입니다.
      if (actual.includes(k)) {
        console.log(`  ✗ ${k.padEnd(22)} 키는 있으나 표본 ${rows.length}건 모두 빈 값 — ${why}`);
      } else {
        const near = similarKeys(k, actual).filter((n) => n !== k);
        console.log(`  ✗ ${k.padEnd(22)} 키 자체가 없음 — ${why}` + (near.length ? `\n      비슷한 키: ${near.join(', ')}` : ''));
      }
    } else {
      const mark = filled === rows.length ? '✓' : '△';
      console.log(`  ${mark} ${k.padEnd(22)} ${String(filled).padStart(2)}/${rows.length}  예: ${JSON.stringify(sample)}`);
    }
  }

  const unused = actual.filter((k) => !(k in spec));
  if (unused.length) console.log(`  · 안 읽는 키 ${unused.length}개: ${unused.join(', ')}`);
  return missing;
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
    const n = Number(arg('probe-rows', 5));
    const detail = await call('getAPTLttotPblancDetail', { page: 1, perPage: n });
    const mdl = await call('getAPTLttotPblancMdl', { page: 1, perPage: n });

    console.log('청약홈 응답 대조 — 수집기가 읽는 키가 실제로 오는지 봅니다.');
    console.log(`  공고 totalCount ${detail.totalCount} · 주택형 totalCount ${mdl.totalCount}`);

    const miss = [
      ...audit('getAPTLttotPblancDetail', detail.data, FIELDS.getAPTLttotPblancDetail),
      ...audit('getAPTLttotPblancMdl', mdl.data, FIELDS.getAPTLttotPblancMdl),
    ];

    // 파싱까지 실제로 해 봅니다. 키가 와도 형식이 다르면 여기서 드러납니다.
    console.log('\n=== 파싱 시험 ===');
    const d0 = detail.data[0] ?? {};
    const m0 = mdl.data[0] ?? {};
    const pblancDate = toDate(d0.RCRIT_PBLANC_DE);
    const district = matchDistrict(d0.HSSPLY_ADRES, districts);
    console.log(`  모집공고일   ${JSON.stringify(d0.RCRIT_PBLANC_DE)} → ${pblancDate}`);
    console.log(`  입주예정월   ${JSON.stringify(d0.MVN_PREARNGE_YM)} → 대기 ${waitYears(pblancDate, d0.MVN_PREARNGE_YM)}년`);
    console.log(`  공급위치     ${JSON.stringify(d0.HSSPLY_ADRES)} → ${district ? district.label : '수집 대상 시군구 아님 (표본 1건이라 정상일 수 있음)'}`);
    console.log(`  주택형       ${JSON.stringify(m0.HOUSE_TY)} → 전용 ${exclusiveArea(m0.HOUSE_TY)}㎡`);
    console.log(`  공급면적     ${JSON.stringify(m0.SUPLY_AR)}  ← areaSqm 에 쓰면 안 되는 값`);
    console.log(`  분양가       ${JSON.stringify(m0.LTTOT_TOP_AMOUNT)} 만원`);

    console.log(
      miss.length
        ? `\n✗ 결측 ${miss.length}개: ${miss.join(', ')}\n  이 출력을 그대로 붙여 주시면 키를 맞추겠습니다.`
        : '\n✓ 수집기가 읽는 키가 전부 옵니다. 그대로 `npm run fetch:offering` 하시면 됩니다.'
    );
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

  // 키가 와도 값이 엉뚱하면 조용히 지나가면 안 됩니다. 스냅샷이 화면의 기준가가
  // 되므로 여기서 못 잡으면 안전마진이 통째로 틀린 채 그럴듯해 보입니다.
  const areas = offerings.flatMap((o) => o.models.map((m) => m.areaSqm));
  const prices = offerings.flatMap((o) => o.models.map((m) => m.price));
  const waits = offerings.map((o) => o.waitYears).filter((v) => v != null);
  const warn = [];
  if (median(areas) > 120) {
    warn.push(
      `전용면적 중위 ${median(areas)}㎡ — 공급면적(SUPLY_AR)을 집었을 수 있습니다. ` +
        '주택형(HOUSE_TY) 파싱을 확인하세요.'
    );
  }
  if (median(areas) < 20) warn.push(`전용면적 중위 ${median(areas)}㎡ — 단위가 ㎡ 가 아닐 수 있습니다.`);
  // 만원 단위라면 3억~20억이 30000~200000 입니다. 원 단위로 오면 자릿수가 네 개 틉니다.
  if (median(prices) > 1000000) {
    warn.push(`분양가 중위 ${median(prices)} — 만원이 아니라 원 단위로 오는 것 같습니다.`);
  }
  if (median(prices) < 3000) warn.push(`분양가 중위 ${median(prices)}만원 — 총액이 아니라 ㎡당 가격일 수 있습니다.`);
  if (waits.length && median(waits) > 6) {
    warn.push(`대기기간 중위 ${median(waits)}년 — 입주예정월 해석을 확인하세요.`);
  }
  if (warn.length) {
    console.log('\n⚠ 값이 예상 범위를 벗어납니다 — 저장은 하되 그대로 쓰지 마세요.');
    for (const w of warn) console.log(`   · ${w}`);
    console.log('   `--probe` 로 원문 키를 대조하세요.\n');
  }

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
