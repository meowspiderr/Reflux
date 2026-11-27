use crate::models::{EncoderInfo, Environment, FocusAnalysis, Rect, VideoMeta};
use base64::Engine;
use serde_json::Value;
use std::env;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

fn binary_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn extra_directories() -> Vec<PathBuf> {
    let mut directories: Vec<PathBuf> = Vec::new();

    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            directories.push(parent.to_path_buf());
            directories.push(parent.join("ffmpeg"));
            directories.push(parent.join("ffmpeg").join("bin"));
            directories.push(parent.join("resources"));
            directories.push(parent.join("resources").join("ffmpeg"));
            directories.push(parent.join("resources").join("ffmpeg").join("bin"));
        }
    }

    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        let root = PathBuf::from(local_app_data);
        directories.push(root.join("Microsoft").join("WinGet").join("Links"));
        directories.push(root.join("Programs").join("ffmpeg").join("bin"));
    }

    if let Ok(program_files) = env::var("ProgramFiles") {
        directories.push(PathBuf::from(program_files).join("ffmpeg").join("bin"));
    }

    directories.push(PathBuf::from("C:/ffmpeg/bin"));
    directories
}

fn find_binary(base: &str) -> Option<PathBuf> {
    let name = binary_name(base);

    if let Ok(path_value) = env::var("PATH") {
        for directory in env::split_paths(&path_value) {
            if directory.as_os_str().is_empty() {
                continue;
            }
            let candidate = directory.join(&name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    for directory in extra_directories() {
        let candidate = directory.join(&name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

pub fn discover() -> Option<Tools> {
    Some(Tools {
        ffmpeg: find_binary("ffmpeg")?,
        ffprobe: find_binary("ffprobe")?,
    })
}

fn tool_version(ffmpeg: &Path) -> Option<String> {
    let output = hidden_command(ffmpeg)
        .arg("-version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let first_line = text.lines().next().unwrap_or("");
    let version = first_line.split_whitespace().nth(2).unwrap_or("");
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

struct EncoderDefinition {
    id: &'static str,
    label: &'static str,
    codec: &'static str,
    hardware: bool,
}

const ENCODERS: [EncoderDefinition; 8] = [
    EncoderDefinition {
        id: "h264_nvenc",
        label: "NVIDIA H.264 (NVENC)",
        codec: "h264",
        hardware: true,
    },
    EncoderDefinition {
        id: "hevc_nvenc",
        label: "NVIDIA H.265 (NVENC)",
        codec: "hevc",
        hardware: true,
    },
    EncoderDefinition {
        id: "h264_qsv",
        label: "Intel H.264 (Quick Sync)",
        codec: "h264",
        hardware: true,
    },
    EncoderDefinition {
        id: "hevc_qsv",
        label: "Intel H.265 (Quick Sync)",
        codec: "hevc",
        hardware: true,
    },
    EncoderDefinition {
        id: "h264_amf",
        label: "AMD H.264 (AMF)",
        codec: "h264",
        hardware: true,
    },
    EncoderDefinition {
        id: "hevc_amf",
        label: "AMD H.265 (AMF)",
        codec: "hevc",
        hardware: true,
    },
    EncoderDefinition {
        id: "libx264",
        label: "H.264 (x264)",
        codec: "h264",
        hardware: false,
    },
    EncoderDefinition {
        id: "libx265",
        label: "H.265 (x265)",
        codec: "hevc",
        hardware: false,
    },
];

fn listed_encoders(ffmpeg: &Path) -> Vec<String> {
    let output = hidden_command(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let mut names: Vec<String> = Vec::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let Some(flags) = parts.next() else {
            continue;
        };
        if flags.len() != 6 {
            continue;
        }
        if let Some(name) = parts.next() {
            names.push(name.to_string());
        }
    }
    names
}

fn test_encoder(ffmpeg: &Path, encoder: &str) -> bool {
    let mut command = hidden_command(ffmpeg);
    command
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=256x256:d=0.2",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let Ok(mut child) = command.spawn() else {
        return false;
    };

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if started.elapsed() > Duration::from_secs(5) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
                std::thread::sleep(Duration::from_millis(30));
            }
            Err(_) => return false,
        }
    }
}

pub fn environment() -> Environment {
    let Some(tools) = discover() else {
        return Environment {
            ffmpeg: None,
            ffprobe: None,
            version: None,
            encoders: Vec::new(),
        };
    };

    let mut listed = listed_encoders(&tools.ffmpeg);
    if listed.is_empty() {
        listed.push("libx264".to_string());
        listed.push("libx265".to_string());
    }

    let hardware_ids: Vec<String> = ENCODERS
        .iter()
        .filter(|definition| {
            definition.hardware && listed.iter().any(|name| name.as_str() == definition.id)
        })
        .map(|definition| definition.id.to_string())
        .collect();

    let handles: Vec<_> = hardware_ids
        .into_iter()
        .map(|id| {
            let ffmpeg = tools.ffmpeg.clone();
            std::thread::spawn(move || {
                let supported = test_encoder(&ffmpeg, &id);
                (id, supported)
            })
        })
        .collect();

    let mut supported: Vec<String> = Vec::new();
    for handle in handles {
        if let Ok((id, true)) = handle.join() {
            supported.push(id);
        }
    }

    let encoders = ENCODERS
        .iter()
        .map(|definition| {
            let listed_ok = listed.iter().any(|name| name.as_str() == definition.id);
            let available = listed_ok
                && (!definition.hardware || supported.iter().any(|id| id.as_str() == definition.id));
            EncoderInfo {
                id: definition.id.to_string(),
                label: definition.label.to_string(),
                codec: definition.codec.to_string(),
                hardware: definition.hardware,
                available,
            }
        })
        .collect();

    Environment {
        ffmpeg: Some(tools.ffmpeg.display().to_string()),
        ffprobe: Some(tools.ffprobe.display().to_string()),
        version: tool_version(&tools.ffmpeg),
        encoders,
    }
}

fn normalize_rotation(rotation: i32) -> i32 {
    let mut value = rotation % 360;
    if value < 0 {
        value += 360;
    }
    match value {
        45..=134 => 90,
        135..=224 => 180,
        225..=314 => 270,
        _ => 0,
    }
}

fn rotation_of(stream: &Value) -> i32 {
    if let Some(list) = stream["side_data_list"].as_array() {
        for side_data in list {
            if let Some(rotation) = side_data["rotation"].as_f64() {
                return normalize_rotation(rotation.round() as i32);
            }
        }
    }
    if let Some(value) = stream["tags"]["rotate"].as_str() {
        if let Ok(rotation) = value.parse::<i32>() {
            return normalize_rotation(rotation);
        }
    }
    0
}

fn parse_clock(value: &str) -> Option<f64> {
    let mut parts = value.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn parse_rate(value: Option<&Value>) -> Option<f64> {
    let text = value?.as_str()?;
    let mut parts = text.split('/');
    let numerator: f64 = parts.next()?.parse().ok()?;
    let denominator: f64 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(1.0);
    if numerator <= 0.0 || denominator <= 0.0 {
        return None;
    }
    Some(numerator / denominator)
}

fn thumbnail(tools: &Tools, file: &Path, duration: f64) -> Option<String> {
    let position = if duration > 0.5 {
        (duration * 0.12).clamp(0.0, 8.0)
    } else {
        0.0
    };

    let output = hidden_command(&tools.ffmpeg)
        .args(["-v", "error", "-nostdin", "-ss"])
        .arg(format!("{position:.3}"))
        .arg("-i")
        .arg(file)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=480:-2:flags=lanczos",
            "-f",
            "image2pipe",
            "-c:v",
            "mjpeg",
            "-q:v",
            "5",
            "-",
        ])
        .stdin(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Some(format!("data:image/jpeg;base64,{encoded}"))
}

pub fn probe(tools: &Tools, path: &str) -> Result<VideoMeta, String> {
    let file = Path::new(path);
    if !file.is_file() {
        return Err("File not found".to_string());
    }

    let output = hidden_command(&tools.ffprobe)
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
            .unwrap_or("Unreadable video")
            .to_string();
        return Err(message);
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Invalid FFprobe output: {error}"))?;

    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|stream| {
            stream["codec_type"].as_str() == Some("video")
                && stream["disposition"]["attached_pic"].as_i64().unwrap_or(0) == 0
        })
        .ok_or_else(|| "No video stream found".to_string())?;

    let mut width = video["width"].as_u64().unwrap_or(0) as u32;
    let mut height = video["height"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 {
        return Err("Video has no frame dimensions".to_string());
    }

    let rotation = rotation_of(video);
    if rotation == 90 || rotation == 270 {
        std::mem::swap(&mut width, &mut height);
    }

    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| *value > 0.0)
        .or_else(|| {
            video["duration"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
        })
        .or_else(|| video["tags"]["DURATION"].as_str().and_then(parse_clock))
        .unwrap_or(0.0);

    let fps = parse_rate(video.get("avg_frame_rate"))
        .filter(|value| *value > 0.0 && *value < 300.0)
        .or_else(|| parse_rate(video.get("r_frame_rate")))
        .unwrap_or(0.0);

    let audio = streams
        .iter()
        .any(|stream| stream["codec_type"].as_str() == Some("audio"));
    let codec = video["codec_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    let size = json["format"]["size"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| std::fs::metadata(file).ok().map(|meta| meta.len()))
        .unwrap_or(0);

    let name = file
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string();

    Ok(VideoMeta {
        path: path.to_string(),
        name,
        duration,
        width,
        height,
        rotation,
        fps,
        codec,
        audio,
        size,
        thumbnail: thumbnail(tools, file, duration),
    })
}

const SAMPLE_WIDTH: usize = 64;
const SAMPLE_HEIGHT: usize = 36;

fn sample_frame(tools: &Tools, file: &Path, timestamp: f64) -> Option<Vec<u8>> {
    let filter = format!("scale={SAMPLE_WIDTH}:{SAMPLE_HEIGHT}:flags=area,format=gray");
    let output = hidden_command(&tools.ffmpeg)
        .args(["-v", "error", "-nostdin", "-ss"])
        .arg(format!("{timestamp:.3}"))
        .arg("-i")
        .arg(file)
        .args(["-frames:v", "1", "-vf"])
        .arg(filter)
        .args(["-f", "rawvideo", "-"])
        .stdin(Stdio::null())
        .output()
        .ok()?;

    let expected = SAMPLE_WIDTH * SAMPLE_HEIGHT;
    if !output.status.success() || output.stdout.len() < expected {
        return None;
    }
    Some(output.stdout[..expected].to_vec())
}

fn gradient_centroid(frame: &[u8]) -> Option<(f64, f64, f64)> {
    let mut weight_sum = 0.0;
    let mut x_sum = 0.0;
    let mut y_sum = 0.0;

    for y in 1..SAMPLE_HEIGHT - 1 {
        for x in 1..SAMPLE_WIDTH - 1 {
            let index = y * SAMPLE_WIDTH + x;
            let dx = (frame[index + 1] as i32 - frame[index - 1] as i32).abs() as f64;
            let dy = (frame[index + SAMPLE_WIDTH] as i32 - frame[index - SAMPLE_WIDTH] as i32).abs()
                as f64;
            let weight = dx + dy;
            if weight >= 16.0 {
                weight_sum += weight;
                x_sum += weight * x as f64;
                y_sum += weight * y as f64;
            }
        }
    }

    if weight_sum <= 0.0 {
        return None;
    }
    Some((
        x_sum / weight_sum,
        y_sum / weight_sum,
        weight_sum,
    ))
}

fn parse_crop(value: &str) -> Option<Rect> {
    let mut parts = value.split(':');
    let width = parts.next()?.parse::<u32>().ok()?;
    let height = parts.next()?.parse::<u32>().ok()?;
    let x = parts.next()?.parse::<u32>().ok()?;
    let y = parts.next()?.parse::<u32>().ok()?;
    if width < 16 || height < 16 {
        return None;
    }
    Some(Rect {
        x,
        y,
        width,
        height,
    })
}

fn detect_content(tools: &Tools, file: &Path, duration: f64) -> Option<Rect> {
    let timestamp = if duration > 1.0 { duration * 0.35 } else { 0.0 };

    let output = hidden_command(&tools.ffmpeg)
        .args(["-hide_banner", "-nostdin", "-ss"])
        .arg(format!("{timestamp:.3}"))
        .arg("-i")
        .arg(file)
        .args([
            "-frames:v",
            "24",
            "-vf",
            "cropdetect=limit=24:round=2",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stderr);
    let mut found: Option<Rect> = None;
    for line in text.lines() {
        if let Some(position) = line.rfind("crop=") {
            let tail = &line[position + 5..];
            let value = tail.split_whitespace().next().unwrap_or("");
            if let Some(rect) = parse_crop(value) {
                found = Some(rect);
            }
        }
    }
    found
}

fn valid_content(rect: &Rect, source_width: u32, source_height: u32) -> bool {
    if rect.width < 16 || rect.height < 16 || source_width == 0 || source_height == 0 {
        return false;
    }
    if rect.x.saturating_add(rect.width) > source_width
        || rect.y.saturating_add(rect.height) > source_height
    {
        return false;
    }
    if rect.width >= source_width && rect.height >= source_height {
        return false;
    }

    let retained_width = rect.width as f64 / source_width as f64;
    let retained_height = rect.height as f64 / source_height as f64;
    retained_width >= 0.72 && retained_height >= 0.72
}

pub fn analyze(
    tools: &Tools,
    path: &str,
    duration: f64,
    source_width: u32,
    source_height: u32,
) -> FocusAnalysis {
    let file = Path::new(path);
    let samples = 8usize;
    let mut total_weight = 0.0;
    let mut weighted_x = 0.0;
    let mut weighted_y = 0.0;

    if duration > 0.2 {
        for index in 0..samples {
            let fraction = 0.06 + 0.86 * (index as f64 / (samples - 1) as f64);
            let timestamp = (duration * fraction).min((duration - 0.15).max(0.0));
            if let Some(frame) = sample_frame(tools, file, timestamp) {
                if let Some((center_x, center_y, weight)) = gradient_centroid(&frame) {
                    weighted_x += center_x * weight;
                    weighted_y += center_y * weight;
                    total_weight += weight;
                }
            }
        }
    }

    let (x, y) = if total_weight > 0.0 {
        (
            weighted_x / total_weight / (SAMPLE_WIDTH as f64 - 1.0),
            weighted_y / total_weight / (SAMPLE_HEIGHT as f64 - 1.0),
        )
    } else {
        (0.5, 0.5)
    };

    let content = detect_content(tools, file, duration)
        .filter(|rect| valid_content(rect, source_width, source_height));

    FocusAnalysis {
        x: x.clamp(0.05, 0.95),
        y: y.clamp(0.05, 0.95),
        content,
    }
}
