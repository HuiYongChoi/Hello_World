#!/usr/bin/env node
/**
 * 마산 생활권 **집주인 쪽 신호**를 실거래에서 잽니다.
 *
 *   node scripts/fetch-masan-landlord.mjs               # 최근 24개월
 *   node scripts/fetch-masan-landlord.mjs --months 36
 *
 * ## 무엇을 재고 무엇을 못 재나
 *
 * 전세에서 정말 알고 싶은 것은 **"이 집에 융자(근저당)가 얼마나 잡혀 있나"**
 * 입니다. 그런데 그건 등기부등본에만 있고, 등기부는 호수 단위로 인터넷등기소에서
 * 열람해야 합니다 — 공개 API 가 없습니다. 공시가격 API(NSDI)는 폐기됐고,
 * 건축물대장 API 는 별도 활용신청이 필요합니다.
 *
 * 대신 **매매·전월세 실거래를 맞대면** 집주인이 어떻게 샀는지의 흔적이 남습니다.
 *
 * ```
 * 갭 흔적  매매 뒤 120일 안에 같은 단지·같은 평형·같은 층에서 신규 전세가 체결
 *          → 산 사람이 전세보증금으로 잔금을 치렀을 가능성 (자기자본이 얇음)
 * 법인 매수 매수자가 법인인 거래
 * ```
 *
 * 갭 흔적은 **하한이자 잡음 섞인 대리지표**입니다.
 * - 세입자를 낀 채 사는 매매(전세가 매매보다 먼저)는 안 잡힙니다 — 하한.
 * - 자료에 동·호수가 없어 **같은 층의 다른 호**가 겹칠 수 있습니다 — 그래서
 *   우연히 겹칠 기대치(`chance`)를 같이 냅니다. 둘이 비슷하면 신호가 아닙니다.
 *
 * ## 결과 (2026-09 수집) — 신호가 아니었습니다
 *
 * 2년 매매 22,698건 중 갭 흔적 4,502건, 우연 기대치 4,257건. 6% 차이라 단지별로
 * 쪼개면 잡음에 묻힙니다. 그래서 앱은 이 파일을 읽지 않고, 스크립트는 **왜 안
 * 쓰는지**를 재현하는 용도로만 남깁니다. 출력 JSON 도 커밋하지 않습니다.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'simulator/src/data');
const TRADE =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const RENT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

/** 매매 뒤 이 기간 안에 체결된 신규 전세를 "갭" 으로 봅니다. */
const GAP_WINDOW_DAYS = 120;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadKey() {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = text.match(/^MOLIT_API_KEY=(.+)$/m);
  if (!m) throw new Error('.env.local 에 MOLIT_API_KEY 가 없습니다.');
  // Encoding 키를 한 번 풉니다 — searchParams 가 다시 인코딩합니다.
  const raw = m[1].trim().replace(/^"|"$/g, '');
  return /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;
}

const TAG = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};

function recentMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out.reverse();
}

async function fetchItems(endpoint, key, lawdCd, dealYmd) {
  const all = [];
  for (let page = 1; page < 20; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('serviceKey', key);
    url.searchParams.set('LAWD_CD', lawdCd);
    url.searchParams.set('DEAL_YMD', dealYmd);
    url.searchParams.set('numOfRows', '1000');
    url.searchParams.set('pageNo', String(page));
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const xml = await res.text();
    const code = TAG(xml, 'resultCode');
    if (code && code !== '000' && code !== '00') {
      throw new Error(`API 오류 ${code}: ${TAG(xml, 'resultMsg') || TAG(xml, 'errMsg')}`);
    }
    if (!code) throw new Error(`응답 이상: ${xml.slice(0, 200)}`);
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    all.push(...items);
    const total = Number(TAG(xml, 'totalCount')) || 0;
    if (all.length >= total || items.length === 0) break;
  }
  return all;
}

