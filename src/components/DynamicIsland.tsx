import { Send } from "lucide-react";
import type { Toast } from "../types";
import { AudioVisualizer } from "./AudioVisualizer";

interface DynamicIslandProps {
  playing: boolean;
  notification?: Toast;
  getAnalyser: () => AnalyserNode | null;
}

export function DynamicIsland({ playing, notification, getAnalyser }: DynamicIslandProps) {
  const mode = notification ? "is-notification" : playing ? "is-playing" : "is-idle";
  const message = notification
    ? [notification.title, notification.description].filter(Boolean).join(" · ")
    : "";

  return (
    <div className={`dynamic-island ${mode}`} role="status" aria-live="polite">
      {notification ? (
        <div className="dynamic-island-notification" key={notification.id}>
          <Send
            size={15}
            strokeWidth={1.4}
            fill="currentColor"
            className="dynamic-island-logo"
            aria-hidden="true"
          />
          <span className="dynamic-island-divider" aria-hidden="true" />
          <span className="dynamic-island-message" title={message}>
            {notification.title}
            {notification.description ? (
              <>
                <span className="dynamic-island-separator">·</span>
                <span className="dynamic-island-desc">{notification.description}</span>
              </>
            ) : null}
          </span>
          {notification.action ? (
            <button
              type="button"
              className="dynamic-island-action"
              onClick={() => notification.action?.run()}
            >
              {notification.action.label}
            </button>
          ) : null}
        </div>
      ) : playing ? (
        <AudioVisualizer getAnalyser={getAnalyser} />
      ) : null}
    </div>
  );
}
