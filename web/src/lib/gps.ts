'use client';
import type { GpsPoint } from '@kaida/contracts';
import { supabase } from './supabase';

/**
 * GPS водителя (ТЗ 10.1): точка с телефона → буфер; раз в 10 с буфер уходит пачкой
 * (trip_add_positions). Без сети точки копятся в localStorage и уходят, когда связь вернётся.
 */
const KEY = (tripId: string) => `kaida-gps-${tripId}`;

export class GpsTracker {
  private watch: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf: GpsPoint[] = [];
  private sending = false;
  last: (GpsPoint & { accuracy?: number }) | null = null;
  sent = 0;
  onUpdate: () => void = () => {};

  constructor(private tripId: string) {
    try { this.buf = JSON.parse(localStorage.getItem(KEY(tripId)) ?? '[]'); } catch { this.buf = []; }
  }

  get pending() { return this.buf.length; }

  start() {
    if (this.watch != null || !('geolocation' in navigator)) return;
    this.watch = navigator.geolocation.watchPosition((p) => {
      const pt: GpsPoint & { accuracy?: number } = {
        lon: +p.coords.longitude.toFixed(6), lat: +p.coords.latitude.toFixed(6),
        speed: p.coords.speed != null ? Math.round(p.coords.speed * 3.6) : undefined,
        heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? Math.round(p.coords.heading) : undefined,
        recorded_at: new Date(p.timestamp).toISOString(), accuracy: p.coords.accuracy,
      };
      this.last = pt;
      const prev = this.buf[this.buf.length - 1];
      // не чаще раза в 5 с — сервер всё равно хранит точку раз в несколько секунд
      if (!prev || new Date(pt.recorded_at!).getTime() - new Date(prev.recorded_at!).getTime() >= 5000) {
        const { accuracy: _a, ...clean } = pt; // eslint-disable-line @typescript-eslint/no-unused-vars
        this.buf.push(clean);
        this.persist();
      }
      this.onUpdate();
    }, () => this.onUpdate(), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    this.timer = setInterval(() => this.flush(), 10_000);
  }

  /** Добавить точку вручную (демо без GPS: «я у площадки») */
  push(p: GpsPoint) {
    this.last = p;
    this.buf.push({ ...p, recorded_at: p.recorded_at ?? new Date().toISOString() });
    this.persist();
    this.onUpdate();
  }

  async flush(): Promise<void> {
    if (this.sending || !this.buf.length || !navigator.onLine) return;
    this.sending = true;
    const batch = this.buf.slice(0, 500);
    try {
      const { error } = await supabase().rpc('trip_add_positions', { p_trip_id: this.tripId, p_points: batch });
      if (!error || /CONFLICT|NOT_FOUND/.test(error.message)) {
        this.buf = this.buf.slice(batch.length);
        if (!error) this.sent += batch.length;
        this.persist();
      }
    } catch { /* нет сети — попробуем через 10 с */ }
    this.sending = false;
    this.onUpdate();
  }

  async stop() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    if (this.timer) clearInterval(this.timer);
    this.watch = null; this.timer = null;
    await this.flush();
  }

  private persist() {
    try { localStorage.setItem(KEY(this.tripId), JSON.stringify(this.buf)); } catch { /* квота */ }
  }
}
