import type { MessageKey } from '@/lib/messages/ru';

export type StageId = 'receiving' | 'opening' | 'trommel' | 'magnet' | 'optical' | 'manual' | 'baling' | 'residue';

export interface Stage {
  id: StageId;
  n: number;
  /** центр зоны по оси X, ед. сцены (1 ед. ≈ 1 м) */
  x: number;
  /** положение камеры относительно центра зоны */
  cam: [number, number, number];
  title: MessageKey;
  short: MessageKey;
  desc: MessageKey;
  input: MessageKey;
  output: MessageKey;
}

const ids: StageId[] = ['receiving', 'opening', 'trommel', 'magnet', 'optical', 'manual', 'baling', 'residue'];
export const STAGE_GAP = 11;

export const STAGES: Stage[] = ids.map((id, i) => ({
  id,
  n: i + 1,
  x: -38.5 + i * STAGE_GAP,
  cam: [0, 13, 21],
  title: `stage.${id}.title` as MessageKey,
  short: `stage.${id}.short` as MessageKey,
  desc: `stage.${id}.desc` as MessageKey,
  input: `stage.${id}.in` as MessageKey,
  output: `stage.${id}.out` as MessageKey,
}));

export const stageX = (id: StageId) => STAGES.find((s) => s.id === id)!.x;

export type Mat = 'organic' | 'metal' | 'alu' | 'pet' | 'hdpe' | 'cardboard' | 'film' | 'paper' | 'glass' | 'rdf' | 'landfill';

export const MAT_COLOR: Record<Mat, string> = {
  organic: '#8b5a2b',
  metal: '#64748b',
  alu: '#cbd5e1',
  pet: '#38bdf8',
  hdpe: '#f97316',
  cardboard: '#d6a05a',
  film: '#e2e8f0',
  paper: '#fde047',
  glass: '#34d399',
  rdf: '#a3a3a3',
  landfill: '#44403c',
};

export const MAT_LABEL: Record<Mat, MessageKey> = {
  organic: 'output.organic',
  metal: 'output.metal',
  alu: 'output.metal',
  pet: 'output.PET',
  hdpe: 'output.HDPE',
  cardboard: 'output.cardboard',
  film: 'output.film',
  paper: 'output.paper',
  glass: 'output.glass',
  rdf: 'output.RDF',
  landfill: 'output.landfill',
};

/** Где предмет покидает ленту и в какой бункер падает: x — выход, bx — бункер. */
export interface Exit {
  mat: Mat;
  weight: number;
  x: number;
  bx: number;
}

export const EXITS: Exit[] = [
  { mat: 'organic', weight: 0.3, x: stageX('trommel') + 2.5, bx: stageX('trommel') + 2.5 },
  { mat: 'metal', weight: 0.06, x: stageX('magnet') - 1.5, bx: stageX('magnet') - 2 },
  { mat: 'alu', weight: 0.04, x: stageX('magnet') + 2.8, bx: stageX('magnet') + 2 },
  { mat: 'pet', weight: 0.16, x: stageX('optical') + 2.6, bx: stageX('optical') + 1.9 },
  { mat: 'hdpe', weight: 0.06, x: stageX('optical') + 3.4, bx: stageX('optical') + 3.3 },
  { mat: 'cardboard', weight: 0.08, x: stageX('optical') + 4.2, bx: stageX('optical') + 4.7 },
  { mat: 'film', weight: 0.06, x: stageX('optical') + 5.0, bx: stageX('optical') + 6.1 },
  { mat: 'paper', weight: 0.1, x: stageX('manual') - 1.6, bx: stageX('manual') - 1.6 },
  { mat: 'glass', weight: 0.06, x: stageX('manual') + 1.6, bx: stageX('manual') + 1.6 },
  { mat: 'rdf', weight: 0.09, x: stageX('residue') - 0.8, bx: stageX('residue') + 0.8 },
  { mat: 'landfill', weight: 0.05, x: stageX('residue') + 2.2, bx: stageX('residue') + 4.2 },
];

export const BELT_START = stageX('opening') - 3.2;
export const BELT_END = stageX('residue') + 3;
export const BELT_Y = 1.0;
export const BUNKER_Z = 4.6;
