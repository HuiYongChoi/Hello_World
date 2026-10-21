#!/usr/bin/env node
/**
 * 입지 지표 스냅샷 — 매매 실거래 스냅샷(market-*.json)의 **모든 단지**에 위치와 주변 지표를 굽습니다.
 *
 *   node scripts/location/collect.mjs            # 처음부터 (캐시가 있으면 이어서)
 *   node scripts/location/collect.mjs --only write   # 캐시만으로 결과 파일 다시 쓰기
 *
 * 단계 (각 단계 결과는 scripts/location/work/ 에 캐시 — 끊겨도 다시 돌리면 이어서 합니다)
 *
 *   1 geocode   법정동 중심 (Nominatim · 1.2초 1회 · User-Agent realty-sim/1.0, 이메일 없음)
 *   2 overpass  권역별 bbox 안의 이름 있는 아파트 · 정류장 · 역 · 학교 · 학원 · 마트 · 병원 · 공원 · IC
 *   3 match     단지명 + 법정동 근처로 OSM 아파트와 짝짓기 → 못 찾으면 법정동 중심 (approx)
 *   4 foot      FOSSGIS OSRM 보행 table — 정류장 · 역 · 초등학교 (좌표가 맞은 단지만)
 *   5 car       FOSSGIS OSRM 차 table — IC · 대형마트 · 병원 (전 단지, 근사 좌표 포함)
 *   6 umd       FOSSGIS OSRM 차 table — 법정동 단위로 고용중심지 · 직장 후보 · 서울 도심 · GTX 역
 *   7 write     simulator/src/data/location-2026-10.json
 *
 * 화면은 결과 JSON 만 읽습니다 — 수집은 빌드 타임에만 하고 런타임 외부 요청은 0건입니다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const WORK = resolve(HERE, 'work');
const MARKET_FILE = resolve(ROOT, 'simulator/src/data/market-2026-08.json');
const RULES_FILE = resolve(ROOT, 'simulator/src/rules/location-2026-10.json');
const OUT_FILE = resolve(ROOT, 'simulator/src/data/location-2026-10.json');

mkdirSync(WORK, { recursive: true });
const market = JSON.parse(readFileSync(MARKET_FILE, 'utf8'));
const rules = JSON.parse(readFileSync(RULES_FILE, 'utf8'));
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? process.argv[i + 1] : null;
})();

const UA = { 'User-Agent': 'realty-sim/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const hav = (a, b) => {
  const r = (x) => (x * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const GROUPS = ['changwon', 'busan', 'gyeonggi'];
const regionOf = new Map(market.regions.map((r) => [r.code, r]));
const umdKey = (c) => `${c.regionCode} ${c.umd}`;

/* ── 1 법정동 중심 (Nominatim) ─────────────────────────────────────── */

const NOMI_F = resolve(WORK, 'nominatim.json');
const nomi = readJson(NOMI_F, {});

/** "창원시 성산구" → { city:'창원시', gu:'성산구', province:'경상남도' } */
function placeParts(label) {
  const t = label.split(/\s+/);
  if (t[0] === '부산') return { city: '부산광역시', gu: t[1], must: '부산' };
  if (t[0] === '경기') return { city: t[1], gu: t[2] ?? null, must: t[1] };
  return { city: t[0], gu: t[1], must: t[0] };
}

async function nominatim(q) {
  if (nomi[q] !== undefined) return nomi[q];
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(
        'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=kr&q=' + encodeURIComponent(q),
        { headers: UA, signal: AbortSignal.timeout(30000) }
      );
      const d = await r.json();
      nomi[q] = d.map((x) => ({ lat: +x.lat, lon: +x.lon, cls: x.class, type: x.type, label: x.display_name }));
      writeJson(NOMI_F, nomi);
      await sleep(1200);
      return nomi[q];
    } catch (e) {
      log('nominatim retry', q, e.message);
      await sleep(5000);
    }
  }
  return [];
}

