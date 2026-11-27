import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowRight,
  FolderOpen,
  LoaderCircle,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  audioPreviewSource,
  cancelAudioExport,
  discardPreview,
  isAudioPath,
  pickAudio,
  previewAudio,
  probeAudio,
  resolveOutputPath,
  revealPath,
  setTaskbarProgress,
  startAudioExport,
  subscribeAudioExport,
} from "../lib/backend";
import {
  BAND_FREQUENCIES,
  AUDIO_FORMAT_OPTIONS,
  AUDIO_SAMPLE_RATE_OPTIONS,
  EXTRA_AUDIO_FORMATS,
  defaultOutputBase,
  estimateAudioBytes,
  formatLabel,
  isLosslessFormat,
  normalizeAudioFormat,
  normalizeOutputBase,
  qualityLabel,
} from "../lib/audio";
import {
  clamp,
  errorText,
  fileName,
  formatBytes,
  formatDuration,
  truncateMiddle,
  uid,
} from "../lib/format";
import { AudioQualitySelect } from "./AudioQualitySelect";
import { AudioSelect } from "./AudioSelect";
import { CustomScrollbar } from "./CustomScrollbar";
import { DynamicIsland } from "./DynamicIsland";
import { FileDropOverlay } from "./FileDropOverlay";
import type {
  AudioExportRequest,
  AudioFormat,
  AudioQuality,
  AudioTrack,
  Environment,
  PreparedPreview,
  RecentExport,
  Toast,
} from "../types";

const FLAT_BANDS = BAND_FREQUENCIES.map(() => 0);
const MIN_TRIM = 0.5;
const SPEED_MIN = 0.5;
const SPEED_MAX = 5;
const SPEED_STEP = 0.5;
const RECENT_EXPORTS_KEY = "reflux.audio.recent.v1";
const CUSTOM_PRESETS_KEY = "reflux.audio.presets.v1";

