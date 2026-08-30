import { describe, expect, it } from 'vitest';
import { MIN_LINKED_PAIRS, growthSuggestion, regionGrowthDistribution, regionGrowthIndex } from '../growth';
import { MARKET, holdingSamples } from '../market';
import type { RegionId } from '../types';

const REGIONS: RegionId[] = ['changwon', 'busan', 'gyeonggi'];

describe('지역 연쇄 가격지수', () => {
  it('세 지역 모두 지수가 나옵니다', () => {
    for (const r of REGIONS) expect(regionGrowthIndex(r)).not.toBeNull();
  });

  it('시작값은 1이고 분기가 오름차순입니다', () => {
    for (const r of REGIONS) {
      const g = regionGrowthIndex(r)!;
      expect(g.points[0].price).toBe(1);
      const qs = g.points.map((p) => p.q);
      expect(qs).toEqual([...qs].sort((a, b) => a - b));
    }
  });

  it('CAGR 은 시작·끝 지수와 구간 길이에서 정확히 나옵니다', () => {
    for (const r of REGIONS) {
      const g = regionGrowthIndex(r)!;
      const last = g.points[g.points.length - 1].price;
      expect(g.cagr).toBeCloseTo(Math.pow(last / 1, 1 / g.years) - 1, 10);
    }
  });

  it('연결 표본이 두껍습니다 — 한두 채가 분기 전체를 흔들면 안 됩니다', () => {
    for (const r of REGIONS) {
      const g = regionGrowthIndex(r)!;
      const links = g.linkCounts.slice(1).sort((a, b) => a - b);
      const med = links[Math.floor(links.length / 2)];
      expect(med).toBeGreaterThanOrEqual(MIN_LINKED_PAIRS * 4);
    }
  });

  it('두 번 불러도 같은 객체입니다 — 40만 건을 매 렌더마다 접으면 안 됩니다', () => {
    expect(regionGrowthIndex('busan')).toBe(regionGrowthIndex('busan'));
  });

  it('지역마다 다른 값이 나옵니다 — 전국 하나로 뭉개면 지역 축이 무의미해집니다', () => {
    const values = REGIONS.map((r) => regionGrowthIndex(r)!.cagr);
    expect(new Set(values.map((v) => v.toFixed(4))).size).toBe(REGIONS.length);
  });

  it('스냅샷 구간을 넘지 않습니다', () => {
    for (const r of REGIONS) {
      const g = regionGrowthIndex(r)!;
      const span = (Number(MARKET.range.to.slice(0, 4)) - Number(MARKET.range.from.slice(0, 4))) + 1;
      expect(g.years).toBeLessThanOrEqual(span);
      expect(g.years).toBeGreaterThan(1);
    }
  });
});

describe('진입시점 분포', () => {
  it('보유기간이 길수록 표본이 줄어듭니다 — 10년은 스냅샷에서 몇 개 안 나옵니다', () => {
    const short = regionGrowthDistribution('busan', 3)!;
    const long = regionGrowthDistribution('busan', 10)!;
    expect(short.count).toBeGreaterThan(long.count);
  });

  it('표본이 얇으면 얇다고 표시합니다 — 분위수가 뭉개진 걸 숨기면 안 됩니다', () => {
    const long = regionGrowthDistribution('busan', 10)!;
    expect(long.thin).toBe(true);
  });

  it('분위수 순서가 맞습니다', () => {
    const d = regionGrowthDistribution('gyeonggi', 3)!;
    expect(d.worst).toBeLessThanOrEqual(d.p25);
    expect(d.p25).toBeLessThanOrEqual(d.median);
    expect(d.median).toBeLessThanOrEqual(d.p75);
    expect(d.p75).toBeLessThanOrEqual(d.best);
  });
});

