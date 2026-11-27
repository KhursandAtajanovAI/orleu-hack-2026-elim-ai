'use client';
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

interface Site { id: string; address: string; qr_code: string; residential_complex: string | null }

/**
 * Генерация и печать QR-наклеек (ТЗ 11.3): PDF A4, 8 наклеек на лист.
 * Наклейка рисуется на canvas (кириллица без встраивания шрифтов) → картинка в PDF.
 * QR ведёт на публичную ссылку /s/{qr} — путь отходов без входа (ТЗ 5.4).
 */
async function sticker(site: Site, url: string, hint: string): Promise<string> {
  const W = 900, H = 1100;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0F766E'; g.fillRect(0, 0, W, 150);
  g.fillStyle = '#fff'; g.font = 'bold 72px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('Қайда?', W / 2, 100);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, url, { width: 640, margin: 1, errorCorrectionLevel: 'M' });
  g.drawImage(qr, (W - 640) / 2, 190);
  g.fillStyle = '#0F172A'; g.font = 'bold 44px system-ui, sans-serif';
  const addr = site.address.length > 34 ? site.address.slice(0, 33) + '…' : site.address;
  g.fillText(addr, W / 2, 900);
  g.font = '32px system-ui, sans-serif'; g.fillStyle = '#475569';
  g.fillText(hint, W / 2, 960);
  g.font = '28px monospace'; g.fillText(site.qr_code, W / 2, 1030);
  return c.toDataURL('image/png');
}

export default function QrPanel() {
  const { t } = useI18n();
  const [sites, setSites] = useState<Site[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    setBase(`${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/s/`);
    supabase().from('sites').select('id,address,qr_code,residential_complex').order('address').then(({ data }) => setSites((data as Site[]) ?? []));
  }, []);
  const chosen = useMemo(() => sites.filter((s) => sel.has(s.id)), [sites, sel]);

  useEffect(() => {
    if (chosen[0]) sticker(chosen[0], base + chosen[0].qr_code, t('app.tagline')).then(setPreview);
    else setPreview(null);
  }, [chosen, base, t]);

  async function download() {
    setBusy(true);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const w = 90, h = 110, mx = 10, my = 10, gap = 10;   // 2 × 2 на страницу, ~9×11 см
    const perPage = 4;
    for (let i = 0; i < chosen.length; i++) {
      if (i > 0 && i % perPage === 0) pdf.addPage();
      const k = i % perPage;
      const x = mx + (k % 2) * (w + gap), y = my + Math.floor(k / 2) * (h + gap + 15);
      pdf.addImage(await sticker(chosen[i], base + chosen[i].qr_code, t('app.tagline')), 'PNG', x, y, w, h);
      pdf.setDrawColor(200); pdf.rect(x, y, w, h);
    }
    pdf.save(`kaida-qr-${new Date().toISOString().slice(0, 10)}.pdf`);
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{t('admin.qrHint')}</p>
        <label className="block text-sm">{t('admin.qrBaseUrl')}<input className="input mt-1" value={base} onChange={(e) => setBase(e.target.value)} /></label>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={() => setSel(new Set(sel.size === sites.length ? [] : sites.map((s) => s.id)))}>{t('admin.qrSelectAll')}</button>
          <span className="text-sm">{t('admin.qrSelected')}: {sel.size}</span>
          <button className="btn-primary ml-auto" disabled={!sel.size || busy} onClick={download}>{t('admin.qrDownload')}</button>
        </div>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {sites.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
              <input type="checkbox" checked={sel.has(s.id)} onChange={() => { const n = new Set(sel); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setSel(n); }} />
              <span className="flex-1">{s.address}</span><code className="text-xs text-slate-500">{s.qr_code}</code>
            </label>
          ))}
        </div>
      </div>
      {preview && <img src={preview} alt="QR" className="card w-full" />}
    </div>
  );
}
