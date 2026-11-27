'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { rpc, type Any } from '@/lib/rpc';
import { fmt, fmtDate } from '@/lib/dashboard';

const TYPES = ['pet', 'hdpe', 'film', 'paper', 'cardboard', 'glass', 'metal', 'organic', 'rdf'] as const;
type Tab = 'feed' | 'deals' | 'sell';

/**
 * B2B-маркетплейс вторсырья (ТЗ 13): объявления с происхождением (партии → площадки, даты, чистота),
 * заявка покупателя, статусы сделки new → accepted → done / cancelled, объявление оператора из своих партий.
 */
export default function Market() {
  const { t } = useI18n();
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  useEffect(() => { const h = window.location.hash.slice(1) as Tab; if (['feed', 'deals', 'sell'].includes(h)) setTab(h); }, []);
  const go = (x: Tab) => { setTab(x); window.history.replaceState(null, '', '#' + x); };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('mkt.title')}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('mkt.intro')}</p>
      </div>
      <nav className="grid grid-cols-3 gap-2">
        {(['feed', 'deals', 'sell'] as Tab[]).map((x) => (
          <button key={x} className={`${x === tab ? 'btn-primary' : 'btn-ghost'} py-2`} onClick={() => go(x)}>{t('mkt.tab.' + x)}</button>
        ))}
      </nav>
      {tab !== 'feed' && !session ? <div className="card">{t('shop.needLogin')} <Link className="text-brand underline" href="/login/">{t('app.login')}</Link></div>
        : tab === 'feed' ? <Feed /> : tab === 'deals' ? <Deals /> : <Sell onDone={() => go('feed')} />}
    </div>
  );
}

function Feed() {
  const { t } = useI18n();
  const { session } = useAuth();
  const [type, setType] = useState('');
  const [list, setList] = useState<Any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { rpc<Any[]>('market_listings', { p_output_type: type || null }).then(setList).catch(() => setList([])); }, [type]);
  useEffect(load, [load]);

  return (
    <div className="space-y-3">
      <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">{t('mkt.all')}</option>
        {TYPES.map((x) => <option key={x} value={x}>{t('out.' + x)}</option>)}
      </select>
      {!list ? <p>{t('app.loading')}</p> : list.length === 0 ? <div className="card text-slate-500">{t('mkt.empty')}</div> : list.map((l) => (
        <div key={l.id} className="card space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-semibold">{t('out.' + l.output_type)}</span>
            <span className="text-lg">{fmt(Number(l.volume_kg) / 1000, 2)} т</span>
            <span className="ml-auto text-lg font-semibold text-brand">{fmt(Number(l.price_per_t), 0)} ₸/т</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            {l.seller && <span>{t('mkt.seller')}: <b>{l.seller.name}</b></span>}
            {l.cleanliness_pct != null && <span>{t('mkt.cleanliness')}: <b>{fmt(Number(l.cleanliness_pct))}%</b></span>}
            {l.origin?.batches > 0 && (
              <span>{t('mkt.origin')}: {l.origin.batches} {t('mkt.batches')} · {l.origin.sites} {t('mkt.sites')} · {fmtDate(l.origin.from, false)} – {fmtDate(l.origin.to, false)}</span>
            )}
            <span className="text-xs">{t('mkt.status.' + l.status)} · {l.requests} {t('mkt.requests')}</span>
          </div>
          {l.description && <p className="text-sm">{l.description}</p>}
          {session && (open === l.id ? <RequestForm listing={l} onDone={() => { setOpen(null); load(); }} />
            : <button className="btn-ghost" onClick={() => setOpen(l.id)}>{t('mkt.request')}</button>)}
        </div>
      ))}
    </div>
  );
}

