import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const rows = JSON.parse(readFileSync(SP + '/ranked.json', 'utf8'));
const eok = (v) => (v == null ? '—' : v >= 1e8 ? `${(v / 1e8).toFixed(2)}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`);
const man = (v) => `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
const pct = (v, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const sp = (a) => (a / 0.78 / 3.3058).toFixed(0);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const JINDONG = ['마산신화하니엘더마린', '한일유앤아이'];
const TIER = {
  A: ['위험 낮음', '#16a34a'],
  B: ['보통 — 등기부 확인 필수', '#2563eb'],
  C: ['주의·위험 — 전세로는 권하지 않음', '#dc2626'],
  D: ['표본 얇음 · 판단 보류', '#6b7280'],
};

function notes(r) {
  const n = [];
  if (r.split) n.push('전세 거래 2건이 2.50억·0.34억으로 갈려 시세를 알 수 없음');
  if (r.name === '상록') n.push('매매 0건·전월세 342건 — 공공임대로 보임(추정), 입주자격 확인');
  if (JINDONG.includes(r.name)) n.push('진동면 — 구 등급은 "보통"이나 실제로는 함안 방향과 멂');
  if (r.dropped.length) n.push(`튀는 거래 제외: ${r.dropped.map((d) => eok(d.v)).join(', ')}`);
  if (!r.split && r.estN < 3 && r.est) n.push(`전세 표본 ${r.estN}건`);
  if (r.sale && r.saleDeals < 5) n.push(`매매 표본 ${r.saleDeals}건`);
  if (r.area > 85) n.push('전용 85㎡ 초과 — 정책상품 불가');
  else if (r.est && r.est > 3e8) n.push('보증금 3억 초과 — 청년버팀목 불가');
  if (r.trend != null && r.trend <= -0.05) n.push(`매매가 하락 중 (${pct(r.trend, 1)})`);
  if (r.renewal >= 0.4) n.push(`갱신계약 ${pct(r.renewal)} — 새 매물 드묾`);
  if (r.buildYear >= 2019) n.push('신축');
  return n;
}

function loanCell(r) {
  if (!r.loansNow.length) return '—';
  const b = r.loansNow[0];
  const others = r.loansNow.slice(1).map((l) => l.name).join(' · ');
  return `<b>${b.name}</b> ${eok(b.limit)} <span class="m">연 ${pct(b.rmin, 1)}${b.rmax > b.rmin ? '~' + pct(b.rmax, 1) : ''}</span><br>
    <span class="m">월 이자 ${man(b.imin)}~${man(b.imax)} · 자기 돈 ${eok(b.own)}</span>${others ? `<br><span class="m">그 밖: ${others}</span>` : ''}`;
}

let rank = 0, lastTier = '';
const body = rows.map((r) => {
  rank++;
  const head = r.tier !== lastTier ? `<tr class="tier"><td colspan="11" style="border-left:4px solid ${TIER[r.tier][1]}">${TIER[r.tier][0]}</td></tr>` : '';
  lastTier = r.tier;
  const roomCls = r.roomNow == null ? '' : r.roomNow > 0 ? 'good' : 'bad';
  return head + `<tr>
    <td class="c b">${rank}</td>
    <td><b>${esc(r.name)}</b><br><span class="m">${esc(r.umd)} · ${r.region} · 준공 ${r.buildYear}</span></td>
    <td class="c">${r.area}㎡<br><span class="m">공급 약 ${sp(r.area)}평</span></td>
    <td class="c">${r.commute}</td>
    <td class="r">${r.est ? eok(r.est) : '—'}<br><span class="m">${r.est ? `${r.estBasis} · ${r.estN}건` : '시세 불명'}</span></td>
    <td class="r">${eok(r.sale)}<br><span class="m">${r.sale ? `최근 1년 · ${r.saleDeals}건` : '매매 없음'}</span></td>
    <td class="c b" style="color:${r.ratioNow == null ? '#6b7280' : r.ratioNow < 0.7 ? '#16a34a' : r.ratioNow < 0.8 ? '#2563eb' : '#dc2626'}">${pct(r.ratioNow)}</td>
    <td class="r ${roomCls}">${r.roomNow == null ? '—' : r.roomNow > 0 ? eok(r.roomNow) + ' 이하' : '융자 없어도 ' + eok(-r.roomNow) + ' 부족'}</td>
    <td class="c">${r.trend == null ? '—' : (r.trend >= 0 ? '+' : '') + pct(r.trend, 1)}</td>
    <td>${loanCell(r)}</td>
    <td class="m">${notes(r).map(esc).join('<br>')}</td>
  </tr>`;
}).join('');

const hist = (h) => h.length ? h.map(([q, n, v]) => `<span class="h">${q.replace('20', "'")} <b>${eok(v)}</b><i>${n}</i></span>`).join('') : '<span class="m">없음</span>';
const detail = (r, i) => `<div class="card">
  <div class="ct"><b>${i}. ${esc(r.name)}</b> · 전용 ${r.area}㎡ (공급 약 ${sp(r.area)}평) · 준공 ${r.buildYear} · ${esc(r.umd)} ${esc(r.road ?? '')}
    <span class="pill" style="background:${TIER[r.tier][1]}">${pct(r.ratioNow)}</span></div>
  <div class="row"><span class="k">전세 (분기별 중위 · 건수)</span>${hist(r.jHist)}</div>
  <div class="row"><span class="k">매매 (분기별 중위 · 건수)</span>${hist(r.sHist)}</div>
  <div class="row"><span class="k">월세</span>${r.wolse ? `보증금 ${eok(r.wolse.deposit)} · 월 ${man(r.wolse.rent)} (${r.wolse.n}건)` : '거래 없음'} · 마지막 거래 ${r.lastYm.slice(0, 4)}.${r.lastYm.slice(4)} · 2년 거래 ${r.n}건 · 갱신 ${pct(r.renewal)}</div>
  <div class="row"><span class="k">융자 허용선</span>${r.roomNow == null ? '잴 수 없음' : r.roomNow > 0 ? `등기부 을구 채권최고액 합계 <b>${eok(r.roomNow)} 이하</b> (경매 80% 가정)` : `<b class="bad">근저당이 없어도 경매 시 ${eok(-r.roomNow)} 부족</b>`}
    ${r.guarNow != null ? ` · 보증보험 기준(시세 90%) 선순위 ${r.guarNow > 0 ? eok(r.guarNow) + ' 이하' : '보증금만으로 초과'}` : ''}</div>
  <div class="row"><span class="k">전세대출</span>${r.loansNow.map((l) => `${l.name} ${eok(l.limit)} (연 ${pct(l.rmin, 1)}${l.rmax > l.rmin ? '~' + pct(l.rmax, 1) : ''}, 월 ${man(l.imin)}~${man(l.imax)}, 자기 돈 ${eok(l.own)})`).join(' · ') || '—'}</div>
  ${notes(r).length ? `<div class="row m">· ${notes(r).map(esc).join(' · ')}</div>` : ''}
