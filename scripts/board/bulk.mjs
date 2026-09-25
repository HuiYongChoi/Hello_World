import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const dist = JSON.parse(readFileSync(SP + '/dist.json', 'utf8'));
const pts = Object.values(dist).filter(Boolean);
const lat0 = Math.min(...pts.map((p) => p.lat)) - 0.02, lat1 = Math.max(...pts.map((p) => p.lat)) + 0.02;
const lon0 = Math.min(...pts.map((p) => p.lon)) - 0.02, lon1 = Math.max(...pts.map((p) => p.lon)) + 0.02;
const bb = `${lat0},${lon0},${lat1},${lon1}`;
const q = `[out:json][timeout:180];(
nwr["shop"~"^(supermarket|mall|department_store|greengrocer|convenience|pet)$"](${bb});
nwr["amenity"~"^(marketplace|hospital|clinic|doctors|veterinary|cafe|restaurant|fast_food|bank|pharmacy)$"](${bb});
nwr["healthcare"~"^(hospital|clinic|doctor)$"](${bb});
nwr["leisure"~"^(park|garden|dog_park)$"](${bb});
way["highway"~"^(footway|path|pedestrian)$"]["name"](${bb});
node["highway"="bus_stop"](${bb});
);out center tags;`;
const EPS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let j = null;
for (let t = 0; t < 6 && !j; t++) {
  try {
    const r = await fetch(EPS[t % 3], { method: 'POST', headers: { 'User-Agent': 'realty-sim/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(200000) });
    const tx = await r.text(); j = JSON.parse(tx); if (!j.elements) j = null;
  } catch (e) { console.log('retry', t, e.message); await new Promise((r) => setTimeout(r, 5000)); }
}
console.log('bbox', bb, 'elements', j.elements.length);
const els = j.elements.map((e) => ({ lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, t: e.tags || {}, type: e.type })).filter((e) => e.lat);
const cat = (e) => {
  const t = e.t, out = [];
  if (/^(supermarket|mall|department_store|greengrocer)$/.test(t.shop) || t.amenity === 'marketplace') out.push('shop');
  if (/^(hospital|clinic|doctors)$/.test(t.amenity) || /^(hospital|clinic|doctor)$/.test(t.healthcare)) out.push('med');
  if (t.amenity === 'veterinary' || t.shop === 'pet' || t.leisure === 'dog_park') out.push('pet');
  if (/^(park|garden|dog_park)$/.test(t.leisure) || (e.type === 'way' && /^(footway|path|pedestrian)$/.test(t.highway) && t.name)) out.push('walk');
  if (t.highway === 'bus_stop' && e.type === 'node') out.push('bus');
  if (/^(cafe|restaurant|fast_food|bank|pharmacy)$/.test(t.amenity) || t.shop === 'convenience') out.push('life');
  return out;
};
const R = { shop: 800, med: 1000, pet: 1500, walk: 800, bus: 400, life: 500 };
const hav = (a, b) => { const r = (x) => (x * Math.PI) / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
const tagged = els.map((e) => ({ ...e, c: cat(e) })).filter((e) => e.c.length);
const out = {};
for (const [name, p] of Object.entries(dist)) {
  if (!p) continue;
  const cnt = { shop: 0, med: 0, pet: 0, walk: 0, bus: 0, life: 0 };
  for (const e of tagged) { const d = hav(p, e); for (const k of e.c) if (d <= R[k]) cnt[k]++; }
  out[name] = cnt;
}
writeFileSync(SP + '/infra-bulk.json', JSON.stringify(out, null, 1));
const old = JSON.parse(readFileSync(SP + '/infra.json', 'utf8'));
for (const n of Object.keys(old).slice(0, 6)) console.log(n, 'old', JSON.stringify(old[n]), 'bulk', JSON.stringify(out[n]));
console.log('complexes', Object.keys(out).length);
