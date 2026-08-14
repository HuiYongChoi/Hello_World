import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { Card, Empty } from '../components/ui';
import { money } from '../engine/format';
import { toBubblePoints, type BubblePoint } from '../engine/matrix';
import { RULES } from '../engine/rules';
import { useStore } from '../state/store';

const STATUS_COLOR: Record<BubblePoint['status'], string> = {
  feasible: '#34d399',
  tight: '#fbbf24',
  infeasible: '#f43f5e',
};

const STATUS_LABEL: Record<BubblePoint['status'], string> = {
  feasible: '실행 가능',
  tight: '빠듯함',
  infeasible: '자금 부족',
};

export function BubbleView() {
  const { matrix, properties } = useStore();
  const points = toBubblePoints(matrix, properties);
  const safeLine = RULES.defaults.dtiSafeLine * 100;

  return (
    <Card
      title="3축 통합 뷰"
      subtitle="입지 점수와 상환 부담은 성격이 다른 축이라 하나로 합치지 않습니다. 목표는 우하단 — 입지가 좋고 부담이 낮은 조합입니다."
    >
      {points.length === 0 ? (
        <Empty>이용 가능한 상품이 있는 조합이 없습니다. 프로필이나 물건 조건을 조정해 보세요.</Empty>
      ) : (
        <>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 8 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="localeScore"
                  name="입지 점수"
                  domain={[0, 100]}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  label={{
                    value: '입지 점수 →',
                    position: 'insideBottom',
                    offset: -18,
                    fill: '#64748b',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="dtiPercent"
                  name="상환 부담률"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  label={{
                    value: '월 상환 부담률 (%)',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#64748b',
                    fontSize: 11,
                  }}
                />
                <ZAxis type="number" dataKey="requiredCash" range={[80, 900]} name="필요현금" />
                <ReferenceLine
                  y={safeLine}
                  stroke="#38bdf8"
                  strokeDasharray="6 4"
                  label={{
                    value: `DTI 안전선 ${safeLine}%`,
                    position: 'insideTopRight',
                    fill: '#38bdf8',
                    fontSize: 10,
                  }}
                />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<BubbleTooltip />} />
                <Scatter data={points}>
                  {points.map((p) => (
                    <Cell
                      key={p.key}
                      fill={STATUS_COLOR[p.status]}
                      fillOpacity={0.55}
                      stroke={STATUS_COLOR[p.status]}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
            {(Object.keys(STATUS_COLOR) as BubblePoint['status'][]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: STATUS_COLOR[s] }}
                />
                {STATUS_LABEL[s]}
              </span>
            ))}
            <span>버블 크기 = 필요 현금</span>
          </div>
        </>
      )}
    </Card>
  );
}

function BubbleTooltip({ active, payload }: { active?: boolean; payload?: { payload: BubblePoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-slate-100">
        {p.propertyName} · {p.scenarioLabel}
      </div>
      <div className="mt-1 space-y-0.5 text-slate-400">
        <div>{p.productName}</div>
        <div>입지 {p.localeScore}점</div>
        <div>상환 부담률 {p.dtiPercent}%</div>
        <div>필요 현금 {money(p.requiredCash)}</div>
        <div style={{ color: STATUS_COLOR[p.status] }}>{STATUS_LABEL[p.status]}</div>
      </div>
    </div>
  );
}
