import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLES,
  rollingBacktest,
  splitValidate,
  type BenchmarkMode,
} from '../backtest';
import { collectedDistricts } from '../regions';

const HOLD = 5;
const bt = (benchmark: BenchmarkMode) => rollingBacktest({ holdYears: HOLD, benchmark })!;

describe('롤링 백테스트 — 표본 만들기', () => {
  it('진입시점 축이 섭니다 — 표본이 칸 수보다 훨씬 많습니다', () => {
    const r = bt('cohort');
    expect(r.samples.length).toBeGreaterThan(r.cells);
    expect(r.entryQuarters.length).toBeGreaterThan(8);
  });

  it('보유기간은 실제 간격으로 환산합니다 — 종료 분기가 ±1 밀릴 수 있습니다', () => {
    for (const s of bt('none').samples) {
      expect(s.exitQ).toBeGreaterThan(s.entryQ);
      expect(s.years).toBeGreaterThanOrEqual(1);
      // ±1분기 허용이므로 명목 5년에서 한 분기 이상 벗어나지 않습니다.
      expect(Math.abs(s.years - HOLD)).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });

  it('CAGR 은 시작가 → 종료가의 복리 연환산입니다', () => {
    for (const s of bt('none').samples.slice(0, 200)) {
      expect(s.cagr).toBeCloseTo(Math.pow(s.endPrice / s.startPrice, 1 / s.years) - 1, 10);
    }
  });

  it('초과수익은 언제나 CAGR − 기준선입니다', () => {
    for (const mode of ['none', 'cohort', 'district', 'market'] as const) {
      for (const s of bt(mode).samples.slice(0, 200)) {
        expect(s.excess).toBeCloseTo(s.cagr - s.benchmarkCagr, 12);
      }
    }
  });

  it('보유기간이 1년 미만이면 아예 내지 않습니다 — 연환산이 폭주합니다', () => {
    expect(rollingBacktest({ holdYears: 0.5, benchmark: 'cohort' })).toBeNull();
  });

  it('시군구를 좁히면 그 시군구 표본만 남습니다', () => {
    const code = collectedDistricts()[0].code;
    const r = rollingBacktest({ holdYears: HOLD, benchmark: 'cohort', districtCodes: [code] })!;
    for (const s of r.samples) expect(s.districtCode).toBe(code);
    expect(r.samples.length).toBeLessThan(bt('cohort').samples.length);
  });
});

describe('기준선 — 무엇에 견주나', () => {
  it('변환을 끄면 초과수익이 곧 수익률입니다', () => {
    for (const s of bt('none').samples) {
      expect(s.benchmarkCagr).toBe(0);
      expect(s.excess).toBe(s.cagr);
    }
  });

  /**
   * 코호트 기준선의 핵심 성질입니다. 표본 자신의 중위를 빼므로 각 진입분기의
   * 중위 초과수익이 **정확히 0** 이고, 그래서 부호를 그대로 읽을 수 있습니다.
   */
  it('같은 진입분기 중위를 빼면 그 분기의 중위 초과수익이 0입니다', () => {
    const r = bt('cohort');
    for (const e of r.entryQuarters) expect(e.medianExcess).toBeCloseTo(0, 12);
    expect(r.medianExcess).toBeCloseTo(0, 12);
  });

  it('시군구 코호트는 같은 분기·같은 시군구끼리 뺍니다', () => {
    const r = bt('district');
    const groups = new Map<string, number[]>();
    for (const s of r.samples) {
      const k = `${s.entryQ}|${s.districtCode}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s.excess);
    }
    for (const xs of groups.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      const i = Math.floor(sorted.length / 2);
      const med = sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
      expect(med).toBeCloseTo(0, 12);
    }
  });

  it('지수 기준선은 진입·종료 분기가 같으면 같은 값입니다', () => {
    const byWindow = new Map<string, number>();
    for (const s of bt('market').samples) {
      const k = `${s.entryQ}|${s.exitQ}`;
      const seen = byWindow.get(k);
      if (seen === undefined) byWindow.set(k, s.benchmarkCagr);
      else expect(s.benchmarkCagr).toBeCloseTo(seen, 12);
    }
  });

  /**
   * 연쇄 지수는 분기 중위 변화율을 계속 곱해 이어 붙이면서 위로 치우칩니다.
   * 그래서 지수 기준 중위 초과수익이 음수인데, 이건 물건의 성적이 아니라
   * 지수의 성질입니다. **이 부호가 뒤집히면 문서의 설명을 다시 재야 합니다.**
   */
  it('지수 기준선은 표본 중위보다 높습니다 — 연쇄 드리프트', () => {
    expect(bt('market').medianExcess).toBeLessThan(0);
    expect(bt('market').beatShare).toBeLessThan(0.5);
    // 코호트 기준선에는 그 치우침이 없습니다.
    expect(bt('cohort').beatShare).toBeGreaterThan(0.4);
    expect(bt('cohort').beatShare).toBeLessThan(0.6);
  });
});

describe('시점 분할 검증', () => {
  const r = bt('cohort');
  const sv = splitValidate(r)!;

  it('진입시점으로만 가릅니다 — 학습이 앞, 검증이 뒤입니다', () => {
    expect(sv).not.toBeNull();
    expect(sv.trainRange[1]).toBeLessThan(sv.splitQ);
    expect(sv.testRange[0]).toBeGreaterThanOrEqual(sv.splitQ);
    expect(sv.trainCount + sv.testCount).toBe(r.samples.length);
    expect(sv.trainCount).toBeGreaterThanOrEqual(MIN_SAMPLES);
    expect(sv.testCount).toBeGreaterThanOrEqual(MIN_SAMPLES);
  });

  /**
   * 상위권을 전체에서 한 번에 뽑으면, 상승장이던 학습 구간이 상위를 독식해
   * 검증이 "시기 맞히기" 가 됩니다. 구간 안에서 따로 뽑아야 "같은 시기에
   * 들어간 것들 중 나았나" 를 묻는 것이 됩니다.
   */
  it('상위권은 각 구간 안에서 따로 뽑습니다', () => {
    for (const g of sv.groups) {
      const trainTop = g.buckets.reduce((s, b) => s + b.trainTop, 0);
      const testTop = g.buckets.reduce((s, b) => s + b.testTop, 0);
      expect(trainTop).toBe(Math.round((sv.trainCount * sv.topPercent) / 100));
      // 검증 상위권은 학습에 없던 구간에도 흩어지므로 그 이하입니다.
      expect(testTop).toBeLessThanOrEqual(Math.round((sv.testCount * sv.topPercent) / 100));
    }
  });

  it('재현 판정은 학습에서 강했던 구간만 셉니다', () => {
    let strong = 0;
    let held = 0;
    for (const g of sv.groups) {
      for (const b of g.buckets) {
        if (b.unmeasurable) {
          // 검증 표본이 없으면 깨진 것이 아니라 잴 수 없는 것입니다.
          expect(b.holds).toBe(false);
          continue;
        }
        if (!b.strongInTrain) continue;
        strong++;
        if (b.holds) {
          held++;
          expect(b.testLift).toBeGreaterThanOrEqual(1);
        }
      }
    }
    expect(sv.strongCount).toBe(strong);
    expect(sv.heldCount).toBe(held);
    expect(sv.reproducedShare).toBeCloseTo(held / Math.max(1, strong), 12);
  });

  it('판정 문구는 재현율에서 옵니다', () => {
    const s = sv.reproducedShare;
    const expected =
      sv.strongCount < 3 ? 'thin' : s >= 0.7 ? 'holds' : s >= 0.4 ? 'mixed' : 'fails';
    expect(sv.verdict).toBe(expected);
  });

  /**
   * 절반쯤만 남는 것이 지금의 실측 결과입니다. 이 화면의 결론은 "공통점을
   * 찾았다" 가 아니라 **"찾은 공통점의 절반은 그 시기의 성질이었다"** 입니다.
   */
  it('지금 표본에서는 절반쯤만 재현됩니다 — 결론을 세게 쓰면 안 됩니다', () => {
    expect(sv.verdict).not.toBe('thin');
    expect(sv.reproducedShare).toBeGreaterThan(0.2);
    expect(sv.reproducedShare).toBeLessThan(0.9);
  });

  it('표본이 모자라면 분할하지 않습니다', () => {
    const tiny = rollingBacktest({
      holdYears: HOLD,
      benchmark: 'cohort',
      districtCodes: ['00000'],
    });
    expect(tiny).toBeNull();
  });

  it('한계가 붙어 있습니다', () => {
    expect(r.caveats.length).toBeGreaterThanOrEqual(4);
    expect(sv.caveats.join(' ')).toContain('시기 맞히기');
    expect(r.caveats.join(' ')).toContain('독립');
  });
});
