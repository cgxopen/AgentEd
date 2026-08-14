// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};

/// Extract a file path from CLI arguments (skip the executable name)
fn extract_file_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1) // skip executable path
        .find(|arg| !arg.starts_with('-')) // skip flags
        .filter(|path| path.ends_with(".md"))
        .cloned()
}

/// Emit file-open event to the main window
fn emit_file_open(app: &tauri::AppHandle, path: &str) {
    if let Err(e) = app.emit("file-open", path.to_string()) {
        eprintln!("Failed to emit file-open event: {e}");
    }
    // Bring window to foreground. Both calls are best-effort — the window
    // may already be gone if the user closed it between event arrival and
    // here — but R7 forbids silently dropping the Result. Log on failure.
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_focus() {
            eprintln!("Failed to focus main window: {e}");
        }
        if let Err(e) = window.unminimize() {
            eprintln!("Failed to unminimize main window: {e}");
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Cold start: check if launched with a file argument
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = extract_file_arg(&args) {
                let handle = app.handle().clone();
                // Delay so frontend has time to initialize
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    emit_file_open(&handle, &path);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
