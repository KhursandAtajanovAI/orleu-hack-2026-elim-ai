/**
 * Скачивает модель Астаны из OpenStreetMap (Overpass) в статические файлы для офлайн-режима.
 * Запуск (на машине с интернетом):
 *   npx tsx scripts/fetch-osm.ts                     # центр города
 *   npx tsx scripts/fetch-osm.ts 71.25 50.98 71.65 51.30   # свой bbox: w s e n
 * Результат: public/data/astana/<tier>/<cx>_<cy>.json + manifest.json. Данные © OpenStreetMap contributors (ODbL).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { CELL_LAT, CELL_LON, TIERS, cellOf, convert, queryFor } from '../src/lib/osm/convert';

const [w, s, e, n] = process.argv.slice(2).map(Number);
const bbox = [w, s, e, n].every(Number.isFinite) ? [w, s, e, n] : [71.33, 51.04, 71.53, 51.2];
const OUT = 'public/data/astana';
const EP = (process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(q: string) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(EP[i % EP.length], { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      if (r.ok) return (await r.json()).elements ?? [];
      await sleep(3000 * (i + 1));
    } catch {
      await sleep(3000 * (i + 1));
    }
  }
  throw new Error('Overpass недоступен');
}

async function main() {
const [x0, y0] = cellOf(bbox[0], bbox[1]);
const [x1, y1] = cellOf(bbox[2], bbox[3]);
const total = (x1 - x0 + 1) * (y1 - y0 + 1) * TIERS.length;
let i = 0;
for (const tier of TIERS) await mkdir(`${OUT}/${tier}`, { recursive: true });
for (const tier of TIERS)
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++) {
      const feats = convert(tier, await overpass(queryFor(tier, cx, cy)));
      await writeFile(`${OUT}/${tier}/${cx}_${cy}.json`, JSON.stringify(feats));
      console.log(`[${++i}/${total}] ${tier} ${cx}_${cy}: ${feats.length}`);
      await sleep(1200); // не нагружаем публичный Overpass
    }
await writeFile(`${OUT}/manifest.json`, JSON.stringify({ bbox, cell: [CELL_LON, CELL_LAT], generated: new Date().toISOString(), attribution: '© OpenStreetMap contributors (ODbL)' }));
console.log('Готово →', OUT);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
