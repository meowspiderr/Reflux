mod audio;
mod export;
mod ffmpeg;
mod models;

use models::{
    AudioExportRequest, AudioProbeOutcome, Environment, ExportRequest,
    FocusAnalysis, ProbeOutcome,
};
use tauri::{Manager, State};

#[tauri::command]
async fn detect_environment() -> Result<Environment, String> {
    tauri::async_runtime::spawn_blocking(ffmpeg::environment)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn probe_videos(paths: Vec<String>) -> Result<Vec<ProbeOutcome>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(tools) = ffmpeg::discover() else {
            let outcomes: Vec<ProbeOutcome> = paths
                .into_iter()
                .map(|path| ProbeOutcome {
                    path,
                    meta: None,
                    error: Some("FFmpeg was not found".to_string()),
                })
                .collect();
            return outcomes;
        };

        let outcomes: Vec<ProbeOutcome> = paths
            .into_iter()
            .map(|path| match ffmpeg::probe(&tools, &path) {
                Ok(meta) => ProbeOutcome {
                    path: path.clone(),
                    meta: Some(meta),
                    error: None,
                },
                Err(error) => ProbeOutcome {
                    path,
                    meta: None,
                    error: Some(error),
                },
            })
            .collect();
        outcomes
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn probe_audio(path: String) -> Result<AudioProbeOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || audio::probe_path(path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn analyze_clip(
    path: String,
    duration: f64,
    width: u32,
    height: u32,
) -> Result<Option<FocusAnalysis>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(tools) = ffmpeg::discover() else {
            return None;
        };
        Some(ffmpeg::analyze(&tools, &path, duration, width, height))
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_export(
    app: tauri::AppHandle,
    state: State<'_, export::ExportState>,
    request: ExportRequest,
) -> Result<(), String> {
    export::start(app, state.inner().clone(), request)
}

#[tauri::command]
fn cancel_export(state: State<'_, export::ExportState>) {
    export::cancel(state.inner());
}

#[tauri::command]
async fn preview_audio(request: AudioExportRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || audio::render_preview(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn discard_preview(path: String) {
    audio::discard_preview(&path);
}

#[tauri::command]
async fn detect_audio_silence(
    path: String,
    duration: f64,
) -> Result<models::SilenceBounds, String> {
    tauri::async_runtime::spawn_blocking(move || audio::detect_silence(&path, duration))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn resolve_audio_output(request: AudioExportRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || audio::resolve_output(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn start_audio_export(
    app: tauri::AppHandle,
    state: State<'_, audio::AudioState>,
    request: AudioExportRequest,
) -> Result<(), String> {
    audio::start(app, state.inner().clone(), request)
}

#[tauri::command]
fn cancel_audio_export(state: State<'_, audio::AudioState>) {
    audio::cancel(state.inner());
}

#[tauri::command]
fn open_folder(path: String) {
    #[cfg(windows)]
    {
        let target = std::path::Path::new(&path);
        let folder = if target.is_dir() {
            target.to_path_buf()
        } else {
            target
                .parent()
                .map(|parent| parent.to_path_buf())
                .unwrap_or_else(|| target.to_path_buf())
        };
        let _ = ffmpeg::hidden_command("explorer.exe").arg(folder).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

#[tauri::command]
fn reveal_path(path: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let target = std::path::Path::new(&path);
        let mut command = ffmpeg::hidden_command("explorer.exe");
        if target.exists() {
            command.raw_arg(format!("/select,\"{}\"", target.display()));
        } else {
            let folder = target
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or(target);
            command.arg(folder);
        }
        let _ = command.spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(export::ExportState::default())
        .manage(audio::AudioState::default())
        .invoke_handler(tauri::generate_handler![
            detect_environment,
            probe_videos,
            probe_audio,
            analyze_clip,
            start_export,
            cancel_export,
            preview_audio,
            discard_preview,
            detect_audio_silence,
            resolve_audio_output,
            start_audio_export,
            cancel_audio_export,
            reveal_path,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reflux");
}
