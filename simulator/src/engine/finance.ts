/** 원리금균등상환 금융 계산 — 순수 함수 모듈 */

/** 월 상환액. principal 원을 연이율 annualRate로 years년 상환. */
export function monthlyPayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0) return 0;
  const n = Math.round(years * 12);
  if (n <= 0) return principal;
  const i = annualRate / 12;
  if (i === 0) return principal / n;
  return (principal * i) / (1 - Math.pow(1 + i, -n));
}

/** 월 상환 가능액에서 역산한 대출 원금(현재가치). */
export function presentValue(payment: number, annualRate: number, years: number): number {
  if (payment <= 0) return 0;
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  const i = annualRate / 12;
  if (i === 0) return payment * n;
  return (payment * (1 - Math.pow(1 + i, -n))) / i;
}

/** 총 이자액 = 총 납입액 − 원금 */
export function totalInterest(principal: number, annualRate: number, years: number): number {
  if (principal <= 0) return 0;
  return monthlyPayment(principal, annualRate, years) * Math.round(years * 12) - principal;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 만원 단위 절사 — 한도 표시는 만원 미만을 버림 처리 */
export function floorToManwon(v: number): number {
  return Math.floor(v / 10000) * 10000;
}
