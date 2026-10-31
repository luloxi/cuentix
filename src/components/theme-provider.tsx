"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "lc-theme";

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyResolved(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;
  // Keep iOS status bar / theme-color roughly in sync
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      resolved === "dark" ? "#121110" : "#f7f6f3",
    );
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let initial: ThemeMode = "system";
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (stored === "light" || stored === "dark" || stored === "system") {
        initial = stored;
      }
    } catch {
      /* ignore */
    }
    setModeState(initial);
    const r = initial === "system" ? getSystemTheme() : initial;
    setResolved(r);
    applyResolved(r);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const r = mode === "system" ? getSystemTheme() : mode;
    setResolved(r);
    applyResolved(r);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode, ready]);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = getSystemTheme();
      setResolved(r);
      applyResolved(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      // Cycle based on what the user actually sees
      const current =
        prev === "system" ? getSystemTheme() : prev;
      return current === "dark" ? "light" : "dark";
    });
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
