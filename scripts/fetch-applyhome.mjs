#!/usr/bin/env node
/**
 * 청약홈(한국부동산원) **분양정보 + 경쟁률** 을 받아 스냅샷으로 굽습니다.
 *
 * 지금까지 청약 단지는 분양가·평형·입주예정을 전부 손으로 넣어야 했습니다.
 * 공고문에만 있는 값이라 API 가 없었기 때문인데, 이 둘이 열리면서
 * **목록에서 고르기만** 하면 되도록 바뀝니다.
 *
 *   node scripts/fetch-applyhome.mjs                 # 2023-01-01 이후
 *   node scripts/fetch-applyhome.mjs --from 2020-01-01
 *
 * ## 세 갈래로만 받습니다
 *
 * 이 도구의 대상 지역은 창원·부산·경기 셋으로 고정입니다. 청약지역 코드는
 * 시도 단위라 그대로 받으면 진주·김해·양주·포천이 섞입니다. 그래서
 * **`regions.json` 에 있는 시만** 남깁니다 — 후보군과 제외 사유가 이미 그
 * 파일에 데이터로 있으므로, 무엇을 왜 안 받는지가 코드에 박히지 않습니다.
 * 부산은 시도 전체가 곧 대상이라 그대로 둡니다.
 *
 * 스냅샷은 통째로 단일 HTML 에 인라인되므로 **바이트가 곧 로딩 시간**입니다.
 * 전국·전기간을 받으면 640KB 인데, 이 필터와 주택형 배열화로 3분의 1이 됩니다.
 *
 * ## 세 데이터셋을 로컬에서 조인합니다
 *
 * ```
 * getAPTLttotPblancDetail  공고 한 줄       — 일정·주소·총세대·규제 표식
 * getAPTLttotPblancMdl     주택형 한 줄     — 전용면적·분양가·공급세대
 * getAPTLttotPblancCmpet   주택형×순위×지역 — 접수건수·경쟁률
 * ```
 *
 * 주택형과 경쟁률은 `cond[HOUSE_MANAGE_NO::EQ]` 로 공고별 조회가 되지만
 * 공고 수만큼 요청이 갑니다. 전체를 페이지로 훑어 로컬에서 조인하는 편이
 * 요청 수가 한 자릿수로 줄어듭니다 (14,600행·54,590행 → 약 70회).
 *
 * ## 경쟁률은 1순위 접수건수로 접습니다
 *
 * 원자료는 `주택형 × 순위 × 해당/기타지역` 이라 한 공고가 수십 행입니다.
 * 그대로 담으면 스냅샷이 몇 배로 불어나는데, 화면에서 읽는 것은 결국
 * **1순위가 몇 대 몇이었나** 뿐입니다. 그래서 주택형별로
 * `1순위 접수건수 합 ÷ 공급세대` 만 남깁니다. API 의 `CMPET_RATE` 를 그대로
 * 쓰지 않는 이유는 그 값이 해당지역·기타지역으로 갈려 있어 한 숫자가
 * 아니고, 미달이면 `-` 로 오기 때문입니다 — 미달은 0이 아니라 미달입니다.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://api.odcloud.kr/api';
const DETAIL = `${BASE}/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail`;
const MODEL = `${BASE}/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl`;
const CMPET = `${BASE}/ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet`;

/**
 * 청약지역(시도) → 우리 권역.
 *
 * `cities` 가 있으면 주소의 시 이름이 그 안에 있어야 남깁니다. 목록은
 * `regions.json` 라벨에서 뽑으므로 후보군을 넓히면 여기도 같이 넓어집니다.
 */
const REGION_ROWS = JSON.parse(
  readFileSync(resolve(ROOT, 'simulator/src/data/regions.json'), 'utf8')
).regions;

/** '경기 화성시 동탄구' → '화성시'. 권역별 시 이름 집합을 만듭니다. */
function citiesOf(region) {
  const out = new Set();
  for (const r of REGION_ROWS) {
    if (r.region !== region) continue;
    const m = r.label.match(/([가-힣]+시)/);
    if (m) out.add(m[1]);
  }
  return out;
}

