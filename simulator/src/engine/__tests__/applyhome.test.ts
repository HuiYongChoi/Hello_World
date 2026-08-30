import { describe, expect, it } from 'vitest';
import {
  APPLYHOME,
  APPLYHOME_CAVEATS,
  NOTICES,
  competitionStats,
  districtOf,
  noticeUrl,
  notices,
  planPatch,
} from '../applyhome';
import { DISTRICTS } from '../regions';
import { emptyPlan } from '../subscription';

describe('청약홈 공고 스냅샷', () => {
  it('세 권역만 담습니다 — 전국으로 넓히지 않습니다', () => {
    const regions = new Set(NOTICES.map((n) => n.region));
    expect([...regions].sort()).toEqual(['busan', 'changwon', 'gyeonggi']);
  });

  it('주택형이 없는 공고는 없습니다 — 분양가를 모르면 쓸모가 없습니다', () => {
    for (const n of NOTICES) expect(n.models.length).toBeGreaterThan(0);
  });

  /** 분양전환 임대의 전환가를 분양가로 읽으면 안전마진이 통째로 어긋납니다. */
  it('분양주택만 담습니다 — 분양전환 임대는 뺍니다', () => {
    for (const n of NOTICES) expect(n.supplyKind).toBe('분양주택');
  });

  it('면적은 전용입니다 — 공급면적보다 작아야 합니다', () => {
    for (const n of NOTICES) {
      for (const m of n.models) {
        expect(m.areaSqm).toBeGreaterThan(0);
        // 공급면적이 0인 옛 공고가 있어 있을 때만 견줍니다.
        if (m.supplyAreaSqm > 0) expect(m.areaSqm).toBeLessThan(m.supplyAreaSqm);
      }
    }
  });

  it('분양가는 원 단위로 풀립니다 — 만원 그대로 새면 1억이 1만원이 됩니다', () => {
    const prices = NOTICES.flatMap((n) => n.models.map((m) => m.price));
    // 아무리 싼 소형이라도 5천만원은 넘고, 부산 남천 펜트하우스가 115억입니다.
    expect(Math.min(...prices)).toBeGreaterThan(50_000_000);
    expect(Math.max(...prices)).toBeLessThan(20_000_000_000);
  });

  it('모집공고일 내림차순입니다', () => {
    const dates = NOTICES.map((n) => n.noticeDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('공고 링크는 번호로 되짚습니다', () => {
    const n = NOTICES[0];
    expect(noticeUrl(n)).toContain(`houseManageNo=${n.id}`);
    expect(noticeUrl(n)).toContain(`pblancNo=${n.no}`);
  });
});

describe('시군구 붙이기', () => {
  it('정확히 같을 때만 붙입니다 — 화성시는 구를 모르면 비웁니다', () => {
    const 화성 = NOTICES.filter((n) => n.sigungu === '화성시');
    expect(화성.length).toBeGreaterThan(0);
    for (const n of 화성) expect(districtOf(n)).toBeNull();
  });

  it('시도 접두어가 붙은 라벨과도 맞습니다 — 남구 = 부산 남구', () => {
    const 남구 = NOTICES.find((n) => n.region === 'busan' && n.sigungu === '남구');
    expect(남구).toBeDefined();
    expect(districtOf(남구!)?.code).toBe('26290');
  });

  it('붙은 시군구는 실제 수집 목록에 있습니다', () => {
    const codes = new Set(DISTRICTS.map((d) => d.code));
    for (const n of NOTICES) {
      const d = districtOf(n);
      if (d) expect(codes.has(d.code)).toBe(true);
    }
  });

  it('matchedOnly 는 붙는 공고만 남깁니다', () => {
    const all = notices({ region: 'gyeonggi' });
    const matched = notices({ region: 'gyeonggi', matchedOnly: true });
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.length).toBeLessThan(all.length);
    for (const n of matched) expect(districtOf(n)).not.toBeNull();
  });
});

describe('공고 → 청약 단지 입력', () => {
  const notice = NOTICES.find((n) => n.waitMonths !== null && districtOf(n))!;

  it('분양가·전용면적·지역을 채웁니다', () => {
    const patch = planPatch(notice, notice.models[0]);
    expect(patch.price).toBe(notice.models[0].price);
    expect(patch.areaSqm).toBe(notice.models[0].areaSqm);
    expect(patch.region).toBe(notice.region);
    expect(patch.sigungu).toBe(districtOf(notice)!.label);
  });

  it('입주까지 남은 기간은 계약일 → 입주예정월입니다', () => {
    const patch = planPatch(notice, notice.models[0]);
    expect(patch.waitYears).toBeCloseTo(notice.waitMonths! / 12, 1);
  });

  /**
   * 중도금 조건과 전매제한은 API 에 없습니다. 불러오기가 이 값들을 건드리면
   * 공고문을 보고 넣은 손입력이 조용히 지워집니다.
   */
  it('납입 구조와 전매제한은 건드리지 않습니다', () => {
    const patch = planPatch(notice, notice.models[0]);
    for (const key of [
      'downPaymentRatio',
      'interimRatio',
      'interimLoanRate',
      'interimDeferred',
      'resaleBanMonths',
      'mortgageRate',
      'mortgageLtv',
    ] as const) {
      expect(patch).not.toHaveProperty(key);
    }
  });

  it('빈 단지에 얹으면 온전한 입력이 됩니다', () => {
    const plan = { ...emptyPlan('t'), ...planPatch(notice, notice.models[0]) };
    expect(plan.price).toBeGreaterThan(0);
    expect(plan.areaSqm).toBeGreaterThan(0);
    expect(plan.downPaymentRatio).toBeGreaterThan(0);
  });
});

describe('1순위 경쟁률', () => {
  it('접수건수 ÷ 공급세대입니다', () => {
    for (const n of NOTICES) {
      for (const m of n.models) {
        if (m.rank1Supply === 0) expect(m.rank1Rate).toBeNull();
        else expect(m.rank1Rate).toBeCloseTo(m.rank1Req / m.rank1Supply, 10);
      }
    }
  });

  it('권역별 분포가 나옵니다', () => {
    for (const region of ['changwon', 'busan', 'gyeonggi'] as const) {
      const s = competitionStats(region)!;
      expect(s).not.toBeNull();
      expect(s.p25).toBeLessThanOrEqual(s.median);
      expect(s.median).toBeLessThanOrEqual(s.p75);
      expect(s.underShare).toBeGreaterThanOrEqual(0);
      expect(s.underShare).toBeLessThanOrEqual(1);
    }
  });

  it('미달 비율은 경쟁률 1 미만의 몫입니다', () => {
    const rates = notices({ region: 'busan' })
      .flatMap((n) => n.models.map((m) => m.rank1Rate))
      .filter((r): r is number => r !== null);
    const under = rates.filter((r) => r < 1).length / rates.length;
    expect(competitionStats('busan')!.underShare).toBeCloseTo(under, 10);
  });

  it('표본이 없는 조건이면 null 입니다', () => {
    expect(competitionStats('changwon', { since: '2099-01-01' })).toBeNull();
  });
});

describe('한계 표기', () => {
  it('무엇을 못 하는지가 붙어 있습니다', () => {
    expect(APPLYHOME_CAVEATS.length).toBeGreaterThanOrEqual(4);
    expect(APPLYHOME_CAVEATS.join(' ')).toContain('전매제한');
  });

  it('출처와 기준일이 있습니다', () => {
    expect(APPLYHOME.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(APPLYHOME.source.name).toContain('청약홈');
    expect(APPLYHOME.stats.notices).toBe(NOTICES.length);
  });
});
