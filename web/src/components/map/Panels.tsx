'use client';
import type {
  MapComplaint,
  MapFacility,
  MapSite,
  MapVehicle,
  OutputType,
  SitePath,
} from '@/lib/contracts';
import { useI18n } from '@/lib/i18n';
import { LANDMARKS, landmarkDesc, landmarkName } from './landmarks';
import {
  CLEAN_BAD,
  CLEAN_GOOD,
  CLEAN_MID,
  COMPLAINT_STATUS_COLOR,
  FACILITY_COLOR,
  OUTCOME_COLOR,
  WASTE_COLOR,
  cleanColor,
} from './constants';

export type Selection =
  | { kind: 'site'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'complaint'; id: string }
  | { kind: 'landmark'; id: string };

export interface LayerState {
  sites: boolean;
  facilities: boolean;
  vehicles: boolean;
  complaints: boolean;
  cleanliness: boolean;
  heat: boolean;
  landmarks: boolean;
  osm: boolean;
  models: boolean;
}

const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-brand/5 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}

export function ObjectCard(props: {
  site?: MapSite;
  facility?: MapFacility;
  vehicle?: MapVehicle;
  complaint?: MapComplaint;
  landmark?: string;
  onClose: () => void;
  onPath: (s: MapSite) => void;
  onWorkshop: (f: MapFacility) => void;
}) {
  const { t } = useI18n();
  const { site, facility, vehicle, complaint, landmark } = props;
  return (
    <div className="glass pointer-events-auto w-full rounded-2xl p-4 shadow-xl sm:w-[340px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {site && (
            <>
              <div className="truncate text-base font-semibold">{site.address}</div>
              <div className="text-xs text-muted">{site.complex}</div>
            </>
          )}
          {facility && (
            <>
              <div className="text-base font-semibold leading-snug">{facility.name}</div>
              <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: FACILITY_COLOR[facility.type] }} />
                {t(`facility.${facility.type}` as 'facility.sorting')}
              </div>
            </>
          )}
          {vehicle && (
            <>
              <div className="text-base font-semibold">{vehicle.plate}</div>
              <div className="text-xs text-muted">{vehicle.type}</div>
            </>
          )}
          {landmark && <div className="text-base font-semibold">{t(landmarkName(landmark))}</div>}
          {complaint && (
            <div className="text-base font-semibold">
              {t(`complaint.type.${complaint.type}` as 'complaint.type.mixed')}
            </div>
          )}
        </div>
        <button aria-label={t('common.close')} onClick={props.onClose} className="h-8 w-8 shrink-0 rounded-lg text-lg text-muted hover:bg-brand/10">
          ×
        </button>
      </div>

      {landmark && (
        <div className="mt-2 space-y-2 text-sm">
          <p>{t(landmarkDesc(landmark))}</p>
          <p className="text-xs text-muted">{t('landmark.model_note')}</p>
        </div>
      )}

      {site && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat
              label={t('card.cleanliness')}
              value={
                <span style={{ color: cleanColor(site.cleanliness_score) }}>{site.cleanliness_score}</span>
              }
            />
            <Stat label={t('card.week_kg')} value={`${site.week_kg} ${t('common.kg')}`} />
          </div>
          <div className="mt-2 text-xs text-muted">
            {t('card.last_pickup')}: {site.last_pickup_at ? fmtTime(site.last_pickup_at) : t('card.never')}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {site.containers.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-xs"
                title={`${c.volume_l} л`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: WASTE_COLOR[c.waste_type] }} />
                {t(`waste.${c.waste_type}` as 'waste.mixed')} · {c.fill_level}%
              </span>
            ))}
          </div>
          <button className="btn btn-primary mt-4 w-full" onClick={() => props.onPath(site)}>
            {t('card.btn.path')} →
          </button>
        </>
      )}

      {facility && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label={t('card.week_tons')} value={`${facility.week_tons} ${t('common.t')}`} />
            <Stat label={t('card.capacity')} value={`${facility.capacity_tpd} ${t('card.tpd')}`} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {facility.accepts.map((w) => (
              <span key={w} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: WASTE_COLOR[w] }} />
                {t(`waste.${w}` as 'waste.mixed')}
              </span>
            ))}
          </div>
          {facility.type === 'sorting' && (
            <button className="btn btn-primary mt-4 w-full" onClick={() => props.onWorkshop(facility)}>
              {t('card.btn.workshop')} →
            </button>
          )}
        </>
      )}

      {vehicle && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label={t('card.carrier')} value={<span className="text-sm">{vehicle.carrier}</span>} />
          <Stat label={t('card.speed')} value={`${Math.round(vehicle.speed)} ${t('common.kmh')}`} />
          <div className="col-span-2 flex items-center gap-2 text-xs text-muted">
            {t('card.trip_waste')}:
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: WASTE_COLOR[vehicle.waste_type] }} />
            {t(`waste.${vehicle.waste_type}` as 'waste.mixed')}
          </div>
        </div>
      )}

      {complaint && (
        <div className="mt-3 space-y-2">
          <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted">
            {complaint.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={complaint.photo_url} alt="" className="h-full w-full rounded-xl object-cover" />
            ) : (
              t('card.photo_stub')
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COMPLAINT_STATUS_COLOR[complaint.status] }} />
            {t(`complaint.status.${complaint.status}` as 'complaint.status.new')}
          </div>
          {complaint.comment && <div className="text-sm">{complaint.comment}</div>}
          <div className="text-xs text-muted">
            {t('card.complaint_when')}: {fmtTime(complaint.created_at)}
          </div>
        </div>
      )}
    </div>
  );
}

