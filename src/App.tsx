import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AudioStudio } from "./components/AudioStudio";
import { SettingsDialog } from "./components/SettingsDialog";
import { TopBar } from "./components/TopBar";
import { detectEnvironment, pickFolder } from "./lib/backend";
import { errorText } from "./lib/format";
import { loadSettings, saveSettings } from "./lib/settings";
import type { Environment, Settings, Toast } from "./types";

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const toastId = useRef(0);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings.theme]);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((entry) => entry.id !== id)),
      toast.tone === "error" ? 9000 : 5500,
    );
  }, []);

  const loadEnvironment = useCallback(async () => {
    setEnvironmentLoading(true);
    try {
      setEnvironment(await detectEnvironment());
    } catch (error) {
      setEnvironment(null);
      pushToast({
        tone: "error",
        title: "Couldn't check the audio engine",
        description: errorText(error),
      });
    } finally {
      setEnvironmentLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void loadEnvironment();
  }, [loadEnvironment]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleTheme = useCallback(() => {
    updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" });
  }, [settings.theme, updateSettings]);

  const chooseFolder = useCallback(async (): Promise<string | null> => {
    try {
      return await pickFolder();
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not open the folder picker",
        description: errorText(error),
      });
      return null;
    }
  }, [pushToast]);

  return (
    <div className="app">
      <TopBar
        dark={settings.theme === "dark"}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <AudioStudio
        active
        onToast={pushToast}
        beyond={settings.beyond}
        outputDir={settings.outputDir}
        openWhenDone={settings.openWhenDone}
        notification={toasts[toasts.length - 1]}
        environment={environment}
        environmentLoading={environmentLoading}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={updateSettings}
        onPickFolder={chooseFolder}
        environment={environment}
        environmentLoading={environmentLoading}
        onRefreshEnvironment={() => void loadEnvironment()}
      />
    </div>
  );
}
