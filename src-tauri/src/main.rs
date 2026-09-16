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

/// The `COLORREF` a `#rrggbb` string describes, or `None` for anything else.
///
/// **The byte order is the whole of this function**: a `COLORREF` is
/// `0x00BBGGRR`, so the red channel of the CSS value is the *low* byte. Getting
/// it backwards gives a window frame in a plausible wrong colour — Solarized
/// Dark's `#073642` would arrive as a blue-green `#423607` — which is why this
/// is a function with a test rather than three lines inside the command.
fn caption_colorref(hex: &str) -> Option<u32> {
    let digits = hex.strip_prefix('#')?;
    if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let value = u32::from_str_radix(digits, 16).ok()?;
    let (r, g, b) = (value >> 16 & 0xff, value >> 8 & 0xff, value & 0xff);
    Some(b << 16 | g << 8 | r)
}

/// The colour the system should draw the window title and the caption buttons
/// in, given whether the frame colour is dark. White or black, and nothing
/// between: the frontend measured that every palette has exactly one readable
/// answer, and this is that answer rather than a shade of its own.
fn caption_text_colorref(dark: bool) -> u32 {
    if dark {
        0x00ff_ffff
    } else {
        0x0000_0000
    }
}

/// Give the window frame the colour the palette resolved to (#326).
///
/// **It answers nothing and reports nothing.** Where the attribute is not
/// supported — Windows 10, and every target that is not Windows — the frame
/// keeps the system default, silently, which is what the issue asks for. A
/// failed `HRESULT` from DWM is discarded here for that reason, and that
/// discard is the promise: an error dialog about a title bar would be worse
/// than the default bar.
#[tauri::command]
fn set_window_appearance(window: tauri::Window, caption: String, dark: bool) {
    // Read and refused on every target, not only the one that can use it: a
    // value this cannot parse is nothing to ask the window for, and saying so
    // in one place keeps the two helpers under the tests that pin them.
    let Some(colour) = caption_colorref(&caption) else {
        return;
    };
    let text = caption_text_colorref(dark);
    #[cfg(not(windows))]
    let _ = (&window, colour, text);
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        };
        let Ok(handle) = window.hwnd() else {
            return;
        };
        let hwnd = handle.0 as _;
        // SAFETY: `hwnd` is the live window handle Tauri just answered with,
        // and each attribute takes a `u32` of exactly four bytes, which is what
        // the size argument says. The return value is deliberately unused, per
        // the doc comment above.
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_CAPTION_COLOR as u32,
                std::ptr::addr_of!(colour).cast(),
                4,
            );
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_TEXT_COLOR as u32,
                std::ptr::addr_of!(text).cast(),
                4,
            );
        }
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
    use super::{caption_colorref, caption_text_colorref};

    /// Issue #326 — a `COLORREF` puts blue in the high byte and red in the low
    /// one, the opposite way round from the CSS value it is built from.
    #[test]
    fn a_caption_colour_is_read_into_the_byte_order_dwm_expects() {
        // Solarized Dark's `--surface`, whose three channels all differ, so a
        // swap cannot pass unnoticed.
        assert_eq!(caption_colorref("#073642"), Some(0x0042_3607));
        assert_eq!(caption_colorref("#ffffff"), Some(0x00ff_ffff));
        assert_eq!(caption_colorref("#000000"), Some(0));
    }

    /// Anything that is not one `#rrggbb` is refused rather than guessed at:
    /// the frame then keeps the colour it has.
    #[test]
    fn a_value_that_is_not_a_six_digit_hex_colour_sets_nothing() {
        for value in ["", "#fff", "f9fafb", "#f9fafg", "#f9fafbff", "rgb(1,2,3)"] {
            assert_eq!(caption_colorref(value), None, "should refuse {value}");
        }
    }

    /// The frontend decides which of the two a palette needs; this only says
    /// what the two are.
    #[test]
    fn the_caption_text_is_white_on_a_dark_frame_and_black_on_a_light_one() {
        assert_eq!(caption_text_colorref(true), 0x00ff_ffff);
        assert_eq!(caption_text_colorref(false), 0);
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
