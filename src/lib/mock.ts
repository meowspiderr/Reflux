import type {
  AudioDoneEvent,
  AudioExportHandlers,
  AudioExportRequest,
  AudioMeta,
  AudioProbeOutcome,
  AudioProgressEvent,
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

interface DemoDefinition {
  file: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  codec: string;
  audio: boolean;
  size: number;
  variant: number;
  focusX: number;
  focusY: number;
}

const DEMOS: DemoDefinition[] = [
  {
    file: "coastline-golden-hour.mp4",
    width: 1920,
    height: 1080,
    duration: 24.4,
    fps: 29.97,
    codec: "h264",
    audio: true,
    size: 84_300_000,
    variant: 0,
    focusX: 0.64,
    focusY: 0.5,
  },
  {
    file: "studio-interview-take-2.mp4",
    width: 3840,
    height: 2160,
    duration: 62.8,
    fps: 25,
    codec: "hevc",
    audio: true,
    size: 512_000_000,
    variant: 1,
    focusX: 0.44,
    focusY: 0.4,
  },
  {
    file: "night-market-broll.mov",
    width: 1920,
    height: 1080,
    duration: 11.2,
    fps: 23.976,
    codec: "prores",
    audio: false,
    size: 1_340_000_000,
    variant: 2,
    focusX: 0.55,
    focusY: 0.52,
  },
  {
    file: "skate-session-vertical.mp4",
    width: 1080,
    height: 1920,
    duration: 18.6,
    fps: 60,
    codec: "h264",
    audio: true,
    size: 96_000_000,
    variant: 3,
    focusX: 0.5,
    focusY: 0.44,
  },
];

const FOLDER = "C:\\Footage\\Reflux demo";

function seeded(seed: number): () => number {
  let state = Math.max(1, Math.floor(seed));
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function paintThumb(canvas: HTMLCanvasElement, variant: number): void {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#2c2d33");
  sky.addColorStop(1, "#0d0d0f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  if (variant === 0) {
    const sun = ctx.createRadialGradient(
      width * 0.66,
      height * 0.52,
      0,
      width * 0.66,
      height * 0.52,
      height * 0.6,
    );
    sun.addColorStop(0, "rgba(244,244,247,0.92)");
    sun.addColorStop(0.22, "rgba(190,190,198,0.38)");
    sun.addColorStop(1, "rgba(120,120,130,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#1b1c20";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.72);
    ctx.lineTo(width * 0.3, height * 0.58);
    ctx.lineTo(width * 0.55, height * 0.74);
    ctx.lineTo(width, height * 0.62);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();

    ctx.fillStyle = "#0a0a0c";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.87);
    ctx.lineTo(width * 0.4, height * 0.77);
    ctx.lineTo(width * 0.72, height * 0.89);
    ctx.lineTo(width, height * 0.81);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();
  } else if (variant === 1) {
    const key = ctx.createRadialGradient(
      width * 0.38,
      height * 0.34,
      0,
      width * 0.38,
      height * 0.34,
      height * 0.85,
    );
    key.addColorStop(0, "rgba(222,222,228,0.46)");
    key.addColorStop(1, "rgba(18,18,22,0)");
    ctx.fillStyle = key;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#0b0b0d";
    ctx.beginPath();
    ctx.ellipse(width * 0.5, height * 0.42, height * 0.16, height * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(width * 0.5, height * 0.98, height * 0.36, height * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(235,235,240,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      width * 0.5,
      height * 0.42,
      height * 0.16,
      height * 0.2,
      0,
      Math.PI * 0.85,
      Math.PI * 1.55,
    );
    ctx.stroke();
  } else if (variant === 2) {
    const random = seeded(7);
    for (let i = 0; i < 16; i += 1) {
      const buildingWidth = width * (0.035 + random() * 0.07);
      const buildingHeight = height * (0.18 + random() * 0.52);
      const x = random() * (width - buildingWidth);
      const shade = 26 + Math.round(random() * 26);
      ctx.fillStyle = `rgb(${shade},${shade},${shade + 4})`;
      ctx.fillRect(x, height - buildingHeight, buildingWidth, buildingHeight);
      for (let j = 0; j < 12; j += 1) {
        ctx.fillStyle = `rgba(228,228,234,${0.1 + random() * 0.4})`;
        ctx.fillRect(
          x + buildingWidth * 0.16 + (j % 2) * buildingWidth * 0.42,
          height - buildingHeight + buildingHeight * 0.1 + Math.floor(j / 2) * buildingHeight * 0.11,
          Math.max(1, buildingWidth * 0.13),
          Math.max(1, buildingHeight * 0.028),
        );
      }
    }
  } else {
    ctx.fillStyle = "#16171a";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.68);
    ctx.bezierCurveTo(width * 0.3, height * 0.54, width * 0.62, height * 0.9, width, height * 0.66);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();

    ctx.fillStyle = "#23242b";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.83);
    ctx.bezierCurveTo(width * 0.4, height * 0.64, width * 0.72, height * 0.98, width, height * 0.8);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();

    const moon = ctx.createRadialGradient(
      width * 0.24,
      height * 0.26,
      0,
      width * 0.24,
      height * 0.26,
      height * 0.45,
    );
    moon.addColorStop(0, "rgba(238,238,243,0.55)");
    moon.addColorStop(1, "rgba(238,238,243,0)");
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, width, height);
  }

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.25,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const grain = seeded(variant + 19);
  for (let i = 0; i < 520; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${grain() * 0.05})`;
    ctx.fillRect(grain() * width, grain() * height, 1, 1);
  }
}

let thumbnails: string[] | null = null;

function thumbs(): string[] {
  if (thumbnails) return thumbnails;
  thumbnails = DEMOS.map((demo) => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = Math.round((480 * demo.height) / demo.width);
    paintThumb(canvas, demo.variant);
    return canvas.toDataURL("image/jpeg", 0.82);
  });
  return thumbnails;
}

function demoMeta(demoIndex: number): VideoMeta {
  const demo = DEMOS[demoIndex];
  return {
    path: `${FOLDER}\\${demo.file}`,
    name: demo.file,
    duration: demo.duration,
    width: demo.width,
    height: demo.height,
    rotation: 0,
    fps: demo.fps,
    codec: demo.codec,
    audio: demo.audio,
    size: demo.size,
    thumbnail: thumbs()[demoIndex],
  };
}

export function environment(): Environment {
  return {
    ffmpeg: "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    ffprobe: "C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe",
    version: "9.0.2",
    encoders: [
      {
        id: "h264_nvenc",
        label: "NVIDIA H.264 (NVENC)",
        codec: "h264",
        hardware: true,
        available: true,
      },
      {
        id: "hevc_nvenc",
        label: "NVIDIA H.265 (NVENC)",
        codec: "hevc",
        hardware: true,
        available: true,
      },
      {
        id: "h264_qsv",
        label: "Intel H.264 (Quick Sync)",
        codec: "h264",
        hardware: true,
        available: true,
      },
      {
        id: "hevc_qsv",
        label: "Intel H.265 (Quick Sync)",
        codec: "hevc",
        hardware: true,
        available: false,
      },
      {
        id: "h264_amf",
        label: "AMD H.264 (AMF)",
        codec: "h264",
        hardware: true,
        available: false,
      },
      {
        id: "libx264",
        label: "H.264 (x264)",
        codec: "h264",
        hardware: false,
        available: true,
      },
      {
        id: "libx265",
        label: "H.265 (x265)",
        codec: "hevc",
        hardware: false,
        available: true,
      },
    ],
  };
}

export function probe(_paths: string[]): Promise<ProbeOutcome[]> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(
        DEMOS.map((_, index) => ({
          path: demoMeta(index).path,
          meta: demoMeta(index),
          error: null,
        })),
      );
    }, 320);
  });
}

export function analyze(clip: VideoMeta): Promise<FocusAnalysis | null> {
  const index = DEMOS.findIndex((demo) => `${FOLDER}\\${demo.file}` === clip.path);
  const demo = index >= 0 ? DEMOS[index] : null;
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(
        demo
          ? { x: demo.focusX, y: demo.focusY, content: null }
          : { x: 0.5, y: 0.5, content: null },
      );
    }, 650 + Math.random() * 500);
  });
}

export function pickVideos(): Promise<string[]> {
  return Promise.resolve(DEMOS.map((_, index) => demoMeta(index).path));
}

export function pickFolder(): Promise<string | null> {
  return Promise.resolve("C:\\Footage\\Reflux");
}

const channels: ExportHandlers[] = [];
let timers: number[] = [];
let running = false;
let cancelled = false;

function broadcastItem(event: ItemEvent): void {
  for (const channel of channels) channel.onItem(event);
}

function broadcastProgress(event: ProgressEvent): void {
  for (const channel of channels) channel.onProgress(event);
}

function finish(done: DoneEvent): void {
  running = false;
  for (const channel of channels) channel.onDone(done);
}

export function subscribeExport(handlers: ExportHandlers): () => void {
  channels.push(handlers);
  return () => {
    const index = channels.indexOf(handlers);
    if (index >= 0) channels.splice(index, 1);
  };
}

export function startExport(request: ExportRequest): Promise<void> {
  if (running) return Promise.resolve();
  running = true;
  cancelled = false;
  timers = [];

  const outputs: string[] = [];
  let index = 0;

  const startItem = () => {
    if (cancelled || index >= request.items.length) return;
    const item = request.items[index];
    broadcastItem({ index, status: "running", output: null, error: null });

    let percent = 0;
    const step = () => {
      if (cancelled) return;
      percent = Math.min(100, percent + 4 + Math.random() * 7);
      broadcastProgress({ index, percent, speed: "2.4x" });
      if (percent < 100) {
        timers.push(window.setTimeout(step, 90));
        return;
      }
      const output = `${request.outputDir || FOLDER}\\${item.name.replace(/\.[^.]+$/, "")}_reflux.mp4`;
      outputs.push(output);
      broadcastItem({ index, status: "done", output, error: null });
      index += 1;
      if (index < request.items.length) {
        timers.push(window.setTimeout(startItem, 220));
      } else {
        finish({ completed: outputs.length, failed: 0, cancelled: false, outputs });
      }
    };
    step();
  };

  startItem();
  return Promise.resolve();
}

export function cancelExport(): Promise<void> {
  if (!running) return Promise.resolve();
  cancelled = true;
  for (const timer of timers) window.clearTimeout(timer);
  timers = [];
  finish({ completed: 0, failed: 0, cancelled: true, outputs: [] });
  return Promise.resolve();
}

const AUDIO_PATH = `${FOLDER}\\midnight-drive.mp3`;
const AUDIO_DURATION = 222.6;
function waveformImage(): string {
  const width = 720;
  const height = 128;
  const count = 128;
  const random = seeded(41);
  let bars = "";
  for (let index = 0; index < count; index += 1) {
    const barHeight = 8 + Math.pow(random(), 0.72) * 104;
    const x = (index * width) / count;
    bars += `<rect x="${x.toFixed(1)}" y="${((height - barHeight) / 2).toFixed(1)}" width="4" height="${barHeight.toFixed(1)}" rx="2" fill="#9aa0a8"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function audioMeta(): AudioMeta {
  return {
    path: AUDIO_PATH,
    name: "midnight-drive.mp3",
    duration: AUDIO_DURATION,
    codec: "mp3",
    sampleRate: 44_100,
    channels: 2,
    bitrate: 320_000,
    size: 8_904_000,
    waveform: waveformImage(),
    title: "Midnight Drive",
    artist: "Reflux Demo",
    album: "Demo Sessions",
  };
}

export function probeAudio(path: string): Promise<AudioProbeOutcome> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      const meta = audioMeta();
      resolve({ path, meta: { ...meta, path }, error: null });
    }, 360);
  });
}

