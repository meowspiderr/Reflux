export type ResizeMode = "fill" | "fit";
export type Container = "mp4" | "mov";
export type ThemeMode = "light" | "dark";
export type Workspace = "video" | "audio";
export type AudioFormat =
  | "mp3"
  | "wav"
  | "flac"
  | "m4a"
  | "aac"
  | "ogg"
  | "opus"
  | "aiff"
  | "wma"
  | "ac3";
export type AudioQuality = "low" | "standard" | "high" | "maximum";
export type ClipStatus = "ready" | "analyzing" | "queued" | "running" | "done" | "failed";

export interface EncoderInfo {
  id: string;
  label: string;
  codec: "h264" | "hevc";
  hardware: boolean;
  available: boolean;
}

export interface Environment {
  ffmpeg: string | null;
  ffprobe: string | null;
  version: string | null;
  encoders: EncoderInfo[];
}

export interface VideoMeta {
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  rotation: number;
  fps: number;
  codec: string;
  audio: boolean;
  size: number;
  thumbnail: string | null;
}

export interface ProbeOutcome {
  path: string;
  meta: VideoMeta | null;
  error: string | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusAnalysis {
  x: number;
  y: number;
  content: Rect | null;
}

export interface Clip extends VideoMeta {
  id: string;
  focusX: number;
  focusY: number;
  source: "auto" | "manual";
  content: Rect | null;
  status: ClipStatus;
  progress: number;
  error?: string;
  output?: string;
}

export interface Settings {
  outputDir: string;
  openWhenDone: boolean;
  theme: ThemeMode;
  beyond: boolean;
}

export interface ExportItem {
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  focusX: number;
  focusY: number;
  content: Rect | null;
}

export interface ExportRequest {
  items: ExportItem[];
  width: number;
  height: number;
  mode: ResizeMode;
  encoder: string;
  quality: number;
  container: Container;
  outputDir: string;
  filenamePattern: string;
}

export interface ProgressEvent {
  index: number;
  percent: number;
  speed: string | null;
}

export interface ItemEvent {
  index: number;
  status: "running" | "done" | "failed";
  output: string | null;
  error: string | null;
}

export interface DoneEvent {
  completed: number;
  failed: number;
  cancelled: boolean;
  outputs: string[];
}

export interface AudioMeta {
  path: string;
  name: string;
  duration: number;
  codec: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
  size: number;
  waveform: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
}

export interface AudioProbeOutcome {
  path: string;
  meta: AudioMeta | null;
  error: string | null;
}

export interface AudioTrack extends AudioMeta {
  id: string;
}

export interface AudioExportRequest {
  path: string;
  duration: number;
  bass: number;
  presence: number;
  treble: number;
  volume: number;
  bands: number[];
  format: AudioFormat;
  quality: AudioQuality;
  beyond: boolean;
  outputDir: string;
  filenamePattern: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
  sampleRate: number;
  loudnessTarget: number;
  fadeIn: number;
  fadeOut: number;
  title: string;
  artist: string;
  album: string;
}

export interface AudioProgressEvent {
  percent: number;
  speed: string | null;
}

export interface AudioDoneEvent {
  output: string | null;
  cancelled: boolean;
  error: string | null;
}

export interface AudioExportHandlers {
  onProgress: (event: AudioProgressEvent) => void;
  onDone: (event: AudioDoneEvent) => void;
}

export interface SilenceBounds {
  start: number;
  end: number;
}

export interface PreparedPreview {
  url: string;
  path: string;
}

export interface RecentExport {
  path: string;
  name: string;
  at: number;
}

export interface ExportHandlers {
  onProgress: (event: ProgressEvent) => void;
  onItem: (event: ItemEvent) => void;
  onDone: (event: DoneEvent) => void;
}

export type ToastTone = "info" | "error" | "success";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; run: () => void };
}
