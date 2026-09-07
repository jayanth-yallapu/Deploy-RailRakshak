"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import dict, { type Lang } from "./translations";

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const Ctx = createContext<LangCtx>({
  lang: "en",
  setLang: () => {},
  t: (k) => k,
});

const STORAGE_KEY = "railrakshak.lang";

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved === "hi" || saved === "en") setLangState(saved);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    window.dispatchEvent(new Event("rr-lang"));
  }

  function t(key: string): string {
    const entry = dict[key];
    if (!entry) return key;
    return entry[lang] ?? entry.en ?? key;
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}
