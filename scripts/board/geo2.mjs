import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const SP = process.argv[2];
const rows = JSON.parse(readFileSync(SP + '/wrows.json', 'utf8'));
const dist = JSON.parse(readFileSync(SP + '/dist.json', 'utf8'));
const cacheF = SP + '/geo-cache.json';
const cache = existsSync(cacheF) ? JSON.parse(readFileSync(cacheF, 'utf8')) : {};
const UA = { 'User-Agent': 'realty-sim/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function geocode(q) {
  if (cache[q] !== undefined) return cache[q];
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=' + encodeURIComponent(q), { headers: UA });
  const d = await r.json(); await sleep(1100);
  cache[q] = d[0] ? { lat: +d[0].lat, lon: +d[0].lon, label: d[0].display_name } : null;
  writeFileSync(cacheF, JSON.stringify(cache, null, 1));
  return cache[q];
}
const DEST = { lat: 35.2783695, lon: 128.4016799 };
for (const r of rows) {
  if (dist[r.name] !== undefined) continue;
  const road = (r.road || '').replace(/\s*\d+(-\d+)?$/, '');
  const tries = [`${road} ${r.umd.split(' ')[0]} 창원`, `${road} 창원`, `${r.umd} 창원`];
  let p = null, used = '';
  for (const q of tries) { if (!q.trim()) continue; p = await geocode(q); if (p) { used = q; break; } }
  if (!p) { dist[r.name] = null; console.log('MISS', r.name); continue; }
  let rt = null;
  try {
    const j = await (await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${p.lon},${p.lat};${DEST.lon},${DEST.lat}?overview=false`, { headers: UA })).json();
    rt = j.routes?.[0];
  } catch (e) {}
  await sleep(500);
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(DEST.lat - p.lat) / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(DEST.lat)) * Math.sin(rad(DEST.lon - p.lon) / 2) ** 2;
  dist[r.name] = { lat: p.lat, lon: p.lon, q: used, roadKm: rt ? rt.distance / 1000 : null, min: rt ? rt.duration / 60 : null, lineKm: 2 * R * Math.asin(Math.sqrt(a)), label: p.label };
  writeFileSync(SP + '/dist.json', JSON.stringify(dist, null, 1));
  console.log(r.name, '|', used, '|', dist[r.name].roadKm?.toFixed(1), 'km', dist[r.name].min?.toFixed(0), 'min');
}
writeFileSync(SP + '/dist.json', JSON.stringify(dist, null, 1));
console.log('done', Object.keys(dist).length);
