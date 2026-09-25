#!/usr/bin/env node
/**
 * 후보판 원본(template.html)을 TS 문자열 모듈로 옮깁니다.
 *
 *   node scripts/board/sync-template.mjs
 *
 * 원본을 HTML 로 두는 이유는 사람이 읽고 고치기 쉬워서이고, TS 로 옮기는
 * 이유는 번들이 **하나의 엔트리**로 끝나야 해서입니다 — `?raw` 임포트나 별도
 * 파일을 쓰면 단일 HTML 빌더가 놓칠 수 있습니다. 둘이 어긋나면 테스트가 잡습니다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, '../../simulator/src/rentfinder/board');
const html = readFileSync(resolve(DIR, 'template.html'), 'utf8');
const out = `/* 자동 생성 — scripts/board/sync-template.mjs. 직접 고치지 말고 template.html 을 고친 뒤 다시 돌리세요. */
export const BOARD_TEMPLATE: string = ${JSON.stringify(html)};
`;
writeFileSync(resolve(DIR, 'template.ts'), out);
console.log(`template.ts ${Math.round(out.length / 1024)}KB`);
