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

/// Which Mica variant a frame colour asks for (#326).
///
/// **It is the only thing the palette can steer here.** Mica takes its colour
/// from the desktop wallpaper and the system's own light or dark setting, not
/// from our tokens, so the palette chooses between the two materials and
/// nothing finer. A function with a test rather than an inline `if`, because
/// the two variants are one character apart in the name and the difference is
/// invisible without a Windows 11 screen in front of you.
fn mica_effect(dark: bool) -> tauri::window::Effect {
    if dark {
        tauri::window::Effect::MicaDark
    } else {
        tauri::window::Effect::MicaLight
    }
}

/// Draw the window with Mica, in the variant the palette asks for (#326).
///
/// **The colour is ignored, deliberately**: this candidate has no colour of its
/// own to set. The frontend sends the same request to both candidates so the
/// two heads differ in one file, and this is where the difference is.
///
/// **It answers nothing and reports nothing.** Below Windows 11 build 22000
/// `window-vibrancy` refuses the effect and the frame keeps the system default,
/// silently, which is what the issue asks for; that `Err` is discarded here for
/// that reason.
#[tauri::command]
fn set_window_appearance(window: tauri::Window, caption: String, dark: bool) {
    let _ = caption;
    let effect = mica_effect(dark);
    #[cfg(not(windows))]
    let _ = (&window, effect);
    #[cfg(windows)]
    {
        use tauri::utils::config::WindowEffectsConfig;
        let _ = window.set_effects(WindowEffectsConfig {
            effects: vec![effect],
            state: None,
            radius: None,
            color: None,
        });
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_window_appearance])
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

#[cfg(test)]
mod tests {
    use super::mica_effect;

    /// Issue #326 — the palette chooses the material's variant and nothing
    /// else; Mica's colour comes from the desktop, not from our tokens.
    #[test]
    fn a_dark_palette_asks_for_the_dark_material_and_a_light_one_for_the_light() {
        assert_eq!(mica_effect(true), tauri::window::Effect::MicaDark);
        assert_eq!(mica_effect(false), tauri::window::Effect::MicaLight);
    }

    /// Issue #65 — drag & drop of an image did nothing on Windows because
    /// `dragDropEnabled` had never been set and Tauri defaults it to
    /// `true`, replacing the webview's own drag-drop handler with its own.
    /// The whole fix is that one line of configuration, so the one line is
    /// pinned here: a JSON file cannot carry a comment saying why it must
    /// stay, and the failure it guards against is silent — drop simply
    /// stops working again, on a target CI cannot exercise.
    #[test]
    fn the_main_window_leaves_drag_and_drop_to_the_webview() {
        let config: tauri::utils::config::Config =
            serde_json::from_str(include_str!("../tauri.conf.json"))
                .expect("tauri.conf.json should parse as a Tauri config");

        let main = config
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .expect("there should be a window labelled `main`");

        assert!(
            !main.drag_drop_enabled,
            "the main window must leave drag & drop to the webview, or the \
             HTML5 drop event never reaches the editor on Windows (#65)"
        );
    }

    /// Issue #249, decision 4 of #220 - `svg` is not in the shell `open`
    /// scope, on either path alternative.
    ///
    /// The scope is the last thing between a sidebar click and a process
    /// started by the OS, and `svg` was the one extension in it for which
    /// open means execute: measured on Windows on 2026-09-07, a click on
    /// an `.svg` opened it in the browser associated with svg, which runs
    /// whatever script the document carries. The other twelve extensions
    /// name documents a viewer displays.
    ///
    /// Read from `tauri.conf.json` for the same reason the test above
    /// reads it: JSON carries no comment saying why an entry must stay
    /// out, and putting `svg` back would be silent.
    #[test]
    fn the_shell_open_scope_does_not_carry_svg() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json should parse as JSON");

        let scope = config["plugins"]["shell"]["open"]
            .as_str()
            .expect("the shell plugin should carry an `open` scope, as a string");

        // Both halves are asserted, because either alone asserts nothing: a
        // scope that had lost its whitelist entirely would satisfy the first
        // assertion while opening far more than svg ever did.
        assert_eq!(
            scope.matches("png").count(),
            2,
            "the open scope should carry its extension whitelist on both path \
             alternatives - the POSIX one and the Windows one - or this test is \
             reading something other than the whitelist: {scope}"
        );
        assert!(
            !scope.contains("svg"),
            "`svg` must stay out of the shell open scope: a sidebar click on one \
             hands it to the browser associated with svg, which executes the \
             script it carries (#249): {scope}"
        );
    }
}