export function LayerPanel(props: {
  layers: LayerState;
  onToggle: (k: keyof LayerState) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  onLandmark?: (id: string) => void;
}) {
  const { t } = useI18n();
  const keys: Array<[keyof LayerState, 'layer.sites']> = [
    ['sites', 'layer.sites'],
    ['facilities', 'layer.facilities' as 'layer.sites'],
    ['vehicles', 'layer.vehicles' as 'layer.sites'],
    ['complaints', 'layer.complaints' as 'layer.sites'],
    ['cleanliness', 'layer.cleanliness' as 'layer.sites'],
    ['heat', 'layer.heat' as 'layer.sites'],
    ['landmarks', 'layer.landmarks' as 'layer.sites'],
    ['osm', 'layer.osm' as 'layer.sites'],
    ['models', 'layer.models' as 'layer.sites'],
  ];
  return (
    <div className="glass pointer-events-auto w-[min(290px,calc(100vw-24px))] rounded-2xl shadow-lg">
      <button
        className="flex w-full items-center justify-between gap-6 px-4 py-2.5 text-sm font-semibold"
        onClick={() => props.setOpen(!props.open)}
        aria-expanded={props.open}
      >
        {t('map.layers')}
        <span className="text-muted">{props.open ? '▾' : '▸'}</span>
      </button>
      {props.open && (
        <div className="space-y-0.5 px-2 pb-2">
          {keys.map(([k, label]) => (
            <label key={k} className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-brand/10">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-500"
                checked={props.layers[k]}
                onChange={() => props.onToggle(k)}
              />
              {t(label)}
            </label>
          ))}
          {props.layers.landmarks && (
            <div className="flex flex-wrap gap-1 border-t border-line px-1 pt-2">
              {LANDMARKS.map((l) => (
                <button key={l.id} onClick={() => props.onLandmark?.(l.id)} className="rounded-full border border-line px-2 py-1 text-[11px] hover:border-brand">
                  {t(landmarkName(l.id))}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1 border-t border-line px-2 pt-2 text-xs text-muted">
            {[
              [CLEAN_GOOD, 'legend.good'],
              [CLEAN_MID, 'legend.mid'],
              [CLEAN_BAD, 'legend.bad'],
            ].map(([c, k]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                {t(k as 'legend.good')}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Donut({ parts }: { parts: Array<{ value: number; color: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let acc = 0;
  const r = 36;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="14" />
      {parts.map((p, i) => {
        const len = (p.value / total) * c;
        const el = (
          <circle
            key={i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={p.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-acc}
          />
        );
        acc += len;
        return el;
      })}
    </svg>
  );
}

export function PathPanel(props: {
  loading: boolean;
  data: SitePath | null;
  onExit: () => void;
  onReplay: () => void;
  onWorkshop: (facilityId: string) => void;
}) {
  const { t } = useI18n();
  const trip = props.data?.trips[0];
  const outcomes = trip
    ? (['recycling', 'buyer', 'energy', 'landfill'] as const).map((k) => ({
        k,
        kg: trip.outputs.filter((o) => o.outcome === k).reduce((s, o) => s + o.weight_kg, 0),
      }))
    : [];
  const total = trip?.batch.weight_kg ?? 0;
  const recycled = outcomes.filter((o) => o.k === 'recycling' || o.k === 'buyer').reduce((s, o) => s + o.kg, 0);
  const step = (n: number, title: string, body: React.ReactNode, warn = false) => (
    <li className="relative pl-8">
      <span
        className={`absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
          warn ? 'bg-red-500 text-white' : 'bg-brand text-[#052e1f]'
        }`}
      >
        {n}
      </span>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-muted">{body}</div>
    </li>
  );

  return (
    <div className="glass pointer-events-auto flex max-h-[70vh] w-full flex-col rounded-2xl shadow-xl sm:w-[360px]">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div>
          <div className="text-base font-semibold">{t('path.title')}</div>
          {props.data && <div className="truncate text-xs text-muted">{props.data.site.address}</div>}
        </div>
        <button className="btn !min-h-[36px] !px-3 !py-1.5 text-xs" onClick={props.onExit}>
          {t('path.exit')}
        </button>
      </div>
      <div className="overflow-y-auto px-4 pb-4 pt-3">
        {props.loading && <div className="py-6 text-sm text-muted">{t('path.loading')}</div>}
        {!props.loading && !trip && <div className="py-6 text-sm text-muted">{t('path.empty')}</div>}
        {trip && props.data && (
          <>
            {trip.mixed_flag && (
              <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-400">
                ⚠ {t('path.mixed_warning')}
              </div>
            )}
            {trip.route_deviation && (
              <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-400">
                ⚠ {t('path.deviation_warning')}
              </div>
            )}
            <ol className="space-y-3">
              {step(
                1,
                t('path.step.container'),
                `${props.data.site.containers.length} · ${t('card.cleanliness')} ${props.data.site.cleanliness_score}`,
              )}
              {step(
                2,
                t('path.step.picked'),
                `${fmtTime(trip.pickups[0]?.picked_at)} · ${t('path.contamination')} ${Math.round(
                  trip.pickups.reduce((s, p) => s + p.contamination_pct, 0) / Math.max(1, trip.pickups.length),
                )}%`,
                trip.mixed_flag,
              )}
              {step(3, t('path.step.transit'), `${trip.vehicle_plate} · ${trip.carrier}`)}
              {step(
                4,
                t('path.step.received'),
                `${trip.destination.name} · ${trip.batch.weight_kg} ${t('common.kg')} · ${fmtTime(trip.batch.received_at)}`,
              )}
              {step(
                5,
                t('path.step.sorted'),
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {trip.outputs.map((o) => (
                    <span key={o.output_type}>
                      {t(`output.${o.output_type as OutputType}` as 'output.PET')} {o.weight_kg}
                    </span>
                  ))}
                </span>,
              )}
              {step(
                6,
                t('path.step.result'),
                <div className="mt-2 flex items-center gap-3">
                  <Donut parts={outcomes.map((o) => ({ value: o.kg, color: OUTCOME_COLOR[o.k] }))} />
                  <div className="space-y-1">
                    {outcomes.map((o) => (
                      <div key={o.k} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: OUTCOME_COLOR[o.k] }} />
                        {t(`path.outcome.${o.k}` as 'path.outcome.energy')}: {o.kg} {t('common.kg')}
                      </div>
                    ))}
                    <div className="pt-1 font-semibold text-ink">
                      {t('path.share_recycled')}: {Math.round((recycled / Math.max(1, total)) * 100)}%
                    </div>
                  </div>
                </div>,
              )}
            </ol>
            <div className="mt-4 flex gap-2">
              <button className="btn flex-1 text-xs" onClick={props.onReplay}>
                ↻ {t('path.replay')}
              </button>
              <button className="btn btn-primary flex-1 text-xs" onClick={() => props.onWorkshop(trip.destination.id)}>
                {t('path.view_workshop')} →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
