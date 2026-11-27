/**
 * Модель отходов симулятора: детерминированный ГСЧ, состав ТБО Казахстана, массы,
 * оценки ИИ в формате ответа /ai/analyze и итоги сортировки партий.
 *
 * Состав смешанных ТБО (ТЗ 14): органика 35–40%, ПЭТ ~16%, бумага и картон ~11%, стекло ~9%.
 */
import rules from '../../contracts/waste-rules.json' with { type: 'json' };

export type WasteType = 'mixed' | 'plastic' | 'paper' | 'glass' | 'metal' | 'organic';
export type OutputType = 'pet' | 'hdpe' | 'film' | 'paper' | 'cardboard' | 'glass' | 'metal' | 'organic' | 'rdf' | 'landfill';
export type Destination = 'recycler' | 'buyer' | 'energy' | 'compost' | 'landfill';

// ------------------------------------------------------------------ ГСЧ (воспроизводимо по seed)
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
    for (let i = 0; i < 6; i++) this.next(); // разогрев: первые значения для близких seed коррелируют
  }
  next(): number {
    // mulberry32
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
  /** нормальное распределение (Бокс — Мюллер), обрезанное до [lo, hi] */
  normal(mean: number, sd: number, lo = -Infinity, hi = Infinity): number {
    const u = Math.max(this.next(), 1e-9), v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.min(hi, Math.max(lo, mean + sd * z));
  }
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ------------------------------------------------------------------ массы
/** Насыпная плотность в контейнере, кг/м³ (порядок величин для ТБО) */
const DENSITY: Record<WasteType, number> = { mixed: 200, plastic: 30, paper: 60, glass: 250, metal: 70, organic: 400 };

export function containerKg(type: WasteType, volumeL: number, fillPct: number): number {
  return Math.round((DENSITY[type] * volumeL / 1000) * (fillPct / 100) * 10) / 10;
}

// ------------------------------------------------------------------ оценка ИИ (формат /ai/analyze)
interface RuleClass { id: number; ai_class: string; bin: string; label_ru: string; label_kk: string }
const CLASSES = (rules as { classes: RuleClass[] }).classes;
const BY_CLASS = new Map(CLASSES.map((c) => [c.ai_class, c]));

/** Какие классы лежат в контейнере данного типа «правильно» и что туда кладут по ошибке */
const RIGHT: Record<WasteType, string[]> = {
  mixed: ['other', 'organic', 'tetra_pak', 'film', 'textile'],
  plastic: ['pet_bottle', 'hard_plastic', 'film'],
  paper: ['paper', 'cardboard'],
  glass: ['glass'],
  metal: ['aluminum_can', 'tin_can'],
  organic: ['organic'],
};
const WRONG: Record<WasteType, string[]> = {
  mixed: [],
  plastic: ['organic', 'other', 'tetra_pak', 'glass', 'paper'],
  paper: ['organic', 'film', 'pet_bottle', 'other'],
  glass: ['pet_bottle', 'other', 'tin_can'],
  metal: ['pet_bottle', 'other', 'glass'],
  organic: ['film', 'pet_bottle', 'other'],
};
const TIPS: Record<string, string> = {
  organic: 'Органику — в смешанный контейнер или на компост',
  other: 'Прочие отходы — в смешанный контейнер',
  film: 'Пакеты сложите вместе, не бросайте по одному',
  pet_bottle: 'Сполосните бутылки и сомните их',
  tetra_pak: 'Тетрапак принимают отдельно — в смешанный контейнер',
  glass: 'Стекло — в зелёный контейнер',
  paper: 'Бумагу — в синий контейнер, сухой',
};

export const SIM_MODEL_VERSION = 'sim-synthetic-0.1';

/**
 * Синтетический ответ ИИ для фото контейнера с заданной долей загрязнения.
 * Рамки рисуются так, чтобы площадь «чужих» рамок / площадь всех ≈ contamination (формула ТЗ 6.3).
 */
export function aiResult(rng: Rng, containerType: WasteType, contaminationPct: number, mode: 'container' | 'item' = 'container') {
  const n = rng.int(4, 9);
  const nWrong = containerType === 'mixed' ? 0 : Math.round(n * contaminationPct / 100);
  const items: { class: string; label_ru: string; label_kk: string; confidence: number; box: number[]; bin: string; correct: boolean }[] = [];
  let areaAll = 0, areaWrong = 0;
  for (let i = 0; i < n; i++) {
    const wrong = i < nWrong;
    const cls = wrong ? rng.pick(WRONG[containerType]) : rng.pick(RIGHT[containerType]);
    const r = BY_CLASS.get(cls)!;
    const w = rng.int(60, 220), h = rng.int(60, 260);
    const x = rng.int(0, 1280 - w), y = rng.int(0, 960 - h);
    areaAll += w * h;
    if (wrong) areaWrong += w * h;
    items.push({
      class: cls, label_ru: r.label_ru, label_kk: r.label_kk,
      confidence: Math.round(rng.range(0.42, 0.96) * 100) / 100,
      box: [x, y, x + w, y + h], bin: r.bin, correct: containerType === 'mixed' ? true : !wrong,
    });
  }
  const contamination = containerType === 'mixed' ? 0 : Math.round((areaWrong / Math.max(areaAll, 1)) * 1000) / 10;
  const tips = [...new Set(items.filter((it) => !it.correct).map((it) => TIPS[it.class]).filter(Boolean))].slice(0, 3);
  return {
    model_version: SIM_MODEL_VERSION, mode, container_type: containerType,
    items, contamination_pct: contamination, tips,
    image: { width: 1280, height: 960 }, processing_ms: rng.int(180, 650), simulated: true,
  };
}

/** Фото жителя «предмет в руке»: один предмет, иногда ошибка ИИ */
export function aiItemResult(rng: Rng) {
  const cls = rng.pick(['pet_bottle', 'pet_bottle', 'hard_plastic', 'film', 'paper', 'cardboard', 'glass', 'aluminum_can', 'tetra_pak', 'organic', 'other']);
  const r = BY_CLASS.get(cls)!;
  return {
    model_version: SIM_MODEL_VERSION, mode: 'item',
    items: [{ class: cls, label_ru: r.label_ru, label_kk: r.label_kk, confidence: Math.round(rng.range(0.55, 0.97) * 100) / 100,
      box: [320, 160, 960, 880], bin: r.bin, correct: true }],
    contamination_pct: null, tips: TIPS[cls] ? [TIPS[cls]] : [], image: { width: 1280, height: 960 }, processing_ms: rng.int(150, 500), simulated: true,
  };
}

// ------------------------------------------------------------------ итоги сортировки
export interface OutputShare { type: OutputType; share: number }

/**
 * Что получается из партии на сортировке. Для смешанных ТБО выход вторсырья низкий —
 * отсюда разрыв «заявлено как переработанное» (весь вес на сортировке) и «реально вторсырьё».
 */
export function sortingShares(rng: Rng, waste: WasteType): OutputShare[] {
  const j = (x: number) => Math.max(0, x * rng.range(0.8, 1.2));
  let s: OutputShare[];
  switch (waste) {
    case 'mixed':
      s = [
        { type: 'pet', share: j(6) }, { type: 'hdpe', share: j(2.5) }, { type: 'film', share: j(2.5) },
        { type: 'paper', share: j(3) }, { type: 'cardboard', share: j(3) }, { type: 'glass', share: j(3.5) },
        { type: 'metal', share: j(1.5) }, { type: 'organic', share: j(18) }, { type: 'rdf', share: j(16) },
      ];
      break;
    case 'plastic':
      s = [{ type: 'pet', share: j(46) }, { type: 'hdpe', share: j(20) }, { type: 'film', share: j(14) }];
      break;
    case 'paper':
      s = [{ type: 'paper', share: j(48) }, { type: 'cardboard', share: j(36) }];
      break;
    case 'glass':
      s = [{ type: 'glass', share: j(86) }];
      break;
    case 'metal':
      s = [{ type: 'metal', share: j(88) }];
      break;
    default:
      s = [{ type: 'organic', share: j(85) }];
  }
  const used = s.reduce((a, b) => a + b.share, 0);
  s.push({ type: 'landfill', share: Math.max(0, 100 - used) });
  return s;
}

/** Разбить вес партии по долям так, чтобы сумма кг точно совпала с весом (ТЗ 7: сумма = вес) */
export function splitWeight(totalKg: number, shares: OutputShare[]): { type: OutputType; kg: number }[] {
  const sum = shares.reduce((a, b) => a + b.share, 0);
  const out = shares.map((s) => ({ type: s.type, kg: Math.floor((totalKg * s.share / sum) * 100) / 100 }));
  const rest = Math.round((totalKg - out.reduce((a, b) => a + b.kg, 0)) * 100) / 100;
  out.sort((a, b) => b.kg - a.kg);
  out[0].kg = Math.round((out[0].kg + rest) * 100) / 100;
  return out.filter((o) => o.kg > 0);
}