export function pickAudio(): Promise<string[]> {
  return Promise.resolve([AUDIO_PATH]);
}

function demoPreview(): string {
  const sampleRate = 8000;
  const seconds = AUDIO_DURATION;
  const total = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + total * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, total * 2, true);
  for (let index = 0; index < total; index += 1) {
    const time = index / sampleRate;
    const envelope = Math.min(1, time * 8, (seconds - time) * 8);
    const sample = Math.sin(2 * Math.PI * 220 * time) * 0.2 * envelope;
    view.setInt16(44 + index * 2, sample * 32767, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

let demoPreviewUrl: string | null = null;

export function audioPreviewSource(_path: string): string {
  if (!demoPreviewUrl) demoPreviewUrl = demoPreview();
  return demoPreviewUrl;
}

export function previewAudio(_request: AudioExportRequest): Promise<PreparedPreview> {
  return new Promise((resolve) => {
    window.setTimeout(
      () => resolve({ url: audioPreviewSource(_request.path), path: "" }),
      420,
    );
  });
}

export function discardPreview(_path: string): Promise<void> {
  return Promise.resolve();
}

export function detectSilence(_path: string, duration: number): Promise<SilenceBounds> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve({ start: 2.4, end: Math.max(2.5, duration - 3.1) }), 480);
  });
}

