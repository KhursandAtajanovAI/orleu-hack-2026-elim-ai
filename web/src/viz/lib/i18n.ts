'use client';
import { useCallback } from 'react';
import { useI18n as useAppI18n, type Lang } from '@/lib/i18n';
import { ru, type MessageKey } from './messages/ru';
import { kk } from './messages/kk';

export type { Lang };
const dict: Record<Lang, Partial<Record<MessageKey, string>>> = { ru, kk };

/**
 * Тексты 3D-карты и 3D-цеха (потоки D, E) — свои словари messages/{ru,kk}.ts,
 * а язык общий с остальным приложением (переключатель в шапке).
 */
export function useI18n() {
  const { lang, setLang } = useAppI18n();
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      let s = dict[lang][key] ?? ru[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );
  return { t, lang, setLang };
}
