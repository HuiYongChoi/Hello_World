/**
 * 물건 성격 판정 — "이건 왜 사는 물건인가".
 *
 * 창원 논의에서 나온 결론이 근거입니다: **투자가치가 붙는 건 재건축이 걸린 구축이거나
 * 신축**이고, 그 사이 어중간한 구축은 살 이유가 약합니다. 그런데 3억대에는 신축이
 * 사실상 없습니다. 그러면 3억대 구축은 "재건축 기대가 있는가"만 남고, 그것마저
 * 없으면 **매수할 이유가 사라집니다** — 그 돈을 임차에 묶고 나머지를 굴리는 편이 낫습니다.
 *
 * 이 판정은 입지 점수와 **합치지 않습니다**. 입지 88점짜리 애매 구간 물건이 존재할 수
 * 있고, 그게 정확히 이 판정이 필요한 이유입니다 — 좋은 동네의 어중간한 구축이 가장
 * 사기 쉬운 실수입니다.
 *
 * 판정 기준값은 전부 `rules.appraisal` 에 있습니다. 신축 하한가는 **실거래 하위 25%**
 * 로 계산해 넣습니다 (`scripts/calc-newbuild-floor.mjs`). 최저가를 쓰면 외곽 나홀로
 * 단지 한 건이 판정을 흔듭니다 — 창원 최저는 1.29억(동읍 용잠리)인데 성산구 신축
 * 하위 25%는 5.38억입니다.
 */

import { money } from './format';
import { findDistrict } from './regions';
import { RULES } from './rules';
import type { Property } from './types';

export type ThesisKind = 'newBuild' | 'redevelopment' | 'ambiguous' | 'stable';

export interface PropertyThesis {
  kind: ThesisKind;
  label: string;
  /** 왜 그렇게 봤는지 */
  reason: string;
  /** 그래서 무엇을 하면 되는지 */
  advice: string;
  /** 매수보다 임차+투자를 먼저 검토해야 하는 구간인가 */
  preferTenure: boolean;
  age: number;
}

const currentYear = () => new Date().getFullYear();

/** 재건축 기대가 실제로 걸려 있는가 — 연식만으로는 부족하고 용적률이 받쳐줘야 합니다. */
export function hasRedevelopmentCase(property: Property): boolean {
  const cfg = RULES.appraisal;
  const stage = property.scores.redevelopmentStage ?? 1;
  if (stage >= cfg.redevelopmentStageThreshold) return true;

  const age = currentYear() - property.builtYear;
  const far = property.scores.floorAreaRatio ?? 220;
  return age >= cfg.redevelopmentMinAge && far <= cfg.farThreshold;
}

/**
 * 이 물건이 속한 시군구의 신축 하한가.
 *
 * 권역 하나로 묶으면 성산구(신축 하위25% 5.38억)와 진해구(1.85억)가 평균으로
 * 상쇄돼 어느 쪽 현실도 아닌 값이 나옵니다. 시군구 값이 있으면 그것을 쓰고,
 * 수집하지 않은 지역이면 권역값으로 물러섭니다.
 */
export interface NewBuildFloor {
  /** 판정 기준값 (하위 25%) */
  price: number;
  /** 같은 표본의 최저가 — 판정엔 안 쓰지만 폭을 보려면 같이 읽어야 합니다 */
  lowest: number;
  median: number;
  /** 표본 수. 적으면 값이 흔들립니다 (성산구는 신축 자체가 드뭅니다) */
  n: number;
  scope: string;
}

export function newBuildFloorFor(property: Property): NewBuildFloor {
  const cfg = RULES.appraisal;
  const district = findDistrict(property.sigungu);
  const stat = district ? cfg.newBuildMinPriceByDistrict[district.code] : undefined;
  return stat
    ? { price: stat.p25, lowest: stat.lowest, median: stat.median, n: stat.n, scope: district!.label }
    : {
        price: cfg.newBuildMinPrice[property.region].p25,
        lowest: cfg.newBuildMinPrice[property.region].lowest,
        median: cfg.newBuildMinPrice[property.region].median,
        n: cfg.newBuildMinPrice[property.region].n,
        scope: '권역 평균',
      };
}

export function propertyThesis(property: Property): PropertyThesis {
  const cfg = RULES.appraisal;
  const age = currentYear() - property.builtYear;
  const floor = newBuildFloorFor(property);
  const newBuildFloor = floor.price;

  if (age <= cfg.newBuildMaxAge) {
    return {
      kind: 'newBuild',
      label: '신축',
      reason: `준공 ${property.builtYear}년 — ${cfg.newBuildMaxAge}년 이내입니다.`,
      advice: '신축 프리미엄이 남아 있는 구간입니다. 가격이 이미 그걸 반영했는지만 보세요.',
      preferTenure: false,
      age,
    };
  }

  if (hasRedevelopmentCase(property)) {
    const stage = property.scores.redevelopmentStage ?? 1;
    return {
      kind: 'redevelopment',
      label: '재건축 기대',
      reason:
        stage >= cfg.redevelopmentStageThreshold
          ? `재건축 단계 ${stage}단계 — 사업이 실제로 굴러가고 있습니다.`
          : `${age}년차 · 용적률 ${property.scores.floorAreaRatio ?? 220}% — 사업성이 나는 조건입니다.`,
      advice:
        '분담금과 사업 지연이 실제 리스크입니다. 단계가 올라갈수록 가격에 이미 반영됩니다.',
      preferTenure: false,
      age,
    };
  }

  if (property.price < newBuildFloor) {
    return {
      kind: 'ambiguous',
      label: '애매 구간',
      reason: `${age}년차 구축인데 재건축 기대가 없고, ${floor.scope} 신축 하한(${money(
        newBuildFloor
      )}) 아래 가격대입니다. 하한은 실거래 하위 25%이고, 같은 표본의 최저가는 ${money(
        floor.lowest
      )}입니다 (표본 ${floor.n}건).`,
      advice:
        '신축도 재건축도 아니면 오를 이유가 약합니다. 매수 대신 임차로 묶고 남은 돈을 굴리는 쪽을 먼저 비교해 보세요.',
      preferTenure: true,
      age,
    };
  }

  return {
    kind: 'stable',
    label: '일반 구축',
    reason: `${age}년차이고 재건축 기대는 없지만, 신축 하한 위 가격대입니다.`,
    advice: '실거주 편익으로 사는 물건입니다. 시세차익을 기대하고 있다면 근거를 따로 세우세요.',
    preferTenure: false,
    age,
  };
}
