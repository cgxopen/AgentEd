// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(any(windows, test))]
mod browser_args;
#[cfg(any(target_os = "macos", test))]
mod document_windows;
mod file_open;
#[cfg(target_os = "macos")]
mod macos_paste;
#[cfg(target_os = "macos")]
mod macos_quit;
#[cfg(target_os = "macos")]
mod macos_windows;
#[cfg(windows)]
mod main_window;
#[cfg(test)]
mod shell_scope;
mod title_bar;
#[cfg(any(target_os = "macos", test))]
mod window_background;
mod window_shown;

fn main() {
    let builder = tauri::Builder::default().manage(file_open::PendingOpen::default());
    // Managed here rather than in `setup`: on macOS the document of a cold
    // start arrives as `RunEvent::Opened` before `setup` runs, measured on
    // a macOS runner on #559 - opened at 0 ms, setup done at 81 ms - and a
    // registry managed in `setup` was not there for it.
    #[cfg(target_os = "macos")]
    let builder = builder
        .manage(macos_windows::DocumentWindows::default())
        .manage(window_background::WindowBackground::default());
    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        file_open::take_pending_file_open,
        title_bar::title_bar_overlay,
        window_shown::show_window_themed
    ]);
    // Several document windows report to the process on macOS (#559).
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        file_open::take_pending_file_open,
        macos_windows::report_window_state,
        macos_windows::window_close_cancelled,
        title_bar::title_bar_overlay,
        window_shown::show_window_themed
    ]);
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Windows builds its main window itself (#434); elsewhere Tauri
            // has already built it from the configuration.
            #[cfg(windows)]
            if let Err(error) = main_window::create(app) {
                main_window::report_and_exit(error.as_ref());
            }

            // The document windows of macOS, and File, New Window (#559);
            // then every quit there through the unsaved-changes gate (#539).
            #[cfg(target_os = "macos")]
            {
                macos_windows::install(app);
                macos_quit::install(app);
            }

            // Cold start: a file named on the command line waits for the
            // page to ask for it (#541).
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = file_open::extract_file_arg(&args) {
                file_open::deliver(app.handle(), path);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, _event| {
        #[cfg(target_os = "macos")]
        match _event {
            // macOS hands a file opened from Finder or Open With to the app
            // as an Apple event, at start-up and while it runs (#541); each
            // file goes to a window of its own or to an untouched one
            // (#559), whose page opens it or says why not (#636).
            tauri::RunEvent::Opened { urls } => {
                macos_windows::open_documents(_handle, file_open::file_paths_from_urls(&urls));
            }
            // A quit asking one window at a time goes on when it is gone.
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } => macos_windows::window_destroyed(_handle, &label),
            _ => {}
        }
    });
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

    /// Issue #366 - the Windows window is the base window with no native
    /// title bar, built by `main_window` rather than by Tauri (#434), and
    /// nothing else.
    ///
    /// Tauri merges `tauri.windows.conf.json` over `tauri.conf.json` with JSON
    /// Merge Patch, which replaces an array whole: `app.windows` has to be
    /// restated in full on Windows just to turn `decorations` off. Restated,
    /// the two can drift - a minimum size changed in one file and not the
    /// other, or the #65 drag-and-drop line lost on the one target it is for.
    /// So the two window objects are held equal here, apart from three keys.
    ///
    /// `visible: false` keeps the window hidden until the page has applied
    /// its theme (#639, `window_shown.rs`); in the base file it would hide
    /// the window of Linux, where nothing shows it after a bound.
    ///
    /// `create: false` hands the window to `main_window`, which builds it
    /// from this same description with the spell-check language added. Lost
    /// from the Windows file, Tauri would build a window without it and the
    /// second build would fail on the label; moved into the base file, Linux
    /// and macOS, which build no window of their own, would open none.
    #[test]
    fn the_windows_window_is_the_base_window_without_decorations() {
        let base: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json should parse");
        let windows: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.windows.conf.json"))
                .expect("tauri.windows.conf.json should parse");

        let base_windows = base["app"]["windows"].as_array().expect("base windows");
        let own_windows = windows["app"]["windows"]
            .as_array()
            .expect("windows windows");
        assert_eq!(own_windows.len(), base_windows.len(), "one window each");

        let mut expected = base_windows[0].clone();
        expected["decorations"] = serde_json::Value::Bool(false);
        expected["create"] = serde_json::Value::Bool(false);
        expected["visible"] = serde_json::Value::Bool(false);
        assert_eq!(own_windows[0], expected);
        assert!(
            base_windows[0].get("visible").is_none(),
            "the base shows the window on Linux from its creation (#639, #645)"
        );
        assert!(
            base_windows[0].get("decorations").is_none(),
            "the base keeps the native bar on Linux and macOS by leaving the default"
        );
        assert!(
            base_windows[0].get("create").is_none(),
            "the base lets Tauri build the window on Linux and macOS by leaving the default"
        );

        // Nothing else in the Windows file: it exists for this one window.
        let keys: Vec<&String> = windows.as_object().expect("an object").keys().collect();
        assert_eq!(keys, ["app"]);
        let app: Vec<&String> = windows["app"]
            .as_object()
            .expect("an object")
            .keys()
            .collect();
        assert_eq!(app, ["windows"]);
    }

    /// Issue #615 - the macOS window is the base window with its title bar
    /// drawn over the header, and nothing else.
    ///
    /// The same Merge Patch as on Windows: `tauri.macos.conf.json` restates
    /// `app.windows` in full to set four keys, so the two objects are held
    /// equal here apart from those keys, and a minimum size or the #65 line
    /// changed in one file and not the other turns this red. The document
    /// windows of #559 are built from this same description.
    ///
    /// `visible: false` is the fourth (#645): every macOS window is hidden
    /// until its page has applied its theme, and `macos_windows` shows it
    /// after `FALLBACK` if the page never asks, `main` and each document
    /// window alike (`window_shown.rs`).
    #[test]
    fn the_macos_window_is_the_base_window_with_its_title_bar_over_the_header() {
        let base: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json should parse");
        let macos: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.macos.conf.json"))
                .expect("tauri.macos.conf.json should parse");

        let base_windows = base["app"]["windows"].as_array().expect("base windows");
        let own_windows = macos["app"]["windows"].as_array().expect("macOS windows");
        assert_eq!(own_windows.len(), base_windows.len(), "one window each");

        let mut expected = base_windows[0].clone();
        expected["titleBarStyle"] = serde_json::json!("Overlay");
        expected["hiddenTitle"] = serde_json::json!(true);
        expected["trafficLightPosition"] = serde_json::json!({ "x": 16, "y": 24 });
        expected["visible"] = serde_json::Value::Bool(false);
        assert_eq!(own_windows[0], expected);
        for key in ["titleBarStyle", "hiddenTitle", "trafficLightPosition"] {
            assert!(
                base_windows[0].get(key).is_none(),
                "the base keeps `{key}` at its default on Windows and Linux"
            );
        }

        // The macOS file holds the window and the notices of #540, nothing else.
        let keys: Vec<&String> = macos.as_object().expect("an object").keys().collect();
        assert_eq!(keys, ["app", "bundle"]);
        let app: Vec<&String> = macos["app"]
            .as_object()
            .expect("an object")
            .keys()
            .collect();
        assert_eq!(app, ["windows"]);
    }

    /// Issue #615 - the header as title bar on macOS is dragged and zoomed
    /// from its passive parts, and the capability for it grants those two
    /// commands and nothing else, on macOS alone, to `main` and the document
    /// windows of #559. The two commands are the ones the drag script of
    /// Tauri calls on a press and on a double click.
    #[test]
    fn the_macos_frame_capability_grants_drag_and_zoom_alone() {
        let frame: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/window-frame-macos.json"))
                .expect("window-frame-macos.json should parse");
        let glob = format!("{}*", crate::document_windows::DOCUMENT_WINDOW_PREFIX);
        assert_eq!(frame["windows"], serde_json::json!(["main", glob]));
        assert_eq!(frame["platforms"], serde_json::json!(["macOS"]));
        assert_eq!(
            frame["permissions"],
            serde_json::json!([
                "core:window:allow-start-dragging",
                "core:window:allow-internal-toggle-maximize"
            ])
        );
    }

    /// Issue #249, decision 4 of #220 - `svg` is not in the shell `open`
    /// scope, on any path alternative. The scope as the plugin matches it is
    /// tested against named paths in `shell_scope.rs` (#448).
    ///
    /// The scope is the last thing between a sidebar click and a process
    /// started by the OS, and `svg` was the one extension in it for which
    /// open means execute: measured on Windows on 2026-09-07, a click on
    /// an `.svg` opened it in the browser associated with svg, which runs
    /// whatever script the document carries. The other extensions name
    /// documents a viewer displays.
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
            3,
            "the open scope should carry its extension whitelist on all three path \
             alternatives - the POSIX one, the drive one and the UNC one (#448) - or \
             this test is reading something other than the whitelist: {scope}"
        );
        assert!(
            !scope.contains("svg"),
            "`svg` must stay out of the shell open scope: a sidebar click on one \
             hands it to the browser associated with svg, which executes the \
             script it carries (#249): {scope}"
        );
    }

    /// Issues #539 and #559 - on macOS the window Tauri builds is the one
    /// `document_windows.rs` calls `main`: a quit asks the windows it has
    /// registered, and a window it did not know would be skipped. That code
    /// compiles on macOS alone, which no CI job builds, so the label is held
    /// here against `tauri.conf.json`: a window Tauri builds, with no
    /// `create: false`.
    #[test]
    fn the_registry_names_the_window_tauri_builds_on_macos() {
        let label = crate::document_windows::MAIN_WINDOW;
        let config: tauri::utils::config::Config =
            serde_json::from_str(include_str!("../tauri.conf.json"))
                .expect("tauri.conf.json should parse as a Tauri config");
        let window = config
            .app
            .windows
            .iter()
            .find(|window| window.label == label)
            .unwrap_or_else(|| panic!("no window labelled `{label}` in tauri.conf.json"));
        assert!(
            window.create,
            "Tauri must build the `{label}` window on macOS, where nothing else does"
        );
    }

    /// Issue #559 - every window after `main` is under the capability made
    /// for them, on macOS alone, with exactly the permissions of `main`.
    ///
    /// A window no capability names has no unsaved-changes gate: measured on
    /// a macOS runner on the step zero of #559, the page said Close
    /// protection unavailable and Cmd+W closed it with typed text and no
    /// question. So the label prefix and the capability glob are held
    /// together here, and so are the two permission lists, since a
    /// permission added to one and not the other would leave a window able
    /// to do less than `main` or more.
    #[test]
    fn every_document_window_has_the_permissions_of_main_on_macos_alone() {
        let main: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("default.json should parse");
        let documents: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/document-windows.json"))
                .expect("document-windows.json should parse");

        assert_eq!(main["windows"], serde_json::json!(["main"]));
        assert!(main.get("platforms").is_none(), "main keeps every platform");

        let glob = format!("{}*", crate::document_windows::DOCUMENT_WINDOW_PREFIX);
        assert_eq!(documents["windows"], serde_json::json!([glob]));
        assert_eq!(documents["platforms"], serde_json::json!(["macOS"]));
        assert_eq!(documents["permissions"], main["permissions"]);
    }
}
