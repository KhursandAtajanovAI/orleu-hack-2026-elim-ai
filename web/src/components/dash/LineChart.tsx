'use client';
import { useState } from 'react';

export interface Series { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean }

/** Линейный график без библиотек (SVG): несколько линий по дням, подсказка при наведении. */
export default function LineChart({ labels, series, unit = '', height = 240 }: {
  labels: string[]; series: Series[]; unit?: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, L = 44, R = 12, T = 12, B = 28;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const maxRaw = Math.max(1e-9, ...all);
  const step = niceStep(maxRaw / 4);
  const max = Math.ceil(maxRaw / step) * step || 1;
  const n = Math.max(labels.length, 1);
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const every = Math.ceil(n / 8);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
        }}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={L} x2={W - R} y1={y(tv)} y2={y(tv)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />
            <text x={L - 6} y={y(tv) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">{+tv.toFixed(3)}</text>
          </g>
        ))}
        {labels.map((lb, i) => i % every === 0 || i === n - 1 ? (
          <text key={lb + i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">{lb}</text>
        ) : null)}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`));
          const segs: string[][] = [[]];
          pts.forEach((p) => (p ? segs[segs.length - 1].push(p) : segs.push([])));
          return (
            <g key={s.key}>
              {segs.filter((sg) => sg.length).map((sg, k) => (
                <polyline key={k} points={sg.join(' ')} fill="none" stroke={s.color} strokeWidth={2.5}
                  strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {s.values.map((v, i) => v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 2.5} fill={s.color} />
              ))}
            </g>
          );
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-slate-400" strokeDasharray="3 3" />}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow dark:border-slate-700 dark:bg-slate-900/95"
          style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
          <div className="mb-1 font-semibold">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}: <b>{s.values[hover] == null ? '—' : `${s.values[hover]} ${unit}`}</b>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-5" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
