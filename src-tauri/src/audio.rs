use crate::ffmpeg;
use base64::Engine;
use crate::models::{
    AudioDonePayload, AudioExportRequest, AudioMeta, AudioProbeOutcome,
    AudioProgressPayload, SilenceBounds,
};
use serde_json::Value;
use std::env;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const BAND_FREQUENCIES: [f64; 10] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Default)]
pub struct AudioState {
    pub running: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub child: Arc<Mutex<Option<Child>>>,
}

enum JobError {
    Cancelled,
    Failed(String),
}

fn parse_u32(value: &Value) -> u32 {
    value
        .as_str()
        .and_then(|text| text.parse::<u32>().ok())
        .or_else(|| value.as_u64().map(|number| number as u32))
        .unwrap_or(0)
}

fn parse_u64(value: &Value) -> u64 {
    value
        .as_str()
        .and_then(|text| text.parse::<u64>().ok())
        .or_else(|| value.as_u64())
        .unwrap_or(0)
}

fn waveform(tools: &ffmpeg::Tools, file: &Path) -> Option<String> {
    let output = ffmpeg::hidden_command(&tools.ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(file)
        .args([
            "-filter_complex",
            "[0:a:0]aformat=channel_layouts=mono,showwavespic=s=720x128:colors=0x9aa0a8",
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "-",
        ])
        .stdin(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Some(format!("data:image/png;base64,{encoded}"))
}

pub fn probe(tools: &ffmpeg::Tools, path: &str) -> Result<AudioMeta, String> {
    let file = Path::new(path);
    if !file.is_file() {
        return Err("File not found".to_string());
    }

    let output = ffmpeg::hidden_command(&tools.ffprobe)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(file)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not run FFprobe: {error}"))?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr)
            .lines()
            .last()
            .unwrap_or("Unreadable audio file")
            .to_string();
        return Err(message);
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Invalid FFprobe output: {error}"))?;
    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let audio = streams
        .iter()
        .find(|stream| stream["codec_type"].as_str() == Some("audio"))
        .ok_or_else(|| "No audio stream found".to_string())?;

    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| *value > 0.0)
        .or_else(|| {
            audio["duration"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
        })
        .unwrap_or(0.0);

    let name = file
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string();
    let size = parse_u64(&json["format"]["size"])
        .max(std::fs::metadata(file).map(|meta| meta.len()).unwrap_or(0));
    let bitrate = parse_u64(&json["format"]["bit_rate"]).max(parse_u64(&audio["bit_rate"]));

    let tag = |key: &str| {
        json["format"]["tags"]
            .as_object()
            .and_then(|tags| {
                tags.iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case(key))
                    .and_then(|(_, value)| value.as_str())
            })
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };

    Ok(AudioMeta {
        path: path.to_string(),
        name,
        duration,
        codec: audio["codec_name"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        sample_rate: parse_u32(&audio["sample_rate"]),
        channels: audio["channels"].as_u64().unwrap_or(0) as u32,
        bitrate,
        size,
        waveform: waveform(tools, file),
        title: tag("title"),
        artist: tag("artist"),
        album: tag("album"),
    })
}

pub fn probe_path(path: String) -> Result<AudioProbeOutcome, String> {
    let Some(tools) = ffmpeg::discover() else {
        return Ok(AudioProbeOutcome {
            path,
            meta: None,
            error: Some("FFmpeg was not found".to_string()),
        });
    };

    Ok(match probe(&tools, &path) {
        Ok(meta) => AudioProbeOutcome {
            path,
            meta: Some(meta),
            error: None,
        },
        Err(error) => AudioProbeOutcome {
            path,
            meta: None,
            error: Some(error),
        },
    })
}

pub fn detect_silence(path: &str, duration: f64) -> Result<SilenceBounds, String> {
    let source = Path::new(path);
    if !source.is_file() {
        return Err("The source file is missing".to_string());
    }
    let tools = ffmpeg::discover().ok_or_else(|| "FFmpeg was not found".to_string())?;
    let output = ffmpeg::hidden_command(&tools.ffmpeg)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(source)
        .args([
            "-af",
            "silencedetect=noise=-35dB:d=0.4",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;

    if !output.status.success() {
        return Err(failure_message(&String::from_utf8_lossy(&output.stderr)));
    }

    let text = String::from_utf8_lossy(&output.stderr);
    let mut intervals: Vec<(f64, Option<f64>)> = Vec::new();
    for line in text.lines() {
        if let Some(position) = line.find("silence_start:") {
            let value = line[position + "silence_start:".len()..]
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok());
            if let Some(value) = value {
                intervals.push((value, None));
            }
        } else if let Some(position) = line.find("silence_end:") {
            let value = line[position + "silence_end:".len()..]
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok());
            if let (Some(value), Some(last)) = (value, intervals.last_mut()) {
                last.1 = Some(value);
            }
        }
    }

    let total = if duration.is_finite() && duration > 0.0 {
        duration
    } else {
        0.0
    };
    if total <= 0.0 {
        return Err("The track length is unavailable".to_string());
    }

    let mut start = 0.0f64;
    let mut end = total;
    if let Some((silence_start, Some(silence_end))) = intervals.first() {
        if *silence_start <= 0.05 {
            start = *silence_end;
        }
    }
    if let Some((silence_start, silence_end)) = intervals.last() {
        let reaches_end = silence_end.map(|value| value >= total - 0.15).unwrap_or(true);
        if reaches_end && *silence_start > 0.1 {
            end = *silence_start;
        }
    }

    start = start.clamp(0.0, total);
    end = end.clamp(0.0, total);
    if end <= start + 0.1 {
        return Ok(SilenceBounds {
            start: 0.0,
            end: total,
        });
    }
    Ok(SilenceBounds { start, end })
}

fn filter_chain(request: &AudioExportRequest) -> Option<String> {
    let mut filters: Vec<String> = Vec::new();

    let (trim_start, trim_end) = trim_bounds(request);
    let trimmed = trim_end - trim_start > 0.01
        && (trim_start > 0.005 || trim_end < request.duration - 0.005);
    if trimmed {
        filters.push(format!("atrim=start={trim_start:.3}:end={trim_end:.3}"));
        filters.push("asetpts=PTS-STARTPTS".to_string());
    }

    let tempo = speed_value(request.speed);
    if (tempo - 1.0).abs() > 0.001 {
        filters.push(atempo_chain(tempo));
    }

    let output_span = ((trim_end - trim_start).max(0.0) / tempo).max(0.0);
    let fade_in = request.fade_in.clamp(0.0, output_span);
    if fade_in > 0.01 {
        filters.push(format!("afade=t=in:st=0:d={fade_in:.3}"));
    }
    let fade_out = request.fade_out.clamp(0.0, output_span);
    if fade_out > 0.01 {
        filters.push(format!(
            "afade=t=out:st={:.3}:d={fade_out:.3}",
            (output_span - fade_out).max(0.0)
        ));
    }

    let volume = request.volume.clamp(0.0, 200.0);
    if (volume - 100.0).abs() > 0.05 {
        filters.push(format!("volume={:.4}", volume / 100.0));
    }

    let limit = if request.beyond { 500.0 } else { 100.0 };

    let bass = request.bass.clamp(0.0, limit);
    if bass > 0.05 {
        filters.push(format!("bass=g={:.2}:f=110:t=q:w=0.7", bass * 0.15));
    }

    let presence = request.presence.clamp(0.0, limit);
    if presence > 0.05 {
        filters.push(format!(
            "equalizer=f=3000:t=q:w=1.1:g={:.2}",
            presence * 0.09
        ));
    }

    let treble = request.treble.clamp(0.0, limit);
    if treble > 0.05 {
        filters.push(format!("treble=g={:.2}:f=10000:t=q:w=0.7", treble * 0.12));
    }

    for (index, frequency) in BAND_FREQUENCIES.iter().enumerate() {
        let gain = request
            .bands
            .get(index)
            .copied()
            .unwrap_or(0.0)
            .clamp(-12.0, 12.0);
        if gain.abs() > 0.05 {
            filters.push(format!(
                "equalizer=f={frequency}:t=q:w=1.1:g={gain:.2}"
            ));
        }
    }

    if request.loudness_target.is_finite() && request.loudness_target < -0.1 {
        let target = request.loudness_target.clamp(-30.0, -5.0);
        filters.push(format!("loudnorm=I={target:.1}:TP=-1.5:LRA=11"));
    }

    if filters.is_empty() {
        return None;
    }
    filters.push("alimiter=limit=0.98:attack=5:release=50:level=0".to_string());
    Some(filters.join(","))
}

fn speed_value(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.5, 5.0)
    } else {
        1.0
    }
}

