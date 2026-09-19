/**
 * dist/ 빌드 결과를 단일 HTML 파일로 인라인합니다.
 *
 * 저장소에 사이트가 둘이라 `--page` 로 어느 쪽을 말아 넣을지 고릅니다.
 * 기본은 매수 시뮬레이터(`index`)이고, `--page rent` 면 마산 전월세 찾기입니다.
 *
 * 외부 요청이 차단된 환경(아티팩트 호스팅, 오프라인, 파일 직접 열기)에서도
 * 그대로 열리도록 CSS와 JS를 모두 문서 안에 넣습니다.
 *
 * 두 가지 형태를 만듭니다.
 *
 *   node scripts/build-standalone.mjs
 *     → dist/standalone.html — <html>/<head>/<body> 없는 본문 조각.
 *       아티팩트 호스트가 그 골격을 씌우므로 중복을 피합니다.
 *
 *   node scripts/build-standalone.mjs --full
 *     → dist/realty.html — 완전한 HTML 문서.
 *       GitHub Pages처럼 파일을 그대로 내려주는 호스팅용입니다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const full = process.argv.includes('--full');
const pageIdx = process.argv.indexOf('--page');
const page = pageIdx >= 0 && process.argv[pageIdx + 1] ? process.argv[pageIdx + 1] : 'index';

/** 사이트마다 제목·설명·파비콘·산출물 이름이 다릅니다. */
const PAGES = {
  index: {
    entry: 'index.html',
    out: full ? 'realty.html' : 'standalone.html',
    title: '주택 매수 의사결정 시뮬레이터',
    description:
      '대출 시나리오 계산과 물건 입지 평가를 한 화면에서 결합한 주택 매수 의사결정 도구',
    icon: '🏠',
  },
  rent: {
    entry: 'rent.html',
    out: full ? 'hyrent.html' : 'rent-standalone.html',
    title: '마산 전월세 찾기 — 함안 · 의령 출퇴근 기준',
    description:
      '국토부 아파트 전월세 실거래로 마산 생활권 투룸 이상 전월세 후보를 좁히는 도구',
    icon: '🔑',
  },
};
const cfg = PAGES[page];
if (!cfg) throw new Error(`--page 는 ${Object.keys(PAGES).join(' | ')} 중 하나여야 합니다.`);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const OUT = join(dist, cfg.out);

const TITLE = cfg.title;

const html = readFileSync(join(dist, cfg.entry), 'utf8');

/** 인라인된 코드가 문서를 조기 종료시키지 않도록 닫는 태그를 이스케이프합니다. */
const guard = (code) => code.replace(/<\/(script|style)/gi, '<\\/$1');

const cssHrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
  (m) => m[1]
);
const jsSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);

if (cssHrefs.length === 0 || jsSrcs.length === 0) {
  throw new Error(`dist/${cfg.entry} 에서 에셋을 찾지 못했습니다. 먼저 \`npm run build\` 를 실행하세요.`);
}

const read = (assetPath) => readFileSync(join(dist, assetPath.replace(/^\.?\//, '')), 'utf8');

const css = cssHrefs.map(read).join('\n');
const js = jsSrcs.map(read).join('\n');

const DESCRIPTION = cfg.description;

// charset은 문서 첫 1024바이트 안에 있어야 브라우저가 인코딩을 올바로 잡습니다.
// 이게 없으면 UTF-8 한글이 windows-1252로 해석돼 전부 깨집니다.
const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  `<title>${TITLE}</title>`,
  `<meta name="description" content="${DESCRIPTION}">`,
  // 파비콘을 data URI로 인라인해 외부 요청을 0으로 유지합니다.
  `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${cfg.icon}</text></svg>`
  )}">`,
  `<style>${guard(css)}</style>`,
];

const body = ['<div id="root"></div>', `<script type="module">${guard(js)}</script>`];

const out = full
  ? [
      '<!doctype html>',
      '<html lang="ko">',
      '<head>',
      ...head,
      '</head>',
      '<body>',
      ...body,
      '</body>',
      '</html>',
      '',
    ].join('\n')
  : [...head, ...body, ''].join('\n');

writeFileSync(OUT, out, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`✓ ${OUT}`);
console.log(`  CSS ${kb(css.length)} + JS ${kb(js.length)} → ${kb(out.length)}`);
