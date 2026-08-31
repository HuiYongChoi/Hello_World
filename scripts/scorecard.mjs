#!/usr/bin/env node
/**
 * 채점표 — **이 저장소가 스스로 지키기로 한 것들을 지키고 있는지** 재는 자입니다.
 *
 *   node scripts/scorecard.mjs
 *   node scripts/scorecard.mjs --fast   # 타입체크·테스트·빌드를 건너뜁니다
 *
 * 점수는 취향이 아니라 **깨질 수 있는 검사**여야 합니다. "화면이 깔끔한가" 같은
 * 것은 넣지 않았습니다 — 통과시키려고 기준을 낮추게 되기 때문입니다. 대신
 * 어긴 순간 자동으로 걸리는 것만 담습니다.
 *
 * ```
 * 구조   겹치는 화면·고아 파일·엔진과 UI 분리
 * 연결   결론에서 근거로 건너갈 수 있는가
 * 검증   타입·테스트·빌드가 실제로 도는가
 * 산출물 단일 HTML·charset·외부 요청 0건
 * ```
 *
 * 100점이 "좋은 도구" 라는 뜻은 아닙니다. **약속한 구조가 무너지지 않았다**는
 * 뜻입니다. 무너지면 여기서 먼저 걸립니다.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIM = join(ROOT, 'simulator');
const SRC = join(SIM, 'src');
const FAST = process.argv.includes('--fast');

/* ── 파일 훑기 ──────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(SIM, p);
const sourceFiles = files.filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'));
const text = new Map(sourceFiles.map((f) => [rel(f), read(f)]));
const all = [...text.values()].join('\n');

function run(cmd) {
  try {
    const out = execSync(cmd, { cwd: SIM, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/* ── 검사 항목 ──────────────────────────────────────────────────────── */

const checks = [];
const check = (category, weight, name, fn) =>
  checks.push({ category, weight, name, fn });

// ── 구조 ─────────────────────────────────────────────────────────────
check('구조', 8, '상시 탭이 6개 이하', () => {
  const app = text.get('src/App.tsx') ?? '';
  // 상시 탭은 TabId 유니온이 정의합니다 — 입력 탭 안의 단계는 세지 않습니다.
  const union = app.match(/type TabId =([^;]+);/)?.[1] ?? '';
  const ids = union.match(/'[a-z]+'/g) ?? [];
  return ids.length > 0 && ids.length <= 6
    ? { ok: true, detail: `탭 ${ids.length}개 (${ids.map((x) => x.replace(/'/g, '')).join(' · ')})` }
    : { ok: false, detail: `탭 ${ids.length}개 — 8개를 6개로 줄이기로 했습니다` };
});

check('구조', 7, '겹치는 화면이 제거됨', () => {
  const removed = ['BubbleView', 'RankingDrawer', 'PremiumDrawer', 'TraitCard', 'SortableTable'];
  const alive = removed.filter(
    (n) => existsSync(join(SRC, `pages/${n}.tsx`)) || existsSync(join(SRC, `components/${n}.tsx`))
  );
  const referenced = removed.filter((n) => new RegExp(`<${n}\\b|from '.*${n}'`).test(all));
  return alive.length === 0 && referenced.length === 0
    ? { ok: true, detail: `${removed.length}개 제거 확인` }
    : { ok: false, detail: `남아 있음: ${[...alive, ...referenced].join(', ')}` };
});

check('구조', 7, '아무도 부르지 않는 화면 파일이 없음', () => {
  const entry = new Set(['src/main.tsx', 'src/App.tsx', 'src/index.css']);
  const orphans = [];
  for (const [path] of text) {
    if (entry.has(path) || path.startsWith('src/engine/')) continue;
    const base = path.split('/').pop().replace(/\.tsx?$/, '');
    const imported = [...text].some(
      ([other, body]) => other !== path && new RegExp(`from '[^']*/${base}'`).test(body)
    );
    if (!imported) orphans.push(path);
  }
  return orphans.length === 0
    ? { ok: true, detail: '고아 없음' }
    : { ok: false, detail: `고아: ${orphans.join(', ')}` };
});