fn atempo_chain(speed: f64) -> String {
    let mut remaining = speed_value(speed);
    let mut factors: Vec<f64> = Vec::new();
    while remaining > 2.0 {
        factors.push(2.0);
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        factors.push(0.5);
        remaining /= 0.5;
    }
    factors.push(remaining);
    factors
        .iter()
        .map(|factor| format!("atempo={factor:.5}"))
        .collect::<Vec<String>>()
        .join(",")
}

fn trim_bounds(request: &AudioExportRequest) -> (f64, f64) {
    let duration = if request.duration.is_finite() && request.duration > 0.0 {
        request.duration
    } else {
        0.0
    };
    let start = if request.trim_start.is_finite() {
        request.trim_start.clamp(0.0, duration)
    } else {
        0.0
    };
    let end = if request.trim_end.is_finite() && request.trim_end > start + 0.01 {
        request.trim_end.min(duration).max(start)
    } else {
        duration
    };
    (start, end)
}

fn bitrate_for(quality: &str) -> &'static str {
    match quality {
        "low" => "96k",
        "standard" => "160k",
        "high" => "256k",
        _ => "320k",
    }
}

fn codec_for(format: &str, quality: &str, sample_rate: u32) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    match format {
        "wav" => {
            args.extend(["-c:a", "pcm_s24le"].map(str::to_string));
        }
        "flac" => {
            args.extend(
                ["-c:a", "flac", "-compression_level", "5", "-frame_size", "4096"]
                    .map(str::to_string),
            );
        }
        "m4a" | "aac" => {
            args.extend(["-c:a", "aac"].map(str::to_string));
            args.push("-b:a".to_string());
            args.push(bitrate_for(quality).to_string());
        }
        "ogg" => {
            args.extend(["-c:a", "libvorbis"].map(str::to_string));
            args.push("-b:a".to_string());
            args.push(bitrate_for(quality).to_string());
        }
        "opus" => {
            args.extend(["-c:a", "libopus"].map(str::to_string));
            args.push("-b:a".to_string());
            args.push(bitrate_for(quality).to_string());
        }
        "wma" => {
            args.extend(["-c:a", "wmav2"].map(str::to_string));
            args.push("-b:a".to_string());
            args.push(bitrate_for(quality).to_string());
        }
        "ac3" => {
            args.extend(["-c:a", "ac3"].map(str::to_string));
            args.push("-b:a".to_string());
            args.push(bitrate_for(quality).to_string());
        }
        "aiff" => {
            args.extend(["-c:a", "pcm_s24be"].map(str::to_string));
        }
        _ => {
            args.extend(
                ["-c:a", "libmp3lame", "-id3v2_version", "3"].map(str::to_string),
            );
            args.push("-b:a".to_string());
            args.push(bitrate_for(quality).to_string());
        }
    }
    if sample_rate > 0 {
        args.push("-ar".to_string());
        args.push(sample_rate.to_string());
    }
    args
}