</div>`;

const top = rows.filter((r) => r.tier === 'A' || r.tier === 'B');
const rest = rows.filter((r) => !(r.tier === 'A' || r.tier === 'B'));

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>마산 전세 후보 순위</title><style>
@page { size: A4 landscape; margin: 9mm 10mm; }
* { box-sizing: border-box; }
body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; font-size: 8.4pt; color: #111827; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 2px; } h2 { font-size: 11pt; margin: 14px 0 6px; border-bottom: 1.5px solid #111827; padding-bottom: 3px; }
.sub { color: #4b5563; font-size: 8.5pt; }
.box { border: 1px solid #d1d5db; border-radius: 6px; padding: 7px 10px; margin: 6px 0; line-height: 1.55; }
.warn { border-color: #f59e0b; background: #fffbeb; } .info { background: #f8fafc; }
table { width: 100%; border-collapse: collapse; }
th { background: #111827; color: #fff; font-weight: 600; padding: 4px 4px; font-size: 7.8pt; text-align: center; }
td { border-bottom: 1px solid #e5e7eb; padding: 3.5px 4px; vertical-align: top; line-height: 1.35; }
tr { page-break-inside: avoid; }
tr.tier td { background: #f3f4f6; font-weight: 700; font-size: 8.2pt; padding: 4px 8px; }
.c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
.m { color: #6b7280; font-size: 7.4pt; } .good { color: #15803d; } .bad { color: #b91c1c; }
.card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 9px; margin: 0 0 6px; page-break-inside: avoid; }
.ct { font-size: 9pt; margin-bottom: 3px; } .pill { color: #fff; border-radius: 9px; padding: 0 7px; font-size: 8pt; margin-left: 6px; }
.row { margin: 2px 0; } .k { display: inline-block; width: 118px; color: #6b7280; }
.h { display: inline-block; margin-right: 9px; } .h i { font-style: normal; color: #9ca3af; font-size: 7pt; margin-left: 2px; }
.pb { page-break-before: always; }
ul { margin: 3px 0 0 16px; padding: 0; } li { margin: 1px 0; }
</style></head><body>
<h1>마산 전세 후보 순위 — 안전한 전세 · 전세대출 · 신축</h1>
<div class="sub">작성 2026-09-24 · 국토교통부 아파트 매매·전월세 실거래 (전월세 2024.10~2026.09, 매매 스냅샷 2026-08) · 조건: 방 2개 이상(전용 45㎡↑) · 함안·의령지사 출퇴근 · 전세 우선</div>

<div class="box info"><b>한 줄 결론</b> — 지금 시세로는 <b>전세가율 70% 아래(위험 낮음)인 곳이 한 곳도 없습니다.</b> 가장 여유 있는 곳은 교방동 <b>푸르지오더플래티넘 1·3단지 84㎡(71~72%)</b>이고, 시세 신뢰도가 가장 높은 곳은 <b>롯데캐슬프리미어 85㎡(79%, 매매 62건)</b>, 출퇴근이 가장 나은 곳은 <b>양덕코오롱하늘채 85㎡(78%)</b>입니다. <b>한일 1~4차·오동동·벽산블루밍은 전세가 집값에 붙어 있어 전세로는 권하지 않습니다.</b></div>

<div class="box warn"><b>정정</b> — 앞서 1위로 알려 드린 <b>창원메트로시티석전(전세가율 42%)은 틀린 값</b>이었습니다. 52㎡ 전세 거래가 2년에 2건뿐인데 <b>2.50억(2025년 1분기)과 0.34억(2026년 2분기)</b>으로 갈려 있었고, 두 건의 중위(=평균) 1.42억이 시세처럼 쓰였습니다. 0.34억은 특수한 계약으로 보이고, 2.50억이 시세라면 전세가율은 약 <b>75%</b>입니다. 전세 시세를 알 수 없어 이 보고서에서는 <b>판단 보류</b>로 내렸습니다.</div>

<div class="box"><b>순위 기준</b> — 점수를 합치지 않고 차례로 가릅니다. ① <b>표본이 충분한가</b>(최근 전세 3건 이상 · 같은 평형 매매 5건 이상 — 안 되면 맨 아래 '판단 보류') → ② <b>전세가율</b>(최근 전세 ÷ 매매 중위)이 낮은 순. 출퇴근·신축·대출은 순위에 섞지 않고 옆 칸에 둡니다.<br>
<b>최근 전세</b> = 2026년 거래가 3건 이상이면 그 중위, 모자라면 최근 4분기 → 6분기 → 2년 순으로 넓힘. 같은 평형 중위의 70%에 못 미치는 거래는 특수 계약으로 보고 뺐습니다. <b>매매 중위</b> = 같은 단지·평형 최근 1년(4분기) 거래.<br>
<b>근저당 허용선</b> = 매매 중위 × 80%(경매 낙찰가율 가정) − 보증금. 등기부등본 을구의 <b>채권최고액 합계</b>가 이 금액보다 크면 경매로 넘어갔을 때 보증금을 다 못 돌려받을 수 있습니다. <b>융자가 있는지는 공개 자료에 없어</b> 계약 전에 등기부로 직접 확인해야 합니다.<br>
<b>전세대출</b> = 기본 조건(만 32세 · 본인 소득 4천만 · 순자산 8천만 · 혼인신고 전 · 중소기업 재직 아님 · 무주택 세대주)으로 가장 싼 상품. 중소기업 재직이면 보증금 2억 이하에서 <b>중기청(연 1.5%)</b>이 열립니다.</div>

<h2>순위표 (${rows.length}개 평형)</h2>
<table><thead><tr><th>순위</th><th style="width:15%">단지</th><th>평형</th><th>출퇴근</th><th>최근 전세</th><th>매매 중위</th><th>전세가율</th><th>근저당 허용선</th><th>매매 1년</th><th style="width:19%">되는 전세대출 (가장 싼 것)</th><th style="width:16%">비고</th></tr></thead>
<tbody>${body}</tbody></table>

<h2 class="pb">상위권 상세 — 최근 거래 이력</h2>
<div class="sub" style="margin-bottom:6px">분기별 중위가와 거래 건수(작은 숫자)입니다. '25 = 2025년. 전세는 순수 전세만, 매매는 해제 거래 제외.</div>
${top.map((r, i) => detail(r, rows.indexOf(r) + 1)).join('')}

<h2 class="pb">나머지 후보 — 최근 거래 이력</h2>
${rest.map((r) => detail(r, rows.indexOf(r) + 1)).join('')}

<h2>계약 전에 서류로 볼 것 — 융자는 여기서 확인합니다</h2>
<table><thead><tr><th style="width:14%">무엇</th><th style="width:28%">어디서</th><th>무엇을 보나</th></tr></thead><tbody>
<tr><td><b>소유자</b></td><td>등기부등본 갑구 (인터넷등기소 열람)</td><td>계약하는 사람이 소유자 본인인지. 신탁·가압류·가처분·경매개시결정이 있으면 멈춥니다.</td></tr>
<tr><td><b>근저당 (융자)</b></td><td>등기부등본 을구</td><td>채권최고액 합계를 위 표의 "근저당 허용선"과 견줍니다. 채권최고액 ÷ 1.2 가 대략의 실제 대출입니다.</td></tr>
<tr><td><b>임대인 세금 체납</b></td><td>임대인 국세·지방세 완납증명</td><td>체납 세금은 보증금보다 먼저 가져갑니다. 등기부에 안 나옵니다.</td></tr>
<tr><td><b>보증보험</b></td><td>HUG 안심전세 앱 · 은행 창구</td><td>가입이 안 되면 그 자체가 신호입니다. 실제 심사는 공시가격 기준이라 이 표의 시세 기준보다 빡빡합니다.</td></tr>
<tr><td><b>잔금일 재확인</b></td><td>등기부등본 (잔금 직전 다시 열람)</td><td>계약 뒤 잔금 전에 근저당을 새로 잡는 사고가 있습니다. 특약에 "잔금일까지 권리변동 없음"을 넣습니다.</td></tr>
</tbody></table>

<div class="box" style="margin-top:8px"><b>이 보고서가 못 하는 것</b><ul>
<li>매물이 아니라 <b>체결된 계약</b>입니다. 지금 빈 집이 있는지는 중개사무소에 확인해야 합니다.</li>
<li>융자(근저당)·세금 체납·신탁 여부는 공개 자료에 없습니다. 매매·전세를 맞대 갭투자 흔적도 재 봤지만 동·호수가 없어 우연과 구분되지 않아(2년 4,502건 대 우연 기대 4,257건) 쓰지 않았습니다.</li>
<li>출퇴근은 소요시간이 아니라 구 단위 방향 등급입니다(마산회원 = 가까움, 마산합포 = 보통). 교방동은 마산회원구와 맞닿은 북쪽 끝이고, 진동면은 남쪽 끝이라 실제로는 멉니다.</li>
<li>대출 요건·금리는 2026-09 기준 추정입니다. 주택도시기금·은행 공고로 재확인하세요. 경매 낙찰가율 80%는 가정값입니다.</li>
<li>반려동물 허용·관리비·주차는 자료에 없습니다. 관리사무소에 확인하세요.</li>
</ul></div>
</body></html>`;
writeFileSync(SP + '/report.html', html);
console.log('ok', rows.length, top.length);
