'use client';
import { useCallback, useEffect, useState } from 'react';
import { ru, type MessageKey } from './messages/ru';
import { kk } from './messages/kk';

export type Lang = 'ru' | 'kk';
const dict: Record<Lang, Partial<Record<MessageKey, string>>> = { ru, kk };
const KEY = 'kaida.lang';
const listeners = new Set<() => void>();
let current: Lang = 'ru';

function readStored(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'kk' ? 'kk' : 'ru';
  } catch {
    return 'ru';
  }
}

export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  listeners.forEach((f) => f());
}

/** Все тексты интерфейса — только через t(); в коде строк нет. */
export function useI18n() {
  const [lang, setL] = useState<Lang>('ru');
  useEffect(() => {
    current = readStored();
    setL(current);
    const f = () => setL(current);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
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