fn extension_for(format: &str) -> &'static str {
    match format {
        "wav" => "wav",
        "flac" => "flac",
        "m4a" => "m4a",
        "aac" => "aac",
        "ogg" => "ogg",
        "opus" => "opus",
        "aiff" => "aiff",
        "wma" => "wma",
        "ac3" => "ac3",
        _ => "mp3",
    }
}

fn sanitize(value: &str) -> String {
    let mut cleaned = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => cleaned.push('-'),
            '\u{0000}'..='\u{001f}' => {}
            _ => cleaned.push(character),
        }
    }
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let limited: String = trimmed.chars().take(120).collect();
    if limited.is_empty() {
        "audio".to_string()
    } else {
        limited
    }
}

fn unique_path(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let candidate = directory.join(format!("{stem}.{extension}"));
    if !candidate.exists() {
        return candidate;
    }
    for index in 2..1000 {
        let candidate = directory.join(format!("{stem} ({index}).{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}.{extension}", std::process::id()))
}

 fn temp_target(extension: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    env::temp_dir().join(format!(
        "reflux-audio-{}-{stamp}.{extension}",
        std::process::id()
    ))
}

fn build_args(
    request: &AudioExportRequest,
    target: &Path,
    preview: bool,
) -> Vec<String> {
    let format = if preview {
        "mp3".to_string()
    } else {
        request.format.to_ascii_lowercase()
    };

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        request.path.clone(),
        "-map".into(),
        "0:a:0".into(),
        "-sn".into(),
        "-dn".into(),
    ];

    let preserves_artwork = !preview && matches!(format.as_str(), "mp3" | "m4a");
    if preview || !preserves_artwork {
        args.push("-vn".to_string());
    }

    if !preview {
        args.extend(["-map_metadata", "0"].map(str::to_string));
        if preserves_artwork {
            args.extend(["-map", "0:v?", "-c:v", "copy"].map(str::to_string));
        }
        for (key, value) in [
            ("title", request.title.trim()),
            ("artist", request.artist.trim()),
            ("album", request.album.trim()),
        ] {
            args.push("-metadata".to_string());
            args.push(format!("{key}={value}"));
        }
    }

    if let Some(filters) = filter_chain(request) {
        args.extend(["-af".to_string(), filters]);
    }

    let sample_rate = if preview {
        48_000
    } else if request.sample_rate > 0 {
        request.sample_rate
    } else if request.loudness_target < -0.1 {
        48_000
    } else {
        0
    };

    if preview {
        args.extend(codec_for("mp3", &request.quality, sample_rate));
    } else {
        args.extend(codec_for(&format, &request.quality, sample_rate));
    }

    if preview {
        args.extend(["-nostats"].map(str::to_string));
    } else {
        args.extend(["-progress", "pipe:1", "-nostats"].map(str::to_string));
    }

    args.push(target.to_string_lossy().to_string());
    args
}