const AREAS = [
  // 부산은 시도 전체가 곧 대상 권역입니다.
  { code: '부산', region: 'busan', cities: null },
  { code: '경기', region: 'gyeonggi', cities: citiesOf('gyeonggi') },
  { code: '경남', region: 'changwon', cities: citiesOf('changwon') },
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
  // 발급 화면의 Encoding 키에는 %2B·%3D 가 섞여 옵니다. 한 번 풀어 둡니다 —
  // URL.searchParams 가 다시 인코딩하므로 여기서 풀지 않으면 이중 인코딩입니다.
  const raw = m[1].trim();
  return /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;
}

/** odcloud 는 page/perPage 로 넘깁니다. matchCount 가 필터 후 건수입니다. */
async function fetchPage(endpoint, key, params, page, perPage) {
  const url = new URL(endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('page', String(page));
  url.searchParams.set('perPage', String(perPage));
  url.searchParams.set('serviceKey', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`JSON 아님 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (json.code && json.code !== 200) {
    throw new Error(`API 오류 ${json.code}: ${json.msg ?? ''}`);
  }
  if (!Array.isArray(json.data)) {
    // SERVICE_KEY_IS_NOT_REGISTERED 는 미신청일 수도, 이중 인코딩일 수도 있습니다.
    throw new Error(`데이터 없음: ${text.slice(0, 200)}`);
  }
  return json;
}

async function fetchAll(endpoint, key, params, label) {
  const perPage = 1000;
  const out = [];
  for (let page = 1; ; page++) {
    let json;
    for (let attempt = 0; ; attempt++) {
      try {
        json = await fetchPage(endpoint, key, params, page, perPage);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    out.push(...json.data);
    process.stdout.write(`\r${label} ${out.length}/${json.matchCount ?? '?'}   `);
    if (out.length >= (json.matchCount ?? out.length) || json.data.length === 0) break;
  }
  process.stdout.write('\n');
  return out;
}

/**
 * 공급위치 주소에서 시군구·법정동을 뜯습니다.
 *
 * 주소는 `경상남도 창원시 성산구 중앙동 99-4,5,6` 처럼 시도부터 옵니다.
 * 광역시는 `부산광역시 남구 대연동`, 화성처럼 구가 생긴 지 얼마 안 된 곳은
 * `경기도 화성시 반월동` 으로 **구 없이** 오기도 합니다.
 *
 * **`지구` 로 끝나는 토큰을 구로 보면 안 됩니다.** `평택시 고덕국제화계획지구`
 * 는 시군구가 아니라 택지지구 이름인데, 단순히 `구` 로 끝나는지만 보면
 * 그대로 시군구가 되어 실측 대조가 통째로 빗나갑니다.
 *
 * 못 뜯으면 빈 문자열입니다 — 지어내지 않습니다. 시군구가 비면 화면이
 * "권역 전체와 비교 중" 이라고 경고합니다.
 */
function parseAddress(address) {
  const parts = String(address ?? '')
    .replace(/특례시/g, '시') // 화성특례시 → 화성시
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  if (parts.length < 2) return { sigungu: '', umd: '', city: '' };

  const isSgg = (t) => /(시|군|구)$/.test(t) && !/(지구|신도시|단지|지역)$/.test(t);

  const rest = parts.slice(1);
  const sgg = [];
  let i = 0;
  // 시·군·구 토큰을 최대 둘까지 (창원시 + 성산구)
  while (i < rest.length && sgg.length < 2 && isSgg(rest[i])) {
    sgg.push(rest[i]);
    i++;
  }
  // 법정동은 그 다음 토큰이 동·읍·면으로 끝날 때만 인정합니다.
  const umd = i < rest.length && /(동|읍|면|리)$/.test(rest[i]) ? rest[i] : '';
  const city = sgg.find((t) => /(시|군)$/.test(t)) ?? '';
  return { sigungu: sgg.join(' '), umd, city };
}

/** `202909` → 계약일로부터 남은 개월 수. 둘 중 하나가 없으면 null */
function waitMonths(contractDate, moveInYm) {
  if (!contractDate || !moveInYm || moveInYm.length < 6) return null;
  const cy = Number(contractDate.slice(0, 4));
  const cm = Number(contractDate.slice(5, 7));
  const my = Number(moveInYm.slice(0, 4));
  const mm = Number(moveInYm.slice(4, 6));
  if (!cy || !cm || !my || !mm) return null;
  const months = (my - cy) * 12 + (mm - cm);
  return months > 0 && months < 120 ? months : null;
}

const yn = (v) => v === 'Y';
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

async function main() {
  const key = loadKey();
  const from = arg('from', '2023-01-01');

  // ── 1. 공고 ──────────────────────────────────────────────────────────
  const notices = [];
  for (const area of AREAS) {
    const rows = await fetchAll(
      DETAIL,
      key,
      {
        'cond[SUBSCRPT_AREA_CODE_NM::EQ]': area.code,
        'cond[RCRIT_PBLANC_DE::GTE]': from,
      },
      `공고 ${area.code}`
    );
    for (const r of rows) {
      const address = String(r.HSSPLY_ADRES ?? '').trim();
      // APT 만 봅니다. 오피스텔·도시형생활주택은 대출 조건이 통째로 다릅니다.
      if (r.HOUSE_SECD !== '01') continue;
      // 분양전환 임대의 `분양가` 는 전환가라 일반 분양가와 같은 자로 못 잽니다.
      if (String(r.RENT_SECD) !== '0') continue;

      const { sigungu, umd, city } = parseAddress(address);
      if (area.cities && !area.cities.has(city)) continue;
      notices.push({
        id: String(r.HOUSE_MANAGE_NO),
        no: String(r.PBLANC_NO),
        name: String(r.HOUSE_NM ?? '').trim(),
        region: area.region,
        sigungu,
        umd,
        address,
        kind: r.HOUSE_DTL_SECD_NM ?? '',
        supplyKind: r.RENT_SECD_NM ?? '',
        households: num(r.TOT_SUPLY_HSHLDCO),
        noticeDate: r.RCRIT_PBLANC_DE ?? '',
        rank1Date: r.GNRL_RNK1_CRSPAREA_RCPTDE ?? '',
        winnerDate: r.PRZWNER_PRESNATN_DE ?? '',
        contractDate: r.CNTRCT_CNCLS_BGNDE ?? '',
        moveInYm: r.MVN_PREARNGE_YM ?? '',
        waitMonths: waitMonths(r.CNTRCT_CNCLS_BGNDE, r.MVN_PREARNGE_YM),
        // 규제 표식 셋. 전매제한·중도금 조건은 여전히 공고문에만 있습니다.
        regulated: yn(r.MDAT_TRGET_AREA_SECD),
        speculative: yn(r.SPECLT_RDN_EARTH_AT),
        priceCapped: yn(r.PARCPRC_ULS_AT),
        builder: r.CNSTRCT_ENTRPS_NM ?? '',
        models: [],
      });
    }
  }
  const byId = new Map(notices.map((n) => [n.id, n]));
  console.log(`공고 ${notices.length}건 (${from} 이후, APT 만)`);

  // ── 2. 주택형 ────────────────────────────────────────────────────────
  const models = await fetchAll(MODEL, key, {}, '주택형 전체');
  let matchedModels = 0;
  for (const m of models) {
    const notice = byId.get(String(m.HOUSE_MANAGE_NO));
    if (!notice) continue;
    const ty = String(m.HOUSE_TY ?? '').trim();
    // `084.9800A` 의 앞 숫자가 **전용면적**입니다. `SUPLY_AR` 은 공급면적이라
    // 20㎡ 넘게 큽니다 — 이 도구의 면적 축은 전부 전용이므로 섞으면 안 됩니다.
    const area = Number(ty.slice(0, 8).replace(/[^0-9.]/g, ''));
    const supplyArea = Number(m.SUPLY_AR) || 0;
    const price = num(m.LTTOT_TOP_AMOUNT);
    if (!area || !price) continue;
    matchedModels++;
    notice.models.push({
      ty,
      area: Math.round(area * 100) / 100,
      supplyArea: Math.round(supplyArea * 100) / 100,
      // 만원 단위 정수. 다른 스냅샷과 같은 약속입니다.
      price,
      general: num(m.SUPLY_HSHLDCO),
      special: num(m.SPSPLY_HSHLDCO),
      lifeFirst: num(m.LFE_FRST_HSHLDCO),
      newlywed: num(m.NWWDS_HSHLDCO),
      rank1Req: 0,
      rank1Supply: 0,
    });
  }
  console.log(`주택형 ${matchedModels}건 (전체 ${models.length}행 중 우리 공고)`);

  // ── 3. 경쟁률 ────────────────────────────────────────────────────────
  const cmpet = await fetchAll(CMPET, key, {}, '경쟁률 전체');
  /** `공고번호|주택형` → { req, supply } */
  const folded = new Map();
  for (const c of cmpet) {
    if (!byId.has(String(c.HOUSE_MANAGE_NO))) continue;
    if (Number(c.SUBSCRPT_RANK_CODE) !== 1) continue; // 1순위만
    const k = `${c.HOUSE_MANAGE_NO}|${String(c.HOUSE_TY ?? '').trim()}`;
    const cur = folded.get(k) ?? { req: 0, supply: 0 };
    cur.req += num(c.REQ_CNT);
    // 공급세대는 해당지역·기타지역 행에 같은 값이 반복되므로 최대값을 씁니다.
    cur.supply = Math.max(cur.supply, num(c.SUPLY_HSHLDCO));
    folded.set(k, cur);
  }
  let withCmpet = 0;
  for (const n of notices) {
    for (const m of n.models) {
      const f = folded.get(`${n.id}|${m.ty}`);
      if (!f || !f.supply) continue;
      m.rank1Req = f.req;
      m.rank1Supply = f.supply;
      withCmpet++;
    }
  }
  console.log(`경쟁률 ${withCmpet}개 주택형에 붙음`);

  // 주택형이 하나도 없는 공고는 분양가를 모르는 공고입니다 — 화면에서 쓸모가
  // 없으므로 뺍니다. (임대·잔여세대 공고에서 주로 생깁니다)
  const kept = notices
    .filter((n) => n.models.length > 0)
    .sort((a, b) => (a.noticeDate < b.noticeDate ? 1 : -1));
  for (const n of kept) n.models.sort((a, b) => a.area - b.area);

  const perRegion = {};
  for (const n of kept) perRegion[n.region] = (perRegion[n.region] ?? 0) + 1;
  console.log('지역별:', perRegion);

  const now = new Date();
  const version = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const snapshot = {
    version,
    asOf: now.toISOString().slice(0, 10),
    unit: 'manwon',
    unitNote: '분양가는 만원 단위 정수입니다. 엔진에서 10000을 곱해 원으로 씁니다.',
    source: {
      name: '한국부동산원 청약홈 분양정보 · 경쟁률',
      endpoint: 'api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1',
      license: '공공누리 제1유형',
      note:
        'APT 만 남겼습니다. 경쟁률은 1순위 접수건수 합 ÷ 공급세대이며, ' +
        '해당지역·기타지역을 합친 값입니다. 미달 공고는 1 미만으로 나옵니다.',
    },
    range: { from, to: now.toISOString().slice(0, 10) },
    areas: AREAS.map((a) => ({ code: a.code, region: a.region })),
    // 주택형은 행이 2천 개라 키 이름이 값보다 무겁습니다. 배열로 접고
    // 순서를 여기에 적어 둡니다 — 실거래 스냅샷의 pointFormat 과 같은 약속입니다.
    modelFormat: [
      'houseType',
      'areaSqm',
      'supplyAreaSqm',
      'priceManwon',
      'general',
      'special',
      'lifeFirst',
      'newlywed',
      'rank1Req',
      'rank1Supply',
    ],
    stats: {
      notices: kept.length,
      models: kept.reduce((s, n) => s + n.models.length, 0),
      withCompetition: withCmpet,
      perRegion,
    },
    notices: kept.map((n) => ({
      ...n,
      // 공고 링크는 id·no 로 되짚을 수 있어 담지 않습니다.
      models: n.models.map((m) => [
        m.ty,
        m.area,
        m.supplyArea,
        m.price,
        m.general,
        m.special,
        m.lifeFirst,
        m.newlywed,
        m.rank1Req,
        m.rank1Supply,
      ]),
    })),
  };

  const out = resolve(ROOT, `simulator/src/data/applyhome-${version}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot), 'utf8');
  const kb = Math.round(Buffer.byteLength(JSON.stringify(snapshot)) / 1024);
  console.log(`\n저장: ${out} (${kb}KB)`);
  console.log(
    '엔진이 읽는 파일명이 고정이라, 버전이 바뀌면 src/engine/applyhome.ts 의 import 를 함께 고치세요.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