async function geocodeUmds() {
  const umds = new Map();
  for (const c of market.complexes) if (!umds.has(umdKey(c))) umds.set(umdKey(c), c);
  const out = {};
  for (const [key, c] of umds) {
    const reg = regionOf.get(c.regionCode);
    const { city, gu, must } = placeParts(reg.label);
    const parts = c.umd.split(/\s+/); // "고덕면 궁리" → ["고덕면","궁리"]
    const last = parts[parts.length - 1];
    const tries = [
      [...parts].reverse().join(', ') + (gu ? `, ${gu}` : '') + `, ${city}`,
      [...parts].reverse().join(', ') + `, ${city}`,
      `${last}, ${city}`,
    ];
    // 리(里) 가 OSM 에 없으면 읍·면 중심으로 — 그 사실을 level 에 남깁니다
    if (parts.length > 1) tries.push(`${parts[0]}, ${city}`);
    let hit = null;
    let used = null;
    let level = 'umd';
    for (const q of tries) {
      const res = await nominatim(q);
      const want = q.startsWith(last) ? last : parts[0];
      // 그 시·도 안이고 이름이 법정동과 같은 것만 — 다른 도시 같은 이름 동을 막습니다
      hit =
        res.find((x) => x.label.includes(must) && x.label.startsWith(want) && x.cls === 'boundary') ??
        res.find((x) => x.label.includes(must) && x.label.startsWith(want)) ??
        null;
      if (hit) {
        used = q;
        if (want !== last) level = 'eupmyeon';
        break;
      }
    }
    out[key] = hit ? { lat: hit.lat, lon: hit.lon, q: used, level, label: hit.label } : null;
    if (!hit) log('MISS 법정동', key, tries);
  }
  return out;
}

/* ── 2 Overpass ────────────────────────────────────────────────────── */

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function overpass(file, q) {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let t = 0; t < 8; t++) {
    try {
      const r = await fetch(OVERPASS[t % OVERPASS.length], {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(400000),
      });
      const tx = await r.text();
      const j = JSON.parse(tx);
      if (!j.elements) throw new Error('no elements');
      const els = j.elements
        .map((e) => ({ id: `${e.type[0]}${e.id}`, t: e.type, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags ?? {} }))
        .filter((e) => e.lat != null);
      writeJson(file, els);
      log('overpass', file.split('/').pop(), els.length);
      await sleep(5000);
      return els;
    } catch (e) {
      log('overpass retry', t, e.message);
      await sleep(15000);
    }
  }
  throw new Error('overpass 실패: ' + file);
}

function bboxOf(points, pad) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return `${(Math.min(...lats) - pad).toFixed(4)},${(Math.min(...lons) - pad).toFixed(4)},${(Math.max(...lats) + pad).toFixed(4)},${(Math.max(...lons) + pad).toFixed(4)}`;
}

async function fetchOsm(group, umdPts) {
  const pts = Object.entries(umdPts)
    .filter(([k, v]) => v && regionOf.get(k.split(' ')[0]).region === group)
    .map(([, v]) => v);
  const bb = bboxOf(pts, 0.05);
  const apts = await overpass(
    resolve(WORK, `osm-${group}-apts.json`),
    `[out:json][timeout:360][maxsize:1073741824];(
      way["landuse"="residential"]["name"](${bb});
      relation["landuse"="residential"]["name"](${bb});
      nwr["building"="apartments"]["name"](${bb});
      way["residential"="apartments"]["name"](${bb});
    );out center tags;`
  );
  const poi = await overpass(
    resolve(WORK, `osm-${group}-poi.json`),
    `[out:json][timeout:360][maxsize:1073741824];(
      node["highway"="bus_stop"](${bb});
      nwr["railway"~"^(station|halt)$"](${bb});
      nwr["amenity"~"^(school|prep_school|hospital)$"](${bb});
      nwr["healthcare"="hospital"](${bb});
      nwr["name"~"학원"](${bb});
      nwr["shop"~"^(department_store|mall|supermarket)$"](${bb});
      nwr["leisure"="park"]["name"](${bb});
      node["highway"="motorway_junction"](${bb});
    );out center tags;`
  );
  return { apts, poi, bb };
}

