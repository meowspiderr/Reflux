import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Environment, Settings } from "../types";
import { CustomScrollbar } from "./CustomScrollbar";
import { Toggle } from "./Toggle";

interface SettingsDialogProps {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onPickFolder: () => Promise<string | null>;
  environment: Environment | null;
  environmentLoading: boolean;
  onRefreshEnvironment: () => void;
}

export function SettingsDialog({
  open,
  settings,
  onClose,
  onChange,
  onPickFolder,
  environment,
  environmentLoading,
  onRefreshEnvironment,
}: SettingsDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Settings>(settings);
  const [nudge, setNudge] = useState(0);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const updateDraft = useCallback((patch: Partial<Settings>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty) {
      setNudge((value) => value + 1);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setNudge(0);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => modalRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, requestClose]);

  if (!open) return null;

  const browseOutputFolder = async () => {
    const folder = await onPickFolder();
    if (folder) updateDraft({ outputDir: folder });
  };

  const revertChanges = () => {
    setDraft(settings);
    onClose();
  };

  const saveChanges = () => {
    onChange(draft);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 id="settings-title" className="modal-title">
            Settings
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={requestClose}
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body-shell">
          <div className="modal-body" ref={bodyRef}>
            <section className="setting-card">
              <div className="setting-card-head">Saving</div>

              <div className="setting-row">
                <div className="setting-copy">
                  <span className="setting-name">Where files are saved</span>
                  <span className="setting-sub">
                    {draft.outputDir || "Next to the original file"}
                  </span>
                </div>
                <div className="setting-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => void browseOutputFolder()}
                  >
                    Browse
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <span className="setting-name">Show the saved file</span>
                  <span className="setting-sub">Opens the folder with your new file.</span>
                </div>
                <Toggle
                  checked={draft.openWhenDone}
                  onChange={(openWhenDone) => updateDraft({ openWhenDone })}
                  label="Show the saved file when finished"
                />
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-card-head">Audio engine</div>
              <div className="setting-row">
                <div className="setting-copy">
                  <span className="setting-name">FFmpeg helper</span>
                  <span className="setting-sub">
                    {environmentLoading
                      ? "Checking your system…"
                      : environment?.ffmpeg ?? "Not installed"}
                  </span>
                </div>
                <div className="setting-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={onRefreshEnvironment}
                    disabled={environmentLoading}
                  >
                    {environmentLoading ? "Checking…" : "Check again"}
                  </button>
                </div>
              </div>
              {environment?.version ? (
                <div className="setting-row">
                  <div className="setting-copy">
                    <span className="setting-name">Engine version</span>
                    <span className="setting-sub">{environment.version}</span>
                  </div>
                </div>
              ) : null}
              {!environmentLoading && !environment?.ffmpeg ? (
                <div className="setting-note">
                  Reflux needs FFmpeg, a free helper app, to open and save audio. Install it,
                  or put ffmpeg.exe and ffprobe.exe in a folder named ffmpeg next to
                  Reflux.exe, then click Check again.
                </div>
              ) : null}
            </section>

            <section className={`beyond-card${draft.beyond ? " is-on" : ""}`}>
              <div className="setting-copy">
                <span className="setting-name beyond-name">
                  Beyond<span className="beyond-bang">!</span>
                </span>
                <span className="setting-sub">
                  Lets Bass, Vocals, and Brightness go up to 500%.
                </span>
              </div>
              <Toggle
                checked={draft.beyond}
                onChange={(beyond) => updateDraft({ beyond })}
                label="Beyond"
              />
            </section>
          </div>
          <CustomScrollbar targetRef={bodyRef} label="Settings" />
        </div>

        {isDirty ? (
          <div
            key={nudge}
            className={`settings-savebar${nudge > 0 ? " is-nudged" : ""}`}
            role="status"
          >
            <span className="settings-savebar-dot" aria-hidden="true" />
            <span className="settings-savebar-copy">Unsaved changes</span>
            <div className="settings-savebar-actions">
              <button type="button" className="secondary-btn" onClick={revertChanges}>
                Revert changes
              </button>
              <button type="button" className="save-btn" onClick={saveChanges}>
                Save changes
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