export function resolveOutputPath(request: AudioExportRequest): Promise<string> {
  const stem = request.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "audio";
  const pattern = request.filenamePattern.trim() || "{name}_edited";
  const name = pattern.replace(/\{name\}/gi, stem).replace(/\{ratio\}/gi, "") || stem;
  return Promise.resolve(`${request.outputDir || FOLDER}\\${name}.${request.format}`);
}

const audioChannels: AudioExportHandlers[] = [];
let audioTimers: number[] = [];
let audioRunning = false;
let audioCancelled = false;

function broadcastAudioProgress(event: AudioProgressEvent): void {
  for (const channel of audioChannels) channel.onProgress(event);
}

function finishAudio(done: AudioDoneEvent): void {
  audioRunning = false;
  for (const channel of audioChannels) channel.onDone(done);
}

export function subscribeAudioExport(handlers: AudioExportHandlers): () => void {
  audioChannels.push(handlers);
  return () => {
    const index = audioChannels.indexOf(handlers);
    if (index >= 0) audioChannels.splice(index, 1);
  };
}

export function startAudioExport(request: AudioExportRequest): Promise<void> {
  if (audioRunning) return Promise.resolve();
  audioRunning = true;
  audioCancelled = false;
  audioTimers = [];
  let percent = 0;
  const step = () => {
    if (audioCancelled) return;
    percent = Math.min(100, percent + 5 + Math.random() * 8);
    broadcastAudioProgress({ percent, speed: "3.1x" });
    if (percent < 100) {
      audioTimers.push(window.setTimeout(step, 100));
      return;
    }
    const stem = request.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "audio";
    const pattern = request.filenamePattern.trim() || "{name}_edited";
    const name = pattern.replace(/\{name\}/gi, stem).replace(/\{ratio\}/gi, "") || stem;
    const output = `${request.outputDir || FOLDER}\\${name}.${request.format}`;
    finishAudio({ output, cancelled: false, error: null });
  };
  step();
  return Promise.resolve();
}

export function cancelAudioExport(): Promise<void> {
  if (!audioRunning) return Promise.resolve();
  audioCancelled = true;
  for (const timer of audioTimers) window.clearTimeout(timer);
  audioTimers = [];
  finishAudio({ output: null, cancelled: true, error: null });
  return Promise.resolve();
}
