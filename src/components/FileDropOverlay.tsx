import { useEffect, useState } from "react";
import { AudioLines, File } from "lucide-react";
import { subscribeFileDrop, type FileDragState } from "../lib/backend";

interface FileDropOverlayProps {
  active: boolean;
  onDrop: (paths: string[]) => void;
}

export function FileDropOverlay({ active, onDrop }: FileDropOverlayProps) {
  const [drag, setDrag] = useState<FileDragState | null>(null);

  useEffect(() => {
    if (!active) {
      setDrag(null);
      return;
    }
    return subscribeFileDrop(onDrop, setDrag);
  }, [active, onDrop]);

  const flip = drag ? drag.x > window.innerWidth - 280 : false;

  return (
    <>
      <div className={`drop-overlay ${drag ? "is-active" : ""}`}>
        <div className="drop-card">
          <AudioLines size={22} strokeWidth={1.6} />
          <span className="drop-title">Drop audio to edit</span>
          <span className="drop-copy">Release to import</span>
        </div>
      </div>

      {drag ? (
        <div
          className="file-drop-chip"
          style={{
            left: drag.x + (flip ? -14 : 14),
            top: drag.y + 16,
            transform: flip ? "translateX(-100%)" : undefined,
          }}
        >
          <span className="file-drop-chip-icon">
            <File size={13} strokeWidth={1.7} />
          </span>
          <span className="file-drop-chip-name">{drag.name ?? "Audio file"}</span>
        </div>
      ) : null}
    </>
  );
}
