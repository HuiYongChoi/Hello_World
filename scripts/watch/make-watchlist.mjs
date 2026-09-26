#!/usr/bin/env node
/**
 * 감시 목록 만들기 — 후보판의 전세 줄 중 무엇을 메일로 받을지.
 *
 *   node scripts/watch/make-watchlist.mjs                       # 스냅샷의 첫 설정(seed) 기준
 *   node scripts/watch/make-watchlist.mjs ~/Downloads/마산후보판-설정-2026-09-27.json
 *
 * 후보판 설정은 브라우저에만 있어서, 후보판 사이드바의 "파일로 내보내기" 로 받은
 * 파일을 넣으면 그 소거·담은 집이 반영됩니다. 사이트에는 판의 모든 줄에 신호를
 * 보여 주고, 메일은 소거하지 않은 줄(alert: true)만 보냅니다.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '../../simulator/src/data');
const latest = (re) => readdirSync(DATA).filter((f) => re.test(f)).sort().pop();
const board = JSON.parse(readFileSync(resolve(DATA, latest(/^board-\d{4}-\d{2}\.json$/)), 'utf8'));
const rent = JSON.parse(readFileSync(resolve(DATA, latest(/^masan-rent-\d{4}-\d{2}\.json$/)), 'utf8'));

const exported = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : null;
if (exported && exported.kind !== 'masan-board-settings') throw new Error('후보판에서 내보낸 설정 파일이 아닙니다');
const excluded = exported?.jeonse?.store?.excluded ?? board.seed.jeonse.excluded ?? {};
const added = exported?.added?.jeonse ?? [];

const rows = board.jeonse.map((r) => ({ id: r.id, cx: r.cx, name: r.name, area: r.area, alert: !excluded[r.id] }));
const have = new Set(rows.map((r) => r.id));
for (const id of added) {
  if (have.has(id)) continue;
  const cut = id.lastIndexOf('_');
  const cx = id.slice(0, cut), area = Number(id.slice(cut + 1));
  const c = rent.complexes.find((x) => x.id === cx);
  rows.push({ id, cx, name: c?.name ?? cx, area, alert: !excluded[id], added: true });
}
const out = resolve(HERE, 'watchlist.json');
writeFileSync(out, JSON.stringify({ madeAt: new Date().toISOString(), jeonse: rows }, null, 1));
console.log(`감시 목록 ${rows.length}줄 (메일 대상 ${rows.filter((r) => r.alert).length}) → ${out}`);
