import { describe, expect, test } from "bun:test";
import {
  defaultOutputBase,
  estimateAudioBytes,
  normalizeOutputBase,
  outputFileName,
} from "./audio";

describe("normalizeOutputBase", () => {
  test("keeps a normal base name", () => {
    expect(normalizeOutputBase("Late Night Mix", "mp3")).toBe("Late Night Mix");
  });

  test("removes the current format suffix if it is typed", () => {
    expect(normalizeOutputBase("Late Night Mix.mp3", "mp3")).toBe("Late Night Mix");
    expect(normalizeOutputBase("Late Night Mix.WAV", "wav")).toBe("Late Night Mix");
  });

  test("removes characters Windows rejects", () => {
    expect(normalizeOutputBase('a<b>c:d"e/f\\g|h?i*j', "mp3")).toBe("abcdefghij");
  });

  test("trims whitespace and trailing dots", () => {
    expect(normalizeOutputBase("  song...  ", "flac")).toBe("song");
  });

  test("avoids Windows reserved device names", () => {
    expect(normalizeOutputBase("CON", "mp3")).toBe("_CON");
    expect(normalizeOutputBase("lpt1", "mp3")).toBe("_lpt1");
  });

  test("rejects names that only contain invalid characters", () => {
    expect(normalizeOutputBase("///", "mp3")).toBe("");
    expect(normalizeOutputBase("   ", "mp3")).toBe("");
  });

  test("caps names at 120 characters", () => {
    expect(normalizeOutputBase("a".repeat(200), "mp3")).toHaveLength(120);
  });
});

describe("output naming", () => {
  test("derives the default base from the track name", () => {
    expect(defaultOutputBase("midnight-drive.mp3")).toBe("midnight-drive_edited");
    expect(defaultOutputBase("no-extension")).toBe("no-extension_edited");
  });

  test("uses the selected format", () => {
    expect(outputFileName("song", "wav")).toBe("song.wav");
    expect(outputFileName("song", "m4a")).toBe("song.m4a");
  });
});

describe("estimateAudioBytes", () => {
  test("estimates compressed audio from bitrate", () => {
    expect(estimateAudioBytes(60, "mp3", "maximum", 44100, 2)).toBe(2_400_000);
  });

  test("estimates WAV from rate, channels, and 24-bit samples", () => {
    expect(estimateAudioBytes(10, "wav", "maximum", 48000, 2)).toBe(2_880_000);
  });

  test("returns zero for no duration", () => {
    expect(estimateAudioBytes(0, "flac", "high", 44100, 2)).toBe(0);
  });
});
