import { Minus, Moon, Settings, Sun, X } from "lucide-react";
import { closeWindow, isNative, minimizeWindow } from "../lib/backend";
import { Logo } from "./Logo";

interface TopBarProps {
  dark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function TopBar({ dark, onToggleTheme, onOpenSettings }: TopBarProps) {
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="brand-mark">
          <Logo size={17} />
        </span>
        <span className="brand-name">Reflux</span>
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-btn"
          onClick={onToggleTheme}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? <Moon size={15} strokeWidth={1.7} /> : <Sun size={15} strokeWidth={1.7} />}
        </button>

        <button
          type="button"
          className="topbar-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings size={15} strokeWidth={1.7} />
        </button>

        {isNative && (
          <div className="window-controls">
            <button
              type="button"
              className="window-btn"
              onClick={() => void minimizeWindow()}
              aria-label="Minimize"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="window-btn is-close"
              onClick={() => void closeWindow()}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
