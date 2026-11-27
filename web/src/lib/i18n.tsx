'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import ru from '@/messages/ru.json';
import kk from '@/messages/kk.json';

export type Lang = 'ru' | 'kk';
const MESSAGES: Record<Lang, unknown> = { ru, kk };

function lookup(obj: unknown, key: string): string | undefined {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj) as
    | string
    | undefined;
}

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (key: string, fallback?: string) => string }
const Ctx = createContext<I18n>({ lang: 'ru', setLang: () => {}, t: (k) => k });

/** Все тексты интерфейса — из src/messages/{ru,kk}.json (ТЗ 1: без текста в коде). */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ru');
  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) as Lang | null;
    if (saved === 'ru' || saved === 'kk') setLangState(saved);
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch { /* приватный режим */ }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback((key: string, fallback?: string) => lookup(MESSAGES[lang], key) ?? lookup(MESSAGES.ru, key) ?? fallback ?? key, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
