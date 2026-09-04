import { describe, expect, it } from 'vitest';
import { NOTICES } from '../applyhome';
import { RATING_CAVEATS, rateOffering, type RatingTerms } from '../rating';
import { RULES } from '../rules';

const terms: RatingTerms = {
  downPaymentRatio: RULES.subscription.downPaymentRatio,
  interimRatio: RULES.subscription.interimRatio,
  interimLoanRate: RULES.subscription.interimLoanRate,
  interimDeferred: true,
  resaleBanMonths: RULES.subscription.defaultResaleBanMonths,
  mortgageRate: 0.045,
  mortgageLtv: 0.8,
};

const changwon = NOTICES.find((n) => n.region === 'changwon' && n.waitMonths !== null)!;
const rate = (over: Partial<RatingTerms> = {}, cash = 200000000) =>
  rateOffering({
    notice: changwon,
    model: changwon.models[0],
    terms: { ...terms, ...over },
    availableCash: cash,
    termYears: 30,
  });

describe('공고 별점', () => {
  it('네 축을 냅니다 — 순서가 곧 읽는 순서입니다', () => {
    expect(rate().axes.map((a) => a.id)).toEqual(['price', 'competition', 'cash', 'lockup']);
  });

  /**
   * 이 저장소의 설계 원칙입니다. 합계를 내보내면 화면이 그걸 쓰게 되고,
   * 싸지만 붙기 어려운 공고와 비싸지만 붙기 쉬운 공고가 같은 점수가 됩니다.
   */
  it('합산 점수를 아예 내보내지 않습니다', () => {
    const r = rate() as unknown as Record<string, unknown>;
    expect(r.total).toBeUndefined();
    expect(r.score).toBeUndefined();
    expect(r.average).toBeUndefined();
  });

  it('별은 0~5 이거나 잴 수 없으면 null 입니다', () => {
    for (const n of NOTICES.slice(0, 40)) {
      for (const a of rateOffering({
        notice: n,
        model: n.models[0],
        terms,
        availableCash: 200000000,
        termYears: 30,
      }).axes) {
        if (a.stars === null) continue;
        expect(Number.isInteger(a.stars)).toBe(true);
        expect(a.stars).toBeGreaterThanOrEqual(1);
        expect(a.stars).toBeLessThanOrEqual(5);
      }
    }
  });

  it('축마다 사유와 한계가 붙습니다 — 별 개수만 남기면 판정이 됩니다', () => {
    for (const a of rate().axes) {
      expect(a.headline.length).toBeGreaterThan(0);
      expect(a.reasons.length).toBeGreaterThan(0);
      expect(a.caveat.length).toBeGreaterThan(0);
      expect(a.question.length).toBeGreaterThan(0);
    }
  });

  /**
   * 별 세 개를 보면 "기준이 뭔데" 가 바로 따라옵니다. 기준을 안 적으면 별점은
   * 분위기가 되고, 분위기는 검증할 수 없습니다.
   */
  it('축마다 별 5~1 구간표가 붙고 지금 값이 든 칸이 표시됩니다', () => {
    for (const a of rate().axes) {
      expect(a.bands.map((b) => b.stars)).toEqual([5, 4, 3, 2, 1]);
      for (const b of a.bands) expect(b.range.length).toBeGreaterThan(0);
      const current = a.bands.filter((b) => b.current);
      // 별을 못 매기는 축은 표시할 칸도 없습니다.
      expect(current.length).toBe(a.stars === null ? 0 : 1);
      if (a.stars !== null) expect(current[0].stars).toBe(a.stars);
    }
  });

  it('묶이는 기간 구간표는 개월로 적습니다 — 백분위로 적으면 자기 값을 못 놓습니다', () => {
    const lockup = rate().axes.find((a) => a.id === 'lockup')!;
    for (const b of lockup.bands) expect(b.range).toContain('개월');
  });

  it('당첨 가능성 구간표는 실제 경쟁률로 적습니다', () => {
    const comp = rate().axes.find((a) => a.id === 'competition')!;
    expect(comp.bands[0].range).toContain('미달');
    expect(comp.bands.slice(1).some((b) => b.range.includes(': 1'))).toBe(true);
  });

  it('축마다 계산식과 대입값이 붙습니다', () => {
    for (const a of rate().axes) {
      expect(a.formula.expression.length).toBeGreaterThan(5);
      expect(a.formula.steps.length).toBeGreaterThan(0);
    }
    const lockup = rate().axes.find((a) => a.id === 'lockup')!;
    expect(lockup.formula.expression).toContain('전매제한');
    expect(lockup.formula.steps.join(' ')).toContain('별');
  });

  /** 네 기준이 무엇인지 이름이 나와야 "네 기준" 이 말이 됩니다. */
  it('분양가 계산식이 네 기준을 하나씩 풉니다', () => {
    const price = rate().axes.find((a) => a.id === 'price')!;
    const text = price.formula.steps.join(' ');
    for (const name of ['주변 실거래', '신축 하한', '입주 시점 예상가', '주변 분양권']) {
      expect(text).toContain(name);
    }
  });

  /** 라벨과 문장이 붙어 "분양가가 기준가의 2.8배" 처럼 주어가 있어야 읽힙니다. */
  it('분양가 문장에 주어가 있습니다', () => {
    const price = rate().axes.find((a) => a.id === 'price')!;
    expect(price.headline).toMatch(/분양가가/);
    expect(price.headline).toMatch(/쌉니다|비쌉니다|배입니다|표본/);
  });

  /** 경쟁률이 없는 주택형에 별 3개를 주면 그것도 판정으로 읽힙니다. */
  it('경쟁률이 없으면 별을 주지 않습니다', () => {
    const noRate = NOTICES.flatMap((n) => n.models.map((m) => ({ n, m }))).find(
      (x) => x.m.rank1Rate === null
    );
    if (!noRate) return;
    const axis = rateOffering({
      notice: noRate.n,
      model: noRate.m,
      terms,
      availableCash: 200000000,
      termYears: 30,
    }).axes.find((a) => a.id === 'competition')!;
    expect(axis.stars).toBeNull();
    expect(axis.headline).toContain('경쟁률이 없습니다');
  });

  /**
   * ★5 는 미달이 통째로 차지합니다. 표에 "★5 = 미달" 이라 적어 놓고 미달이
   * 아닌 공고에 ★5 를 주면 표와 별이 어긋납니다.
   */
  it('미달이 아니면 당첨 가능성은 ★4 가 상한입니다', () => {
    for (const n of NOTICES.slice(0, 60)) {
      for (const m of n.models) {
        if (m.rank1Rate === null || m.rank1Rate < 1) continue;
        const axis = rateOffering({
          notice: n,
          model: m,
          terms,
          availableCash: 200000000,
          termYears: 30,
        }).axes.find((a) => a.id === 'competition')!;
        expect(axis.stars).toBeLessThanOrEqual(4);
      }
    }
  });

  it('별과 구간표가 어긋나지 않습니다 — 표시된 칸이 곧 그 별입니다', () => {
    for (const n of NOTICES.slice(0, 40)) {
      for (const a of rateOffering({
        notice: n,
        model: n.models[0],
        terms,
        availableCash: 200000000,
        termYears: 30,
      }).axes) {
        if (a.stars === null) continue;
        const marked = a.bands.filter((b) => b.current);
        expect(marked).toHaveLength(1);
        expect(marked[0].stars).toBe(a.stars);
      }
    }
  });

  it('1순위 미달이면 당첨 가능성이 만점입니다', () => {
    const under = NOTICES.flatMap((n) => n.models.map((m) => ({ n, m }))).find(
      (x) => x.m.rank1Rate !== null && x.m.rank1Rate < 1
    )!;
    const axis = rateOffering({
      notice: under.n,
      model: under.m,
      terms,
      availableCash: 200000000,
      termYears: 30,
    }).axes.find((a) => a.id === 'competition')!;
    expect(axis.stars).toBe(5);
    expect(axis.headline).toContain('미달');
  });

  /* ── 손입력이 별점을 움직입니다 ─────────────────────────────────── */

  it('전매제한을 늘리면 묶이는 기간 별이 줄어듭니다', () => {
    const short = rate({ resaleBanMonths: 0 }).axes.find((a) => a.id === 'lockup')!;
    const long = rate({ resaleBanMonths: 36 }).axes.find((a) => a.id === 'lockup')!;
    expect(long.stars!).toBeLessThanOrEqual(short.stars!);
    expect(long.headline).toContain('36개월');
  });

  it('계약금 비율을 올리면 자금 부담 별이 줄어듭니다', () => {
    const light = rate({ downPaymentRatio: 0.1 }).axes.find((a) => a.id === 'cash')!;
    const heavy = rate({ downPaymentRatio: 0.3 }).axes.find((a) => a.id === 'cash')!;
    expect(heavy.stars!).toBeLessThanOrEqual(light.stars!);
  });

  it('이자후불 여부가 사유 문장에 그대로 드러납니다', () => {
    expect(rate({ interimDeferred: true }).axes.find((a) => a.id === 'cash')!.reasons.join(' ')).toContain(
      '이자후불'
    );
    expect(
      rate({ interimDeferred: false }).axes.find((a) => a.id === 'cash')!.reasons.join(' ')
    ).toContain('매달');
  });

  it('현금이 모자라면 자금 부담이 최하이고 부족액을 적습니다', () => {
    const axis = rate({}, 10000000).axes.find((a) => a.id === 'cash')!;
    expect(axis.stars).toBe(1);
    expect(axis.headline).toContain('모자랍니다');
  });

  it('한계가 붙어 있습니다', () => {
    expect(RATING_CAVEATS.length).toBeGreaterThanOrEqual(4);
    expect(rate().caveats).toEqual(RATING_CAVEATS);
    expect(RATING_CAVEATS.join(' ')).toContain('합치지 않습니다');
  });
});