describe('제안값', () => {
  it('단일 CAGR 과 분포를 같이 냅니다 — 하나만 내면 진입시점이 감춰집니다', () => {
    const s = growthSuggestion('changwon', 10)!;
    expect(s.cagr).toBeTypeOf('number');
    expect(s.distribution).not.toBeNull();
    expect(s.cells).toBeGreaterThan(100);
  });

  it('실측 창원은 기본 가정 3% 보다 낮습니다 — 가정이 결론을 만들고 있었습니다', () => {
    expect(growthSuggestion('changwon', 10)!.cagr).toBeLessThan(0.03);
  });

  /**
   * 제안값은 **지수가 아니라 표본**에서 옵니다. 지수는 분기 중위 변화율을 곱해
   * 이어 붙이면서 위로 치우치므로(연쇄 드리프트), 그 값을 가져다 쓰면 전형적인
   * 한 칸이 겪은 것보다 높은 상승률로 3-way 를 돌리게 됩니다.
   */
  it('제안값은 같은 보유기간 표본의 중위입니다', () => {
    for (const r of REGIONS) {
      const s = growthSuggestion(r, 10)!;
      const rows = holdingSamples(s.holdYears, { regions: [r] });
      const sorted = rows.map((x) => x.cagr).sort((a, b) => a - b);
      const i = (sorted.length - 1) / 2;
      const med =
        Number.isInteger(i)
          ? sorted[i]
          : (sorted[Math.floor(i)] + sorted[Math.ceil(i)]) / 2;
      expect(s.samples).toBe(rows.length);
      expect(s.cagr).toBeCloseTo(med, 10);
      expect(s.distribution!.median).toBeCloseTo(s.cagr, 12);
    }
  });

  /**
   * 드리프트는 **같은 보유기간끼리** 재야 합니다. 10.5년 지수 CAGR 과 5년 표본
   * 중위를 견주면 드리프트가 아니라 기간 차이를 재게 됩니다 — 실제로 그렇게
   * 재면 창원은 부호까지 뒤집힙니다.
   */
  it('연쇄 지수는 참고로만 남고, 같은 기간으로 견줍니다', () => {
    for (const r of REGIONS) {
      for (const y of [5, 10]) {
        const s = growthSuggestion(r, y)!;
        expect(s.indexCagr).toBeCloseTo(regionGrowthIndex(r)!.cagr, 12);
        expect(s.indexMedian).toBeCloseTo(regionGrowthDistribution(r, s.holdYears)!.median, 12);
        expect(s.indexGap).toBeCloseTo(s.indexMedian! - s.cagr, 12);
        // 세 권역 · 두 기간 모두 지수가 표본 중위보다 높습니다. 이 부호가
        // 뒤집히면 드리프트 설명을 다시 재야 합니다.
        expect(s.indexGap).toBeGreaterThan(0);
      }
    }
  });

  /**
   * 스냅샷이 2016년부터라 30년 보유 표본은 없습니다. 그때 지수 CAGR 로
   * 바꿔치기하면 화면에는 30년처럼 보이는 다른 숫자가 뜹니다.
   */
  it('표본이 없는 기간은 물러서고 그 사실을 냅니다', () => {
    const s = growthSuggestion('busan', 30)!;
    expect(s.fellBack).toBe(true);
    expect(s.holdYears).toBeLessThan(30);
    expect(s.holdYears).toBeGreaterThanOrEqual(1);
    expect(s.samples).toBeGreaterThan(0);

    const exact = growthSuggestion('busan', 5)!;
    expect(exact.fellBack).toBe(false);
    expect(exact.holdYears).toBe(5);
  });

  it('진입분기가 얇으면 얇다고 표시합니다', () => {
    // 10년 보유는 2016년 진입 네 분기밖에 안 남습니다.
    expect(growthSuggestion('busan', 10)!.thin).toBe(true);
    expect(growthSuggestion('busan', 10)!.entryQuarters).toBeLessThan(8);
    expect(growthSuggestion('busan', 5)!.thin).toBe(false);
  });

  it('분위수 순서가 맞습니다', () => {
    const d = growthSuggestion('gyeonggi', 5)!.distribution!;
    expect(d.worst).toBeLessThanOrEqual(d.p25);
    expect(d.p25).toBeLessThanOrEqual(d.median);
    expect(d.median).toBeLessThanOrEqual(d.p75);
    expect(d.p75).toBeLessThanOrEqual(d.best);
  });
});
