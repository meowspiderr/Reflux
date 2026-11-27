use crate::ffmpeg;
use crate::models::{
    DonePayload, ExportItem, ExportRequest, ItemPayload, ProgressPayload,
};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Default)]
pub struct ExportState {
    pub running: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub child: Arc<Mutex<Option<Child>>>,
}

enum ItemFailure {
    Cancelled,
    Failed(String),
}

pub fn start(app: AppHandle, state: ExportState, request: ExportRequest) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("An export is already running".to_string());
    }
    if request.items.is_empty() {
        state.running.store(false, Ordering::SeqCst);
        return Err("There are no videos to convert".to_string());
    }
    if request.width < 2 || request.height < 2 {
        state.running.store(false, Ordering::SeqCst);
        return Err("The output size is invalid".to_string());
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

pub fn cancel(state: &ExportState) {
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

fn run(app: AppHandle, state: ExportState, request: ExportRequest) {
    let mut completed = 0usize;
    let mut failed = 0usize;
    let mut outputs: Vec<String> = Vec::new();
    let mut cancelled = false;

    for (index, item) in request.items.iter().enumerate() {
        if state.cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }

        let _ = app.emit(
            "export://item",
            ItemPayload {
                index,
                status: "running".to_string(),
                output: None,
                error: None,
            },
        );

        match run_item(&app, &state, &request, item, index) {
            Ok(path) => {
                completed += 1;
                let output = path.display().to_string();
                outputs.push(output.clone());
                let _ = app.emit(
                    "export://item",
                    ItemPayload {
                        index,
                        status: "done".to_string(),
                        output: Some(output),
                        error: None,
                    },
                );
            }
            Err(ItemFailure::Cancelled) => {
                cancelled = true;
                break;
            }
            Err(ItemFailure::Failed(message)) => {
                failed += 1;
                let _ = app.emit(
                    "export://item",
                    ItemPayload {
                        index,
                        status: "failed".to_string(),
                        output: None,
                        error: Some(message),
                    },
                );
            }
        }
    }

    let leftover = state
        .child
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take();
    if let Some(mut child) = leftover {
        let _ = child.kill();
        let _ = child.wait();
    }
    state.running.store(false, Ordering::SeqCst);
    state.cancel.store(false, Ordering::SeqCst);

    let _ = app.emit(
        "export://done",
        DonePayload {
            completed,
            failed,
            cancelled,
            outputs,
        },
    );
}

fn run_item(
    app: &AppHandle,
    state: &ExportState,
    request: &ExportRequest,
    item: &ExportItem,
    index: usize,
) -> Result<PathBuf, ItemFailure> {
    let tools = ffmpeg::discover()
        .ok_or_else(|| ItemFailure::Failed("FFmpeg was not found".to_string()))?;
    let source = PathBuf::from(&item.path);
    if !source.is_file() {
        return Err(ItemFailure::Failed("The source file is missing".to_string()));
    }

    let output_dir = if request.output_dir.trim().is_empty() {
        source
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        PathBuf::from(request.output_dir.trim())
    };
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        ItemFailure::Failed(format!("Could not create the output folder: {error}"))
    })?;

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("video");
    let base = build_filename(
        &request.filename_pattern,
        stem,
        request.width,
        request.height,
    );
    let extension = if request.container.eq_ignore_ascii_case("mov") {
        "mov"
    } else {
        "mp4"
    };
    let target = unique_path(&output_dir, &base, extension);

    let filters = build_filters(request, item);
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        item.path.clone(),
        "-map".into(),
        "0:V:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        "-sn".into(),
        "-dn".into(),
        "-vf".into(),
        filters,
    ];
    args.extend(encoder_args(&request.encoder, request.quality));
    args.extend([
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
    ]);
    args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    args.extend([
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
    ]);
    args.push(target.to_string_lossy().to_string());

    let mut command = ffmpeg::hidden_command(&tools.ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| ItemFailure::Failed(format!("Could not start FFmpeg: {error}")))?;

    let stdout = match child.stdout.take() {
        Some(handle) => handle,
        None => {
            let _ = child.kill();
            return Err(ItemFailure::Failed(
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

        let percent = if item.duration > 0.05 {
            (microseconds as f64 / (item.duration * 1_000_000.0) * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };

        if percent - last_percent >= 0.5 || last_emit.elapsed() >= Duration::from_millis(250) {
            last_percent = percent;
            last_emit = Instant::now();
            let _ = app.emit(
                "export://progress",
                ProgressPayload {
                    index,
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
        return Err(ItemFailure::Cancelled);
    };

    let status = child.wait();
    let cancelled = state.cancel.load(Ordering::SeqCst);
    let stderr_text = stderr_thread.join().unwrap_or_default();

    if cancelled {
        let _ = std::fs::remove_file(&target);
        return Err(ItemFailure::Cancelled);
    }

    let status = status
        .map_err(|error| ItemFailure::Failed(format!("FFmpeg did not finish: {error}")))?;

    if !status.success() {
        let _ = std::fs::remove_file(&target);
        let tail: Vec<&str> = stderr_text.lines().rev().take(4).collect();
        let message = if tail.is_empty() {
            "FFmpeg exited with an error".to_string()
        } else {
            tail.into_iter().rev().collect::<Vec<&str>>().join("\n")
        };
        return Err(ItemFailure::Failed(message));
    }

    let _ = app.emit(
        "export://progress",
        ProgressPayload {
            index,
            percent: 100.0,
            speed: None,
        },
    );

    Ok(target)
}

fn encoder_args(encoder: &str, quality: u8) -> Vec<String> {
    let q = quality.clamp(10, 40).to_string();

    let base: &[&str] = match encoder {
        "libx265" => &["-c:v", "libx265", "-preset", "medium", "-crf"],
        "h264_nvenc" => &[
            "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq",
        ],
        "hevc_nvenc" => &[
            "-c:v", "hevc_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq",
        ],
        "h264_qsv" => &["-c:v", "h264_qsv", "-preset", "medium", "-global_quality"],
        "hevc_qsv" => &["-c:v", "hevc_qsv", "-preset", "medium", "-global_quality"],
        "h264_amf" => &[
            "-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i",
        ],
        "hevc_amf" => &[
            "-c:v", "hevc_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i",
        ],
        _ => &["-c:v", "libx264", "-preset", "medium", "-crf"],
    };

    let mut args: Vec<String> = base.iter().map(|value| value.to_string()).collect();
    args.push(q.clone());

    if matches!(encoder, "h264_nvenc" | "hevc_nvenc") {
        args.push("-b:v".to_string());
        args.push("0".to_string());
    }
    if matches!(encoder, "h264_amf" | "hevc_amf") {
        args.push("-qp_p".to_string());
        args.push(q);
    }
    if matches!(
        encoder,
        "libx265" | "hevc_nvenc" | "hevc_qsv" | "hevc_amf"
    ) {
        args.push("-tag:v".to_string());
        args.push("hvc1".to_string());
    }

    args
}

fn even(value: u32) -> u32 {
    let value = value.max(2);
    if value % 2 == 0 {
        value
    } else {
        value - 1
    }
}

fn even_floor(value: f64) -> u32 {
    even(value.floor().max(2.0) as u32)
}

fn build_filters(request: &ExportRequest, item: &ExportItem) -> String {
    let target_width = even(request.width);
    let target_height = even(request.height);
    let source_width = item.width.max(2);
    let source_height = item.height.max(2);

    let content = item.content.filter(|rect| {
        rect.width >= 16
            && rect.height >= 16
            && rect.x.saturating_add(rect.width) <= source_width
            && rect.y.saturating_add(rect.height) <= source_height
    });

    let (content_x, content_y, content_width, content_height) = match content {
        Some(rect) => (
            rect.x & !1,
            rect.y & !1,
            even(rect.width),
            even(rect.height),
        ),
        None => (0, 0, even(source_width), even(source_height)),
    };
    let content_width = content_width.max(2);
    let content_height = content_height.max(2);

    let mut filters: Vec<String> = Vec::new();
    if content.is_some() {
        filters.push(format!(
            "crop={content_width}:{content_height}:{content_x}:{content_y}"
        ));
    }

    if request.mode == "fit" {
        let scale = (target_width as f64 / content_width as f64)
            .min(target_height as f64 / content_height as f64);
        let scaled_width = even_floor(content_width as f64 * scale)
            .min(target_width)
            .max(2);
        let scaled_height = even_floor(content_height as f64 * scale)
            .min(target_height)
            .max(2);
        let pad_x = (target_width - scaled_width) / 2;
        let pad_y = (target_height - scaled_height) / 2;

        filters.push(format!(
            "scale={scaled_width}:{scaled_height}:flags=lanczos"
        ));
        filters.push("setsar=1".to_string());
        filters.push(format!(
            "pad={target_width}:{target_height}:{pad_x}:{pad_y}:color=black"
        ));
    } else {
        let target_ratio = target_width as f64 / target_height as f64;
        let source_ratio = content_width as f64 / content_height as f64;

        let (crop_width, crop_height) = if source_ratio > target_ratio {
            (
                even_floor(content_height as f64 * target_ratio),
                content_height,
            )
        } else {
            (
                content_width,
                even_floor(content_width as f64 / target_ratio),
            )
        };
        let crop_width = crop_width.min(content_width).max(2);
        let crop_height = crop_height.min(content_height).max(2);

        let focus_x = item.focus_x.clamp(0.0, 1.0);
        let focus_y = item.focus_y.clamp(0.0, 1.0);
        let max_x = content_width.saturating_sub(crop_width);
        let max_y = content_height.saturating_sub(crop_height);
        let offset_x = ((focus_x * content_width as f64) - crop_width as f64 / 2.0)
            .round()
            .clamp(0.0, max_x as f64) as u32;
        let offset_y = ((focus_y * content_height as f64) - crop_height as f64 / 2.0)
            .round()
            .clamp(0.0, max_y as f64) as u32;

        filters.push(format!(
            "crop={crop_width}:{crop_height}:{offset_x}:{offset_y}"
        ));
        filters.push(format!(
            "scale={target_width}:{target_height}:flags=lanczos"
        ));
        filters.push("setsar=1".to_string());
    }

    filters.push("format=yuv420p".to_string());
    filters.join(",")
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

fn build_filename(pattern: &str, stem: &str, width: u32, height: u32) -> String {
    let divisor = gcd(width.max(1), height.max(1));
    let ratio = format!("{}x{}", width / divisor, height / divisor);
    let template = if pattern.trim().is_empty() {
        "{name}_{ratio}"
    } else {
        pattern
    };

    let replaced = template
        .replace("{name}", stem)
        .replace("{ratio}", &ratio)
        .replace("{width}", &width.to_string())
        .replace("{height}", &height.to_string());

    sanitize(&replaced)
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
        "reflux".to_string()
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

    directory.join(format!(
        "{stem}-{}.{extension}",
        std::process::id()
    ))
}
