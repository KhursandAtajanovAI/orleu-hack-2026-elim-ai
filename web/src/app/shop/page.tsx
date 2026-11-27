'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { rpc, type Any } from '@/lib/rpc';
import { fmt, fmtDate } from '@/lib/dashboard';

/**
 * Магазин бонусов (ТЗ 13): наши продукты из переработанного сырья и скидки партнёров (промокод).
 * Оплата бонусами полностью или частично — остаток в тенге (1 бонус = 1 ₸).
 */
export default function Shop() {
  const { t, lang } = useI18n();
  const { session, me, refresh } = useAuth();
  const [items, setItems] = useState<Any[]>([]);
  const [orders, setOrders] = useState<Any[]>([]);
  const [balance, setBalance] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase().from('listings').select('*, partner:partners(name, kind, terms)')
      .eq('kind', 'shop_product').eq('status', 'active').order('price_bonus');
    setItems(data ?? []);
    if (session) {
      setOrders(await rpc<Any[]>('my_orders').catch(() => []));
      setBalance(Number((await rpc<Any>('me_bonuses', { p_limit: 1 }).catch(() => ({ balance: 0 }))).balance ?? 0));
    }
  }, [session]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (me) setBalance(Number(me.bonus_balance ?? 0)); }, [me]);

  const ours = items.filter((x) => !x.partner_id);
  const partners = items.filter((x) => x.partner_id);
  const done = async () => { await load(); await refresh(); };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{t('shop.title')}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('shop.intro')}</p>
        </div>
        {session ? (
          <Link href="/bonuses/" className="card py-2 text-right">
            <div className="text-xs text-slate-500">{t('bon.balance')}</div>
            <div className="text-xl font-bold text-brand">{fmt(balance)}</div>
          </Link>
        ) : <div className="text-sm">{t('shop.needLogin')} <Link className="text-brand underline" href="/login/">{t('app.login')}</Link></div>}
      </div>

      {[['ours', ours], ['partners', partners]].map(([k, list]) => (list as Any[]).length > 0 && (
        <section key={k as string} className="space-y-2">
          <h2 className="text-lg font-semibold">{t('shop.' + k)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(list as Any[]).map((x) => <Item key={x.id} item={x} lang={lang} balance={balance} canBuy={!!session} onDone={done} />)}
          </div>
        </section>
      ))}

      {session && (
        <section className="card space-y-2">
          <h2 className="font-semibold">{t('shop.orders')}</h2>
          {orders.filter((o) => o.details?.bonus != null).length === 0 ? <p className="text-sm text-slate-500">{t('shop.noOrders')}</p> : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {orders.filter((o) => o.details?.bonus != null).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="flex-1 font-medium">{o.details.title}</span>
                  {o.details.promo_code && <code className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800">{o.details.promo_code}</code>}
                  <span className="text-slate-500">−{fmt(o.details.bonus)} {Number(o.details.money) > 0 && `+ ${fmt(o.details.money)} ₸`}</span>
                  <span className="text-xs text-slate-400">{fmtDate(o.created_at)} · {t('shop.status.' + o.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Item({ item, lang, balance, canBuy, onDone }: { item: Any; lang: string; balance: number; canBuy: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const price = Number(item.price_bonus);
  const partnerOffer = item.partner?.terms?.[lang === 'kk' ? 'offer_kk' : 'offer_ru'];
  const isPromo = Number(item.price ?? 0) === 0;
  const [pay, setPay] = useState(Math.min(price, balance));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setPay(Math.min(price, balance)), [price, balance]);
  const need = isPromo ? price : pay;
  const rest = isPromo ? 0 : Math.max(0, Number(item.price ?? price) * (1 - pay / price));

  const buy = async () => {
    setBusy(true); setRes(null);
    try {
      const o = await rpc<Any>('shop_redeem', { p_listing_id: item.id, p_bonus: need, p_client_id: crypto.randomUUID() });
      setRes({ ok: true, text: o.details?.promo_code ? `${t('shop.promo')}: ${o.details.promo_code}` : t('shop.done') });
      onDone();
    } catch (e) { setRes({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };

  return (
    <div className="card flex flex-col gap-2">
      <div className="font-semibold">{item.title}</div>
      {item.partner && <div className="text-xs text-slate-500">{item.partner.name}</div>}
      <div className="text-sm text-slate-600 dark:text-slate-300">{partnerOffer ?? item.description}</div>
      <div className="mt-auto text-sm">
        {isPromo ? <span className="font-semibold text-brand">{fmt(price)} {t('bon.unit')}</span>
          : <span>{t('shop.price')}: <b>{fmt(Number(item.price))} ₸</b> · {t('bon.unit')}: <b className="text-brand">{fmt(price)}</b></span>}
      </div>
      {canBuy && !isPromo && (
        <label className="text-xs text-slate-500">
          {t('shop.payBonus')}: <b>{fmt(pay)}</b> · {t('shop.rest')}: <b>{fmt(rest, 0)} ₸</b>
          <input type="range" className="w-full" min={0} max={Math.min(price, balance)} step={10} value={pay} onChange={(e) => setPay(Number(e.target.value))} />
        </label>
      )}
      {canBuy && (
        <button className="btn-primary" disabled={busy || need > balance} onClick={buy}>
          {need > balance ? t('shop.notEnough') : isPromo ? t('shop.getCode') : t('shop.buy')}
        </button>
      )}
      {res && <div className={`rounded-lg p-2 text-sm ${res.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{res.text}</div>}
    </div>
  );
}
