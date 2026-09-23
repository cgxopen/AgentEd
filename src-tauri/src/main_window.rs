//! Issue #434 - on Windows the main window is built here rather than by
//! Tauri, so that it can carry a value read at startup: the first of the
//! Windows preferred languages, for the spell checker.
//!
//! The window is still described in `tauri.windows.conf.json`, which sets
//! `create: false` so that Tauri leaves the building to this module. Every
//! other key is read from that description by `from_config`, so the title,
//! the sizes, `dragDropEnabled` (#65) and `decorations` (#366) stay where the
//! tests in `main.rs` read them.

use std::error::Error;

use tauri::{App, WebviewWindowBuilder};
use windows::core::{w, HSTRING};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_MULTI_SZ};
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

use crate::browser_args::{browser_args, parse_multi_sz};

/// Size of the registry read, in UTF-16 units: 4 KiB, room for well over a
/// hundred tags. A longer value fails the read with `ERROR_MORE_DATA`, which
/// falls back like any other failed read.
const BUFFER_UNITS: usize = 2048;

/// Most entries parsed out of the value. Only the first is used.
const MAX_LANGUAGES: usize = 64;

/// The list Settings shows under Language, in its order. Read from the
/// registry value behind it rather than from `GetUserPreferredUILanguages`,
/// which was measured on the owner machine to start with the display
/// language instead - the answer before #434. Any failure gives an empty
/// list, which `browser_args` turns into the behaviour before #434.
fn preferred_languages() -> Vec<String> {
    let mut buffer = [0u16; BUFFER_UNITS];
    let mut bytes = (BUFFER_UNITS * 2) as u32;
    // SAFETY: the data pointer and the byte count describe `buffer`, which
    // outlives the call; RegGetValueW writes no more than `bytes` bytes.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Control Panel\\International\\User Profile"),
            w!("Languages"),
            RRF_RT_REG_MULTI_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
    };
    if status != ERROR_SUCCESS {
        eprintln!(
            "Preferred languages not read (error {}), spell check follows the display language",
            status.0
        );
        return Vec::new();
    }
    let units = (bytes as usize / 2).min(BUFFER_UNITS);
    parse_multi_sz(&buffer[..units], MAX_LANGUAGES)
}

/// Builds the window labelled `main` from its configuration, with the
/// WebView2 arguments of `browser_args`.
pub fn create(app: &App) -> Result<(), Box<dyn Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("the configuration has no window labelled main")?;
    let args = browser_args(&preferred_languages());
    WebviewWindowBuilder::from_config(app.handle(), config)?
        .additional_browser_args(&args)
        .build()?;
    Ok(())
}

/// The owner decision of 2026-09-23 on #434, variant B: a main window that
/// cannot be built is said so in a native dialog, and the process exits.
///
/// The documented cause is a second AgentEd started while the first is open,
/// after the first preferred language changed: WebView2 documents that it
/// refuses an environment whose options differ from the one already running on the same
/// data folder. Nothing is open in this process yet, so exiting loses no
/// document, and the first instance is not touched.
pub fn report_and_exit(error: &dyn Error) -> ! {
    let text = HSTRING::from(format!(
        "AgentEd could not open its window.\n\n\
         If AgentEd is already open, the Windows language list may have changed \
         since it started. Close every AgentEd window, then open AgentEd again.\n\n\
         Details: {error}"
    ));
    // SAFETY: both strings are NUL-terminated and live across the call.
    unsafe {
        MessageBoxW(None, &text, w!("AgentEd"), MB_OK | MB_ICONERROR);
    }
    std::process::exit(1);
}