fn failure_message(stderr: &str) -> String {
    let tail: Vec<&str> = stderr.lines().rev().take(5).collect();
    if tail.is_empty() {
        "FFmpeg exited with an error".to_string()
    } else {
        tail.into_iter().rev().collect::<Vec<&str>>().join("\n")
    }
}

pub fn render_preview(request: AudioExportRequest) -> Result<String, String> {
    let tools = ffmpeg::discover().ok_or_else(|| "FFmpeg was not found".to_string())?;
    let source = PathBuf::from(&request.path);
    if !source.is_file() {
        return Err("The source file is missing".to_string());
    }

    let target = temp_target("mp3");
    let args = build_args(&request, &target, true);
    let output = ffmpeg::hidden_command(&tools.ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&target);
        return Err(failure_message(&String::from_utf8_lossy(&output.stderr)));
    }

    Ok(target.to_string_lossy().to_string())
}

pub fn discard_preview(path: &str) {
    let target = PathBuf::from(path);
    if !target.starts_with(env::temp_dir()) {
        return;
    }
    let removable = target
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with("reflux-audio-"))
        .unwrap_or(false);
    if removable {
        let _ = std::fs::remove_file(target);
    }
}

pub fn start(
    app: AppHandle,
    state: AudioState,
    request: AudioExportRequest,
) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("An audio export is already running".to_string());
    }
    if request.path.trim().is_empty() {
        state.running.store(false, Ordering::SeqCst);
        return Err("There is no audio file to export".to_string());
    }
    if !Path::new(&request.path).is_file() {
        state.running.store(false, Ordering::SeqCst);
        return Err("The source file is missing".to_string());
    }
    if ffmpeg::discover().is_none() {
        state.running.store(false, Ordering::SeqCst);
        return Err("FFmpeg was not found".to_string());
    }

    state.cancel.store(false, Ordering::SeqCst);
    *state
        .child
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = None;

    std::thread::spawn(move || run(app, state, request));
    Ok(())
}

