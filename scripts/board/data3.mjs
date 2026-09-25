import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const J = JSON.parse(readFileSync(SP + '/data2.json', 'utf8'));
const W = JSON.parse(readFileSync(SP + '/wrows.json', 'utf8'));
const AXES = JSON.parse(readFileSync(SP + '/axes.json', 'utf8'));
const dist = JSON.parse(readFileSync(SP + '/dist.json', 'utf8'));
const old = JSON.parse(readFileSync(SP + '/infra.json', 'utf8'));
const bulk = JSON.parse(readFileSync(SP + '/infra-bulk.json', 'utf8'));
function scorer(pool) {   // pool: {name: counts}
  const names = Object.keys(pool), res = {};
  for (const a of AXES) {
    const vals = names.map((n) => pool[n][a.key]);
    const sparse = vals.filter((v) => v === 0).length / vals.length > 0.4;
    const base = sparse ? vals.filter((v) => v > 0) : vals;
    res[a.key] = (v) => {
      if (v == null) return null;
      if (sparse && v === 0) return null;
      if (v === 0) return 1;
      const less = base.filter((x) => x < v).length, eq = base.filter((x) => x === v).length;
      return Math.min(5, 1 + Math.floor(((less + (eq || 1) / 2) / base.length) * 5));
    };
  }
  return res;
}
// 전세: 이미 잰 19곳의 자동 점수는 그대로, 비어 있던 곳만 같은 모집단에 넣어 채웁니다
const jPool = {};
for (const d of J) jPool[d.name] = old[d.name] || bulk[d.name];
const js = scorer(jPool);
let filled = 0;
for (const d of J) {
  if (!old[d.name] && bulk[d.name]) {
    d.counts = bulk[d.name];
    d.auto = Object.fromEntries(AXES.map((a) => [a.key, js[a.key](bulk[d.name][a.key])]));
    filled++;
  }
}
// 월세: 월세 후보끼리 상대 점수
const wPool = {};
for (const d of W) wPool[d.name] = bulk[d.name];
const ws = scorer(Object.fromEntries(Object.entries(wPool).filter(([, v]) => v)));
const PRIORITY = 25000000;  // 소액임차인 최우선변제 한도 (그 밖의 지역) — 화면에 확인 필요 표기
const PRIORITY_DEP = 75000000;
for (const d of W) {
  const c = bulk[d.name];
  d.counts = c || {};
  d.auto = Object.fromEntries(AXES.map((a) => [a.key, c ? ws[a.key](c[a.key]) : null]));
  const p = dist[d.name];
  d.km = p?.roadKm ?? null; d.min = p?.min ?? null; d.approx = p?.approx === 'dong';
  d.priority = d.dep <= PRIORITY_DEP;
  d.rental = !d.sale && d.wn >= 30;   // 매매가 없고 월세가 많으면 임대 전용 단지로 보임
  // 판정: 보증금이 돌려받기 쉬운가
  d.tier = d.sale == null ? 'D' : d.room != null && d.room > 0 && (d.dep <= PRIORITY || d.ratio < 0.5) ? 'A' : d.room > 0 ? 'B' : 'C';
  const n = [];
  if (d.rental) n.push(`매매 0건 · 월세 ${d.wn}건 — 임대 전용(공공·민간임대) 단지로 보임, 임대인·보증 조건 확인`);
  if (d.approx) n.push('위치가 동 중심 기준 — 실제 단지와 수백 m 어긋날 수 있음');
  if (d.priority) n.push(`보증금 7,500만 이하 — 소액임차인 최우선변제 대상(2,500만까지, 전입·확정일자 필요 · 시행령 확인)`);
  if (d.area > 85) n.push('전용 85㎡ 초과 — 정책상품 불가');
  if (d.wn < 5) n.push(`월세 표본 ${d.wn}건`);
  if (d.renew >= 0.4) n.push(`갱신계약 ${Math.round(d.renew * 100)}% — 새 매물 드묾`);
  d.notes = n;
}
// 월세 자동 순위: 판정(A,B → C → D) 다음 월 환산 주거비 낮은 순
const TO = { A: 0, B: 0, C: 1, D: 2 };
W.sort((a, b) => TO[a.tier] - TO[b.tier] || a.monthly - b.monthly);
W.forEach((d, i) => (d.rank = i + 1));
writeFileSync(SP + '/data-j.json', JSON.stringify(J));
writeFileSync(SP + '/data-w.json', JSON.stringify(W));
console.log('jeonse filled', filled, 'wolse', W.length, 'tiers', JSON.stringify(W.reduce((m, d) => (m[d.tier] = (m[d.tier] || 0) + 1, m), {})));
W.slice(0, 12).forEach((d) => console.log(d.rank, d.tier, d.name, d.area, d.built, (d.dep / 1e4) + '/' + (d.rent / 1e4), Math.round(d.monthly / 1e4) + '만', d.km?.toFixed(1), d.rental ? '임대' : ''));
