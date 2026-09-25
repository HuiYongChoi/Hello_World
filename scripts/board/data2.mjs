import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const data = JSON.parse(readFileSync(SP + '/data.json', 'utf8'));
const infra = JSON.parse(readFileSync(SP + '/infra.json', 'utf8'));
const AXES = [
  { key: 'walk', label: '산책 (공원·산책로)', short: '산책', r: 800, unit: '공원·이름 있는 산책로', w: 3, basis: 'leisure=park·garden·dog_park + 이름 붙은 보행로' },
  { key: 'pet', label: '동물병원·펫숍', short: '펫', r: 1500, unit: '동물병원·펫숍', w: 2, basis: 'amenity=veterinary · shop=pet' },
  { key: 'shop', label: '장보기 (마트·시장)', short: '마트', r: 800, unit: '마트·시장', w: 2, basis: 'shop=supermarket·mall·department_store · amenity=marketplace' },
  { key: 'med', label: '병원·의원', short: '병원', r: 1000, unit: '병원·의원', w: 1, basis: 'amenity=hospital·clinic·doctors' },
  { key: 'bus', label: '버스 정류장', short: '버스', r: 400, unit: '정류장', w: 1, basis: 'highway=bus_stop' },
  { key: 'life', label: '생활편의 (카페·식당·은행·약국·편의점)', short: '편의', r: 500, unit: '생활편의 시설', w: 1, basis: 'amenity=cafe·restaurant·bank·pharmacy · shop=convenience' },
];
const names = Object.keys(infra);
const auto = {};
for (const a of AXES) {
  const vals = names.map((n) => infra[n][a.key]);
  const zeroShare = vals.filter((v) => v === 0).length / vals.length;
  const sparse = zeroShare > 0.4;
  const pool = sparse ? vals.filter((v) => v > 0) : vals;
  a.sparse = sparse;
  for (const n of names) {
    const v = infra[n][a.key];
    let sc;
    if (sparse && v === 0) sc = null;
    else if (v === 0) sc = 1;
    else {
      const less = pool.filter((x) => x < v).length, eq = pool.filter((x) => x === v).length;
      sc = Math.min(5, 1 + Math.floor(((less + eq / 2) / pool.length) * 5));
    }
    (auto[n] ||= {})[a.key] = sc;
  }
  console.log(a.key, 'zero', (zeroShare * 100).toFixed(0) + '%', sparse ? 'SPARSE' : '');
}
for (const d of data) {
  d.cx = d.id.split('_')[0];
  d.counts = infra[d.name] || {};
  d.auto = auto[d.name] || Object.fromEntries(AXES.map((a) => [a.key, null]));
}
writeFileSync(SP + '/data2.json', JSON.stringify(data));
writeFileSync(SP + '/axes.json', JSON.stringify(AXES));
for (const n of names) console.log(n.padEnd(16), JSON.stringify(infra[n]), JSON.stringify(auto[n]));
