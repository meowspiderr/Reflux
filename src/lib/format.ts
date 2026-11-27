export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function fileStem(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return "—";
  const rounded = Math.round(fps * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)} fps`;
}

export function codecLabel(codec: string): string {
  const map: Record<string, string> = {
    h264: "H.264",
    hevc: "H.265",
    h265: "H.265",
    av1: "AV1",
    vp9: "VP9",
    vp8: "VP8",
    prores: "ProRes",
    dnxhd: "DNxHD",
    mpeg4: "MPEG-4",
    mpeg2video: "MPEG-2",
    wmv3: "WMV",
  };
  return map[codec.toLowerCase()] ?? codec.toUpperCase();
}

export function truncateMiddle(value: string, max = 46): string {
  if (value.length <= max) return value;
  const head = Math.floor((max - 3) / 2);
  const tail = max - 3 - head;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function errorText(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

export function qualityLabel(quality: number): string {
  if (quality <= 18) return "High quality";
  if (quality <= 22) return "Balanced";
  if (quality <= 26) return "Compact";
  return "Small file";
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
