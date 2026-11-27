import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AudioDoneEvent,
  AudioExportHandlers,
  AudioExportRequest,
  AudioProgressEvent,
  AudioProbeOutcome,
  DoneEvent,
  Environment,
  ExportHandlers,
  ExportRequest,
  FocusAnalysis,
  ItemEvent,
  PreparedPreview,
  ProbeOutcome,
  ProgressEvent,
  SilenceBounds,
  VideoMeta,
} from "../types";
import * as mock from "./mock";

export const isNative = isTauri();

export const VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "mkv",
  "webm",
  "m4v",
  "avi",
  "mpg",
  "mpeg",
  "ts",
  "flv",
  "ogv",
  "wmv",
  "mxf",
  "ivf",
];

export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "opus",
  "wma",
  "aiff",
  "aif",
  "alac",
  "ac3",
  "amr",
  "m4b",
  "caf",
  "ape",
  "wv",
  "mka",
  "au",
  "snd",
  "dts",
  "ra",
  "mpc",
  "spx",
];

export function isVideoPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}

export function isAudioPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}

export async function detectEnvironment(): Promise<Environment> {
  if (!isNative) return mock.environment();
  return invoke<Environment>("detect_environment");
}

export async function probeVideos(paths: string[]): Promise<ProbeOutcome[]> {
  if (!isNative) return mock.probe(paths);
  return invoke<ProbeOutcome[]>("probe_videos", { paths });
}

export async function analyzeClip(clip: VideoMeta): Promise<FocusAnalysis | null> {
  if (!isNative) return mock.analyze(clip);
  return invoke<FocusAnalysis | null>("analyze_clip", {
    path: clip.path,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
  });
}

export async function pickVideos(): Promise<string[]> {
  if (!isNative) return mock.pickVideos();
  const selection = await open({
    multiple: true,
    directory: false,
    title: "Add videos",
    filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
  });
  if (!selection) return [];
  return Array.isArray(selection) ? selection : [selection];
}

export async function pickAudio(): Promise<string[]> {
  if (!isNative) return mock.pickAudio();
  const selection = await open({
    multiple: true,
    directory: false,
    title: "Add audio",
    filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
  });
  if (!selection) return [];
  return Array.isArray(selection) ? selection : [selection];
}

export async function probeAudio(path: string): Promise<AudioProbeOutcome> {
  if (!isNative) return mock.probeAudio(path);
  return invoke<AudioProbeOutcome>("probe_audio", { path });
}

export async function previewAudio(request: AudioExportRequest): Promise<PreparedPreview> {
  if (!isNative) return mock.previewAudio(request);
  const path = await invoke<string>("preview_audio", { request });
  return { url: convertFileSrc(path), path };
}

export async function discardPreview(path: string): Promise<void> {
  if (!isNative || !path) return;
  await invoke("discard_preview", { path });
}

export async function detectSilence(path: string, duration: number): Promise<SilenceBounds> {
  if (!isNative) return mock.detectSilence(path, duration);
  return invoke<SilenceBounds>("detect_audio_silence", { path, duration });
}

export async function resolveOutputPath(request: AudioExportRequest): Promise<string> {
  if (!isNative) return mock.resolveOutputPath(request);
  return invoke<string>("resolve_audio_output", { request });
}

export function audioPreviewSource(path: string): string {
  if (!isNative) return mock.audioPreviewSource(path);
  return convertFileSrc(path);
}

export async function startAudioExport(request: AudioExportRequest): Promise<void> {
  if (!isNative) return mock.startAudioExport(request);
  return invoke("start_audio_export", { request });
}

export async function cancelAudioExport(): Promise<void> {
  if (!isNative) return mock.cancelAudioExport();
  return invoke("cancel_audio_export");
}

export function subscribeAudioExport(handlers: AudioExportHandlers): () => void {
  if (!isNative) return mock.subscribeAudioExport(handlers);

  let disposed = false;
  const unlisteners: UnlistenFn[] = [];
  const track = (pending: Promise<UnlistenFn>) => {
    pending
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      })
      .catch(() => undefined);
  };

  track(
    listen<AudioProgressEvent>("audio://progress", (event) =>
      handlers.onProgress(event.payload),
    ),
  );
  track(
    listen<AudioDoneEvent>("audio://done", (event) => handlers.onDone(event.payload)),
  );

  return () => {
    disposed = true;
    for (const unlisten of unlisteners) unlisten();
  };
}

