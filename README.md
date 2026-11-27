<p align="center">
  <img src="assets/reflux_banner.png" alt="Reflux" />
</p>

<h1 align="center">Reflux</h1>

<p align="center">
  A small Windows audio editor for quick cuts, fades, tone changes, and exports.
</p>

Reflux is a desktop audio editor that runs locally. Drop in a track, trim the parts you don't want, shape the sound, and save it in the format you need. There is no account, no upload, and no internet connection required.

## Features

- Drag and drop an audio file, or browse for one. Reflux reads the common formats FFmpeg supports.
- Trim the start and end on the waveform, with adjustable fade in and fade out.
- Shape the sound with Bass, Vocals, and Brightness controls, plus a 10-band EQ from 31 Hz to 16 kHz.
- Start from the Bass, Vocals, or Bright presets, or save your own.
- Change speed from 0.5× to 5× while keeping the pitch.
- Preview edits before saving, with undo and redo.
- Export to MP3, WAV, FLAC, or M4A. AAC, OGG, Opus, AIFF, WMA, and AC3 are available too.
- Choose the quality, sample rate, file name, and output folder.
- Everything is processed on your computer.

Reflux works on one track at a time.

## Download

Get the latest installer from the [Releases page](https://github.com/meowspiderr/Reflux/releases).

Reflux is built for Windows 11 (64-bit).

## FFmpeg

Reflux uses [FFmpeg](https://ffmpeg.org/) to read and write audio. It does not include its own copy, so FFmpeg needs to be installed separately.

Make sure `ffmpeg.exe` and `ffprobe.exe` are on your PATH, or put both files in a folder named `ffmpeg` next to `Reflux.exe`. Open Settings in Reflux and click **Check again** to confirm it was found.

## Getting started

1. Install Reflux, then install FFmpeg if you don't already have it.
2. Open Settings and choose where exported files should go. If you leave this blank, files are saved next to the original.
3. Drop an audio file onto the window, or click the box to browse.
4. Drag the trim handles to set the start and end. Drag the fade handles if you want a fade.
5. Use the Sound tab to adjust the tone, EQ, and speed.
6. Open the Export tab, pick a format and file name, then click **Export**.

The finished file appears in your output folder. You can also open it from the Recently saved list.

## Settings

- **Where files are saved** sets the output folder.
- **Show the saved file** opens the folder when an export finishes.
- **Beyond!** raises the Bass, Vocals, and Brightness limits from 100% to 500%.
- **Theme** switches between light and dark.
- **FFmpeg helper** shows the detected version and lets you check again after installing.

## Build from source

You need:

- Windows 11
- [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri's Windows prerequisites](https://tauri.app/start/prerequisites/) (Microsoft C++ Build Tools and WebView2)
- FFmpeg on your PATH

Install the dependencies and start the app:

```bash
bun install
bun run tauri dev
```

Build the installer:

```bash
bun run tauri build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`.

Run the checks:

```bash
bun test
bun run build
cd src-tauri && cargo test
```

## License

Reflux is released under the GNU General Public License v3.0. See [LICENSE](LICENSE) for the full text.

Copyright © 2026 Spiderr.
