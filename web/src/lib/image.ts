'use client';
/** Сжатие фото на телефоне (ТЗ 1): длинная сторона ≤ 1280 px, файл ≤ 1 МБ, JPEG. */
export async function compressImage(file: Blob, maxSide = 1280, maxBytes = 1_000_000): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.85, 0.75, 0.6, 0.45]) {
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
    if (b && (b.size <= maxBytes || q === 0.45)) return b;
  }
  return file;
}

/** Расстояние между точками, м (гаверсинус) */
export function distanceM(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const R = 6_371_000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
