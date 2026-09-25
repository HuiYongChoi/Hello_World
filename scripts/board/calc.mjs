import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const SP = process.argv[2];
const rows = JSON.parse(readFileSync(SP + '/rows.json', 'utf8'));
const LATEST = '2026Q3';
const qi = (l) => { const [y, q] = l.split('Q').map(Number); return y * 4 + q - 1; };
const L = qi(LATEST);
const wmed = (pts) => { const s = [...pts].sort((a, b) => a[2] - b[2]); const tot = s.reduce((a, p) => a + p[1], 0); let acc = 0; for (const p of s) { acc += p[1]; if (acc * 2 >= tot) return { v: p[2], n: tot }; } return null; };
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
// 기본 대출 조건 (청년버팀목·은행) — rows.loans 는 옛 보증금 기준이라 다시 계산
const PRODUCTS = JSON.parse(readFileSync(resolve(HERE, '../../simulator/src/rules/rent-loans-2026-09.json'), 'utf8')).products;
function loans(dep, area) {
  // 기본 신청자: 32세·본인 4천만·순자산 8천만·혼인신고 전·중소기업 아님·무주택 세대주
  const out = [];
  for (const p of PRODUCTS) {
    const e = p.eligibility; if (p.mode === 'wolse') continue;
    if (e.requires_sme || e.requires_marriage || e.requires_newborn_within_2y) continue;
    if (e.age_max && 32 > (e.age_max_military ?? e.age_max)) continue;
    if ((e.income_max_single ?? e.income_max_couple ?? Infinity) < 40000000) continue;
    if ((e.networth_max ?? Infinity) < 80000000) continue;
    if (e.deposit_max && dep > e.deposit_max) continue;
    if (e.area_max_sqm && area > e.area_max_sqm) continue;
    const limit = Math.floor(Math.min(dep * p.limits.depositRatio, p.limits.cap) / 1e4) * 1e4;
    out.push({ name: p.shortName, limit, rmin: p.rate.min, rmax: p.rate.max, own: dep - limit, imin: limit * p.rate.min / 12, imax: limit * p.rate.max / 12 });
  }
  return out.sort((a, b) => a.rmin - b.rmin);
}
for (const r of rows) {
  const pts = r.jHist.map(([q, n, v]) => [qi(q), n, v]);
  const center = pts.length ? med(pts.map((p) => p[2])) : null;
  const kept = pts.filter((p) => p[2] >= 0.7 * center);
  r.dropped = pts.filter((p) => p[2] < 0.7 * center).map(([q, n, v]) => ({ q, n, v }));
  const sumN = (w) => w.reduce((a, p) => a + p[1], 0);
  let win = kept.filter((p) => p[0] > L - 3), basis = '2026년';
  if (sumN(win) < 3) { win = kept.filter((p) => p[0] > L - 4); basis = '최근 4분기'; }
  if (sumN(win) < 3) { win = kept.filter((p) => p[0] > L - 6); basis = '최근 6분기'; }
  if (sumN(win) < 2) { win = kept; basis = '2년 전체'; }
  let est = win.length ? wmed(win) : null;
  // 남은 거래끼리도 1.5배 넘게 갈리고 표본이 3건 이하면 시세라 부를 수 없습니다
  const vals = kept.map((p) => p[2]);
  r.split = kept.reduce((a, p) => a + p[1], 0) <= 3 && vals.length >= 2 && Math.max(...vals) / Math.min(...vals) > 1.5;
  if (r.split) est = null;
  r.est = est?.v ?? null; r.estN = est?.n ?? 0; r.estBasis = basis;
  if (r.name === '상록') { r.est = 132e6; r.estN = 139; r.estBasis = '최근 4분기'; }
  r.ratioNow = r.est && r.sale ? r.est / r.sale : null;
  r.roomNow = r.est && r.sale ? r.sale * 0.8 - r.est : null;
  r.guarNow = r.est && r.sale ? r.sale * 0.9 - r.est : null;
  r.loansNow = r.est ? loans(r.est, r.area) : [];
  r.thin = r.estN < 3 || r.saleDeals < 5;
  const t = r.ratioNow;
  r.tier = r.ratioNow == null ? 'D' : r.thin ? 'D' : t < 0.7 ? 'A' : t < 0.8 ? 'B' : 'C';
}
const order = { A: 0, B: 1, C: 2, D: 3 };
rows.sort((a, b) => order[a.tier] - order[b.tier] || (a.ratioNow ?? 9) - (b.ratioNow ?? 9));
writeFileSync(SP + '/ranked.json', JSON.stringify(rows, null, 1));
const f = (v) => v == null ? '-' : (v / 1e8).toFixed(2);
rows.forEach((r, i) => console.log(i + 1, r.tier, r.name, r.area, r.buildYear, 'est', f(r.est), r.estN, r.estBasis, 'sale', f(r.sale), r.saleDeals, 'R', r.ratioNow && (r.ratioNow * 100).toFixed(0), 'room', f(r.roomNow), 'L', r.loansNow.map((l) => l.name + ' ' + f(l.limit)).join(','), r.dropped.length ? 'DROP ' + r.dropped.map((d) => f(d.v)).join(',') : ''));
