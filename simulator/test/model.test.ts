import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, aiResult, sortingShares, splitWeight, containerKg } from '../src/model.ts';
import { drive, distanceM, headingDeg } from '../src/geo.ts';
import { outputDestination, orderStops, planTrip, DEFAULT_SCENARIO } from '../src/history.ts';
import { SITES, VEHICLES, DEPOTS } from '../data/astana.ts';
import { seedId } from '../src/client.ts';

test('итог сортировки: сумма кг точно равна весу партии (ТЗ 7)', () => {
  const rng = new Rng(1);
  for (const w of ['mixed', 'plastic', 'paper', 'glass', 'metal'] as const) {
    for (const kg of [0.5, 37.3, 612, 1453.21]) {
      const out = splitWeight(kg, sortingShares(rng, w));
      const sum = Math.round(out.reduce((a, b) => a + b.kg, 0) * 100) / 100;
      assert.equal(sum, kg, `${w} ${kg}`);
      assert.ok(out.every((o) => o.kg > 0));
    }
  }
});

test('смешанные ТБО: вторсырья мало, органики и полигона много', () => {
  const s = sortingShares(new Rng(7), 'mixed');
  const share = (t: string) => s.filter((x) => x.type === t).reduce((a, b) => a + b.share, 0);
  assert.ok(share('landfill') > 25);
  assert.ok(share('pet') < 10);
});

test('оценка ИИ: загрязнение = площадь чужих рамок / площадь всех (ТЗ 6.3)', () => {
  const r = aiResult(new Rng(3), 'plastic', 40);
  const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
  const all = r.items.reduce((a, it) => a + area(it.box), 0);
  const wrong = r.items.filter((it) => !it.correct).reduce((a, it) => a + area(it.box), 0);
  assert.equal(r.contamination_pct, Math.round((wrong / all) * 1000) / 10);
  assert.ok(r.items.every((it) => (it.bin === 'plastic') === it.correct || !it.correct));
  assert.equal(aiResult(new Rng(3), 'mixed', 50).contamination_pct, 0);
});

test('массы контейнеров в реальных порядках', () => {
  assert.equal(containerKg('mixed', 1100, 100), 220);
  assert.ok(containerKg('plastic', 1100, 100) < 50);
});

test('GPS: точки по треку с заданной скоростью, курс по направлению', () => {
  const line: [number, number][] = [[71.40, 51.10], [71.41, 51.10]];
  const len = distanceM(line[0], line[1]);
  const d = drive(line, 0, 36, 10);
  assert.ok(Math.abs(d.t / 1000 - len / 10) < 1);       // 36 км/ч = 10 м/с
  assert.ok(d.points.length >= Math.floor(len / 100));
  assert.equal(headingDeg(line[0], line[1]), 90);
});

test('направления итогов и сценарии нарушений', () => {
  assert.equal(outputDestination('pet').destination, 'recycler');
  assert.equal(outputDestination('rdf').destination, 'energy');
  const v1 = VEHICLES[0];
  const stops = orderStops(DEPOTS[v1.carrier], v1.sites as string[]);
  assert.equal(new Set(stops).size, (v1.sites as string[]).length);
  let mixed = 0, landfill = 0;
  for (let i = 0; i < 400; i++) {
    const p = planTrip('v1', 'mixed', new Rng(i + 1), DEFAULT_SCENARIO);
    if (p.mixAt.size) mixed++;
    if (p.destination === 'landfill') landfill++;
  }
  assert.ok(mixed > 20 && mixed < 90, `смешивание ${mixed}/400`);
  assert.ok(landfill > 3 && landfill < 40, `полигон ${landfill}/400`);
});

test('сиды: площадки в Астане, детерминированные uuid', () => {
  assert.equal(SITES.length, 25);
  for (const s of SITES) {
    assert.ok(s.lonlat[0] > 71.3 && s.lonlat[0] < 71.6 && s.lonlat[1] > 51.0 && s.lonlat[1] < 51.2, s.address);
    assert.ok(s.containers.includes('mixed') && s.containers.length >= 2 && s.containers.length <= 4);
  }
  assert.equal(seedId('x'), seedId('x'));
  assert.match(seedId('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
