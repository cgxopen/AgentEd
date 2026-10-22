//! Issue #639 - on Windows the main window is created hidden and shown once
//! the page has applied its theme, so no frame in a colour the settings of
//! the person do not give is ever on screen. Issue #645 - on macOS every
//! window is, the same way: `main` and each document window of #559. Issue
//! #648 - on Linux `main` is, the same way; one process holds one window
//! there (R-C8).
//!
//! On macOS and Linux each window is also given the colour of the palette as
//! its background before it is shown (`window_background.rs`): a hidden
//! window is not painted, so without it the first window of a process came on
//! screen before its page had painted, white on a real Mac, and grey then
//! white under Xvfb on Linux. And the stylesheet draws nothing of the page
//! before its theme (`html:not([data-theme-applied])` in `src/styles.css`),
//! so what shows until the page paints is that colour.
//!
//! Measured by the owner on Windows on 2026-10-20, on three installers built
//! from the same main: as before, the window flashed white at launch; with
//! the first frame of the page following the system, a stored palette that
//! differs from the system still flashed, since storage is read only by the
//! page; hidden until the theme is applied, nothing flashed, with Windows
//! dark and light, Paper Warm stored or nothing, and the launch did not feel
//! slower.
//!
//! On macOS the route was measured on a runner on its first head, hidden
//! alone, without the colour or the stylesheet rule (#646, runs 39622509677
//! and 39624581335): the first frame was the palette for a launch, a new
//! window and one document from Finder, and the fallback fired at 2.0 s for
//! `main` and a document window with a page that never asks. The route as it
//! stands, with the colour and the rule, was seen by the owner on a rented
//! Mac with no flash (#646, comment 6336254153). The Linux figures are those
//! of #648, under Xvfb.
//!
//! The page asks for the window with `show_window_themed`, right after the
//! theme manager has set `data-theme`. If that never arrives, the process
//! shows the window anyway after `FALLBACK`, so a page that fails still opens
//! a window: `main_window` on Windows, and `show_after_fallback` here on
//! macOS and Linux, armed by `macos_windows` for every macOS window and by
//! `main.rs` for the Linux one. The three descriptions of the window are
//! hidden (`tauri.windows.conf.json`, `tauri.macos.conf.json`,
//! `tauri.linux.conf.json`).

use std::time::Duration;

/// How long the process waits for the page before it shows the window
/// itself: the bound of Q2, which asks AgentEd to open in under about 2 s.
pub const FALLBACK: Duration = Duration::from_millis(2000);

/// The page has applied its theme: show the window that asked.
#[tauri::command]
pub fn show_window_themed(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

/// The colour of the page, `--bg`, which the page reports on every platform
/// when its theme is applied and whenever it changes (#648). macOS and Linux
/// keep it for the next window they draw (`window_background.rs`). Windows
/// keeps nothing: its window is hidden until the theme and was seen with no
/// flash without a colour behind it (#639), so the report is answered there
/// and changes nothing.
#[tauri::command]
pub fn keep_page_colour(app: tauri::AppHandle, colour: String) {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    crate::window_background::remember(&app, &colour);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = (app, colour);
}

/// The window is created hidden and its page shows it once its theme is
/// applied. If the page has not after `FALLBACK`, the window is shown here,
/// so a page that fails still opens one, on macOS and Linux. The same wait as
/// `show_after_fallback` of `main_window.rs` on Windows, kept apart so the
/// Windows module is not touched; a window that cannot be shown is said on
/// stderr, which a launch from the desktop shows nowhere.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn show_after_fallback(window: tauri::WebviewWindow) {
    std::thread::spawn(move || {
        std::thread::sleep(FALLBACK);
        if window.is_visible().unwrap_or(false) {
            return;
        }
        if let Err(e) = window.show() {
            eprintln!(
                "window_shown: {} not shown after the fallback: {e}",
                window.label()
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fallback_is_within_the_two_seconds_of_q2() {
        assert_eq!(FALLBACK, Duration::from_millis(2000));
    }
}
