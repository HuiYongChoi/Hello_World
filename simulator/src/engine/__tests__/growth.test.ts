import { describe, expect, it } from 'vitest';
import { MIN_LINKED_PAIRS, growthSuggestion, regionGrowthDistribution, regionGrowthIndex } from '../growth';
import { MARKET } from '../market';
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
});
