import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const SP = process.argv[2];
const dist = JSON.parse(readFileSync(SP + '/dist.json', 'utf8'));
const DEST = { lat: 35.2783695, lon: 128.4016799 };
const W = 320, H = 220;            // 동네 지도 창
const ZL = 15, ZO = 11;            // 동네 / 전체
const px = (lat, lon, z) => {
  const n = 256 * 2 ** z, r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};
const need = new Set();
const pts = {};
for (const [name, p] of Object.entries(dist)) {
  if (!p) continue;
  const L = px(p.lat, p.lon, ZL), O = px(p.lat, p.lon, ZO);
  pts[name] = { lx: L.x, ly: L.y, ox: O.x, oy: O.y };
  for (let tx = Math.floor((L.x - W / 2) / 256); tx <= Math.floor((L.x + W / 2) / 256); tx++)
    for (let ty = Math.floor((L.y - H / 2) / 256); ty <= Math.floor((L.y + H / 2) / 256); ty++) need.add(`${ZL}/${tx}/${ty}`);
}
const D = px(DEST.lat, DEST.lon, ZO);
const ox = Object.values(pts).map((p) => p.ox).concat(D.x), oy = Object.values(pts).map((p) => p.oy).concat(D.y);
const ob = { x0: Math.floor(Math.min(...ox) / 256), x1: Math.floor(Math.max(...ox) / 256), y0: Math.floor(Math.min(...oy) / 256), y1: Math.floor(Math.max(...oy) / 256) };
for (let tx = ob.x0; tx <= ob.x1; tx++) for (let ty = ob.y0; ty <= ob.y1; ty++) need.add(`${ZO}/${tx}/${ty}`);
console.log('tiles', need.size, 'overview', ob);
const tiles = {};
for (const k of need) {
  const f = `${SP}/tiles/${k.replaceAll('/', '_')}.png`;
  if (!existsSync(f)) {
    const r = await fetch(`https://tile.openstreetmap.org/${k}.png`, { headers: { 'User-Agent': 'realty-sim/1.0 (one-off personal map)' } });
    if (!r.ok) { console.log('fail', k, r.status); continue; }
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    await new Promise((res) => setTimeout(res, 250));
  }
  tiles[k] = 'data:image/png;base64,' + readFileSync(f).toString('base64');
}
writeFileSync(SP + '/map.json', JSON.stringify({ ZL, ZO, W, H, ob, dest: { ox: D.x, oy: D.y }, pts, tiles }));
console.log('bytes', JSON.stringify(tiles).length);
