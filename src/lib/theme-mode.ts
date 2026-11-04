export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "lc-theme";

export function parseStoredTheme(raw: string | null | undefined): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function resolveTheme(
  mode: ThemeMode,
  system: ResolvedTheme,
): ResolvedTheme {
  return mode === "system" ? system : mode;
}

/** What the toggle shows next: system follows the current system theme. */
export function toggledTheme(
  mode: ThemeMode,
  system: ResolvedTheme,
): Exclude<ThemeMode, "system"> {
  const current = resolveTheme(mode, system);
  return current === "dark" ? "light" : "dark";
}
