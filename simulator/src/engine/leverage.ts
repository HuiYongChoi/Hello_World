import type { LoanResult, Property } from './types';

/**
 * 레버리지 방향 분석.
 *
 *   r_equity ≈ r_asset + (L/E) × (r_asset − i)
 *                         ↑배율      ↑스프레드
 *
 * 배율은 곱셈으로 들어가고 금리는 스프레드 안의 한 항일 뿐입니다.
 * 따라서 스프레드의 **부호**가 1차 관문입니다 — 음수면 레버리지가 클수록
 * 손실이 커지므로, LTV 80%가 70%보다 항상 유리하다는 통념이 뒤집힙니다.
 *
 * 주의: 이것은 방향을 보기 위한 1차 근사입니다. 원금상환, 보유세, 거래비용,
 * 양도세를 제외했으므로 수익률 예측치로 읽으면 안 됩니다. 실제 수익률은
 * 부대비용만큼 더 낮고, 보유기간이 짧을수록 격차가 벌어집니다.
 */
export interface LeverageView {
  /** 부채비율 L/E — 자기자본 1원당 빌린 금액 */
  debtToEquity: number;
  /** 자산에 투입된 자기자본 (부대비용 제외, 매매가 − 대출액) */
  equity: number;
  /** 가격상승률 − 적용금리. 부호가 레버리지의 방향을 결정합니다. */
  spread: number;
  /** 스프레드가 양수일 때만 레버리지가 수익을 증폭합니다. */
  amplifying: boolean;
  /** 손익분기 가격상승률 = 적용금리. 이보다 낮으면 레버리지가 손실을 키웁니다. */
  breakEvenGrowth: number;
  /** 무차입 자산수익률 (= 가정한 가격상승률) */
  unleveredReturn: number;
  /** 자기자본 수익률 근사 */
  equityReturn: number;
}

export function leverageView(
  result: LoanResult,
  property: Property,
  priceGrowthRate: number
): LeverageView | null {
  if (!result.eligible || result.limit <= 0) return null;

  const equity = property.price - result.limit;
  if (equity <= 0) return null;

  const debtToEquity = result.limit / equity;
  const spread = priceGrowthRate - result.rate;

  return {
    debtToEquity,
    equity,
    spread,
    amplifying: spread > 0,
    breakEvenGrowth: result.rate,
    unleveredReturn: priceGrowthRate,
    equityReturn: priceGrowthRate + debtToEquity * spread,
  };
}
