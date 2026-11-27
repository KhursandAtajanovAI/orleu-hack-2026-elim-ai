'use client';
/**
 * ИИ прямо в браузере (ТЗ 6): дообученная YOLO11n «waste-yolo» в ONNX на onnxruntime-web (wasm, CPU).
 * Сервер ИИ не нужен: модель и рантайм лежат рядом с сайтом (/models, /ort). Пред- и постобработка —
 * как в ai/app/detector.py и analyze.py: letterbox 416 px, NMS по классам, класс → правило waste_rules.
 */
import type { Any } from './rpc';

export const MODEL_VERSION = 'waste-yolo-0.1';
export const CLASSES = ['pet_bottle', 'hard_plastic', 'film', 'paper', 'cardboard', 'tetra_pak', 'glass',
  'aluminum_can', 'tin_can', 'organic', 'textile', 'hazardous', 'other'] as const;
const IMGSZ = 416;
const CONF = 0.3;
const IOU = 0.45;
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Ort = Any;
let sessionP: Promise<{ ort: Ort; session: Any }> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Не загрузился рантайм ИИ'));
    document.head.appendChild(s);
  });
}

/** Загрузка рантайма и модели (≈ 10 МБ + 11 МБ, кэшируется браузером). Вызывать заранее, чтобы прогреть. */
export function loadModel(): Promise<{ ort: Ort; session: Any }> {
  if (!sessionP) {
    sessionP = (async () => {
      await loadScript(`${BASE}/ort/ort.wasm.min.js`);
      const ort = (window as unknown as { ort: Ort }).ort;
      ort.env.wasm.wasmPaths = `${BASE}/ort/`;
      ort.env.wasm.numThreads = 1; // GitHub Pages без cross-origin isolation
      const session = await ort.InferenceSession.create(`${BASE}/models/waste-yolo.onnx`, { executionProviders: ['wasm'] });
      return { ort, session };
    })().catch((e) => { sessionP = null; throw e; });
  }
  return sessionP;
}

export interface Det { cls: string; confidence: number; box: [number, number, number, number] }

function iou(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = (r: number[]) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  return inter / (area(a) + area(b) - inter + 1e-9);
}

/** Детекция на картинке. Возвращает рамки в пикселях исходного изображения. */
export async function detect(img: HTMLImageElement | HTMLCanvasElement): Promise<{ dets: Det[]; ms: number; brightness: number }> {
  const { ort, session } = await loadModel();
  const t0 = performance.now();
  const w = (img as HTMLImageElement).naturalWidth || img.width, h = (img as HTMLImageElement).naturalHeight || img.height;
  const r = Math.min(IMGSZ / w, IMGSZ / h);
  const nw = Math.round(w * r), nh = Math.round(h * r);
  const px = Math.round((IMGSZ - nw) / 2 - 0.1), py = Math.round((IMGSZ - nh) / 2 - 0.1);
  const c = document.createElement('canvas');
  c.width = IMGSZ; c.height = IMGSZ;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = 'rgb(114,114,114)'; g.fillRect(0, 0, IMGSZ, IMGSZ);
  g.drawImage(img, px, py, nw, nh);
  const px32 = g.getImageData(0, 0, IMGSZ, IMGSZ).data;
  const n = IMGSZ * IMGSZ;
  const input = new Float32Array(3 * n);
  let bright = 0;
  for (let i = 0; i < n; i++) {
    const R = px32[i * 4], G = px32[i * 4 + 1], B = px32[i * 4 + 2];
    input[i] = R / 255; input[n + i] = G / 255; input[2 * n + i] = B / 255;
    bright += 0.299 * R + 0.587 * G + 0.114 * B;
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, IMGSZ, IMGSZ]) };
  const out = (await session.run(feeds))[session.outputNames[0]];
  const [, a, b] = out.dims as number[];
  const data = out.data as Float32Array;
  const nc = CLASSES.length;
  // классический экспорт Ultralytics: [1, 4 + nc, N]
  const N = a === 4 + nc ? b : a;
  const at = a === 4 + nc ? (k: number, j: number) => data[k * N + j] : (k: number, j: number) => data[j * (4 + nc) + k];
  const cand: { c: number; s: number; box: number[] }[] = [];
  for (let j = 0; j < N; j++) {
    let best = 0, bc = 0;
    for (let k = 0; k < nc; k++) { const s = at(4 + k, j); if (s > best) { best = s; bc = k; } }
    if (best < CONF) continue;
    const cx = at(0, j), cy = at(1, j), bw = at(2, j), bh = at(3, j);
    cand.push({ c: bc, s: best, box: [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2] });
  }
  cand.sort((x, y) => y.s - x.s);
  const keep: typeof cand = [];
  for (const d of cand) if (!keep.some((k) => k.c === d.c && iou(k.box, d.box) > IOU)) keep.push(d);
  const clip = (v: number, m: number) => Math.min(m, Math.max(0, v));
  const dets = keep.slice(0, 20).map((d) => ({
    cls: CLASSES[d.c], confidence: Math.round(d.s * 1000) / 1000,
    box: [clip((d.box[0] - px) / r, w), clip((d.box[1] - py) / r, h), clip((d.box[2] - px) / r, w), clip((d.box[3] - py) / r, h)] as Det['box'],
  }));
  return { dets, ms: Math.round(performance.now() - t0), brightness: bright / n };
}

/** Результат в формате ИИ-сервиса (ai_result в scans): предметы → правило города, загрязнение контейнера. */
export function toAiResult(dets: Det[], rules: Any[], mode: 'item' | 'container', container?: string, ms = 0): Any {
  const byClass = new Map(rules.map((r) => [r.ai_class, r]));
  const items = dets.map((d) => {
    const r = byClass.get(d.cls) ?? byClass.get('other') ?? {};
    const correct = mode === 'container' && container ? (!r.special_handling && r.bin === container) : null;
    return { class: d.cls, label_ru: r.label_ru, label_kk: r.label_kk, confidence: d.confidence, box: d.box.map(Math.round),
      bin: r.bin, correct, special_handling: !!r.special_handling, color: r.color, _area: (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]) };
  });
  const total = items.reduce((s, i) => s + i._area, 0);
  const wrong = items.filter((i) => i.correct === false).reduce((s, i) => s + i._area, 0);
  return {
    model_version: MODEL_VERSION, source: 'browser', mode, container_type: container ?? null, latency_ms: ms,
    items: items.map(({ _area, ...i }) => i), // eslint-disable-line @typescript-eslint/no-unused-vars
    contamination_pct: mode === 'container' && total > 0 ? Math.round((1000 * wrong) / total) / 10 : null,
  };
}
