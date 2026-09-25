import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const rows = JSON.parse(readFileSync(SP + '/ranked.json', 'utf8'));
const dist = JSON.parse(readFileSync(SP + '/dist.json', 'utf8'));
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const eok = (v) => v >= 1e8 ? `${(v / 1e8).toFixed(2)}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
function notes(r) {
  const n = [];
  if (r.split) n.push('전세 거래 2건이 2.50억·0.34억으로 갈려 시세를 알 수 없음 (앞서 42%로 잘못 안내)');
  if (r.name === '상록') n.push('매매 0건·전월세 342건 — 공공임대로 보임(추정), 입주자격 확인');
  if (r.dropped.length) n.push(`튀는 거래 제외: ${r.dropped.map((d) => eok(d.v)).join(', ')}`);
  if (!r.split && r.estN < 3 && r.est) n.push(`전세 표본 ${r.estN}건`);
  if (r.sale && r.saleDeals < 5) n.push(`매매 표본 ${r.saleDeals}건`);
  if (r.area > 85) n.push('전용 85㎡ 초과 — 정책상품 불가');
  else if (r.est && r.est > 3e8) n.push('보증금 3억 초과 — 청년버팀목 불가');
  if (r.trend != null && r.trend <= -0.05) n.push(`매매가 하락 중 (${pct(r.trend, 1)})`);
  if (r.renewal >= 0.4) n.push(`갱신계약 ${pct(r.renewal)} — 새 매물 드묾`);
  return n;
}
const out = rows.map((r, i) => ({
  id: `${r.id}_${r.area}`,
  rank: i + 1, tier: r.tier, name: r.name, umd: r.umd, road: r.road, region: r.region,
  built: r.buildYear, area: r.area, supply: Math.round(r.area / 0.78 / 3.3058),
  est: r.est, estN: r.estN, estBasis: r.estBasis, sale: r.sale, saleN: r.saleDeals,
  ratio: r.ratioNow, room: r.roomNow, guar: r.guarNow, trend: r.trend,
  loans: r.loansNow.map((l) => ({ n: l.name, lim: l.limit, r0: l.rmin, r1: l.rmax, own: l.own, i0: Math.round(l.imin), i1: Math.round(l.imax) })),
  km: dist[r.name]?.roadKm ?? null, min: dist[r.name]?.min ?? null, line: dist[r.name]?.lineKm ?? null,
  jh: r.jHist, sh: r.sHist, wolse: r.wolse, deals: r.n, last: r.lastYm, renew: r.renewal,
  notes: notes(r),
}));
writeFileSync(SP + '/data.json', JSON.stringify(out));
console.log(out.length, JSON.stringify(out).length);
