/**
 * 전세 후보 원자료 내보내기 — 1단계.
 *
 * 엔진(TS)을 그대로 써야 해서 vitest 로 돌립니다:
 *   cd simulator && BOARD_WORK=../scripts/board/work npx vitest run ../scripts/board/export-jeonse.board.ts --dir ..
 * 결과: $BOARD_WORK/rows.json  (단지·평형별 전세 이력·매매 이력·전세가율·대출)
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { COMPLEXES, regionOf, COMMUTE_LABEL } from '../../simulator/src/rentfinder/data';
import { jeonseSafety } from '../../simulator/src/rentfinder/safety';
import { jeonseLoanFit } from '../../simulator/src/rentfinder/loans';
import { quarterLabel } from '../../simulator/src/engine/market';

const OUT = process.env.BOARD_WORK ?? 'work';
const b = { age: 32, militaryServed: true, married: false, marriedYears: 0, newbornWithin2y: false, smeEmployed: false, income: 40000000, spouseIncome: 35000000, netWorth: 80000000, householder: true, noHouse: true };
/** 사용자가 이름을 짚은 단지·평형 — 이 목록이 전세 후보판의 행입니다. */
const WANT: [string, number, string][] = [
  ['창원메트로시티석전', 52, '1차 추천'], ['월영동SK오션뷰', 74, '1차 추천'], ["송촌e'누리채아파트", 53, '1차 추천'], ['해오름', 111, '1차 추천'], ['혜성미', 70, '1차 추천'], ['한일유앤아이', 124, '1차 추천'], ['경동메르빌', 85, '1차 추천'], ['중흥S클래스프라디움3차', 108, '1차 추천'], ['창원가포안단테', 60, '1차 추천'], ['마산신화하니엘더마린', 85, '1차 추천'],
  ['창원푸르지오더플래티넘1단지', 84, '교방동'], ['창원푸르지오더플래티넘1단지', 85, '교방동'], ['창원푸르지오더플래티넘2단지', 84, '교방동'], ['창원푸르지오더플래티넘2단지', 85, '교방동'], ['창원푸르지오더플래티넘3단지', 84, '교방동'], ['창원푸르지오더플래티넘3단지', 60, '교방동'], ['창원푸르지오더플래티넘3단지', 74, '교방동'],
  ['창원롯데캐슬프리미어', 85, '롯데캐슬'], ['창원롯데캐슬프리미어', 60, '롯데캐슬'], ['무학산벽산블루밍1단지', 85, '교방동'], ['무학산벽산블루밍2단지', 85, '교방동'], ['상록', 60, '교방동'],
  ['양덕코오롱하늘채', 85, '양덕 하늘채'], ['마산양덕4차한일타운', 84, '한일 4차'], ['한일3', 85, '한일 3차'], ['한일3', 60, '한일 3차'], ['한일타운2', 85, '한일 2차'], ['한일타운2', 60, '한일 2차'], ['한일타운', 85, '한일 1차'], ['한일타운', 60, '한일 1차'],
  ['중앙마린파이브아파트', 85, '오동동'], ['중앙마린파이브아파트', 70, '오동동'], ['서광아침의빛', 85, '오동동'], ['오동동다:숲', 45, '오동동'],
];
it('export jeonse rows', () => {
  const LATEST = Math.max(...COMPLEXES.flatMap((c) => c.sizes.flatMap((s) => s.trend.map((t) => t.q))));
  const rows: unknown[] = [];
  for (const [name, area, group] of WANT) {
    const c = COMPLEXES.find((x) => x.name === name && x.regionCode.startsWith('481') && x.sizes.some((s) => s.area === area));
    if (!c) continue;
    const s = c.sizes.find((x) => x.area === area)!;
    const saf = s.jeonse ? jeonseSafety(c.id, s.area, s.jeonse.deposit) : null;
    const fit = s.jeonse ? jeonseLoanFit(b, s.jeonse.deposit, s.area) : null;
    const reg = regionOf(c.regionCode)!;
    rows.push({ id: c.id, name, group, area, buildYear: c.buildYear, umd: c.umd, road: c.road, region: reg.short, commute: COMMUTE_LABEL[reg.commute],
      n: s.n, lastYm: s.lastYm, renewal: s.renewalShare, j2y: s.jeonse, wolse: s.wolse, latest: quarterLabel(LATEST),
      sale: saf?.salePrice ?? null, saleDeals: saf?.saleDeals ?? 0, trend: saf?.priceTrend?.change ?? null,
      jHist: s.trend.slice(-6).map((t) => [quarterLabel(t.q), t.n, t.deposit]), loans2y: fit?.eligible.map((r) => r.product.shortName) ?? [] });
  }
  writeFileSync(`${OUT}/rows.json`, JSON.stringify(rows, null, 1));
});
