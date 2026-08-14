import type { DerivedScenario, Profile, ScenarioAxis } from './types';

export const ALL_SCENARIO_AXES: ScenarioAxis[] = [
  { id: 'before-sole', marriageTiming: 'before', ownership: 'sole' },
  { id: 'before-joint', marriageTiming: 'before', ownership: 'joint' },
  { id: 'after-sole', marriageTiming: 'after', ownership: 'sole' },
  { id: 'after-joint', marriageTiming: 'after', ownership: 'joint' },
];

export function scenarioLabel(axis: ScenarioAxis): string {
  const t = axis.marriageTiming === 'before' ? '혼전' : '혼후';
  const o = axis.ownership === 'sole' ? '단독' : '공동';
  return `${t}·${o}`;
}

/**
 * 프로필 × 시나리오축 → 판정 상태 파생.
 *
 *   생애최초유효 = 본인생애최초 && !(혼인후 && 배우자 주택소유 이력)
 *   판정소득     = 혼인후 || 공동명의 ? 본인+배우자 : 본인
 *   가용현금     = 혼인후 ? 본인+배우자 : 본인 (+배우자 자금 포함 시 증여세 경고)
 */
export function deriveScenario(profile: Profile, axis: ScenarioAxis): DerivedScenario {
  const isAfter = axis.marriageTiming === 'after';
  const isJoint = axis.ownership === 'joint';

  // 단독세대주(디딤돌 30세 요건·축소한도 대상)는 혼인 전 단독명의 매수인 경우
  const isSingleHousehold = !isAfter && !isJoint;

  const spouseHadHouse = profile.spouseHouseHistory !== 'none';
  const isFirstTimeValid = profile.isFirstTime && !(isAfter && spouseHadHouse);
  let firstTimeLostReason: string | undefined;
  if (!profile.isFirstTime) {
    firstTimeLostReason = '본인 생애최초 요건 미충족';
  } else if (isAfter && spouseHadHouse) {
    firstTimeLostReason =
      profile.spouseHouseHistory === 'owning'
        ? '혼인 후 배우자 주택 보유로 생애최초·무주택세대 요건 소멸'
        : '혼인 후 배우자 주택 소유 이력으로 세대 기준 생애최초 소멸';
  }

  // 혼인 후에는 배우자가 주택을 보유 중이면 무주택 세대가 아님
  const hasNoHouseHousehold = !(isAfter && profile.spouseHouseHistory === 'owning');

  const assessedIncome =
    isAfter || isJoint ? profile.ownIncome + profile.spouseIncome : profile.ownIncome;

  // 공동명의는 각자 지분을 각자 자금으로 취득하므로 배우자 현금이 가용에 들어옵니다.
  const useSpouseCash = isAfter || isJoint || profile.includeSpouseCashBeforeMarriage;
  const availableCash = profile.ownCash + (useSpouseCash ? profile.spouseCash : 0);

  // 증여세 리스크는 "단독명의인데 배우자 자금을 쓰는" 구조에서 발생합니다.
  // 혼전 공동명의는 지분율과 자금부담률이 어긋날 때만 문제가 되므로 별도 플래그로 분리합니다.
  const giftTaxFlag =
    !isAfter &&
    !isJoint &&
    profile.includeSpouseCashBeforeMarriage &&
    profile.spouseCash > 0;
  const contributionRatioFlag = !isAfter && isJoint && profile.spouseCash > 0;

  const isNewlywed =
    isAfter || profile.maritalStatus === 'newlywed7y' || profile.maritalStatus === 'engaged';

  return {
    ...axis,
    label: scenarioLabel(axis),
    isSingleHousehold,
    isFirstTimeValid,
    firstTimeLostReason,
    assessedIncome,
    availableCash,
    giftTaxFlag,
    contributionRatioFlag,
    isNewlywed,
    hasNoHouseHousehold,
  };
}

export function deriveAll(profile: Profile, axes: ScenarioAxis[] = ALL_SCENARIO_AXES) {
  return axes.map((a) => deriveScenario(profile, a));
}