check('구조', 7, '엔진이 UI 를 모름', () => {
  const bad = [...text].filter(
    ([path, body]) => path.startsWith('src/engine/') && /from 'react|\.tsx'/.test(body)
  );
  return bad.length === 0
    ? { ok: true, detail: 'engine/ 에 React import 0건' }
    : { ok: false, detail: bad.map(([p]) => p).join(', ') };
});

check('구조', 7, '화면이 룰셋 JSON 을 직접 읽지 않음', () => {
  const bad = [...text].filter(
    ([path, body]) => path.startsWith('src/pages/') && /from '.*rules\/\d{4}-\d{2}\.json'/.test(body)
  );
  return bad.length === 0
    ? { ok: true, detail: '정책 수치는 엔진 경유' }
    : { ok: false, detail: bad.map(([p]) => p).join(', ') };
});

// ── 설명서 ───────────────────────────────────────────────────────────
check('설명서', 8, '왼쪽 대출 설명서 서랍이 붙어 있음', () => {
  const app = text.get('src/App.tsx') ?? '';
  const drawer = text.get('src/pages/HandbookDrawer.tsx') ?? '';
  const mounted = /<HandbookDrawer \/>/.test(app);
  const left = /fixed[^"']*left-0/.test(drawer) && /left-0/.test(drawer);
  return mounted && left
    ? { ok: true, detail: '장착 · 좌측 슬라이드' }
    : { ok: false, detail: `장착 ${mounted} · 좌측 ${left}` };
});

check('설명서', 8, '설명서가 룰셋 숫자를 코드에 베끼지 않음', () => {
  const hb = text.get('src/engine/handbook.ts') ?? '';
  // 금액·비율 리터럴이 있으면 룰셋과 어긋날 수 있습니다. 포맷 자릿수(0,1,2)만 허용.
  const literals = (hb.match(/\b\d{3,}\b/g) ?? []).filter((n) => !/^20\d\d$/.test(n));
  return literals.length === 0
    ? { ok: true, detail: '값은 전부 RULES 에서' }
    : { ok: false, detail: `코드에 박힌 숫자: ${literals.join(', ')}` };
});

// ── 연결 ─────────────────────────────────────────────────────────────
check('연결', 6, '매트릭스 상품명 → 설명서', () => {
  const cmp = text.get('src/pages/ComparePage.tsx') ?? '';
  return /<HandbookLink id=\{r\.productId\}/.test(cmp)
    ? { ok: true, detail: '상품명 클릭으로 열림' }
    : { ok: false, detail: 'ComparePage 에 HandbookLink 없음' };
});

check('연결', 6, '등록한 물건 → 실거래 검색', () => {
  const mk = text.get('src/pages/MarketPage.tsx') ?? '';
  return /useStore\(\)/.test(mk) && /등록한 물건에서/.test(mk)
    ? { ok: true, detail: '물건 버튼으로 검색어 채움' }
    : { ok: false, detail: 'MarketPage 가 물건과 안 이어짐' };
});

check('연결', 5, '3-way 가정값 → 전세 규정 설명서', () => {
  const tn = text.get('src/pages/TenurePage.tsx') ?? '';
  return /<HandbookLink id="jeonse-loan"/.test(tn)
    ? { ok: true, detail: '전세 규정으로 건너뜀' }
    : { ok: false, detail: 'TenurePage 에 링크 없음' };
});

// ── 검증 ─────────────────────────────────────────────────────────────
check('검증', 8, '타입체크 통과', () => {
  if (FAST) return { ok: true, detail: '건너뜀(--fast)', skipped: true };
  const r = run('npm run typecheck');
  return { ok: r.ok, detail: r.ok ? 'tsc -b --noEmit 깨끗' : r.out.trim().split('\n').slice(-3).join(' / ') };
});

check('검증', 10, '엔진 단위 테스트 전부 통과', () => {
  if (FAST) return { ok: true, detail: '건너뜀(--fast)', skipped: true };
  const r = run('npm test');
  const m = r.out.match(/Tests\s+(\d+) passed \((\d+)\)/);
  return {
    ok: r.ok && !!m && m[1] === m[2],
    detail: m ? `${m[1]}/${m[2]}건 통과` : r.out.trim().split('\n').slice(-3).join(' / '),
  };
});

// ── 산출물 ───────────────────────────────────────────────────────────
check('산출물', 8, '단일 HTML 로 빌드됨', () => {
  if (FAST) return { ok: true, detail: '건너뜀(--fast)', skipped: true };
  const r = run('npm run deploy:realty');
  const out = join(ROOT, 'realty/index.html');
  if (!r.ok || !existsSync(out)) {
    return { ok: false, detail: r.out.trim().split('\n').slice(-3).join(' / ') };
  }
  const kb = Math.round(statSync(out).size / 1024);
  return { ok: true, detail: `realty/index.html ${kb}KB` };
});

check('산출물', 5, 'charset 이 첫 1024바이트 안 · 외부 요청 0건', () => {
  const out = join(ROOT, 'realty/index.html');
  if (!existsSync(out)) return { ok: false, detail: '빌드 산출물이 없습니다' };
  const buf = readFileSync(out);
  const head = buf.subarray(0, 1024).toString('utf8');
  const charsetOk = /charset/i.test(head);
  const html = buf.toString('utf8');
  // 외부에서 받아오는 태그만 봅니다. 본문 텍스트 안의 URL 은 요청이 아닙니다.
  const external = html.match(/<(?:script[^>]*\ssrc|link[^>]*\shref|img[^>]*\ssrc)=["']https?:/gi) ?? [];
  return charsetOk && external.length === 0
    ? { ok: true, detail: 'charset 선두 · 외부 태그 0건' }
    : { ok: false, detail: `charset ${charsetOk} · 외부 태그 ${external.length}건` };
});

/* ── 채점 ───────────────────────────────────────────────────────────── */

const results = checks.map((c) => ({ ...c, ...c.fn() }));

/*
 * 건너뛴 검사는 **분자에서도 분모에서도 뺍니다.**
 *
 * 안 돌린 검사에 점수를 주면 --fast 가 항상 만점이 되고, 그 순간 채점표는
 * 자기 자신을 속이는 자가 됩니다. 건너뛰면 만점의 기준선 자체가 내려가고,
 * 그 사실이 총점 옆에 같이 찍힙니다.
 */
const scored = results.filter((r) => !r.skipped);
const total = scored.reduce((s, r) => s + (r.ok ? r.weight : 0), 0);
const max = scored.reduce((s, r) => s + r.weight, 0);
const skipped = results.filter((r) => r.skipped);
function c(r) {
  return r.skipped ? 0 : r.ok ? r.weight : 0;
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));

console.log(`\n채점표 — 주택 매수 의사결정 시뮬레이터${FAST ? ' (--fast)' : ''}\n`);
let lastCategory = '';
for (const r of results) {
  if (r.category !== lastCategory) {
    console.log(`\n[${r.category}]`);
    lastCategory = r.category;
  }
  const mark = r.skipped ? '−' : r.ok ? '✓' : '✗';
  const score = r.skipped ? ' —' : `${String(c(r)).padStart(2)}/${r.weight}`;
  console.log(`  ${mark} ${pad(r.name, 40)} ${score}  ${r.detail}`);
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n총점 ${total}/${max}` +
    (skipped.length ? ` (${skipped.length}건 건너뜀 — 만점 기준선이 ${max}점으로 내려갑니다)` : '')
);
if (failed.length) {
  console.log(`실패 ${failed.length}건: ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
console.log('만점입니다 — 약속한 구조가 그대로 서 있습니다.\n');
