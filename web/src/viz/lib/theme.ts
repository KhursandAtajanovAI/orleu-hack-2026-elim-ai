'use client';
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'kaida.theme';
const listeners = new Set<(t: Theme) => void>();

function initial(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  listeners.forEach((f) => f(t));
}

export function useTheme() {
  const [theme, setT] = useState<Theme>('dark');
  useEffect(() => {
    const t = initial();
    document.documentElement.dataset.theme = t;
    setT(t);
    listeners.add(setT);
    return () => {
      listeners.delete(setT);
    };
  }, []);
  const toggle = useCallback(() => applyTheme(theme === 'dark' ? 'light' : 'dark'), [theme]);
  return { theme, toggle };
}