export function setTaskbarProgress(progress: number | "indeterminate" | null): void {
  if (!isNative) return;
  const state =
    progress === null
      ? { status: ProgressBarStatus.None }
      : progress === "indeterminate"
        ? { status: ProgressBarStatus.Indeterminate }
        : {
            status: ProgressBarStatus.Normal,
            progress: Math.max(0, Math.min(100, Math.round(progress))),
          };
  void getCurrentWindow()
    .setProgressBar(state)
    .catch(() => undefined);
}

export async function pickFolder(): Promise<string | null> {
  if (!isNative) return mock.pickFolder();
  const selection = await open({
    directory: true,
    multiple: false,
    title: "Choose export folder",
  });
  return typeof selection === "string" ? selection : null;
}

export async function requestExport(request: ExportRequest): Promise<void> {
  if (!isNative) return mock.startExport(request);
  return invoke("start_export", { request });
}

export async function cancelExportRequest(): Promise<void> {
  if (!isNative) return mock.cancelExport();
  return invoke("cancel_export");
}

export async function revealPath(path: string): Promise<void> {
  if (!isNative) return;
  await invoke("reveal_path", { path });
}

export async function openFolder(path: string): Promise<void> {
  if (!isNative) return;
  await invoke("open_folder", { path });
}

export function subscribeExport(handlers: ExportHandlers): () => void {
  if (!isNative) return mock.subscribeExport(handlers);

  let disposed = false;
  const unlisteners: UnlistenFn[] = [];
  const track = (pending: Promise<UnlistenFn>) => {
    pending
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      })
      .catch(() => undefined);
  };

  track(listen<ProgressEvent>("export://progress", (event) => handlers.onProgress(event.payload)));
  track(listen<ItemEvent>("export://item", (event) => handlers.onItem(event.payload)));
  track(listen<DoneEvent>("export://done", (event) => handlers.onDone(event.payload)));

  return () => {
    disposed = true;
    for (const unlisten of unlisteners) unlisten();
  };
}

export interface FileDragState {
  x: number;
  y: number;
  name: string | null;
}

export function subscribeFileDrop(
  onPaths: (paths: string[]) => void,
  onHover: (state: FileDragState | null) => void,
): () => void {
  if (isNative) {
    let unlisten: UnlistenFn | undefined;
    let name: string | null = null;
    const hover = (position: { x: number; y: number }) => {
      const scale = window.devicePixelRatio || 1;
      onHover({ x: position.x / scale, y: position.y / scale, name });
    };
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          name = payload.paths[0]?.split(/[\\/]/).pop() ?? null;
          hover(payload.position);
        } else if (payload.type === "over") {
          hover(payload.position);
        } else if (payload.type === "drop") {
          name = null;
          onHover(null);
          onPaths(payload.paths);
        } else {
          name = null;
          onHover(null);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }

  const hover = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    onHover({ x: event.clientX, y: event.clientY, name: null });
  };
  const enter = (event: DragEvent) => {
    event.preventDefault();
    hover(event);
  };
  const over = (event: DragEvent) => {
    event.preventDefault();
    hover(event);
  };
  const leave = (event: DragEvent) => {
    event.preventDefault();
    if (!event.relatedTarget) onHover(null);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    onHover(null);
    onPaths([]);
  };

  window.addEventListener("dragenter", enter);
  window.addEventListener("dragover", over);
  window.addEventListener("dragleave", leave);
  window.addEventListener("drop", drop);

  return () => {
    window.removeEventListener("dragenter", enter);
    window.removeEventListener("dragover", over);
    window.removeEventListener("dragleave", leave);
    window.removeEventListener("drop", drop);
  };
}

export async function minimizeWindow(): Promise<void> {
  if (!isNative) return;
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isNative) return;
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  if (!isNative) return;
  await getCurrentWindow().close();
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isNative) return false;
  return getCurrentWindow().isMaximized();
}

export function onWindowResized(handler: () => void): () => void {
  if (!isNative) return () => undefined;
  const pending = getCurrentWindow().onResized(() => handler());
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}
