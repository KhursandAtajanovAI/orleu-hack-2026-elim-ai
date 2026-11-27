'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { rpc, type Any } from '@/lib/rpc';
import { compressImage } from '@/lib/image';
import { detect, loadModel, toAiResult } from '@/lib/wasteAi';

type Tab = 'photo' | 'barcode' | 'report';
const BINS = ['plastic', 'paper', 'glass', 'metal', 'organic', 'mixed'] as const;
const REPORT_TYPES = ['mixed', 'overflow', 'dump', 'other'] as const;

async function uploadPhoto(uid: string, blob: Blob, folder: string): Promise<string | null> {
  const path = `${uid}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const up = await supabase().storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  return up.error ? null : supabase().storage.from('photos').getPublicUrl(path).data.publicUrl;
}
const here = () => new Promise<{ lon: number; lat: number } | null>((res) => {
  if (!navigator.geolocation) return res(null);
  navigator.geolocation.getCurrentPosition((p) => res({ lon: p.coords.longitude, lat: p.coords.latitude }), () => res(null), { timeout: 8000 });
});

/**
 * Житель (ТЗ 5): фото предмета или контейнера → ИИ в браузере → в какой контейнер и что из этого сделают;
 * штрихкод упаковки → база упаковок; жалоба с фото и местом. Без входа — только подсказка, со входом — сохраняется.
 */
export default function Scan() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('photo');
  useEffect(() => { const h = window.location.hash.slice(1) as Tab; if (['photo', 'barcode', 'report'].includes(h)) setTab(h); }, []);
  const go = (x: Tab) => { setTab(x); window.history.replaceState(null, '', '#' + x); };
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('res.title')}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('res.intro')}</p>
      </div>
      <nav className="grid grid-cols-3 gap-2">
        {(['photo', 'barcode', 'report'] as Tab[]).map((x) => (
          <button key={x} className={`${x === tab ? 'btn-primary' : 'btn-ghost'} py-3`} onClick={() => go(x)}>{t('res.tab.' + x)}</button>
        ))}
      </nav>
      {tab === 'photo' ? <PhotoScan /> : tab === 'barcode' ? <Barcode /> : <Report />}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Link href="/recycling/" className="card text-center hover:border-brand">♻ {t('modules.recycling')}</Link>
        <Link href="/bonuses/" className="card text-center hover:border-brand">★ {t('modules.bonuses')}</Link>
      </div>
    </div>
  );
}

function useRules() {
  const [rules, setRules] = useState<Any[]>([]);
  useEffect(() => { rpc<Any[]>('waste_rules_list').then(setRules).catch(() => setRules([])); }, []);
  return rules;
}

function PhotoScan() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const rules = useRules();
  const [mode, setMode] = useState<'item' | 'container'>('item');
  const [container, setContainer] = useState<string>('plastic');
  const [img, setImg] = useState<string | null>(null);
  const [res, setRes] = useState<Any | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'busy' | 'ready'>('idle');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const busyRef = useRef(false);

  useEffect(() => { setState('loading'); loadModel().then(() => setState('ready')).catch((e) => { setErr(e.message); setState('idle'); }); }, []);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setRes(null); setSaved(false);
    const blob = await compressImage(f);
    blobRef.current = blob;
    setImg(URL.createObjectURL(blob));
  };
  const run = async () => {
    const el = imgRef.current;
    if (!el || !el.complete || !el.naturalWidth || busyRef.current) return;
    busyRef.current = true;
    setState('busy'); setErr('');
    try {
      const { dets, ms, brightness } = await detect(el);
      if (brightness < 35) throw new Error(t('res.tooDark'));
      if (dets.length === 0 && mode === 'item') throw new Error(t('res.nothing'));
      const r = toAiResult(dets, rules, mode, mode === 'container' ? container : undefined, ms);
      setRes(r);
      if (session) {
        const uid = session.user.id;
        const pos = await here();
        const url = blobRef.current ? await uploadPhoto(uid, blobRef.current, 'scans') : null;
        await rpc('scan_create', { p_mode: mode, p_photo_url: url, p_ai_result: r, p_container_type: mode === 'container' ? container : null,
          p_lon: pos?.lon ?? null, p_lat: pos?.lat ?? null }).then(() => setSaved(true)).catch(() => {});
      }
    } catch (e) { setErr((e as Error).message); }
    busyRef.current = false;
    setState('ready');
  };
  // модель догрузилась уже после выбора фото
  useEffect(() => { if (img && state === 'ready' && !res && !err) run(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = (o: Any | undefined, f: string) => o?.[`${f}_${lang}`] ?? o?.[`${f}_ru`];
  const rule = (cls: string) => rules.find((r) => r.ai_class === cls);
  const top = res?.items?.[0];

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div className="flex gap-2">
          {(['item', 'container'] as const).map((m) => (
            <button key={m} className={`${m === mode ? 'btn-primary' : 'btn-ghost'} flex-1 py-1.5 text-sm`} onClick={() => { setMode(m); setRes(null); }}>{t('res.mode.' + m)}</button>
          ))}
        </div>
        {mode === 'container' && (
          <label className="block text-sm">{t('res.whichBin')}
            <select className="input" value={container} onChange={(e) => { setContainer(e.target.value); setRes(null); }}>
              {BINS.map((b) => <option key={b} value={b}>{t('waste.' + b)}</option>)}
            </select>
          </label>
        )}
        <label className="btn-primary block cursor-pointer py-4 text-center text-lg">
          📷 {t('res.takePhoto')}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <p className="text-xs text-slate-500">{state === 'loading' ? t('res.modelLoading') : t('res.modelReady')}</p>
      </div>

      {img && (
        <div className="card space-y-2">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={img} alt="" className="w-full rounded-lg" onLoad={() => { if (state === 'ready') run(); }} />
            {res?.items?.map((i: Any, k: number) => {
              const el = imgRef.current; if (!el) return null;
              const sx = el.clientWidth / el.naturalWidth, sy = el.clientHeight / el.naturalHeight;
              return (
                <div key={k} className="pointer-events-none absolute rounded border-2" style={{ left: i.box[0] * sx, top: i.box[1] * sy, width: (i.box[2] - i.box[0]) * sx, height: (i.box[3] - i.box[1]) * sy, borderColor: i.correct === false ? '#dc2626' : (i.color ?? '#0f766e') }}>
                  <span className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-xs text-white" style={{ background: i.correct === false ? '#dc2626' : (i.color ?? '#0f766e') }}>{L(i, 'label')} {Math.round(i.confidence * 100)}%</span>
                </div>
              );
            })}
          </div>
          {state === 'busy' && <p className="text-sm text-slate-500">{t('res.analyzing')}</p>}
          {err && <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{err}</div>}
        </div>
      )}

      {res && mode === 'item' && top && (() => {
        const r = rule(top.class);
        return (
          <div className="card space-y-2" style={{ borderColor: r?.color ?? undefined, borderWidth: 2 }}>
            <div className="text-sm text-slate-500">{L(top, 'label')} · {Math.round(top.confidence * 100)}%</div>
            {r?.special_handling ? <div className="text-xl font-bold text-amber-700">⚠ {t('rcy.special')}</div>
              : <div className="text-2xl font-bold">→ {t('res.binIs')} «{t('waste.' + top.bin)}»</div>}
            {L(r, 'hint') && <p className="text-sm">{L(r, 'hint')}</p>}
            {r?.is_recyclable && L(r, 'usage') && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">♻ {t('rcy.becomes')}: {L(r, 'usage')}</p>}
            {res.items.length > 1 && <p className="text-xs text-slate-500">{t('res.alsoFound')}: {res.items.slice(1).map((i: Any) => `${L(i, 'label')} → ${t('waste.' + i.bin)}`).join(' · ')}</p>}
          </div>
        );
      })()}
      {res && mode === 'container' && (
        <div className="card space-y-1">
          <div className="text-sm text-slate-500">{t('res.contamination')}</div>
          <div className={`text-3xl font-bold ${(res.contamination_pct ?? 0) > 20 ? 'text-red-600' : 'text-emerald-600'}`}>{res.contamination_pct ?? 0}%</div>
          {res.items.filter((i: Any) => i.correct === false).map((i: Any, k: number) => (
            <p key={k} className="text-sm">✕ {L(i, 'label')} → {t('waste.' + i.bin)}</p>
          ))}
          {res.items.length > 0 && res.items.every((i: Any) => i.correct) && <p className="text-sm text-emerald-700">✓ {t('res.allGood')}</p>}
        </div>
      )}
      {res && <p className="text-xs text-slate-500">{res.model_version} · {res.latency_ms} мс · {session ? (saved ? t('res.saved') : '') : t('res.guest')}</p>}
    </div>
  );
}

function Barcode() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const [code, setCode] = useState('');
  const [res, setRes] = useState<Any | null>(null);
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const L = (o: Any | undefined, f: string) => o?.[`${f}_${lang}`] ?? o?.[`${f}_ru`];

  const lookup = async (g: string) => {
    setErr(''); setRes(null);
    try {
      const pos = session ? await here() : null;
      const r = session
        ? await rpc<Any>('package_scan', { p_gtin: g, p_lat: pos?.lat ?? null, p_lon: pos?.lon ?? null, p_client_id: crypto.randomUUID() }).then((x) => x.package ?? { gtin: g, found: false })
        : await rpc<Any>('package_lookup', { p_gtin: g });
      setRes(r);
    } catch (e) { setErr((e as Error).message); }
  };
  const scan = async () => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: Any) => Any }).BarcodeDetector;
    if (!BD) { setErr(t('res.noScanner')); return; }
    setScanning(true);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).catch(() => null);
    if (!stream || !video.current) { setScanning(false); return; }
    video.current.srcObject = stream; await video.current.play();
    const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const stop = () => { stream.getTracks().forEach((x) => x.stop()); setScanning(false); };
    for (let i = 0; i < 150; i++) {
      const found = await det.detect(video.current).catch(() => []);
      if (found[0]?.rawValue) { stop(); setCode(found[0].rawValue); lookup(found[0].rawValue); return; }
      await new Promise((r) => setTimeout(r, 200));
    }
    stop();
  };

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <button className="btn-primary w-full py-3" onClick={scan} disabled={scanning}>▥ {t('res.scanBarcode')}</button>
        <video ref={video} className={scanning ? 'w-full rounded-lg' : 'hidden'} muted playsInline />
        <div className="flex gap-2">
          <input className="input" inputMode="numeric" placeholder={t('res.barcodePh')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn-ghost" disabled={code.length < 8} onClick={() => lookup(code)}>{t('res.find')}</button>
        </div>
        <p className="text-xs text-slate-500">{t('res.barcodeHint')}</p>
      </div>
      {err && <div className="card text-sm text-amber-800">{err}</div>}
      {res && (res.found === false ? <div className="card text-sm">{t('res.notInBase')}</div> : (
        <div className="card space-y-1" style={{ borderColor: res.rule?.color ?? undefined, borderWidth: 2 }}>
          <div className="font-semibold">{res.name ?? res.gtin}</div>
          <div className="text-xs text-slate-500">{[res.brand, res.quantity, res.gtin].filter(Boolean).join(' · ')}</div>
          <div className="text-sm">{t('res.material')}: {L(res.rule, 'label')}</div>
          {res.rule?.special_handling ? <div className="text-lg font-bold text-amber-700">⚠ {t('rcy.special')}</div>
            : <div className="text-xl font-bold">→ {t('res.binIs')} «{t('waste.' + res.rule?.bin)}»</div>}
          {L(res.rule, 'hint') && <p className="text-sm">{L(res.rule, 'hint')}</p>}
        </div>
      ))}
    </div>
  );
}

function Report() {
  const { t } = useI18n();
  const { session } = useAuth();
  const [type, setType] = useState<string>('mixed');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lon: number; lat: number } | null>(null);
  const [sites, setSites] = useState<Any[]>([]);
  const [site, setSite] = useState('');
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    here().then((p) => {
      setPos(p);
      if (p) rpc<Any[]>('nearest_sites', { p_lon: p.lon, p_lat: p.lat, p_limit: 5 }).then((s) => { setSites(s); if (s[0] && s[0].distance_m < 300) setSite(s[0].id); }).catch(() => {});
    });
  }, []);
  if (!session) return <div className="card">{t('res.loginToReport')} <Link className="text-brand underline" href="/login/">{t('app.login')}</Link></div>;

  const send = async () => {
    if (!photo) return;
    setBusy(true); setMsg(null);
    try {
      const url = await uploadPhoto(session.user.id, photo, 'reports');
      const s = sites.find((x) => x.id === site);
      const p = pos ?? (s ? { lon: s.location?.lon, lat: s.location?.lat } : null);
      if (!p) throw new Error(t('res.noGeo'));
      await rpc('report_create', { p_type: type, p_photo_url: url ?? '', p_lon: p.lon, p_lat: p.lat, p_site_id: site || null, p_comment: comment || null, p_client_id: crypto.randomUUID() });
      setMsg({ ok: true, text: t('res.reportSent') });
      setPhoto(null); setPreview(null); setComment('');
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };

  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {REPORT_TYPES.map((x) => (
          <button key={x} className={`${x === type ? 'btn-primary' : 'btn-ghost'} py-2 text-sm`} onClick={() => setType(x)}>{t('res.rt.' + x)}</button>
        ))}
      </div>
      <label className="btn-ghost block cursor-pointer py-3 text-center">
        📷 {preview ? t('res.retake') : t('res.addPhoto')}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const b = await compressImage(f); setPhoto(b); setPreview(URL.createObjectURL(b)); } }} />
      </label>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="" className="max-h-64 w-full rounded-lg object-cover" />}
      <label className="block text-sm">{t('res.site')}
        <select className="input" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">{pos ? t('res.noSite') : t('res.noGeo')}</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.address} · {Math.round(s.distance_m)} м</option>)}
        </select>
      </label>
      <input className="input" placeholder={t('res.comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
      <button className="btn-primary w-full py-3" disabled={!photo || busy || (!pos && !site)} onClick={send}>{t('res.send')}</button>
      {msg && <div className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</div>}
    </div>
  );
}