pub fn cancel(state: &AudioState) {
    state.cancel.store(true, Ordering::SeqCst);
    let child = state
        .child
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take();
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn run(app: AppHandle, state: AudioState, request: AudioExportRequest) {
    let outcome = run_job(&app, &state, &request);
    state.running.store(false, Ordering::SeqCst);
    state.cancel.store(false, Ordering::SeqCst);

    let payload = match outcome {
        Ok(path) => AudioDonePayload {
            output: Some(path.display().to_string()),
            cancelled: false,
            error: None,
        },
        Err(JobError::Cancelled) => AudioDonePayload {
            output: None,
            cancelled: true,
            error: None,
        },
        Err(JobError::Failed(message)) => AudioDonePayload {
            output: None,
            cancelled: false,
            error: Some(message),
        },
    };
    let _ = app.emit("audio://done", payload);
}

fn output_target(request: &AudioExportRequest) -> Result<(PathBuf, PathBuf), String> {
    let source = PathBuf::from(&request.path);
    if !source.is_file() {
        return Err("The source file is missing".to_string());
    }

    let output_dir = if request.output_dir.trim().is_empty() {
        source
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        PathBuf::from(request.output_dir.trim())
    };

    let format = request.format.to_ascii_lowercase();
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audio");
    let pattern = if request.filename_pattern.trim().is_empty() {
        "{name}_edited"
    } else {
        request.filename_pattern.as_str()
    };
    let base = sanitize(&pattern.replace("{ratio}", "").replace("{name}", stem));
    let target = unique_path(&output_dir, &base, extension_for(&format));
    Ok((output_dir, target))
}

pub fn resolve_output(request: AudioExportRequest) -> Result<String, String> {
    output_target(&request).map(|(_, target)| target.to_string_lossy().to_string())
}

fn run_job(
    app: &AppHandle,
    state: &AudioState,
    request: &AudioExportRequest,
) -> Result<PathBuf, JobError> {
    let tools = ffmpeg::discover()
        .ok_or_else(|| JobError::Failed("FFmpeg was not found".to_string()))?;
    let (output_dir, target) = output_target(request)
        .map_err(JobError::Failed)?;
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        JobError::Failed(format!("Could not create the output folder: {error}"))
    })?;
    let args = build_args(request, &target, false);

    let mut command = ffmpeg::hidden_command(&tools.ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| JobError::Failed(format!("Could not start FFmpeg: {error}")))?;
    let stdout = match child.stdout.take() {
        Some(handle) => handle,
        None => {
            let _ = child.kill();
            return Err(JobError::Failed(
                "Could not read FFmpeg progress".to_string(),
            ));
        }
    };
    let stderr = child.stderr.take();
    let stderr_thread = std::thread::spawn(move || {
        let mut buffer = String::new();
        if let Some(handle) = stderr {
            for line in BufReader::new(handle).lines().map_while(Result::ok) {
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    continue;
                }
                buffer.push_str(trimmed);
                buffer.push('\n');
                if buffer.len() > 12_000 {
                    let excess = buffer.len() - 12_000;
                    buffer.drain(..excess);
                }
            }
        }
        buffer
    });

    {
        let mut slot = state
            .child
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *slot = Some(child);
    }

    let mut speed: Option<String> = None;
    let mut last_percent = -1.0f64;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let (trim_start, trim_end) = trim_bounds(request);
    let tempo = speed_value(request.speed);
    let span = ((trim_end - trim_start).max(0.0) / tempo).max(0.0);
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else {
            break;
        };
        if state.cancel.load(Ordering::SeqCst) {
            break;
        }
        if let Some(value) = line.strip_prefix("speed=") {
            let trimmed = value.trim();
            if !trimmed.is_empty() && trimmed != "N/A" {
                speed = Some(trimmed.to_string());
            }
            continue;
        }
        let raw = line
            .strip_prefix("out_time_us=")
            .or_else(|| line.strip_prefix("out_time_ms="));
        let Some(raw) = raw else {
            continue;
        };
        let Ok(microseconds) = raw.trim().parse::<i64>() else {
            continue;
        };
        let percent = if span > 0.05 {
            (microseconds as f64 / (span * 1_000_000.0) * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        if percent - last_percent >= 0.5 || last_emit.elapsed() >= Duration::from_millis(250) {
            last_percent = percent;
            last_emit = Instant::now();
            let _ = app.emit(
                "audio://progress",
                AudioProgressPayload {
                    percent,
                    speed: speed.clone(),
                },
            );
        }
    }

    let child = state
        .child
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take();
    let Some(mut child) = child else {
        let _ = stderr_thread.join();
        let _ = std::fs::remove_file(&target);
        return Err(JobError::Cancelled);
    };

    let status = child.wait();
    let cancelled = state.cancel.load(Ordering::SeqCst);
    let stderr_text = stderr_thread.join().unwrap_or_default();
    if cancelled {
        let _ = std::fs::remove_file(&target);
        return Err(JobError::Cancelled);
    }
    let status = status
        .map_err(|error| JobError::Failed(format!("FFmpeg did not finish: {error}")))?;
    if !status.success() {
        let _ = std::fs::remove_file(&target);
        return Err(JobError::Failed(failure_message(&stderr_text)));
    }

    let _ = app.emit(
        "audio://progress",
        AudioProgressPayload {
            percent: 100.0,
            speed: None,
        },
    );
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> AudioExportRequest {
        AudioExportRequest {
            path: "track.flac".to_string(),
            duration: 120.0,
            bass: 0.0,
            presence: 0.0,
            treble: 0.0,
            volume: 100.0,
            bands: vec![0.0; 10],
            format: "mp3".to_string(),
            quality: "maximum".to_string(),
            beyond: false,
            output_dir: String::new(),
            filename_pattern: "{name}_edited".to_string(),
            trim_start: 0.0,
            trim_end: 120.0,
            speed: 1.0,
            sample_rate: 0,
            loudness_target: 0.0,
            fade_in: 0.0,
            fade_out: 0.0,
            title: String::new(),
            artist: String::new(),
            album: String::new(),
        }
    }

    #[test]
    fn trim_bounds_are_clamped() {
        let mut value = request();
        value.trim_start = -4.0;
        value.trim_end = 300.0;
        assert_eq!(trim_bounds(&value), (0.0, 120.0));

        value.trim_start = 30.0;
        value.trim_end = 10.0;
        assert_eq!(trim_bounds(&value), (30.0, 120.0));
    }

    #[test]
    fn empty_request_needs_no_filter_chain() {
        assert!(filter_chain(&request()).is_none());
    }

    #[test]
    fn edits_build_a_complete_filter_chain() {
        let mut value = request();
        value.trim_start = 4.0;
        value.trim_end = 64.0;
        value.speed = 1.25;
        value.fade_in = 2.0;
        value.fade_out = 3.0;
        value.bass = 100.0;
        value.bands[3] = 4.0;
        value.loudness_target = -16.0;

        let chain = filter_chain(&value).expect("filters");
        assert!(chain.contains("atrim=start=4.000:end=64.000"));
        assert!(chain.contains("atempo=1.25000"));
        assert!(chain.contains("afade=t=in:st=0:d=2.000"));
        assert!(chain.contains("afade=t=out:st=45.000:d=3.000"));
        assert!(chain.contains("bass=g="));
        assert!(chain.contains("equalizer=f=250:t=q:w=1.1:g=4.00"));
        assert!(chain.contains("loudnorm=I=-16.0"));
        assert!(chain.ends_with("alimiter=limit=0.98:attack=5:release=50:level=0"));
    }

    #[test]
    fn codec_args_carry_sample_rate() {
        let args = codec_for("wav", "maximum", 48_000);
        assert!(args.windows(2).any(|pair| pair == ["-c:a", "pcm_s24le"]));
        assert!(args.windows(2).any(|pair| pair == ["-ar", "48000"]));

        let flac = codec_for("flac", "maximum", 44_100);
        assert!(flac.windows(2).any(|pair| pair == ["-frame_size", "4096"]));
    }

    #[test]
    fn sanitize_cleans_windows_characters() {
        assert_eq!(sanitize(" a/b:c*d "), "a-b-c-d");
        assert_eq!(sanitize("..."), "audio");
    }

    #[test]
    fn tempo_is_split_into_supported_factors() {
        assert_eq!(atempo_chain(1.25), "atempo=1.25000");
        assert_eq!(atempo_chain(4.0), "atempo=2.00000,atempo=2.00000");
    }

    #[test]
    fn custom_formats_export_audio_the_app_can_load() {
        let Some(tools) = ffmpeg::discover() else {
            eprintln!("Skipping: FFmpeg is not installed on this machine");
            return;
        };
        let dir = env::temp_dir().join(format!("reflux-formats-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("sample.wav");
        let status = std::process::Command::new(&tools.ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=3",
                "-ac",
                "2",
                "-ar",
                "44100",
            ])
            .arg(&source)
            .status()
            .expect("generate the sample clip");
        assert!(status.success(), "could not generate the sample clip");

        let mut value = request();
        value.path = source.to_string_lossy().into_owned();
        value.duration = 3.0;
        value.output_dir = dir.to_string_lossy().into_owned();
        value.trim_start = 0.5;
        value.trim_end = 2.5;
        value.fade_in = 0.3;
        value.fade_out = 0.4;

        for (format, codec) in [
            ("ogg", "vorbis"),
            ("opus", "opus"),
            ("aiff", "pcm_s24be"),
            ("aac", "aac"),
            ("wma", "wmav2"),
            ("ac3", "ac3"),
        ] {
            value.format = format.to_string();
            let (_, target) = output_target(&value).expect("the export path");
            assert_eq!(
                target.extension().and_then(|extension| extension.to_str()),
                Some(format),
                "wrong extension for {format}"
            );
            let output = std::process::Command::new(&tools.ffmpeg)
                .args(build_args(&value, &target, false))
                .output()
                .expect("run FFmpeg");
            assert!(
                output.status.success(),
                "{format} export failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );

            let meta = probe(&tools, target.to_str().unwrap()).unwrap_or_else(|error| {
                panic!("the app cannot load its {format} export: {error}")
            });
            assert_eq!(meta.codec, codec, "{format} codec");
            assert_eq!(meta.channels, 2, "{format} channels");
            assert!(
                (meta.duration - 2.0).abs() < 0.1,
                "{format} duration is {}",
                meta.duration
            );

        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
