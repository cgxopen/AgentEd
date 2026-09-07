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

#[cfg(test)]
mod tests {
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

    /// The `additionalBrowserArgs` of the window labelled `main`, read
    /// through `tauri::utils::config::Config` rather than as plain JSON.
    /// `WindowConfig` carries `deny_unknown_fields`, so a misspelled key
    /// does not become a field the tests below quietly fail to find - it
    /// stops the whole file parsing, here and in the two tests above.
    fn main_window_browser_args() -> String {
        let config: tauri::utils::config::Config =
            serde_json::from_str(include_str!("../tauri.conf.json"))
                .expect("tauri.conf.json should parse as a Tauri config");

        let main = config
            .app
            .windows
            .into_iter()
            .find(|window| window.label == "main")
            .expect("there should be a window labelled `main`");

        main.additional_browser_args
            .expect("the main window should set `additionalBrowserArgs`")
    }

    /// Issue #218 - the window is built with the Chromium network
    /// predictor turned off.
    ///
    /// What this test cannot do, said first: it cannot observe whether the
    /// hover lookup goes quiet. That is a network property of WebView2, a
    /// runtime this project does not ship, and one that stopped honouring
    /// the flag would keep starting normally and say nothing - nothing
    /// between this file and the environment options reads the arguments
    /// back. The instrumented run on Windows is where the behaviour is
    /// measured. This test holds the configuration and nothing else.
    ///
    /// It also runs on the Linux CI runner, while `tauri-runtime-wry`
    /// consumes this field only under `cfg(windows)`. It is evidence about
    /// the file on every platform, and never about the runtime on any.
    ///
    /// Split from the test below on purpose: one equality over the whole
    /// string would go red for either loss and say the same thing about
    /// both, so it could not tell a dropped remedy from a dropped default.
    #[test]
    fn the_main_window_disables_the_network_predictor() {
        let args = main_window_browser_args();

        let disabled = args
            .split_whitespace()
            .find_map(|arg| arg.strip_prefix("--disable-features="))
            .expect("the arguments should carry a `--disable-features` switch");

        assert!(
            disabled
                .split(',')
                .any(|feature| feature == "NetworkPrediction"),
            "`NetworkPrediction` must stay in the disabled feature list - it is \
             the whole subject of #218, and without it this build measures \
             nothing: {args}"
        );
    }

    /// Issue #218 - the four arguments `wry` would have passed on its own
    /// are restated here, because setting this field replaces them.
    ///
    /// `wry` builds its default argument string only when the field is
    /// absent - `unwrap_or_else`, `wry-0.54.4/src/webview2/mod.rs:294` -
    /// so each of these is a thing that stops happening if it is dropped
    /// from the string, and nothing else in the build would say so. That
    /// is the same reason the two tests above read this file: JSON carries
    /// no comment saying why an entry must stay.
    #[test]
    fn the_main_window_restates_the_defaults_the_field_replaces() {
        let args = main_window_browser_args();

        for restated in [
            "msWebOOUI",
            "msPdfOOUI",
            "msSmartScreenProtection",
            "--autoplay-policy=no-user-gesture-required",
        ] {
            assert!(
                args.contains(restated),
                "`{restated}` is a wry default that this field replaces rather \
                 than extends, so dropping it here stops it happening and \
                 nothing else would say so: {args}"
            );
        }
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
