import type { AudioFormat, AudioQuality } from "../types";

export const BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export interface AudioQualityOption {
  value: AudioQuality;
  label: string;
  hint: string;
  kbps: number;
}

export const AUDIO_QUALITY_OPTIONS: AudioQualityOption[] = [
  { value: "low", label: "Low", hint: "Smallest file", kbps: 96 },
  { value: "standard", label: "Standard", hint: "Good for most songs", kbps: 160 },
  { value: "high", label: "High", hint: "More detail", kbps: 256 },
  { value: "maximum", label: "Best", hint: "Highest detail", kbps: 320 },
];

export function qualityKbps(quality: AudioQuality): number {
  return AUDIO_QUALITY_OPTIONS.find((option) => option.value === quality)?.kbps ?? 320;
}

export function qualityLabel(quality: AudioQuality): string {
  return AUDIO_QUALITY_OPTIONS.find((option) => option.value === quality)?.label ?? "Best";
}

export interface AudioFormatOption {
  value: AudioFormat;
  label: string;
  hint: string;
  lossless: boolean;
}

export const AUDIO_FORMAT_OPTIONS: AudioFormatOption[] = [
  { value: "mp3", label: "MP3", hint: "Small file · plays anywhere", lossless: false },
  { value: "wav", label: "WAV", hint: "Full quality · very large file", lossless: true },
  { value: "flac", label: "FLAC", hint: "Perfect copy · smaller than WAV", lossless: true },
  { value: "m4a", label: "M4A", hint: "Small file · Apple-friendly", lossless: false },
];

export const EXTRA_AUDIO_FORMATS: AudioFormatOption[] = [
  { value: "aac", label: "AAC", hint: "Small file · widely supported", lossless: false },
  { value: "ogg", label: "OGG", hint: "Vorbis · open and small", lossless: false },
  { value: "opus", label: "OPUS", hint: "Smallest file · speech and music", lossless: false },
  { value: "aiff", label: "AIFF", hint: "Full quality · Apple studios", lossless: true },
  { value: "wma", label: "WMA", hint: "Windows-friendly", lossless: false },
  { value: "ac3", label: "AC3", hint: "Surround-friendly", lossless: false },
];

const ALL_FORMAT_OPTIONS = [...AUDIO_FORMAT_OPTIONS, ...EXTRA_AUDIO_FORMATS];

export function normalizeAudioFormat(value: string): AudioFormat | null {
  const cleaned = value.trim().replace(/^\.+/, "").toLowerCase();
  if (!cleaned) return null;
  return ALL_FORMAT_OPTIONS.find((option) => option.value === cleaned)?.value ?? null;
}

export function isLosslessFormat(format: AudioFormat): boolean {
  return ALL_FORMAT_OPTIONS.find((option) => option.value === format)?.lossless ?? false;
}

export function formatLabel(format: AudioFormat): string {
  return ALL_FORMAT_OPTIONS.find((option) => option.value === format)?.label ?? format.toUpperCase();
}

export interface AudioSampleRateOption {
  value: string;
  label: string;
}

export const AUDIO_SAMPLE_RATE_OPTIONS: AudioSampleRateOption[] = [
  { value: "0", label: "Same as original" },
  { value: "44100", label: "44.1 kHz · music" },
  { value: "48000", label: "48 kHz · video" },
];

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function defaultOutputBase(trackName: string): string {
  const stem = trackName.replace(/\.[^.]+$/, "");
  return `${stem}_edited`;
}

export function normalizeOutputBase(value: string, format: AudioFormat): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!cleaned) return "";

  const suffix = `.${format}`;
  const withoutSuffix = cleaned.toLowerCase().endsWith(suffix)
    ? cleaned.slice(0, -suffix.length)
    : cleaned;
  let base = withoutSuffix.trim().replace(/[. ]+$/g, "");
  if (!base) return "";
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  return base.slice(0, 120);
}

export function outputFileName(base: string, format: AudioFormat): string {
  return `${base}.${format}`;
}

export function estimateAudioBytes(
  seconds: number,
  format: AudioFormat,
  quality: AudioQuality,
  sampleRate: number,
  channels: number,
): number {
  const duration = Math.max(0, seconds);
  if (duration <= 0) return 0;
  if (isLosslessFormat(format)) {
    const rate = sampleRate > 0 ? sampleRate : 44100;
    const bytes = duration * rate * Math.max(1, channels) * 3;
    return Math.round(format === "flac" ? bytes * 0.62 : bytes);
  }
  return Math.round((duration * qualityKbps(quality) * 1000) / 8);
}
