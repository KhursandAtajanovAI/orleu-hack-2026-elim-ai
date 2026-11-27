import type { FacilityType, PathOutput, WasteType } from '@/viz/lib/contracts';
import { hexToRgb } from '@/viz/lib/geo';

export const WASTE_COLOR: Record<WasteType, string> = {
  mixed: '#6b7280',
  plastic: '#f59e0b',
  paper: '#3b82f6',
  glass: '#10b981',
  metal: '#a855f7',
  organic: '#84cc16',
};

export const FACILITY_COLOR: Record<FacilityType, string> = {
  sorting: '#0ea5e9',
  recycling: '#22c55e',
  landfill: '#78716c',
  collection_point: '#f97316',
  composting: '#65a30d',
  energy: '#eab308',
};

/** Высота «иконки-башни» объекта, м — разные формы читаются на расстоянии. */
export const FACILITY_HEIGHT: Record<FacilityType, number> = {
  sorting: 160,
  recycling: 130,
  landfill: 60,
  collection_point: 70,
  composting: 90,
  energy: 190,
};

export const OUTCOME_COLOR: Record<PathOutput['outcome'], string> = {
  recycling: '#22c55e',
  buyer: '#3b82f6',
  energy: '#eab308',
  landfill: '#78716c',
};

export const COMPLAINT_STATUS_COLOR = {
  new: '#ef4444',
  in_work: '#f59e0b',
  confirmed: '#22c55e',
  rejected: '#9ca3af',
} as const;

export const CLEAN_GOOD = '#22c55e';
export const CLEAN_MID = '#eab308';
export const CLEAN_BAD = '#ef4444';

/** ≥80 зелёный, 50–79 жёлтый, <50 красный (ТЗ §8). */
export function cleanColor(score: number): string {
  return score >= 80 ? CLEAN_GOOD : score >= 50 ? CLEAN_MID : CLEAN_BAD;
}

export const rgba = (hex: string, a = 255): [number, number, number, number] => {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, a];
};

export const NEUTRAL_SITE = '#2dd4bf';
