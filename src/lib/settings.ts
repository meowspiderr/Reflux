import type { Settings, ThemeMode } from "../types";

const STORAGE_KEY = "reflux.settings.v2";

export const DEFAULT_SETTINGS: Settings = {
  outputDir: "",
  openWhenDone: false,
  theme: "dark",
  beyond: false,
};

const THEMES: ThemeMode[] = ["light", "dark"];

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("reflux.settings.v1");
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return {
      outputDir: stringValue(parsed.outputDir, ""),
      openWhenDone: parsed.openWhenDone === true,
      theme: THEMES.includes(parsed.theme as ThemeMode)
        ? (parsed.theme as ThemeMode)
        : DEFAULT_SETTINGS.theme,
      beyond: parsed.beyond === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
  }
}