/* ── 3 단지 짝짓기 ────────────────────────────────────────────────── */

const ALIAS = [
  [/e-?편한세상/g, '이편한세상'],
  [/sk\s*view|sk뷰|skview/g, '에스케이뷰'],
  [/i-?park/g, '아이파크'],
  [/lh/g, '엘에이치'],
  [/제(\d+)단지/g, '$1단지'],
];

function norm(name) {
  let s = (name ?? '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, '');
  for (const [re, to] of ALIAS) s = s.replace(re, to);
  s = s.replace(/아파트|apt\.?|apartment/g, '');
  s = s.replace(/[\s·.,\-_'"]/g, '');
  return s;
}

/** OSM 건물 이름 "부산더샵센텀포레 107동" → "부산더샵센텀포레" */
function cleanOsmName(n) {
  return (n ?? '')
    .replace(/\s*(제)?\d+\s*동$/, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s*(관리동|상가|경비실|노인정|주차장|커뮤니티|어린이집).*$/, '')
    .trim();
}

const numTokens = (s) => new Set([...s.matchAll(/(\d+)(차|단지|블럭|블록)/g)].map((m) => m[1]));

/** 같은 이름 건물·경계를 600m 안에서 한 덩어리로 */
function groupApts(apts) {
  const groups = [];
  const byName = new Map();
  for (const e of apts) {
    const names = [e.tags.name, e.tags['name:ko'], e.tags.alt_name, e.tags.old_name, e.tags.official_name].filter(Boolean);
    const keys = [...new Set(names.map((n) => norm(cleanOsmName(n))).filter((k) => k.length >= 2 && !/^\d+$/.test(k)))];
    if (keys.length === 0) continue;
    const isArea = e.tags.landuse === 'residential';
    let g = null;
    for (const k of keys) {
      g = (byName.get(k) ?? []).find((x) => hav(x, e) < 600) ?? null;
      if (g) break;
    }
    if (!g) {
      g = { keys: new Set(), pts: [], areaPts: [], label: e.tags.name, lat: e.lat, lon: e.lon };
      groups.push(g);
    }
    for (const k of keys) {
      g.keys.add(k);
      if (!byName.has(k)) byName.set(k, []);
      if (!byName.get(k).includes(g)) byName.get(k).push(g);
    }
    (isArea ? g.areaPts : g.pts).push({ lat: e.lat, lon: e.lon });
    const use = g.areaPts.length ? g.areaPts : g.pts;
    g.lat = use.reduce((s, p) => s + p.lat, 0) / use.length;
    g.lon = use.reduce((s, p) => s + p.lon, 0) / use.length;
    if (isArea) g.label = e.tags.name;
  }
  return groups;
}

function matchComplexes(groupsByRegion, umdPts) {
  const out = {};
  for (const c of market.complexes) {
    const u = umdPts[umdKey(c)];
    const nm = norm(c.name);
    const groups = groupsByRegion[c.region] ?? [];
    const radius = /[면리]$/.test(c.umd.split(' ')[0]) ? 5000 : 2500;
    if (!u || nm.length < 2 || /^\d+(-\d+)?$/.test(nm)) {
      out[c.id] = null;
      continue;
    }
    const near = groups.filter((g) => hav(g, u) <= radius);
    const ct = numTokens(nm);
    const cands = [];
    for (const g of near) {
      let score = 0;
      for (const k of g.keys) {
        let s = 0;
        if (k === nm) s = 3;
        else if ((nm.length >= 4 && k.includes(nm)) || (k.length >= 4 && nm.includes(k))) s = 2;
        if (s === 0) continue;
        const gt = numTokens(k);
        if (ct.size && gt.size && ![...ct].some((x) => gt.has(x))) continue; // 2차 ↔ 3차
        if (ct.size && !gt.size && s === 2 && k.length < nm.length) s = 1; // "센텀파크" ↔ "센텀파크2차" — 약하게
        score = Math.max(score, s);
      }
      if (score > 0) cands.push({ g, score, d: hav(g, u) });
    }
    cands.sort((a, b) => b.score - a.score || a.d - b.d);
    let best = cands[0] ?? null;
    // 짧은 이름(현대·한양 3자 이하)은 반경 1.5km 안에 정확히 하나일 때만
    if (best && nm.length <= 3) {
      const exact = cands.filter((x) => x.score === 3 && x.d <= 1500);
      best = exact.length === 1 ? exact[0] : null;
    }
    if (best && best.score < 2) best = null;
    out[c.id] = best ? { lat: best.g.lat, lon: best.g.lon, osm: best.g.label, d: Math.round(best.d) } : null;
  }
  return out;
}

/* ── POI 분류 ─────────────────────────────────────────────────────── */

const MART_RE = /이마트|홈플러스|롯데마트|코스트코|트레이더스|메가마트|하나로마트|농협하나로/;
const MART_EXCLUDE = /이마트\s*24|에브리데이|익스프레스|express|노브랜드|편의점|슈퍼(?!센터)/i;
const HOSP_EXCLUDE = /요양|한방|한의|치과|동물|정신|재활|여성|산부인과|소아|아동|안과|이비인후과|피부|성형|정형외과|비뇨|항문|척추|관절|통증|의원|검진|치매|노인|요양/;
const ACAD_EXCLUDE = /운전|자동차|학원로|학원길|사거리|삼거리|입구|정류장|역$/;

function classify(e) {
  const t = e.tags;
  const name = t.name ?? '';
  const k = [];
  if (e.t === 'node' && t.highway === 'bus_stop') k.push('bus');
  if (/^(station|halt)$/.test(t.railway) && !/freight/.test(`${t.usage ?? ''}${t.station ?? ''}${t['railway:traffic_mode'] ?? ''}`) && !/신호장|화물|기지/.test(name))
    k.push('rail');
  if (t.amenity === 'school' && /초등학교/.test(name)) k.push('elem');
  if (t.amenity === 'school' && /중학교|고등학교/.test(name)) k.push('midhigh');
  if (
    (t.amenity === 'prep_school' || /학원/.test(name)) &&
    !ACAD_EXCLUDE.test(name) &&
    !t.highway &&
    !t.public_transport &&
    !t.junction &&
    !t.railway &&
    t.amenity !== 'school'
  )
    k.push('acad');
  if (t.shop === 'department_store' || (MART_RE.test(name) && !MART_EXCLUDE.test(name) && (t.shop || t.building || t.amenity)))
    k.push('mart');
  if ((t.amenity === 'hospital' || t.healthcare === 'hospital') && name && !HOSP_EXCLUDE.test(name)) k.push('hosp');
  if (t.leisure === 'park' && name) k.push('park');
  if (t.highway === 'motorway_junction' && name && !/jc|jct|분기점|분기/i.test(name)) k.push('ic');
  return k;
}

/* ── OSRM table ───────────────────────────────────────────────────── */

const OSRM_F = resolve(WORK, 'osrm.json');
const osrmCache = readJson(OSRM_F, {});
let osrmCount = 0;

async function table(profile, sources, dests) {
  const coords = [...sources, ...dests].map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const key = `${profile}|${coords}`;
  if (osrmCache[key]) return osrmCache[key];
  const s = sources.map((_, i) => i).join(';');
  const d = dests.map((_, i) => i + sources.length).join(';');
  const url = `https://routing.openstreetmap.de/${profile}/table/v1/driving/${coords}?sources=${s}&destinations=${d}&annotations=duration,distance`;
  for (let t = 0; t < 6; t++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
      const j = await r.json();
      if (j.code !== 'Ok') throw new Error(j.code + ' ' + (j.message ?? ''));
      const res = { dur: j.durations, dist: j.distances };
      osrmCache[key] = res;
      if (++osrmCount % 5 === 0) writeJson(OSRM_F, osrmCache);
      await sleep(1000);
      return res;
    } catch (e) {
      log('osrm retry', profile, t, e.message);
      await sleep(8000 * (t + 1));
    }
  }
  throw new Error('osrm 실패');
}

/** 출발점 각각의 클래스별 가까운 k곳(직선)을 모아 table 한 번. 결과: 출발점 × 클래스 → {min, m, name} */
async function nearestBy(profile, sources, classes, limit = 100) {
  const results = new Array(sources.length);
  let i = 0;
  let batches = 0;
  while (i < sources.length) {
    // 출발 + 도착이 limit 안에 들게 출발점을 하나씩 늘립니다
    const batch = [];
    const dests = new Map();
    let j = i;
    while (j < sources.length) {
      const picks = [];
      for (const cl of classes) {
        const near = cl.pois
          .map((p) => ({ p, d: hav(sources[j], p) }))
          .filter((x) => x.d <= cl.maxM)
          .sort((a, b) => a.d - b.d)
          .slice(0, cl.k);
        for (const x of near) picks.push(x.p);
      }
      const add = picks.filter((p) => !dests.has(p.id));
      if (batch.length > 0 && batch.length + 1 + dests.size + add.length > limit) break;
      batch.push(j);
      for (const p of add) dests.set(p.id, p);
      j++;
    }
    const destList = [...dests.values()];
    let res = null;
    if (destList.length > 0) res = await table(profile, batch.map((b) => sources[b]), destList);
    batch.forEach((b, bi) => {
      const r = {};
      for (const cl of classes) {
        let best = null;
        destList.forEach((p, di) => {
          if (!cl.ids.has(p.id)) return;
          const dur = res?.dur?.[bi]?.[di];
          if (dur == null) return;
          if (!best || dur < best.dur) best = { dur, m: res.dist[bi][di], name: p.name };
        });
        r[cl.key] = best;
      }
      results[b] = r;
    });
    i = j;
    if (++batches % 10 === 0) log(profile, `${i}/${sources.length}`);
  }
  writeJson(OSRM_F, osrmCache);
  return results;
}

/* ── 5분위·반경 수 ────────────────────────────────────────────────── */

function countUnique(src, pois, radius) {
  const seen = new Set();
  for (const p of pois) {
    if (Math.abs(p.lat - src.lat) > 0.02 || Math.abs(p.lon - src.lon) > 0.025) continue;
    if (hav(src, p) <= radius) seen.add(p.name || p.id);
  }
  return seen.size;
}

/* ── 실행 ─────────────────────────────────────────────────────────── */

async function main() {
  const UMD_F = resolve(WORK, 'umd-points.json');
  let umdPts = readJson(UMD_F, null);
  if (!umdPts) {
    if (ONLY === 'write') throw new Error('캐시 없음');
    log('1 geocode 법정동');
    umdPts = await geocodeUmds();
    writeJson(UMD_F, umdPts);
  }
  log('법정동', Object.keys(umdPts).length, '좌표 없음', Object.values(umdPts).filter((v) => !v).length);

  const osm = {};
  for (const g of GROUPS) osm[g] = await fetchOsm(g, umdPts);

  log('3 match');
  const groupsByRegion = Object.fromEntries(GROUPS.map((g) => [g, groupApts(osm[g].apts)]));
  const matched = matchComplexes(groupsByRegion, umdPts);
  writeJson(resolve(WORK, 'matched.json'), matched);
  const nMatched = Object.values(matched).filter(Boolean).length;
  log('짝지음', nMatched, '/', market.complexes.length);

  // 출발점 — 맞춘 단지는 OSM 좌표, 못 맞춘 단지는 법정동 중심
  const cx = market.complexes.map((c) => {
    const m = matched[c.id];
    const u = umdPts[umdKey(c)];
    if (m) return { c, lat: m.lat, lon: m.lon, exact: true };
    if (u) return { c, lat: u.lat, lon: u.lon, exact: false };
    return { c, lat: null, lon: null, exact: false };
  });

  const poiBy = {};
  for (const g of GROUPS) {
    const by = { bus: [], rail: [], elem: [], midhigh: [], acad: [], mart: [], hosp: [], park: [], ic: [] };
    for (const e of osm[g].poi) for (const k of classify(e)) by[k].push({ id: e.id, lat: e.lat, lon: e.lon, name: e.tags.name ?? '' });
    poiBy[g] = by;
    log(g, Object.entries(by).map(([k, v]) => `${k} ${v.length}`).join(' · '));
  }

  const cls = (g, key, k, maxM) => ({ key, k, maxM, pois: poiBy[g][key], ids: new Set(poiBy[g][key].map((p) => p.id)) });
  const IND = rules.indicators;

  const rows = {};
  for (const g of GROUPS) {
    // 도보 — 맞춘 단지만, 같은 시군구끼리 붙여 batch 가 좁은 범위에 모이게
    const exact = cx.filter((x) => x.c.region === g && x.exact).sort((a, b) => a.c.regionCode.localeCompare(b.c.regionCode) || a.lat - b.lat);
    log('4 foot', g, exact.length);
    const foot = await nearestBy('routed-foot', exact, [
      cls(g, 'bus', 3, 1500),
      cls(g, 'rail', 2, IND.subwayWalk.maxStraightM),
      cls(g, 'elem', 2, IND.elemInComplex.maxStraightM),
    ]);
    exact.forEach((x, i) => (x.foot = foot[i]));

    const all = cx.filter((x) => x.c.region === g && x.lat != null).sort((a, b) => a.c.regionCode.localeCompare(b.c.regionCode) || a.lat - b.lat);
    // 근사 좌표는 같은 법정동끼리 겹치므로 좌표로 묶어 한 번만
    const uniq = new Map();
    for (const x of all) {
      const k = `${x.lat.toFixed(5)},${x.lon.toFixed(5)}`;
      if (!uniq.has(k)) uniq.set(k, { lat: x.lat, lon: x.lon, members: [] });
      uniq.get(k).members.push(x);
    }
    const srcs = [...uniq.values()];
    log('5 car', g, srcs.length);
    const car = await nearestBy('routed-car', srcs, [cls(g, 'ic', 3, 30000), cls(g, 'mart', 3, 20000), cls(g, 'hosp', 3, 20000)]);
    srcs.forEach((s, i) => s.members.forEach((x) => (x.car = car[i])));

    for (const x of all) {
      const p = { lat: x.lat, lon: x.lon };
      const by = poiBy[g];
      x.counts = x.exact
        ? {
            bus400: countUnique(p, by.bus.map((b) => ({ ...b, name: b.id })), IND.brt.countRadiusM),
            mh: countUnique(p, by.midhigh, IND.midHighSchool.radiusM),
            acad: countUnique(p, by.acad, IND.academyAccess.radiusM),
            park: countUnique(p, by.park, IND.park.radiusM),
          }
        : null;
    }
  }

  // 6 법정동 단위 — 먼 곳(고용중심지·직장·서울·GTX)
  const umdSrc = {};
  for (const x of cx) {
    if (x.lat == null) continue;
    const k = umdKey(x.c);
    if (!umdSrc[k]) umdSrc[k] = { key: k, region: x.c.region, pts: [], n: 0 };
    if (x.exact) {
      umdSrc[k].pts.push(x);
      umdSrc[k].n++;
    }
  }
  for (const [k, u] of Object.entries(umdSrc)) {
    if (u.pts.length) {
      u.lat = u.pts.reduce((s, p) => s + p.lat, 0) / u.pts.length;
      u.lon = u.pts.reduce((s, p) => s + p.lon, 0) / u.pts.length;
      u.src = 'osm';
    } else {
      u.lat = umdPts[k].lat;
      u.lon = umdPts[k].lon;
      u.src = 'nominatim';
    }
  }
  const placeIds = rules.places.map((p) => p.id);
  for (const g of GROUPS) {
    const us = Object.values(umdSrc).filter((u) => u.region === g);
    const places = rules.places.filter((p) => p.regions.includes(g));
    log('6 umd', g, us.length, '×', places.length);
    for (let i = 0; i < us.length; i += 80) {
      const chunk = us.slice(i, i + 80);
      const res = await table('routed-car', chunk, places);
      chunk.forEach((u, ui) => {
        u.t = placeIds.map((id) => {
          const pi = places.findIndex((p) => p.id === id);
          const v = pi >= 0 ? res.dur?.[ui]?.[pi] : null;
          return v == null ? null : Math.round(v / 6) / 10;
        });
      });
    }
  }

  /* 7 write */
  const names = [];
  const nameIdx = new Map();
  const nm = (s) => {
    if (!s) return null;
    if (!nameIdx.has(s)) {
      nameIdx.set(s, names.length);
      names.push(s);
    }
    return nameIdx.get(s);
  };
  const min1 = (r) => (r ? Math.round(r.dur / 6) / 10 : null);
  const m0 = (r) => (r ? Math.round(r.m) : null);
  const fields = ['id', 'exact', 'lat', 'lon', 'busMin', 'busM', 'bus400', 'railMin', 'railM', 'rail', 'elemMin', 'elemM', 'elem', 'midHigh1k', 'academy1k', 'park800', 'icMin', 'ic', 'martMin', 'mart', 'hospMin', 'hosp'];
  const complexes = [];
  for (const x of cx) {
    if (x.lat == null) continue;
    const f = x.foot ?? {};
    const c = x.car ?? {};
    complexes.push([
      x.c.id,
      x.exact ? 1 : 0,
      +x.lat.toFixed(4),
      +x.lon.toFixed(4),
      min1(f.bus),
      m0(f.bus),
      x.counts?.bus400 ?? null,
      min1(f.rail),
      m0(f.rail),
      nm(f.rail?.name),
      min1(f.elem),
      m0(f.elem),
      nm(f.elem?.name),
      x.counts?.mh ?? null,
      x.counts?.acad ?? null,
      x.counts?.park ?? null,
      min1(c.ic),
      nm(c.ic?.name),
      min1(c.mart),
      nm(c.mart?.name),
      min1(c.hosp),
      nm(c.hosp?.name),
    ]);
  }
  const umd = Object.values(umdSrc).map((u) => [u.key, u.src === 'osm' ? 1 : 0, u.n, +u.lat.toFixed(4), +u.lon.toFixed(4), ...u.t]);

  const stats = {
    complexes: market.complexes.length,
    located: complexes.length,
    exact: cx.filter((x) => x.exact).length,
    byRegion: Object.fromEntries(
      GROUPS.map((g) => {
        const xs = cx.filter((x) => x.c.region === g);
        return [g, { complexes: xs.length, exact: xs.filter((x) => x.exact).length }];
      })
    ),
    poi: Object.fromEntries(GROUPS.map((g) => [g, Object.fromEntries(Object.entries(poiBy[g]).map(([k, v]) => [k, v.length]))])),
  };
  const out = {
    version: '2026-10',
    asOf: new Date().toISOString().slice(0, 10),
    market: market.version ?? '2026-08',
    rules: rules.version,
    note: '단지별 위치·주변 지표. exact=1 은 OSM 아파트 이름으로 짝지은 좌표, 0 은 법정동 중심(approx) — 0 인 단지는 도보 거리·반경 시설 수를 비웁니다. 분은 FOSSGIS OSRM 최소치(신호·정체 없음).',
    source: rules.source,
    fields,
    names,
    complexes,
    umdFields: ['key', 'exact', 'n', 'lat', 'lon', ...placeIds.map((id) => `min:${id}`)],
    placeIds,
    umd,
    stats,
  };
  writeFileSync(OUT_FILE, JSON.stringify(out));
  log('write', OUT_FILE, (JSON.stringify(out).length / 1024).toFixed(0), 'KB', JSON.stringify(stats.byRegion));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