function speedText(speed: number): string {
  const label = Number.isInteger(speed)
    ? `${speed}`
    : speed.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${label}×`;
}

interface Tone {
  bass: number;
  presence: number;
  treble: number;
  volume: number;
}

const DEFAULT_TONE: Tone = {
  bass: 0,
  presence: 0,
  treble: 0,
  volume: 100,
};

function freshTone(): Tone {
  return { ...DEFAULT_TONE };
}

interface TonePreset {
  id: string;
  label: string;
  bass: number;
  presence: number;
  treble: number;
  volume: number;
}

interface CustomTonePreset {
  id: string;
  label: string;
  tone: Tone;
  bands: number[];
}

function loadCustomPresets(): CustomTonePreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CustomTonePreset => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<CustomTonePreset>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.label === "string" &&
        Boolean(candidate.tone) &&
        Array.isArray(candidate.bands)
      );
    });
  } catch {
    return [];
  }
}

function loadRecentExports(): RecentExport[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_EXPORTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RecentExport => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<RecentExport>;
      return typeof candidate.path === "string" && typeof candidate.name === "string";
    });
  } catch {
    return [];
  }
}

function tonePresetsFor(beyond: boolean): TonePreset[] {
  const top = beyond ? 500 : 100;
  return [
    { id: "bass", label: "Bass", bass: top, presence: 0, treble: 0, volume: 100 },
    { id: "vocal", label: "Vocals", bass: 0, presence: 100, treble: 25, volume: 100 },
    { id: "bright", label: "Bright", bass: 0, presence: 25, treble: top, volume: 100 },
  ];
}

const STREAMABLE_EXTENSIONS = new Set(["mp3", "wav", "flac", "m4a", "ogg", "oga", "opus"]);
const WEB_PLAYABLE_CODECS = new Set([
  "mp3",
  "aac",
  "flac",
  "vorbis",
  "opus",
  "pcm_u8",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
]);


interface AudioStudioProps {
  active: boolean;
  onToast: (toast: Omit<Toast, "id">) => void;
  beyond: boolean;
  outputDir: string;
  openWhenDone: boolean;
  notification?: Toast;
  environment: Environment | null;
  environmentLoading: boolean;
  onOpenSettings: () => void;
}

interface AudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  fade: GainNode;
  volume: GainNode;
  bass: BiquadFilterNode;
  presence: BiquadFilterNode;
  treble: BiquadFilterNode;
  bands: BiquadFilterNode[];
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
}

interface EditSnapshot {
  tone: Tone;
  bands: number[];
  speed: number;
  trimStart: number;
  trimEnd: number;
}

function applyToneToGraph(graph: AudioGraph, tone: Tone, bands: number[]): void {
  const now = graph.ctx.currentTime;
  const set = (param: AudioParam, value: number) =>
    param.setTargetAtTime(value, now, 0.03);

  set(graph.volume.gain, tone.volume / 100);
  set(graph.bass.gain, tone.bass * 0.15);
  set(graph.presence.gain, tone.presence * 0.09);
  set(graph.treble.gain, tone.treble * 0.12);
  graph.bands.forEach((filter, index) => {
    set(filter.gain, bands[index] ?? 0);
  });
}

interface PercentageRowProps {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function PercentageRow({ label, value, max, disabled, onChange }: PercentageRowProps) {
  return (
    <div className="audio-slider-row">
      <span className="audio-slider-name">{label}</span>
      <input
        className="audio-range"
        style={{ "--fill": `${(value / max) * 100}%` } as CSSProperties}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="audio-slider-value">{value}%</span>
    </div>
  );
}

interface SpeedRowProps {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function SpeedRow({ value, disabled, onChange }: SpeedRowProps) {
  const step = (direction: -1 | 1) => {
    const next =
      direction > 0
        ? (Math.floor(value / SPEED_STEP) + 1) * SPEED_STEP
        : (Math.ceil(value / SPEED_STEP) - 1) * SPEED_STEP;
    onChange(clamp(Number(next.toFixed(2)), SPEED_MIN, SPEED_MAX));
  };

  return (
    <div className="audio-slider-row">
      <span className="audio-slider-name">Speed</span>
      <div className="audio-speed-stepper" role="group" aria-label="Playback speed">
        <button
          type="button"
          className="audio-speed-step"
          onClick={() => step(-1)}
          disabled={disabled || value <= SPEED_MIN + 0.001}
          aria-label="Slower"
          title="Slower"
        >
          <Minus size={11} strokeWidth={2.2} />
        </button>
        <span className="audio-speed-value" aria-live="polite" aria-atomic="true">
          {speedText(value)}
        </span>
        <button
          type="button"
          className="audio-speed-step"
          onClick={() => step(1)}
          disabled={disabled || value >= SPEED_MAX - 0.001}
          aria-label="Faster"
          title="Faster"
        >
          <Plus size={11} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

export function AudioStudio({
  active,
  onToast,
  beyond,
  outputDir,
  openWhenDone,
  notification,
  environment,
  environmentLoading,
  onOpenSettings,
}: AudioStudioProps) {
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const [tone, setTone] = useState<Tone>(freshTone);
  const [bands, setBands] = useState<number[]>(() => [...FLAT_BANDS]);
  const [speed, setSpeed] = useState(1);
  const [quality, setQuality] = useState<AudioQuality>("maximum");
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [sampleRate, setSampleRate] = useState(0);
  const [outputBase, setOutputBase] = useState("");
  const [fileNameDraft, setFileNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [preparingSource, setPreparingSource] = useState(false);
  const [position, setPosition] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [resolvedPath, setResolvedPath] = useState("");
  const [customPresets, setCustomPresets] = useState<CustomTonePreset[]>(loadCustomPresets);
  const [inspector, setInspector] = useState<"sound" | "export">("sound");
  const [customFormatOpen, setCustomFormatOpen] = useState(false);
  const [formatDraft, setFormatDraft] = useState("");
  const [recentExports, setRecentExports] = useState<RecentExport[]>(loadRecentExports);

  const activeRef = useRef(active);
  const exportingRef = useRef(exporting);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileNameInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const fallbackCache = useRef(new Map<string, Promise<PreparedPreview>>());
  const previewPathsRef = useRef(new Set<string>());
  const taskbarProgressRef = useRef<number | "indeterminate" | null>(null);
  const historyStackRef = useRef<EditSnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const historyTrackRef = useRef<string | null>(null);
  const historyTimeRef = useRef(0);
  const historySeededRef = useRef(false);
  const getAnalyser = useCallback(() => graphRef.current?.analyser ?? null, []);

  const waveRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const positionRef = useRef(0);
  const trimDragRef = useRef<"start" | "end" | null>(null);
  const fadeDragRef = useRef<"in" | "out" | null>(null);

  const trimFrom = track ? clamp(trimStart, 0, track.duration) : 0;
  const trimTo = track
    ? clamp(trimEnd > 0 ? trimEnd : track.duration, trimFrom, track.duration)
    : 0;
  const trimStartPct = track && track.duration > 0 ? (trimFrom / track.duration) * 100 : 0;
  const trimEndPct = track && track.duration > 0 ? (trimTo / track.duration) * 100 : 100;
  const trimmedDuration = Math.max(0, trimTo - trimFrom);
  const fadeInPct = track && track.duration > 0 ? ((trimFrom + fadeIn) / track.duration) * 100 : 0;
  const fadeOutPct = track && track.duration > 0 ? ((trimTo - fadeOut) / track.duration) * 100 : 100;

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      setPlaying(false);
      audioRef.current?.pause();
    }
  }, [active]);

  useEffect(() => {
    exportingRef.current = exporting;
  }, [exporting]);

  useEffect(() => {
    const next: number | "indeterminate" | null = exporting
      ? progress > 0
        ? Math.round(progress)
        : "indeterminate"
      : importing || preparingSource
        ? "indeterminate"
        : null;
    if (taskbarProgressRef.current === next) return;
    taskbarProgressRef.current = next;
    setTaskbarProgress(next);
  }, [exporting, importing, preparingSource, progress]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph) applyToneToGraph(graph, tone, bands);
  }, [tone, bands]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.preservesPitch = true;
      audio.playbackRate = speed;
    }
  }, [speed, sourceUrl]);

  useEffect(() => {
    setPlaying(false);
    positionRef.current = 0;
    setPosition(0);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
      }
    }
  }, [track?.path]);

  useEffect(() => {
    setSourceUrl(undefined);
    setPreparingSource(false);
    if (!track) return;

    const extension = track.name.split(".").pop()?.toLowerCase() ?? "";
    const streamable =
      STREAMABLE_EXTENSIONS.has(extension) && WEB_PLAYABLE_CODECS.has(track.codec.toLowerCase());
    if (streamable) {
      setSourceUrl(audioPreviewSource(track.path));
      return;
    }

    let active = true;
    setPreparingSource(true);
    const request: AudioExportRequest = {
      path: track.path,
      duration: track.duration,
      bass: 0,
      presence: 0,
      treble: 0,
      volume: 100,
      bands: [...FLAT_BANDS],
      format: "mp3",
      quality: "maximum",
      beyond: false,
      outputDir: "",
      filenamePattern: "{name}",
      trimStart: 0,
      trimEnd: track.duration,
      speed: 1,
      sampleRate: 0,
      loudnessTarget: 0,
      fadeIn: 0,
      fadeOut: 0,
      title: "",
      artist: "",
      album: "",
    };

    let pending = fallbackCache.current.get(track.path);
    if (!pending) {
      pending = previewAudio(request);
      fallbackCache.current.set(track.path, pending);
      void pending.catch(() => fallbackCache.current.delete(track.path));
    }

    void pending
      .then((prepared) => {
        if (prepared.path) {
          if (active) previewPathsRef.current.add(prepared.path);
          else void discardPreview(prepared.path);
        }
        if (active) setSourceUrl(prepared.url);
      })
      .catch((error) => {
        if (active) {
          onToast({
            tone: "error",
            title: "Can't preview this file",
            description: errorText(error),
          });
        }
      })
      .finally(() => {
        if (active) setPreparingSource(false);
      });

    return () => {
      active = false;
    };
  }, [onToast, track]);

  useEffect(() => {
    return () => {
      for (const path of previewPathsRef.current) void discardPreview(path);
      previewPathsRef.current.clear();
      fallbackCache.current.clear();
    };
  }, [track?.path]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) {
        graph.source.disconnect();
        void graph.ctx.close().catch(() => undefined);
      }
      for (const path of previewPathsRef.current) void discardPreview(path);
      previewPathsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (beyond) return;
    setTone((previous) => {
      const bass = Math.min(previous.bass, 100);
      const presence = Math.min(previous.presence, 100);
      const treble = Math.min(previous.treble, 100);
      if (bass === previous.bass && presence === previous.presence && treble === previous.treble) {
        return previous;
      }
      return { ...previous, bass, presence, treble };
    });
  }, [beyond]);

  const acceptPath = useCallback(
    async (path: string) => {
      if (exportingRef.current) return;
      audioRef.current?.pause();
      setPlaying(false);
      positionRef.current = 0;
      setPosition(0);
      setImporting(true);
      try {
        const outcome = await probeAudio(path);
        if (!outcome.meta) {
          const name = path.split(/[\\/]/).pop() ?? path;
          onToast({
            tone: "error",
            title: `Couldn't read ${name}`,
            description: outcome.error ?? undefined,
          });
          return;
        }
        const meta = outcome.meta;
        setTrack({ ...meta, id: uid() });
        setInspector("sound");
        setOutputBase(defaultOutputBase(meta.name));
        setEditingName(false);
        setTrimStart(0);
        setTrimEnd(meta.duration);
        setTone(freshTone());
        setBands([...FLAT_BANDS]);
        setSpeed(1);
        setQuality("maximum");
        setFormat("mp3");
        setSampleRate(0);
        setFadeIn(0);
        setFadeOut(0);
        setProgress(0);
      } catch (error) {
        onToast({
          tone: "error",
          title: "Could not read that audio file",
          description: errorText(error),
        });
      } finally {
        setImporting(false);
      }
    },
    [onToast],
  );

  const browse = useCallback(async () => {
    if (exportingRef.current || importing) return;
    try {
      const paths = await pickAudio();
      const path = paths.find(isAudioPath) ?? paths[0];
      if (path) await acceptPath(path);
    } catch (error) {
      onToast({
        tone: "error",
        title: "Couldn't open the file picker",
        description: errorText(error),
      });
    }
  }, [acceptPath, importing, onToast]);

  const handleFileDrop = useCallback(
    (paths: string[]) => {
      if (!activeRef.current || exportingRef.current) return;
      const audio = paths.filter(isAudioPath);
      if (audio.length === 0) {
        if (paths.length > 0) {
          onToast({ tone: "info", title: "Those files aren't audio" });
        }
        return;
      }
      if (audio.length > 1) {
        onToast({
          tone: "info",
          title: "One track at a time",
          description: "Loaded the first audio file.",
        });
      }
      void acceptPath(audio[0]);
    },
    [acceptPath, onToast],
  );

  const recordExport = useCallback((output: string) => {
    const entry: RecentExport = { path: output, name: fileName(output), at: Date.now() };
    setRecentExports((previous) => {
      const next = [entry, ...previous.filter((item) => item.path !== output)].slice(0, 6);
      try {
        localStorage.setItem(RECENT_EXPORTS_KEY, JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return subscribeAudioExport({
      onProgress: (event) => setProgress(event.percent),
      onDone: (event) => {
        setExporting(false);
        setProgress(0);
        if (event.cancelled) {
          onToast({ tone: "info", title: "Saving cancelled" });
          return;
        }
        if (event.error) {
          onToast({
            tone: "error",
            title: "Couldn't save that track",
            description: event.error,
          });
          return;
        }
        const output = event.output;
        if (!output) return;
        recordExport(output);
        if (openWhenDone) void revealPath(output);
        onToast({
          tone: "success",
          title: "Your file is ready",
          description: fileName(output),
          action: { label: "Show in folder", run: () => void revealPath(output) },
        });
      },
    });
  }, [onToast, openWhenDone, recordExport]);

  const buildRequest = useCallback((): AudioExportRequest | null => {
    if (!track) return null;
    return {
      path: track.path,
      duration: track.duration,
      bass: tone.bass,
      presence: tone.presence,
      treble: tone.treble,
      volume: tone.volume,
      bands: [...bands],
      format,
      quality: isLosslessFormat(format) ? "maximum" : quality,
      beyond,
      outputDir,
      filenamePattern: outputBase,
      trimStart: trimFrom,
      trimEnd: trimTo,
      speed,
      sampleRate,
      loudnessTarget: 0,
      fadeIn,
      fadeOut,
      title: "",
      artist: "",
      album: "",
    };
  }, [
    beyond,
    outputDir,
    outputBase,
    quality,
    format,
    sampleRate,
    fadeIn,
    fadeOut,
    bands,
    speed,
    tone,
    track,
    trimFrom,
    trimTo,
  ]);

  const editSnapshot = useMemo<EditSnapshot | null>(() => {
    if (!track) return null;
    return { tone, bands: [...bands], speed, trimStart: trimFrom, trimEnd: trimTo };
  }, [track, tone, bands, speed, trimFrom, trimTo]);

  useLayoutEffect(() => {
    let stack = historyStackRef.current;
    const trackId = track?.id ?? null;
    if (historyTrackRef.current !== trackId) {
      historyTrackRef.current = trackId;
      historyStackRef.current = [];
      stack = historyStackRef.current;
      historyIndexRef.current = -1;
      historyTimeRef.current = 0;
      historySeededRef.current = false;
    }
    if (!editSnapshot) {
      return;
    }

    const index = historyIndexRef.current;
    const initial = index === -1;
    const top = stack[index];
    const same =
      top &&
      top.speed === editSnapshot.speed &&
      top.trimStart === editSnapshot.trimStart &&
      top.trimEnd === editSnapshot.trimEnd &&
      top.tone.bass === editSnapshot.tone.bass &&
      top.tone.presence === editSnapshot.tone.presence &&
      top.tone.treble === editSnapshot.tone.treble &&
      top.tone.volume === editSnapshot.tone.volume &&
      top.bands.length === editSnapshot.bands.length &&
      top.bands.every((band, bandIndex) => band === editSnapshot.bands[bandIndex]);
    if (same) return;

    const now = Date.now();
    if (
      top &&
      !initial &&
      historySeededRef.current &&
      index === stack.length - 1 &&
      now - historyTimeRef.current < 350
    ) {
      stack[index] = editSnapshot;
    } else {
      stack.splice(index + 1);
      stack.push(editSnapshot);
      if (stack.length > 40) stack.shift();
      historyIndexRef.current = stack.length - 1;
    }
    if (!initial) historySeededRef.current = true;
    historyTimeRef.current = now;
  }, [editSnapshot, track]);

  useEffect(() => {
    const request = buildRequest();
    if (!request) {
      setResolvedPath("");
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void resolveOutputPath(request)
        .then((path) => {
          if (active) setResolvedPath(path);
        })
        .catch(() => undefined);
    }, 260);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [buildRequest, recentExports.length]);

  const beginFileNameEdit = useCallback(() => {
    if (exporting) return;
    setFileNameDraft(outputBase);
    setEditingName(true);
    window.setTimeout(() => {
      fileNameInputRef.current?.focus();
      fileNameInputRef.current?.select();
    }, 0);
  }, [exporting, outputBase]);

  const cancelFileNameEdit = useCallback(() => {
    setEditingName(false);
  }, []);

  const saveFileName = useCallback(() => {
    const next = normalizeOutputBase(fileNameDraft, format);
    if (!next) return;
    setOutputBase(next);
    setEditingName(false);
  }, [fileNameDraft, format]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const wave = waveRef.current;
      if (!track || !wave) return;
      const rect = wave.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const next = clamp(ratio * track.duration, trimFrom, trimTo);
      positionRef.current = next;
      setPosition(next);
      const audio = audioRef.current;
      if (audio) {
        try {
          audio.currentTime = next;
        } catch {
        }
      }
    },
    [track, trimFrom, trimTo],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!track || exportingRef.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      seekFromClientX(event.clientX);
    },
    [seekFromClientX, track],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      seekFromClientX(event.clientX);
    },
    [seekFromClientX],
  );

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const trimFromClientX = useCallback(
    (clientX: number, side: "start" | "end") => {
      const wave = waveRef.current;
      if (!track || !wave || track.duration <= 0) return;
      const rect = wave.getBoundingClientRect();
      if (rect.width <= 0) return;
      const time = clamp((clientX - rect.left) / rect.width, 0, 1) * track.duration;
      const gap = Math.min(MIN_TRIM, track.duration / 3);
      if (side === "start") {
        setTrimStart(clamp(time, 0, Math.max(0, trimTo - gap)));
      } else {
        setTrimEnd(clamp(time, Math.min(track.duration, trimFrom + gap), track.duration));
      }
    },
    [track, trimFrom, trimTo],
  );

  const nudgeTrim = useCallback(
    (side: "start" | "end", delta: number) => {
      if (!track) return;
      const gap = Math.min(MIN_TRIM, track.duration / 3);
      if (side === "start") {
        setTrimStart((previous) => clamp(previous + delta, 0, Math.max(0, trimTo - gap)));
      } else {
        setTrimEnd((previous) => clamp(previous + delta, trimFrom + gap, track.duration));
      }
    },
    [track, trimFrom, trimTo],
  );

  const beginTrimDrag = useCallback(
    (side: "start" | "end") => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!track || exportingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      trimDragRef.current = side;
      event.currentTarget.setPointerCapture(event.pointerId);
      trimFromClientX(event.clientX, side);
    },
    [track, trimFromClientX],
  );

  const moveTrimDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const side = trimDragRef.current;
      if (!side) return;
      event.stopPropagation();
      trimFromClientX(event.clientX, side);
    },
    [trimFromClientX],
  );

  const endTrimDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    trimDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const fadeFromClientX = useCallback(
    (clientX: number, side: "in" | "out") => {
      const wave = waveRef.current;
      if (!track || !wave || track.duration <= 0) return;
      const rect = wave.getBoundingClientRect();
      if (rect.width <= 0) return;
      const time = clamp((clientX - rect.left) / rect.width, 0, 1) * track.duration;
      if (side === "in") {
        const limit = Math.max(0, Math.min(trimmedDuration - fadeOut, 30));
        setFadeIn(Math.round(clamp(time - trimFrom, 0, limit) * 10) / 10);
      } else {
        const limit = Math.max(0, Math.min(trimmedDuration - fadeIn, 30));
        setFadeOut(Math.round(clamp(trimTo - time, 0, limit) * 10) / 10);
      }
    },
    [track, trimFrom, trimTo, trimmedDuration, fadeIn, fadeOut],
  );

  const beginFadeDrag = useCallback(
    (side: "in" | "out") => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!track || exportingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      fadeDragRef.current = side;
      event.currentTarget.setPointerCapture(event.pointerId);
      fadeFromClientX(event.clientX, side);
    },
    [track, fadeFromClientX],
  );

  const moveFadeDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const side = fadeDragRef.current;
      if (!side) return;
      event.stopPropagation();
      fadeFromClientX(event.clientX, side);
    },
    [fadeFromClientX],
  );

  const endFadeDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    fadeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const nudgeFade = useCallback(
    (side: "in" | "out", delta: number) => {
      if (side === "in") {
        setFadeIn((value) =>
          Math.round(
            clamp(value + delta, 0, Math.max(0, Math.min(trimmedDuration - fadeOut, 30))) * 10,
          ) / 10,
        );
      } else {
        setFadeOut((value) =>
          Math.round(
            clamp(value + delta, 0, Math.max(0, Math.min(trimmedDuration - fadeIn, 30))) * 10,
          ) / 10,
        );
      }
    },
    [trimmedDuration, fadeIn, fadeOut],
  );

  useEffect(() => {
    setFadeIn((value) => Math.min(value, Math.max(0, trimmedDuration)));
    setFadeOut((value) => Math.min(value, Math.max(0, trimmedDuration)));
  }, [trimmedDuration]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        if (trimTo > 0 && audio.currentTime >= trimTo) {
          audio.pause();
          positionRef.current = trimTo;
          setPosition(trimTo);
          return;
        }
        positionRef.current = audio.currentTime;
        setPosition(audio.currentTime);
        const graph = graphRef.current;
        if (graph) {
          const t = audio.currentTime;
          let gain = 1;
          if (fadeIn > 0.05 && t - trimFrom < fadeIn) {
            gain = clamp((t - trimFrom) / fadeIn, 0, 1);
          }
          const remain = trimTo - t;
          if (fadeOut > 0.05 && remain < fadeOut) {
            gain = Math.min(gain, clamp(remain / fadeOut, 0, 1));
          }
          graph.fade.gain.setTargetAtTime(gain, graph.ctx.currentTime, 0.02);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, trimTo, trimFrom, fadeIn, fadeOut]);

  const ensureAudioGraph = useCallback(async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;

    let graph = graphRef.current;
    if (!graph) {
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(audio);

        const fade = ctx.createGain();
        const volume = ctx.createGain();

        const bass = ctx.createBiquadFilter();
        bass.type = "lowshelf";
        bass.frequency.value = 110;

        const presence = ctx.createBiquadFilter();
        presence.type = "peaking";
        presence.frequency.value = 3000;
        presence.Q.value = 1.1;

        const treble = ctx.createBiquadFilter();
        treble.type = "highshelf";
        treble.frequency.value = 10000;

        const bandFilters = BAND_FREQUENCIES.map((frequency) => {
          const filter = ctx.createBiquadFilter();
          filter.type = "peaking";
          filter.frequency.value = frequency;
          filter.Q.value = 1.1;
          return filter;
        });

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.005;
        limiter.release.value = 0.05;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.78;

        source.connect(fade);
        fade.connect(volume);
        volume.connect(bass);
        bass.connect(presence);
        presence.connect(treble);
        let previous: BiquadFilterNode = treble;
        for (const filter of bandFilters) {
          previous.connect(filter);
          previous = filter;
        }
        previous.connect(limiter);
        limiter.connect(analyser);
        analyser.connect(ctx.destination);

        graph = { ctx, source, fade, volume, bass, presence, treble, bands: bandFilters, limiter, analyser };
        graphRef.current = graph;
        applyToneToGraph(graph, tone, bands);
      } catch {
        return;
      }
    }

    if (!graph) return;
    if (graph.ctx.state === "suspended") {
      try {
        await graph.ctx.resume();
      } catch {
      }
    }
  }, [bands, tone]);

  const handlePreview = useCallback(async () => {
    if (!track || !sourceUrl || exportingRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    await ensureAudioGraph();

    if (audio.ended || audio.currentTime >= trimTo - 0.05 || audio.currentTime < trimFrom - 0.05) {
      audio.currentTime = trimFrom;
      positionRef.current = trimFrom;
      setPosition(trimFrom);
    }

    try {
      await audio.play();
    } catch (error) {
      setPlaying(false);
      onToast({
        tone: "error",
        title: "Could not play the preview",
        description: errorText(error),
      });
    }
  }, [ensureAudioGraph, onToast, sourceUrl, track, trimFrom, trimTo]);

  const beginExport = useCallback(async () => {
    const request = buildRequest();
    if (!request || exportingRef.current) return;
    audioRef.current?.pause();
    setPlaying(false);
    setInspector("export");
    setExporting(true);
    setProgress(0);
    try {
      await startAudioExport(request);
    } catch (error) {
      setExporting(false);
      onToast({
        tone: "error",
        title: "Couldn't start saving",
        description: errorText(error),
      });
    }
  }, [buildRequest, onToast]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelAudioExport();
    } catch (error) {
      onToast({
        tone: "error",
        title: "Couldn't cancel saving",
        description: errorText(error),
      });
    }
  }, [onToast]);

  const removeTrack = useCallback(async () => {
    if (!track || exportingRef.current) return;
    audioRef.current?.pause();
    setPlaying(false);
    setTrack(null);
    setTone(freshTone());
    setBands([...FLAT_BANDS]);
    setSpeed(1);
    setTrimStart(0);
    setTrimEnd(0);
    setPosition(0);
    positionRef.current = 0;
    setProgress(0);
    setOutputBase("");
    setResolvedPath("");
  }, [track]);

  const updateTone = useCallback((patch: Partial<Tone>) => {
    setTone((previous) => ({ ...previous, ...patch }));
  }, []);

  const applySnapshot = useCallback((snapshot: EditSnapshot) => {
    setTone({ ...snapshot.tone });
    setBands([...snapshot.bands]);
    setSpeed(snapshot.speed);
    setTrimStart(snapshot.trimStart);
    setTrimEnd(snapshot.trimEnd);
  }, []);

  const undo = useCallback(() => {
    const stack = historyStackRef.current;
    const next = historyIndexRef.current - 1;
    if (next < 0 || !stack[next]) return;
    historyIndexRef.current = next;
    historyTimeRef.current = 0;
    applySnapshot(stack[next]);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const stack = historyStackRef.current;
    const next = historyIndexRef.current + 1;
    if (next >= stack.length || !stack[next]) return;
    historyIndexRef.current = next;
    historyTimeRef.current = 0;
    applySnapshot(stack[next]);
  }, [applySnapshot]);

  const setBand = useCallback((index: number, value: number) => {
    setBands((previous) => previous.map((band, bandIndex) => (bandIndex === index ? value : band)));
  }, []);

  const tonePresets = useMemo(() => tonePresetsFor(beyond), [beyond]);
  const bandsFlat = bands.every((band) => band === 0);
  const activeTonePreset = useMemo(
    () =>
      bandsFlat
        ? tonePresets.find(
            (preset) =>
              preset.bass === tone.bass &&
              preset.presence === tone.presence &&
              preset.treble === tone.treble &&
              preset.volume === tone.volume,
          )?.id ?? "custom"
        : "custom",
    [bandsFlat, tone, tonePresets],
  );
  const activeCustomPreset = useMemo(
    () =>
      customPresets.find(
        (preset) =>
          preset.bands.length === bands.length &&
          preset.bands.every((band, index) => band === bands[index]) &&
          preset.tone.bass === tone.bass &&
          preset.tone.presence === tone.presence &&
          preset.tone.treble === tone.treble &&
          preset.tone.volume === tone.volume,
      )?.id ?? null,
    [customPresets, bands, tone],
  );
  const maxBoost = beyond ? 500 : 100;

  const applyTonePreset = useCallback((preset: TonePreset) => {
    setTone((previous) => ({
      ...previous,
      bass: preset.bass,
      presence: preset.presence,
      treble: preset.treble,
      volume: preset.volume,
    }));
    setBands([...FLAT_BANDS]);
  }, []);

  const applyCustomPreset = useCallback((preset: CustomTonePreset) => {
    setTone({ ...preset.tone });
    setBands(preset.bands.map((band) => clamp(band, -12, 12)));
  }, []);

  const deleteCustomPreset = useCallback((id: string) => {
    setCustomPresets((previous) => {
      const next = previous.filter((preset) => preset.id !== id);
      try {
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }, []);

  const canExport = Boolean(track) && !exporting && !importing;
  const normalizedBase = editingName
    ? normalizeOutputBase(fileNameDraft, format)
    : outputBase;
  const fileNameDirty = editingName && normalizedBase !== outputBase;
  const playhead = track && track.duration > 0 ? clamp(position / track.duration, 0, 1) : 0;
  const bandChanges = bands.filter((band) => band !== 0).length;
  const exportSeconds = trimmedDuration / Math.max(0.01, speed);
  const estimatedBytes = estimateAudioBytes(
    exportSeconds,
    format,
    quality,
    sampleRate || (track?.sampleRate ?? 0),
    track?.channels ?? 2,
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (
        target?.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) || tag === "BUTTON" || !track) return;
      if (event.code === "Space") {
        event.preventDefault();
        void handlePreview();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 1;
        const next = clamp(
          positionRef.current + (event.key === "ArrowLeft" ? -step : step),
          trimFrom,
          trimTo,
        );
        positionRef.current = next;
        setPosition(next);
        const audio = audioRef.current;
        if (audio) audio.currentTime = next;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePreview, redo, track, trimFrom, trimTo, undo]);

  return (
    <>
      <DynamicIsland playing={playing} notification={notification} getAnalyser={getAnalyser} />
      <div className="main-shell" hidden={!active}>
        <main className="main audio-main" ref={scrollRef}>
          <div className="studio">
          {environment && !environment.ffmpeg ? (
            <div className="audio-setup" role="alert">
              <div>
                <strong>One-time setup needed</strong>
                <span>
                  {environmentLoading
                    ? "Checking your computer…"
                    : "Reflux needs a free helper app called FFmpeg to open and save audio. Install it, then click Check again in Settings."}
                </span>
              </div>
              <button type="button" className="secondary-btn" onClick={onOpenSettings}>
                Open Settings
              </button>
            </div>
          ) : null}

          {track ? (
            <>
              <section className="studio-deck">
                <div
                  className="audio-wave"
                  ref={waveRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerEnd}
                >
                  {track.waveform ? (
                    <img className="audio-waveform" src={track.waveform} alt="" />
                  ) : null}
                  {track.duration > 0 && (
                    <>
                      <div
                        className="audio-trim-zone"
                        style={{
                          left: `${trimStartPct}%`,
                          width: `${Math.max(0, trimEndPct - trimStartPct)}%`,
                        }}
                        aria-hidden="true"
                      />
                      <div
                        className="audio-trim-shade is-before"
                        style={{ width: `${trimStartPct}%` }}
                        aria-hidden="true"
                      />
                      <div
                        className="audio-trim-shade is-after"
                        style={{ left: `${trimEndPct}%` }}
                        aria-hidden="true"
                      />
                    </>
                  )}
                  <div
                    className="audio-playhead"
                    style={{ left: `${playhead * 100}%` }}
                    aria-hidden="true"
                  >
                    <span className="audio-playhead-grip" />
                  </div>
                  {track.duration > 0 && (
                    <>
                      <button
                        type="button"
                        className="audio-trim-handle is-start"
                        style={{ left: `${trimStartPct}%` }}
                        onPointerDown={beginTrimDrag("start")}
                        onPointerMove={moveTrimDrag}
                        onPointerUp={endTrimDrag}
                        onPointerCancel={endTrimDrag}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          event.stopPropagation();
                          const step = event.shiftKey ? 5 : 0.5;
                          nudgeTrim("start", event.key === "ArrowLeft" ? -step : step);
                        }}
                        disabled={exporting}
                        aria-label="Trim start"
                        title="Drag to trim the start"
                      />
                      <button
                        type="button"
                        className="audio-trim-handle is-end"
                        style={{ left: `${trimEndPct}%` }}
                        onPointerDown={beginTrimDrag("end")}
                        onPointerMove={moveTrimDrag}
                        onPointerUp={endTrimDrag}
                        onPointerCancel={endTrimDrag}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          event.stopPropagation();
                          const step = event.shiftKey ? 5 : 0.5;
                          nudgeTrim("end", event.key === "ArrowLeft" ? -step : step);
                        }}
                        disabled={exporting}
                        aria-label="Trim end"
                        title="Drag to trim the end"
                      />
                    </>
                  )}
                  {track.duration > 0 && trimmedDuration > 0 ? (
                    <>
                      {fadeIn > 0.02 || fadeOut > 0.02 ? (
                        <svg
                          className="audio-fade-lines"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          {fadeIn > 0.02 ? (
                            <path
                              className="audio-fade-curve"
                              d={`M ${trimStartPct} 100 C ${trimStartPct + (fadeInPct - trimStartPct) * 0.6} 100, ${fadeInPct - (fadeInPct - trimStartPct) * 0.25} 0, ${fadeInPct} 0`}
                              vectorEffect="non-scaling-stroke"
                            />
                          ) : null}
                          {fadeOut > 0.02 ? (
                            <path
                              className="audio-fade-curve"
                              d={`M ${fadeOutPct} 0 C ${fadeOutPct + (trimEndPct - fadeOutPct) * 0.25} 100, ${trimEndPct - (trimEndPct - fadeOutPct) * 0.6} 100, ${trimEndPct} 100`}
                              vectorEffect="non-scaling-stroke"
                            />
                          ) : null}
                        </svg>
                      ) : null}
                      <button
                        type="button"
                        className="audio-fade-handle is-in"
                        style={{ left: `calc(8px + (100% - 16px) * ${fadeInPct / 100})` }}
                        onPointerDown={beginFadeDrag("in")}
                        onPointerMove={moveFadeDrag}
                        onPointerUp={endFadeDrag}
                        onPointerCancel={endFadeDrag}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          event.stopPropagation();
                          const step = event.shiftKey ? 1 : 0.1;
                          nudgeFade("in", event.key === "ArrowLeft" ? -step : step);
                        }}
                        disabled={exporting}
                        aria-label="Fade in"
                        title={`Fade in ${fadeIn.toFixed(1)}s — drag sideways`}
                      >
                        <span className="audio-fade-value">
                          {fadeIn > 0.02 ? `${fadeIn.toFixed(1)}s` : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="audio-fade-handle is-out"
                        style={{ left: `calc(8px + (100% - 16px) * ${fadeOutPct / 100})` }}
                        onPointerDown={beginFadeDrag("out")}
                        onPointerMove={moveFadeDrag}
                        onPointerUp={endFadeDrag}
                        onPointerCancel={endFadeDrag}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          event.stopPropagation();
                          const step = event.shiftKey ? 1 : 0.1;
                          nudgeFade("out", event.key === "ArrowLeft" ? step : -step);
                        }}
                        disabled={exporting}
                        aria-label="Fade out"
                        title={`Fade out ${fadeOut.toFixed(1)}s — drag sideways`}
                      >
                        <span className="audio-fade-value">
                          {fadeOut > 0.02 ? `${fadeOut.toFixed(1)}s` : ""}
                        </span>
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="studio-transport">
                  <button
                    type="button"
                    className="studio-play"
                    onClick={() => void handlePreview()}
                    disabled={exporting || preparingSource || !sourceUrl}
                    aria-label={
                      preparingSource
                        ? "Getting the preview ready"
                        : playing
                          ? "Pause"
                          : "Play the preview"
                    }
                  >
                    {preparingSource ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : playing ? (
                      <Pause size={13} fill="currentColor" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                  </button>
                  <span className="studio-clock">
                    {formatDuration(position)} <i>/</i> {formatDuration(track.duration)}
                  </span>
                  <button
                    type="button"
                    className="studio-icon-btn"
                    onClick={() => void removeTrack()}
                    disabled={exporting}
                    aria-label="Remove audio track"
                    title="Remove track"
                  >
                    <X size={13} />
                  </button>
                </div>
              </section>

              <section className="studio-panel">
                <div className="studio-tabs" role="tablist" aria-label="Editor sections">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspector === "sound"}
                    className={inspector === "sound" ? "is-active" : undefined}
                    onClick={() => setInspector("sound")}
                  >
                    Sound
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspector === "export"}
                    className={inspector === "export" ? "is-active" : undefined}
                    onClick={() => setInspector("export")}
                  >
                    Export
                  </button>
                </div>
                {inspector === "sound" ? (
              <section className="audio-card">
                <div className="audio-card-head">
                  <span className="audio-card-title">Sound</span>
                  <div className="tone-presets" role="group" aria-label="Tone presets">
                    {tonePresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`tone-chip${activeTonePreset === preset.id ? " is-active" : ""}`}
                        onClick={() => applyTonePreset(preset)}
                        disabled={exporting}
                      >
                        {preset.label}
                      </button>
                    ))}
                    {customPresets.map((preset) => (
                      <span
                        key={preset.id}
                        className={`tone-chip-group${activeCustomPreset === preset.id ? " is-active" : ""}`}
                      >
                        <button
                          type="button"
                          className="tone-chip"
                          onClick={() => applyCustomPreset(preset)}
                          disabled={exporting}
                        >
                          {preset.label}
                        </button>
                        <button
                          type="button"
                          className="tone-chip-remove"
                          onClick={() => deleteCustomPreset(preset.id)}
                          disabled={exporting}
                          aria-label={`Delete ${preset.label} preset`}
                        >
                          <X size={8} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="audio-sliders">
                  <PercentageRow
                    label="Bass"
                    value={tone.bass}
                    max={maxBoost}
                    disabled={exporting}
                    onChange={(bass) => updateTone({ bass })}
                  />
                  <PercentageRow
                    label="Vocals"
                    value={tone.presence}
                    max={maxBoost}
                    disabled={exporting}
                    onChange={(presence) => updateTone({ presence })}
                  />
                  <PercentageRow
                    label="Brightness"
                    value={tone.treble}
                    max={maxBoost}
                    disabled={exporting}
                    onChange={(treble) => updateTone({ treble })}
                  />
                  <PercentageRow
                    label="Volume"
                    value={tone.volume}
                    max={200}
                    disabled={exporting}
                    onChange={(volume) => updateTone({ volume })}
                  />
                  <SpeedRow value={speed} disabled={exporting} onChange={setSpeed} />
                </div>
                <details className="audio-eq">
                  <summary className="audio-details-summary">
                    <span>Fine-tune sound</span>
                    <span>{bandChanges > 0 ? `${bandChanges} changed` : "Not adjusted"}</span>
                  </summary>
                  <div className="audio-eq-grid">
                    {BAND_FREQUENCIES.map((frequency, index) => (
                      <label className="audio-eq-band" key={frequency}>
                        <span className="audio-eq-value">
                          {bands[index] > 0 ? `+${bands[index]}` : bands[index]}
                        </span>
                        <input
                          className="audio-eq-slider"
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={bands[index] ?? 0}
                          onChange={(event) => setBand(index, Number(event.target.value))}
                          disabled={exporting}
                          aria-label={`${frequency} hertz`}
                        />
                        <span className="audio-eq-label">
                          {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
                        </span>
                      </label>
                    ))}
                  </div>
                </details>
              </section>
                ) : (
              <section className="audio-overview" aria-label="Export settings">
                <div className="studio-section-title">Output</div>
                <div className="studio-quality-row">
                  <span className="studio-field-label">Quality</span>
                  {isLosslessFormat(format) ? (
                    <strong className="studio-quality-full">
                      {formatLabel(format)} · nothing removed
                    </strong>
                  ) : (
                    <AudioQualitySelect value={quality} disabled={exporting} onChange={setQuality} />
                  )}
                </div>
                <div className="audio-export-row">
                  <div className="audio-export-field">
                    <span>Save as</span>
                    <AudioSelect
                      value={format}
                      options={[
                        ...AUDIO_FORMAT_OPTIONS.map((option) => ({
                          value: option.value,
                          label: option.label,
                          hint: option.hint,
                        })),
                        ...(EXTRA_AUDIO_FORMATS.some((option) => option.value === format)
                          ? [
                              {
                                value: format,
                                label: formatLabel(format),
                                hint:
                                  EXTRA_AUDIO_FORMATS.find((option) => option.value === format)
                                    ?.hint ?? "Custom format",
                              },
                            ]
                          : []),
                        { value: "__custom", label: "Custom…", hint: "Type any audio format" },
                      ]}
                      label="Save as"
                      disabled={exporting}
                      onChange={(next) => {
                        if (next === "__custom") {
                          setCustomFormatOpen(true);
                          setFormatDraft("");
                          return;
                        }
                        setCustomFormatOpen(false);
                        setFormat(next as AudioFormat);
                      }}
                    />
                    {customFormatOpen ? (
                      <div className="audio-custom-format">
                        <span className="audio-custom-dot">.</span>
                        <input
                          className={`text-input audio-custom-input${
                            formatDraft.trim() && !normalizeAudioFormat(formatDraft)
                              ? " is-invalid"
                              : ""
                          }`}
                          value={formatDraft}
                          placeholder="ogg"
                          maxLength={8}
                          autoFocus
                          onChange={(event) => {
                            const next = event.target.value;
                            setFormatDraft(next);
                            const parsed = normalizeAudioFormat(next);
                            if (parsed) setFormat(parsed);
                          }}
                          disabled={exporting}
                          aria-label="Custom audio format"
                          aria-invalid={Boolean(formatDraft.trim()) && !normalizeAudioFormat(formatDraft)}
                        />
                        <small className="audio-custom-note">
                          {formatDraft.trim() === ""
                            ? "Type an audio format, e.g. ogg"
                            : normalizeAudioFormat(formatDraft)
                              ? `Saved as .${normalizeAudioFormat(formatDraft)}`
                              : "Not an audio format"}
                        </small>
                      </div>
                    ) : null}
                  </div>
                  <div className="audio-export-field">
                    <span>Sound detail</span>
                    <AudioSelect
                      value={String(sampleRate)}
                      options={AUDIO_SAMPLE_RATE_OPTIONS}
                      label="Sound detail"
                      disabled={exporting}
                      onChange={(next) => setSampleRate(Number(next))}
                    />
                  </div>
                </div>
                <div className="audio-filename">
                  <button
                    type="button"
                    className="audio-filename-pencil"
                    onClick={editingName ? () => fileNameInputRef.current?.select() : beginFileNameEdit}
                    disabled={exporting}
                    aria-label="Edit file name"
                    title="Edit file name"
                  >
                    <Pencil size={12} strokeWidth={1.8} />
                  </button>
                  <input
                    ref={fileNameInputRef}
                    className={`audio-filename-input${editingName ? " is-editing" : ""}`}
                    value={editingName ? fileNameDraft : outputBase}
                    readOnly={!editingName}
                    disabled={exporting}
                    onChange={(event) => setFileNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (fileNameDirty && normalizedBase) saveFileName();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelFileNameEdit();
                      }
                    }}
                    aria-label="Output file name"
                    spellCheck={false}
                  />
                  <span className="audio-filename-ext">.{format}</span>
                  {fileNameDirty ? (
                    <button
                      type="button"
                      className="audio-filename-save"
                      onClick={saveFileName}
                      disabled={exporting || !normalizedBase}
                    >
                      Save
                    </button>
                  ) : null}
                </div>
                <div className="audio-output-path" title={resolvedPath || undefined}>
                  <FolderOpen size={9} />
                  <span>{resolvedPath ? truncateMiddle(resolvedPath, 72) : "Checking destination…"}</span>
                </div>
                {recentExports.length > 0 ? (
                  <details className="audio-recent">
                    <summary className="audio-details-summary">
                      <span>Recently saved</span>
                      <span>{recentExports.length}</span>
                    </summary>
                    <div className="audio-recent-list">
                      {recentExports.map((entry) => (
                        <button
                          key={`${entry.path}-${entry.at}`}
                          type="button"
                          className="audio-recent-item"
                          onClick={() => void revealPath(entry.path)}
                          title={entry.path}
                        >
                          <span>{entry.name}</span>
                          <small>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                          <FolderOpen size={10} />
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
              </section>
                )}
              </section>

              {inspector === "export" || exporting ? (
              <div className="studio-savebar">
                {exporting ? (
                  <>
                    <div
                      className="studio-progress"
                      role="progressbar"
                      aria-label="Saving progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress)}
                    >
                      <span style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
                    </div>
                    <span className="studio-progress-pct">{Math.round(progress)}%</span>
                    <button
                      type="button"
                      className="studio-cancel"
                      onClick={() => void handleCancel()}
                    >
                      <X size={12} />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="studio-savebar-meta">
                      <span>
                        {formatLabel(format)} ·{" "}
                        {isLosslessFormat(format) ? "Full quality" : qualityLabel(quality)}
                      </span>
                      <small>
                        ~{formatBytes(estimatedBytes)} · {formatDuration(exportSeconds)}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="studio-save"
                      onClick={() => void beginExport()}
                      disabled={!canExport}
                    >
                      Export
                      <ArrowRight size={14} strokeWidth={2.2} />
                    </button>
                  </>
                )}
              </div>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="studio-empty"
              onClick={() => void browse()}
              disabled={importing}
            >
              <span className="studio-empty-square">
                <span className="studio-empty-icon">
                  {importing ? (
                    <LoaderCircle size={26} className="spin" />
                  ) : (
                    <Upload size={26} strokeWidth={1.6} />
                  )}
                </span>
                <span className="studio-empty-title">
                  {importing ? "Reading your track" : "Drop audio here"}
                </span>
                <span className="studio-empty-hint">
                  {importing ? "this only takes a moment" : "or browse files"}
                </span>
              </span>
              <span className="studio-empty-formats">supports all audio types</span>
            </button>
          )}
          </div>
        </main>
        <CustomScrollbar targetRef={scrollRef} label="Editor" />
      </div>

      <audio
        hidden
        ref={audioRef}
        src={sourceUrl}
        preload="auto"
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          positionRef.current = 0;
          setPosition(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
      />

      <FileDropOverlay active={active} onDrop={handleFileDrop} />
    </>
  );
}
