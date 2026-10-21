//! Issue #645 - on macOS each window is drawn in the colour of the palette
//! from the moment it is shown, before its page has painted.
//!
//! Every macOS window is created hidden and shown once its page has applied
//! its theme (`window_shown.rs`). On a real Mac the first window of a process
//! still showed white for a moment (owner pass on #646): WebKit paints nothing
//! while a window is hidden, so that window came on screen before its page
//! had painted, and what showed was the default white of the window and of
//! the web view. Windows made while AgentEd runs did not flash.
//!
//! So the process keeps the colour of the page, `--bg`, which the page of
//! every macOS window reports with its state (`report_window_state`) and
//! again whenever its theme changes. The last colour is kept in a file of the
//! configuration folder of AgentEd, never beside a document. Before a window
//! is shown, `paint` sets that colour as its background. On macOS
//! `set_background_color` colours the window and stops the web view from
//! drawing its white, so until the page paints the window shows the palette.
//! With nothing kept yet it is the colour of Paper Warm, the palette of a
//! launch with nothing stored (#642).
//!
//! Compiled on macOS, and for the tests of the pure parts everywhere.

use std::sync::Mutex;

/// The page colour of Paper Warm, `--bg` of `:root[data-theme="paper"]` in
/// `src/styles.css`: what a launch with nothing stored draws (#642). Held
/// against the stylesheet by a test below.
pub const PAPER_WARM: &str = "#f7f3ed";

/// The name of the file, in the configuration folder of AgentEd, that holds
/// the last colour a page reported.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const FILE_NAME: &str = "window-background";

/// A colour as the page reports it, `#rrggbb` in lower or upper case, or
/// `None` for anything else, which is not kept.
pub fn parse(text: &str) -> Option<(u8, u8, u8)> {
    let hex = text.trim().strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some((byte(0)?, byte(2)?, byte(4)?))
}

/// The last colour a page reported, read from its file the first time it is
/// needed. `None` until then.
#[derive(Default)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct WindowBackground(Mutex<Option<String>>);

#[cfg(target_os = "macos")]
mod process {
    use super::{parse, WindowBackground, FILE_NAME, PAPER_WARM};
    use std::path::PathBuf;
    use std::sync::MutexGuard;
    use tauri::window::Color;
    use tauri::{AppHandle, Manager, WebviewWindow};

    fn file(app: &AppHandle) -> Option<PathBuf> {
        match app.path().app_config_dir() {
            Ok(dir) => Some(dir.join(FILE_NAME)),
            Err(e) => {
                eprintln!("window_background: no configuration folder: {e}");
                None
            }
        }
    }

    /// The kept colour, read from its file on first use; Paper Warm when
    /// the file is missing or holds no colour.
    fn kept(app: &AppHandle) -> MutexGuard<'_, Option<String>> {
        let state = app.state::<WindowBackground>();
        // A panic while this was held aborts the process (`panic = "abort"`).
        let mut guard = state.inner().0.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            let read = file(app).and_then(|path| std::fs::read_to_string(path).ok());
            let colour = read
                .as_deref()
                .filter(|text| parse(text).is_some())
                .map(|text| text.trim().to_string());
            *guard = Some(colour.unwrap_or_else(|| PAPER_WARM.to_string()));
        }
        guard
    }

    /// Set the kept colour as the background of `window`, before it is shown.
    pub fn paint(app: &AppHandle, window: &WebviewWindow) {
        let colour = kept(app).clone().unwrap_or_else(|| PAPER_WARM.to_string());
        let Some((r, g, b)) = parse(&colour) else {
            return;
        };
        if let Err(e) = window.set_background_color(Some(Color(r, g, b, 255))) {
            eprintln!(
                "window_background: {} not painted {colour}: {e}",
                window.label()
            );
        }
    }

    /// A page reported its colour. Kept, and written to the file, when it is
    /// a colour and differs from the one kept.
    pub fn remember(app: &AppHandle, colour: &str) {
        if parse(colour).is_none() {
            return;
        }
        let colour = colour.trim().to_lowercase();
        {
            let mut guard = kept(app);
            if guard.as_deref() == Some(colour.as_str()) {
                return;
            }
            *guard = Some(colour.clone());
        }
        let Some(path) = file(app) else { return };
        let written = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| std::fs::write(&path, &colour));
        if let Err(e) = written {
            eprintln!(
                "window_background: {colour} not kept in {}: {e}",
                path.display()
            );
        }
    }
}

#[cfg(target_os = "macos")]
pub use process::{paint, remember};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_colour_is_six_hex_digits_after_a_hash() {
        assert_eq!(parse("#f7f3ed"), Some((0xf7, 0xf3, 0xed)));
        assert_eq!(parse(" #000000\n"), Some((0, 0, 0)));
        assert_eq!(parse("#FDF6E3"), Some((0xfd, 0xf6, 0xe3)));
        for text in ["", "#fff", "f7f3ed", "#f7f3edff", "#g7f3ed", "rgb(0, 0, 0)"] {
            assert_eq!(parse(text), None, "{text:?} is not kept");
        }
    }

    /// The colour of a launch with nothing stored is the one the page draws:
    /// read from the stylesheet, so a change of Paper Warm there turns this red.
    #[test]
    fn the_colour_of_nothing_stored_is_the_page_colour_of_paper_warm() {
        let css = include_str!("../../src/styles.css");
        let block = css
            .split(":root[data-theme=\"paper\"] {")
            .nth(1)
            .expect("styles.css has a Paper Warm block");
        let bg = block
            .lines()
            .find_map(|line| line.trim().strip_prefix("--bg:"))
            .expect("the Paper Warm block sets --bg");
        assert_eq!(bg.trim().trim_end_matches(';'), PAPER_WARM);
    }
}
