import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const rows = JSON.parse(readFileSync(SP + '/wrows.json', 'utf8'));
const dist = JSON.parse(readFileSync(SP + '/dist.json', 'utf8'));
const UA = { 'User-Agent': 'realty-sim/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEST = { lat: 35.2783695, lon: 128.4016799 };
const names = [...new Set(rows.map((r) => r.name))].filter((n) => dist[n] && !/동 창원$|리 창원$|읍 .* 창원$|면 .* 창원$/.test(dist[n].q) && !dist[n].q.includes(' ' + rows.find((r) => r.name === n).umd.split(' ')[0] + ' '));
for (const n of names) {
  const r = rows.find((x) => x.name === n);
  const q = `${r.umd} 창원`;
  const d = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=' + encodeURIComponent(q), { headers: UA })).json();
  await sleep(1100);
  if (!d[0]) { console.log('MISS', n, q); continue; }
  const p = { lat: +d[0].lat, lon: +d[0].lon };
  const j = await (await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${p.lon},${p.lat};${DEST.lon},${DEST.lat}?overview=false`, { headers: UA })).json();
  await sleep(400);
  const rt = j.routes?.[0];
  console.log(n, '| old', dist[n].q, dist[n].roadKm?.toFixed(1), '→ new', q, (rt.distance / 1000).toFixed(1), 'km', (rt.duration / 60).toFixed(0), 'min', d[0].display_name.slice(0, 50));
  dist[n] = { ...dist[n], lat: p.lat, lon: p.lon, q, roadKm: rt.distance / 1000, min: rt.duration / 60, approx: 'dong' };
}
writeFileSync(SP + '/dist.json', JSON.stringify(dist, null, 1));
