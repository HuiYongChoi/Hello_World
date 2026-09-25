import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const SP = process.argv[2];
const dist = JSON.parse(readFileSync(SP + '/dist.json', 'utf8'));
const outF = SP + '/infra.json';
const out = existsSync(outF) ? JSON.parse(readFileSync(outF, 'utf8')) : {};
/* 축 — 반경은 걸어서 닿는 거리 기준 */
const AXES = {
  shop:  { r: 800,  q: 'nwr(around:R,LAT,LON)["shop"~"^(supermarket|mall|department_store|greengrocer)$"];nwr(around:R,LAT,LON)["amenity"="marketplace"];' },
  med:   { r: 1000, q: 'nwr(around:R,LAT,LON)["amenity"~"^(hospital|clinic|doctors)$"];nwr(around:R,LAT,LON)["healthcare"~"^(hospital|clinic|doctor)$"];' },
  pet:   { r: 1500, q: 'nwr(around:R,LAT,LON)["amenity"="veterinary"];nwr(around:R,LAT,LON)["shop"="pet"];nwr(around:R,LAT,LON)["leisure"="dog_park"];' },
  walk:  { r: 800,  q: 'nwr(around:R,LAT,LON)["leisure"~"^(park|garden|dog_park)$"];way(around:R,LAT,LON)["highway"~"^(footway|path|pedestrian)$"]["name"];' },
  bus:   { r: 400,  q: 'node(around:R,LAT,LON)["highway"="bus_stop"];node(around:R,LAT,LON)["public_transport"="platform"]["bus"="yes"];' },
  life:  { r: 500,  q: 'nwr(around:R,LAT,LON)["amenity"~"^(cafe|restaurant|fast_food|bank|pharmacy)$"];nwr(around:R,LAT,LON)["shop"="convenience"];' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, p] of Object.entries(dist)) {
  if (!p || out[name]) continue;
  const parts = Object.entries(AXES).map(([k, a]) =>
    `(${a.q.replaceAll('R', a.r).replaceAll('LAT', p.lat).replaceAll('LON', p.lon)});out count;`).join('');
  const body = '[out:json][timeout:60];' + parts;
  let j = null;
  const EPS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  for (let t = 0; t < 6 && !j; t++) {
    try {
      const res = await fetch(EPS[t % EPS.length], { method: 'POST', headers: { 'User-Agent': 'realty-sim/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(body) });
      const tx = await res.text(); j = JSON.parse(tx); if (!j.elements) j = null;
    } catch (e) { j = null; await sleep(4000); }
  }
  if (!j) { console.log('FAIL', name); continue; }
  const counts = j.elements.filter((e) => e.type === 'count').map((e) => +e.tags.total);
  out[name] = Object.fromEntries(Object.keys(AXES).map((k, i) => [k, counts[i]]));
  writeFileSync(outF, JSON.stringify(out, null, 1));
  console.log(name, JSON.stringify(out[name]));
  await sleep(2500);
}