async function withRetry(fn, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === 2) {
        console.warn(`\n  ! ${label} 실패: ${e.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return null;
}

const dayOf = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;

async function main() {
  const key = loadKey();
  const months = recentMonths(Number(arg('months', '24')));

  // 대상 지역은 전월세 스냅샷과 같게 — 두 파일이 같은 단지를 말해야 합니다.
  const rentFile = readdirSync(DATA)
    .filter((f) => /^masan-rent-\d{4}-\d{2}\.json$/.test(f))
    .sort()
    .pop();
  const regions = JSON.parse(readFileSync(resolve(DATA, rentFile), 'utf8')).regions;
  console.log(`수집: ${regions.length}개 시군구 × ${months.length}개월 × 매매·전월세`);

  const sales = [];
  const jeonse = [];
  let failures = 0;
  const perRegion = {};

  for (const r of regions) {
    process.stdout.write(`\n${r.label} `);
    perRegion[r.code] = { sales: 0, jeonse: 0 };
    for (const ym of months) {
      const t = await withRetry(() => fetchItems(TRADE, key, r.code, ym), `${r.label} ${ym} 매매`);
      const l = await withRetry(() => fetchItems(RENT, key, r.code, ym), `${r.label} ${ym} 전월세`);
      if (!t) failures++;
      if (!l) failures++;
      for (const it of t ?? []) {
        // 해제된 거래는 체결되지 않은 신고입니다.
        if (TAG(it, 'cdealType') === 'O') continue;
        const area = Number(TAG(it, 'excluUseAr'));
        if (!area) continue;
        sales.push({
          id: TAG(it, 'aptSeq'),
          area,
          floor: Number(TAG(it, 'floor')) || 0,
          day: dayOf(+TAG(it, 'dealYear'), +TAG(it, 'dealMonth'), +TAG(it, 'dealDay')),
          corp: TAG(it, 'buyerGbn') === '법인',
        });
        perRegion[r.code].sales++;
      }
      for (const it of l ?? []) {
        const rent = Number(TAG(it, 'monthlyRent').replace(/[,\s]/g, '')) || 0;
        if (rent !== 0) continue;
        if (TAG(it, 'contractType') === '갱신') continue; // 갱신은 새 집주인 신호가 아닙니다
        const area = Number(TAG(it, 'excluUseAr'));
        if (!area) continue;
        jeonse.push({
          id: TAG(it, 'aptSeq'),
          area,
          floor: Number(TAG(it, 'floor')) || 0,
          day: dayOf(+TAG(it, 'dealYear'), +TAG(it, 'dealMonth'), +TAG(it, 'dealDay')),
        });
        perRegion[r.code].jeonse++;
      }
      process.stdout.write('.');
    }
  }
  process.stdout.write('\n');

  /** 단지별 전세 · 층 최대값 */
  const jeonseBy = new Map();
  const topFloor = new Map();
  for (const j of jeonse) {
    if (!jeonseBy.has(j.id)) jeonseBy.set(j.id, []);
    jeonseBy.get(j.id).push(j);
  }
  for (const x of [...sales, ...jeonse]) {
    topFloor.set(x.id, Math.max(topFloor.get(x.id) ?? 0, x.floor));
  }

  /** 단지 → [매매건수, 갭 흔적, 우연 기대치, 법인 매수] */
  const agg = new Map();
  for (const s of sales) {
    if (!s.id) continue;
    if (!agg.has(s.id)) agg.set(s.id, { sales: 0, gap: 0, chance: 0, corp: 0 });
    const a = agg.get(s.id);
    a.sales++;
    if (s.corp) a.corp++;

    const window = (jeonseBy.get(s.id) ?? []).filter(
      (j) =>
        Math.abs(j.area - s.area) <= 1 &&
        j.day >= s.day &&
        j.day <= s.day + GAP_WINDOW_DAYS
    );
    if (window.some((j) => j.floor === s.floor)) a.gap++;
    /*
     * 동·호수가 없어 같은 층의 다른 호가 겹칠 수 있습니다. 창구 안의 신규 전세
     * k건이 층을 무작위로 골랐다면 하나라도 같은 층에 떨어질 확률은
     * 1 − (1 − 1/층수)^k 입니다.
     */
    const floors = Math.max(1, topFloor.get(s.id) ?? 1);
    if (window.length) a.chance += 1 - Math.pow(1 - 1 / floors, window.length);
  }

  const complexes = {};
  for (const [id, a] of [...agg.entries()].sort()) {
    complexes[id] = [a.sales, a.gap, Math.round(a.chance * 10) / 10, a.corp];
  }

  const now = new Date();
  const version = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const snapshot = {
    version,
    asOf: now.toISOString().slice(0, 10),
    source: {
      name: '국토교통부 아파트 매매·전월세 실거래가 자료',
      endpoint: 'apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev · RTMSDataSvcAptRent',
      license: '공공누리 제1유형',
    },
    range: { from: months[0], to: months[months.length - 1] },
    gapWindowDays: GAP_WINDOW_DAYS,
    format: ['sales', 'gapSales', 'gapByChance', 'corporateBuys'],
    note:
      '갭 흔적 = 매매 뒤 120일 안에 같은 단지·평형(±1㎡)·층에서 신규 전세 체결. 세 낀 매매는 안 잡혀 하한이고, 동·호수가 없어 같은 층 다른 호가 섞일 수 있어 우연 기대치를 같이 둡니다. 근저당(융자)은 이 자료에 없습니다.',
    stats: { sales: sales.length, newJeonse: jeonse.length, failedRequests: failures, perRegion },
    complexes,
  };

  const file = resolve(DATA, `masan-landlord-${version}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot), 'utf8');

  console.log('\n지역별:');
  for (const r of regions) {
    const p = perRegion[r.code];
    console.log(`  ${r.label.padEnd(14)} 매매 ${String(p.sales).padStart(5)} · 신규전세 ${String(p.jeonse).padStart(5)}`);
  }
  const totalGap = Object.values(complexes).reduce((s, c) => s + c[1], 0);
  const totalChance = Object.values(complexes).reduce((s, c) => s + c[2], 0);
  console.log(
    `\n갭 흔적 ${totalGap}건 / 매매 ${sales.length}건 (우연 기대 ${totalChance.toFixed(1)}건)`
  );
  const kb = Math.round(Buffer.byteLength(JSON.stringify(snapshot)) / 1024);
  console.log(`저장: ${file} (${kb}KB · 단지 ${Object.keys(complexes).length}개)`);
  if (failures) console.log(`실패 요청 ${failures}건 — 다시 돌리면 채워집니다.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
