import { describe, expect, it } from 'vitest';
import { SUPPLY_CAVEATS, supplyFeedback, supplyOutlookFor, supplyOutlooks } from '../supply';

describe('향후 입주 물량 대리지표', () => {
  const all = supplyOutlooks();

  it('시군구별로 나옵니다', () => {
    expect(all.length).toBeGreaterThan(3);
    console.log(
      all
        .map(
          (o) =>
            `${o.districtLabel} 미준공 ${o.pending}/${o.presaleComplexes} · 재고 ${o.marketComplexes} · 비율 ${(o.pendingRatio * 100).toFixed(1)}%`
        )
        .join('\n')
    );
  });

  it('미준공 단지는 분양권 단지를 넘을 수 없습니다', () => {
    for (const o of all) expect(o.pending).toBeLessThanOrEqual(o.presaleComplexes);
  });

  it('두 번 불러도 같은 객체입니다', () => {
    expect(supplyOutlooks()).toBe(supplyOutlooks());
  });

  it('시군구명으로 찾을 수 있고, 없는 이름은 null 입니다', () => {
    expect(supplyOutlookFor(all[0].districtLabel)).not.toBeNull();
    expect(supplyOutlookFor('없는구')).toBeNull();
    expect(supplyOutlookFor('')).toBeNull();
  });

  it('제안 점수는 0~100 이고 공급이 많을수록 낮습니다', () => {
    const fbs = all.map((o) => supplyFeedback(o.districtLabel)).filter(Boolean);
    expect(fbs.length).toBeGreaterThan(0);
    for (const f of fbs) {
      expect(f!.suggestedScore).toBeGreaterThanOrEqual(0);
      expect(f!.suggestedScore).toBeLessThanOrEqual(100);
    }
    const sorted = [...fbs].sort((a, b) => a!.percentile - b!.percentile);
    expect(sorted[0]!.suggestedScore).toBeGreaterThanOrEqual(
      sorted[sorted.length - 1]!.suggestedScore
    );
  });

  it('입력 단위가 세대라 순위를 세대로 되돌리지 않습니다 — 점수로만 비교합니다', () => {
    const f = supplyFeedback(all[0].districtLabel)!;
    // 세대 수를 지어내는 필드가 없어야 합니다.
    expect(Object.keys(f)).not.toContain('suggestedHouseholds');
    expect(f.rankBySupply).toBeGreaterThanOrEqual(1);
    expect(f.rankBySupply).toBeLessThanOrEqual(f.peers);
  });

  it('같은 지역군 안에서만 비교합니다 — 시군구 크기 차이가 섞이면 안 됩니다', () => {
    const f = supplyFeedback(all[0].districtLabel)!;
    const peers = supplyOutlooks().filter((o) => o.region === f.outlook.region);
    expect(f.peers).toBe(peers.length);
  });

  it('한계를 문장으로 들고 다닙니다 — 대리지표를 실측처럼 쓰면 안 됩니다', () => {
    expect(SUPPLY_CAVEATS.some((c) => c.includes('전매제한'))).toBe(true);
    expect(SUPPLY_CAVEATS.some((c) => c.includes('세대수'))).toBe(true);
  });
});
