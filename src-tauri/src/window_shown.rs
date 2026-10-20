//! Issue #639 - on Windows the main window is created hidden and shown once
//! the page has applied its theme, so no frame in a colour the settings of
//! the person do not give is ever on screen.
//!
//! Measured by the owner on Windows on 2026-10-20, on three installers built
//! from the same main: as before, the window flashed white at launch; with
//! the first frame of the page following the system, a stored palette that
//! differs from the system still flashed, since storage is read only by the
//! page; hidden until the theme is applied, nothing flashed, with Windows
//! dark and light, Paper Warm stored or nothing, and the launch did not feel
//! slower.
//!
//! The page asks for the window with `show_window_themed`, right after the
//! theme manager has set `data-theme`. If that never arrives, `main_window`
//! shows the window anyway after `FALLBACK`, so a page that fails still opens
//! a window. Only the Windows description of the window is hidden
//! (`tauri.windows.conf.json`); on macOS and Linux the window is visible from
//! its creation, as before, and the command shows a window already shown.

use std::time::Duration;

/// How long `main_window` waits for the page before it shows the window
/// itself: the bound of Q2, which asks AgentEd to open in under about 2 s.
#[cfg_attr(not(windows), allow(dead_code))]
pub const FALLBACK: Duration = Duration::from_millis(2000);

/// The page has applied its theme: show the window that asked.
#[tauri::command]
pub fn show_window_themed(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fallback_is_within_the_two_seconds_of_q2() {
        assert_eq!(FALLBACK, Duration::from_millis(2000));
    }
}
