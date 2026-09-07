"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: "light",
  setTheme: () => {},
  toggle: () => {},
});

const STORAGE_KEY = "railrakshak.theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial = saved === "dark" || saved === "light" ? saved : "light";
    setThemeState(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    document.documentElement.setAttribute("data-theme", t);
  }

  function toggle() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return <Ctx.Provider value={{ theme, setTheme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
