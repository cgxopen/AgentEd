//! Issue #645 - on macOS each window is drawn in the colour of the palette
//! from the moment it is shown, before its page has painted. Issue #648 - on
//! Linux the same.
//!
//! Every macOS and Linux window is created hidden and shown once its page has
//! applied its theme (`window_shown.rs`). A hidden window is not painted, so
//! the first window of a process came on screen before its page had painted:
//! white on a real Mac (owner pass on #646), and under Xvfb on Linux the grey
//! of the GTK window, then the white of the WebKitGTK web view (#648).
//!
//! So the process keeps the colour of the page, `--bg`, which the page of
//! every window reports with `keep_page_colour` when its theme is applied and
//! again whenever it changes. The last colour is kept in a file of the
//! configuration folder of AgentEd, never beside a document. Before a window
//! is shown, `paint` sets that colour as its background. On macOS
//! `set_background_color` colours the window and stops the web view from
//! drawing its white; on Linux it colours the GTK window through its CSS
//! provider and the WebKitGTK web view. So until the page paints the window
//! shows the palette. With nothing kept yet it is the colour of Paper Warm,
//! the palette of a launch with nothing stored (#642).
//!
//! A kept colour that disagrees with the stored palette, as after storage was
//! cleared by hand, shows until the page paints, and the next report corrects
//! it.
//!
//! Compiled on macOS and Linux, and for the tests of the pure parts
//! everywhere.

use std::sync::Mutex;

/// The page colour of Paper Warm, `--bg` of `:root[data-theme="paper"]` in
/// `src/styles.css`: what a launch with nothing stored draws (#642). Held
/// against the stylesheet by a test below.
pub const PAPER_WARM: &str = "#f7f3ed";

/// The name of the file, in the configuration folder of AgentEd, that holds
/// the last colour a page reported.
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
const FILE_NAME: &str = "window-background";

/// A colour as the page reports it, `#rrggbb` or `#rgb` in lower or upper
/// case, or `None` for anything else, which is not kept.
///
/// The short form is what the page reports for OLED Black and Default Light:
/// the build minifies the stylesheet, so `#000000` reaches the page as
/// `#000` and `#ffffff` as `#fff`. Seen on a Mac on #645, where `#000` was
/// refused and nothing was kept.
pub fn parse(text: &str) -> Option<(u8, u8, u8)> {
    let hex = text.trim().strip_prefix('#')?;
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let digit = |i: usize| u8::from_str_radix(&hex[i..=i], 16).ok();
    let pair = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    match hex.len() {
        3 => Some((digit(0)? * 17, digit(1)? * 17, digit(2)? * 17)),
        6 => Some((pair(0)?, pair(2)?, pair(4)?)),
        _ => None,
    }
}

/// A colour in the one form it is kept in, `#rrggbb` in lower case.
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
fn normal(text: &str) -> Option<String> {
    parse(text).map(|(r, g, b)| format!("#{r:02x}{g:02x}{b:02x}"))
}

/// The last colour a page reported, read from its file the first time it is
/// needed. `None` until then.
#[derive(Default)]
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
pub struct WindowBackground(Mutex<Option<String>>);

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod process {
    use super::{normal, parse, WindowBackground, FILE_NAME, PAPER_WARM};
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
            let read = file(app).and_then(|path| match std::fs::read_to_string(&path) {
                Ok(text) => Some(text),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => {
                    eprintln!(
                        "window_background: {} not read, Paper Warm used: {e}",
                        path.display()
                    );
                    None
                }
            });
            let colour = read.as_deref().and_then(normal);
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
        let Some(colour) = normal(colour) else {
            return;
        };
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

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub use process::{paint, remember};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_colour_is_six_or_three_hex_digits_after_a_hash() {
        assert_eq!(parse("#f7f3ed"), Some((0xf7, 0xf3, 0xed)));
        assert_eq!(parse(" #000000\n"), Some((0, 0, 0)));
        assert_eq!(parse("#FDF6E3"), Some((0xfd, 0xf6, 0xe3)));
        assert_eq!(parse("#000"), Some((0, 0, 0)));
        assert_eq!(parse("#fff"), Some((255, 255, 255)));
        assert_eq!(parse("#1A2"), Some((0x11, 0xaa, 0x22)));
        for text in [
            "",
            "#ff",
            "f7f3ed",
            "#f7f3edff",
            "#g7f3ed",
            "#ggg",
            "rgb(0, 0, 0)",
            "black",
        ] {
            assert_eq!(parse(text), None, "{text:?} is not kept");
        }
        assert_eq!(normal("#000").as_deref(), Some("#000000"));
        assert_eq!(normal(" #F7F3ED ").as_deref(), Some("#f7f3ed"));
    }

    /// Every page colour of the stylesheet is kept, in the form it is written
    /// and in the short form a minifier makes of it where it has one (#645:
    /// OLED Black reached the process as `#000`).
    #[test]
    fn every_page_colour_of_the_stylesheet_is_kept_long_or_short() {
        let css = include_str!("../../src/styles.css");
        let colours: Vec<&str> = css
            .lines()
            .filter_map(|line| line.trim().strip_prefix("--bg:"))
            .map(|value| value.trim().trim_end_matches(';').trim())
            .collect();
        assert_eq!(
            colours.len(),
            6,
            "the six palette blocks set --bg: {colours:?}"
        );
        for colour in colours {
            assert!(parse(colour).is_some(), "{colour} is kept");
            let hex = colour.trim_start_matches('#').as_bytes();
            if hex.len() == 6 && hex[0] == hex[1] && hex[2] == hex[3] && hex[4] == hex[5] {
                let short = format!("#{}{}{}", hex[0] as char, hex[2] as char, hex[4] as char);
                assert_eq!(
                    normal(&short),
                    normal(colour),
                    "{short} is kept as {colour}"
                );
            }
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
