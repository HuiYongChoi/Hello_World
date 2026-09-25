import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const SP = process.argv[2];
const rows = JSON.parse(readFileSync(SP + '/ranked.json', 'utf8'));
const cacheF = SP + '/geo-cache.json';
const cache = existsSync(cacheF) ? JSON.parse(readFileSync(cacheF, 'utf8')) : {};
const UA = { 'User-Agent': 'realty-sim/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function geocode(q) {
  if (cache[q] !== undefined) return cache[q];
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=' + encodeURIComponent(q), { headers: UA });
  const d = await r.json(); await sleep(1200);
  cache[q] = d[0] ? { lat: +d[0].lat, lon: +d[0].lon, label: d[0].display_name } : null;
  writeFileSync(cacheF, JSON.stringify(cache, null, 1));
  return cache[q];
}
const DEST = { lat: 35.2783695, lon: 128.4016799 }; // 함안의령지사 (함안군 가야읍) 인근 도로
const out = {};
for (const r of rows) {
  const key = r.name;
  if (out[key]) continue;
  const road = (r.road || '').replace(/\s*\d+(-\d+)?$/, '');
  const city = r.region.startsWith('마산') ? '창원' : '';
  const tries = [`${road} ${r.umd.split(' ')[0]} ${city}`.trim(), `${road} ${city}`.trim(), `${r.umd} ${city}`.trim()];
  let p = null, used = '';
  for (const q of tries) { p = await geocode(q); if (p) { used = q; break; } }
  if (!p) { out[key] = null; console.log('MISS', key, tries); continue; }
  const u = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${p.lon},${p.lat};${DEST.lon},${DEST.lat}?overview=false`;
  const j = await (await fetch(u, { headers: UA })).json(); await sleep(600);
  const rt = j.routes?.[0];
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(DEST.lat - p.lat) / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(DEST.lat)) * Math.sin(rad(DEST.lon - p.lon) / 2) ** 2;
  out[key] = { lat: p.lat, lon: p.lon, q: used, roadKm: rt ? rt.distance / 1000 : null, min: rt ? rt.duration / 60 : null, lineKm: 2 * R * Math.asin(Math.sqrt(a)), label: p.label };
  console.log(key, '|', used, '|', out[key].roadKm?.toFixed(1), 'km', out[key].min?.toFixed(0), 'min | 직선', out[key].lineKm.toFixed(1), '|', p.label.slice(0, 60));
}
writeFileSync(SP + '/dist.json', JSON.stringify(out, null, 1));