function RequestForm({ listing, onDone }: { listing: Any; onDone: () => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(Number(listing.volume_kg));
  const [company, setCompany] = useState('');
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    try {
      await rpc('market_request', { p_listing_id: listing.id, p_amount_kg: amount, p_company: company || null, p_comment: comment || null });
      setMsg({ ok: true, text: t('mkt.sent') });
      setTimeout(onDone, 1200);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 dark:bg-slate-900">
      <label className="text-sm">{t('mkt.amount')}<input className="input" type="number" min={1} max={listing.volume_kg} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
      <label className="text-sm">{t('mkt.company')}<input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></label>
      <label className="text-sm sm:col-span-2">{t('mkt.comment')}<input className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <span className="text-sm">{t('mkt.total')}: <b>{fmt((Number(listing.price_per_t) * amount) / 1000, 0)} ₸</b></span>
        <button className="btn-primary ml-auto" disabled={!(amount > 0)} onClick={send}>{t('mkt.send')}</button>
      </div>
      {msg && <div className={`text-sm sm:col-span-2 ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</div>}
    </div>
  );
}

function Deals() {
  const { t } = useI18n();
  const [d, setD] = useState<{ incoming: Any[]; outgoing: Any[] } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { rpc<{ incoming: Any[]; outgoing: Any[] }>('market_my_deals').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(load, [load]);
  const set = async (id: string, status: string) => {
    setErr('');
    try { await rpc('market_set_status', { p_order_id: id, p_status: status }); load(); } catch (e) { setErr((e as Error).message); }
  };
  if (!d) return <p>{err || t('app.loading')}</p>;
  const row = (o: Any, seller: boolean) => (
    <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="font-medium">{t('out.' + o.listing.output_type)} · {fmt(Number(o.amount_kg) / 1000, 2)} т</span>
      <span className="text-slate-500">{fmt(Number(o.details?.total), 0)} ₸</span>
      {seller && <span className="text-slate-500">{t('mkt.buyer')}: {o.details?.company || o.buyer}</span>}
      {o.details?.comment && <span className="text-xs text-slate-400">«{o.details.comment}»</span>}
      <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{t('mkt.status.' + o.status)}</span>
      {seller && o.status === 'new' && <button className="btn-primary py-1" onClick={() => set(o.id, 'accepted')}>{t('mkt.accept')}</button>}
      {seller && o.status === 'accepted' && <button className="btn-primary py-1" onClick={() => set(o.id, 'done')}>{t('mkt.finish')}</button>}
      {(seller ? ['new', 'accepted'] : ['new']).includes(o.status) && <button className="btn-ghost py-1" onClick={() => set(o.id, 'cancelled')}>{t('mkt.cancel')}</button>}
    </li>
  );
  return (
    <div className="space-y-3">
      {err && <div className="card text-red-700">{err}</div>}
      {[['incoming', d.incoming, true], ['outgoing', d.outgoing, false]].map(([k, list, seller]) => (
        <section key={k as string} className="card">
          <h2 className="font-semibold">{t('mkt.' + k)}</h2>
          {(list as Any[]).length === 0 ? <p className="text-sm text-slate-500">{t('mkt.noDeals')}</p>
            : <ul className="divide-y divide-slate-100 dark:divide-slate-800">{(list as Any[]).map((o) => row(o, seller as boolean))}</ul>}
        </section>
      ))}
    </div>
  );
}

function Sell({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { me, hasRole } = useAuth();
  const [type, setType] = useState<string>('pet');
  const [batches, setBatches] = useState<Any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [volume, setVolume] = useState(0);
  const [price, setPrice] = useState(90000);
  const [warehouse, setWarehouse] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fid = me?.facility_id;

  useEffect(() => {
    if (!fid) return;
    supabase().from('batches').select('id, received_at, weight_kg, batch_outputs(output_type, weight_kg)')
      .eq('facility_id', fid).order('received_at', { ascending: false }).limit(100)
      .then(({ data }) => setBatches(data ?? []));
  }, [fid]);

  const withType = useMemo(() => batches.map((b): Any => ({
    ...b, kg: (b.batch_outputs as Any[]).filter((o) => o.output_type === type).reduce((s, o) => s + Number(o.weight_kg), 0),
  })).filter((b) => b.kg > 0), [batches, type]);
  const avail = withType.filter((b) => sel.has(b.id)).reduce((s, b) => s + b.kg, 0);
  useEffect(() => { setSel(new Set()); }, [type]);
  useEffect(() => { setVolume(Math.round(avail)); }, [avail]);

  if (!hasRole('operator')) return <div className="card text-slate-600">{t('mkt.sellOnly')}</div>;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const publish = async () => {
    try {
      await rpc('market_create_listing', { p_output_type: type, p_volume_kg: volume, p_price_per_t: price, p_batch_ids: [...sel],
        p_warehouse: warehouse || null, p_description: desc || null });
      setMsg({ ok: true, text: t('mkt.published') });
      setTimeout(onDone, 1000);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div className="card space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm">{t('mkt.type')}
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{t('out.' + x)}</option>)}</select>
        </label>
        <label className="text-sm">{t('mkt.volume')}, кг<input className="input" type="number" min={1} value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
        <label className="text-sm">{t('mkt.pricePerT')}<input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
      </div>
      <div>
        <div className="text-sm font-medium">{t('mkt.pickBatches')} · {t('mkt.available')} {fmt(avail)} кг</div>
        {withType.length === 0 ? <p className="text-sm text-slate-500">{t('mkt.noBatches')}</p> : (
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            {withType.map((b) => (
              <label key={b.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm last:border-0 dark:border-slate-800">
                <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />
                <span className="flex-1">{fmtDate(b.received_at)}</span>
                <span className="tabular-nums">{fmt(b.kg)} кг</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">{t('mkt.warehouse')}<input className="input" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} /></label>
        <label className="text-sm">{t('mkt.description')}<input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      </div>
      <button className="btn-primary" disabled={!(volume > 0) || (sel.size > 0 && volume > avail + 0.01)} onClick={publish}>{t('mkt.publish')}</button>
      {msg && <div className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</div>}
    </div>
  );
}
