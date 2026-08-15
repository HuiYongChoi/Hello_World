import { rankProducts } from './loan';
import { getProduct } from './rules';
import { deriveScenario } from './scenario';
import { scoreProperty } from './scoring';
import type {
  CellResult,
  CellSummary,
  DerivedScenario,
  LoanResult,
  Objective,
  Profile,
  Property,
  ScenarioAxis,
} from './types';

export interface MatrixResult {
  scenarios: DerivedScenario[];
  cells: Record<string, CellResult>;
  /** 전체에서 가장 좋은 조합 (실행가능한 것 중 목적함수 최우수) */
  recommendation: CellResult | null;
}

export function cellKey(propertyId: string, scenarioId: string): string {
  return `${propertyId}::${scenarioId}`;
}

export function buildMatrix(
  profile: Profile,
  axes: ScenarioAxis[],
  properties: Property[],
  objective: Objective
): MatrixResult {
  const scenarios = axes.map((a) => deriveScenario(profile, a));
  const cells: Record<string, CellResult> = {};

  for (const property of properties) {
    const score = scoreProperty(property);
    for (const scenario of scenarios) {
      const { all, best } = rankProducts(profile, scenario, property, objective);
      cells[cellKey(property.id, scenario.id)] = {
        propertyId: property.id,
        scenarioId: scenario.id,
        best,
        all,
        localeScore: score.total,
        grade: score.grade,
        summary: summarize(all, best),
      };
    }
  }

  const feasibleCells = Object.values(cells).filter((c) => c.best?.feasible);
  const recommendation =
    feasibleCells.slice().sort((a, b) => rankCells(a, b, objective))[0] ?? null;

  return { scenarios, cells, recommendation };
}

/**
 * 셀에 안 뜬 상품을 정리합니다.
 *
 * `passedOver` 는 **적격인데 목적함수에 밀린 정책상품** 중 한도가 가장 큰 것입니다.
 * 월납·이자 최소화는 덜 빌리는 쪽을 유리하게 만들기 때문에, LTV 80%짜리 정책상품이
 * LTV 70% 은행 상품에 지는 일이 정상적으로 일어납니다. 그 사실을 숨기면 사용자는
 * 정책상품이 아예 반영되지 않았다고 오해합니다.
 */
export function summarize(all: LoanResult[], best: LoanResult | null): CellSummary {
  const rejected = all
    .filter((r) => !r.eligible)
    .map((r) => ({ productName: r.productName, reason: r.rejectReason ?? '자격 미달' }));

  const candidates = all.filter(
    (r) =>
      r.eligible &&
      r.productId !== best?.productId &&
      getProduct(r.productId).type === 'policy' &&
      r.limit > 0
  );
  const top = candidates.slice().sort((a, b) => b.limit - a.limit)[0] ?? null;

  return {
    totalCount: all.length,
    eligibleCount: all.filter((r) => r.eligible).length,
    rejected,
    passedOver:
      top && best
        ? {
            productName: top.productName,
            shortName: getProduct(top.productId).shortName,
            limit: top.limit,
            rate: top.rate,
            monthlyPayment: top.monthlyPayment,
            limitDelta: top.limit - best.limit,
            monthlyDelta: top.monthlyPayment - best.monthlyPayment,
          }
        : null,
  };
}

/**
 * 셀 간 비교. 단일 점수로 합치지 않는다는 원칙에 따라, 추천은
 * "실행 가능한 것들 중 목적함수 우수 → 동점 시 입지 점수" 순으로만 정렬합니다.
 */
function rankCells(a: CellResult, b: CellResult, objective: Objective): number {
  const ra = a.best;
  const rb = b.best;
  if (!ra || !rb) return 0;
  let primary = 0;
  switch (objective) {
    case 'interest':
      primary = ra.totalInterest - rb.totalInterest;
      break;
    case 'monthly':
      primary = ra.monthlyPayment - rb.monthlyPayment;
      break;
    case 'limit':
      primary = rb.limit - ra.limit;
      break;
    case 'safety':
      primary = ra.dtiRatio - rb.dtiRatio;
      break;
  }
  // 목적함수 차이가 5% 이내면 사실상 동점으로 보고 입지 점수로 가릅니다.
  const reference = Math.max(Math.abs(refValue(ra, objective)), 1);
  if (Math.abs(primary) / reference > 0.05) return primary;
  return b.localeScore - a.localeScore;
}

function refValue(r: CellResult['best'], objective: Objective): number {
  if (!r) return 1;
  switch (objective) {
    case 'interest':
      return r.totalInterest;
    case 'monthly':
      return r.monthlyPayment;
    case 'limit':
      return r.limit;
    case 'safety':
      return r.dtiRatio;
  }
}

/** 3축 뷰용 산점도 데이터 (X 입지점수 / Y 상환부담률 / Z 필요현금) */
export interface BubblePoint {
  key: string;
  propertyId: string;
  propertyName: string;
  scenarioId: string;
  scenarioLabel: string;
  localeScore: number;
  dtiPercent: number;
  requiredCash: number;
  status: 'feasible' | 'tight' | 'infeasible';
  productName: string;
}

export function toBubblePoints(
  matrix: MatrixResult,
  properties: Property[]
): BubblePoint[] {
  const points: BubblePoint[] = [];
  for (const cell of Object.values(matrix.cells)) {
    if (!cell.best || !cell.best.eligible) continue;
    const property = properties.find((p) => p.id === cell.propertyId);
    const scenario = matrix.scenarios.find((s) => s.id === cell.scenarioId);
    if (!property || !scenario) continue;
    points.push({
      key: cellKey(cell.propertyId, cell.scenarioId),
      propertyId: cell.propertyId,
      propertyName: property.name,
      scenarioId: cell.scenarioId,
      scenarioLabel: scenario.label,
      localeScore: Number(cell.localeScore.toFixed(1)),
      dtiPercent: Number((cell.best.dtiRatio * 100).toFixed(1)),
      requiredCash: cell.best.requiredCash,
      status: cell.best.feasible ? (cell.best.tight ? 'tight' : 'feasible') : 'infeasible',
      productName: cell.best.productName,
    });
  }
  return points;
}
