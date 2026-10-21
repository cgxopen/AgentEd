//! Issue #639 - on Windows the main window is created hidden and shown once
//! the page has applied its theme, so no frame in a colour the settings of
//! the person do not give is ever on screen. Issue #645 - on macOS every
//! window is, the same way: `main` and each document window of #559. Each
//! macOS window is also given the colour of the palette as its background
//! before it is shown, since a hidden window is not painted and the first
//! window of a process still flashed white on a real Mac
//! (`window_background.rs`).
//!
//! Measured by the owner on Windows on 2026-10-20, on three installers built
//! from the same main: as before, the window flashed white at launch; with
//! the first frame of the page following the system, a stored palette that
//! differs from the system still flashed, since storage is read only by the
//! page; hidden until the theme is applied, nothing flashed, with Windows
//! dark and light, Paper Warm stored or nothing, and the launch did not feel
//! slower.
//!
//! Measured on a macOS runner on #645, macOS 26.6 at 1024 by 768, capturing
//! each window the moment it first came on screen: without this route the
//! window of a launch was white for 1.3 to 1.5 s and a new window for 60 to
//! 110 ms; with it the first frame was the palette, but for one of the two
//! windows two documents opened at once bring at a cold start, captured white
//! as it came on screen 8 times of 8. The fallback was seen firing there, at
//! 2.0 s, for `main` and for a document window, with a page that never asks;
//! it has not been seen firing on a real machine, nor on Windows.
//!
//! The page asks for the window with `show_window_themed`, right after the
//! theme manager has set `data-theme`. If that never arrives, the process
//! shows the window anyway after `FALLBACK`, so a page that fails still opens
//! a window: `main_window` on Windows, and `macos_windows` on macOS for
//! `main` and for every window it builds from the same description. The
//! Windows and the macOS descriptions of the window are hidden
//! (`tauri.windows.conf.json`, `tauri.macos.conf.json`); on Linux the window
//! is visible from its creation, as before, and the command shows a window
//! already shown.

use std::time::Duration;

/// How long the process waits for the page before it shows the window
/// itself: the bound of Q2, which asks AgentEd to open in under about 2 s.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
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
