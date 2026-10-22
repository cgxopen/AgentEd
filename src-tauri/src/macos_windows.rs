//! Issue #559 - several document windows in one AgentEd on macOS (R-C8).
//!
//! The decisions are taken in `document_windows.rs`, which is pure and
//! tested on every platform; this module applies them to the windows. It is
//! compiled on macOS alone.
//!
//! - **A new window** is built from the description of `main` in
//!   `tauri.conf.json`, under a label `doc-N` that the capability in
//!   `capabilities/document-windows.json` names. It is reached from File,
//!   New Window and its chord, Cmd+Shift+N, and from Finder.
//! - **A document opened from Finder** while AgentEd runs goes to an empty,
//!   untouched Untitled window if one is shown, and to a new window
//!   otherwise (owner decision on #559).
//! - **A quit** asks the windows holding unsaved changes one at a time, the
//!   one in front first, and stops at the first Cancel; with nothing unsaved
//!   anywhere it is approved to macOS at once, so a logout goes on.
//! - **Every window is created hidden** and shown by its page once the theme
//!   is applied (#645, `window_shown.rs`); `show_after_fallback` shows it
//!   anyway after `FALLBACK`, for `main` and for each window built here. Each
//!   is first given the colour of the palette as its background
//!   (`window_background.rs`), so it shows no white before its page paints.
//!
//! Each page learns that it is one of several from the `window-coordination`
//! event, sent to it once it has asked for its document. From then on it
//! reports its state and tells a cancelled close (`src/platform/window-
//! coordination.ts`). Windows and Linux send no such event, so their pages
//! report nothing.
//!
//! The registry is locked only to read or write it, never while a window is
//! asked to do anything: closing a window raises events that come back here.

use std::sync::{Mutex, MutexGuard};

use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{App, AppHandle, Emitter, EventTarget, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::document_windows::{QuitNext, QuitStart, Registry, Route, MAIN_WINDOW};

/// The menu item File, New Window.
const NEW_WINDOW_ITEM: &str = "new-window";

/// How far each new window sits from the one before it, in points, and how
/// many steps before the cascade starts again from the top left.
const CASCADE_STEP: f64 = 28.0;
const CASCADE_STEPS: usize = 8;

/// The windows of this process and what each reported.
#[derive(Default)]
pub struct DocumentWindows(Mutex<Registry>);

fn registry(app: &AppHandle) -> MutexGuard<'_, Registry> {
    let state = app.state::<DocumentWindows>();
    // A panic while the registry was held aborts the process (`panic =
    // "abort"`), so a poisoned lock is not reached in a release build; the
    // registry is still the last consistent one if it is.
    state.inner().0.lock().unwrap_or_else(|e| e.into_inner())
}

/// Register `main`, which Tauri has built, and add File, New Window.
/// Called from `setup`. The registry itself is managed by the builder in
/// `main.rs`, since the document of a cold start can reach it before this.
pub fn install(app: &App) {
    registry(app.handle()).add(MAIN_WINDOW);
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => {
            crate::window_background::paint(app.handle(), &window);
            crate::window_shown::show_after_fallback(window);
        }
        None => eprintln!("macos_windows: no window {MAIN_WINDOW} to show after the fallback"),
    }
    if let Err(e) = extend_default_menu(app) {
        eprintln!("macos_windows: the menu items of AgentEd were not added: {e}");
    }
    app.on_menu_event(|app, event| {
        if event.id() == NEW_WINDOW_ITEM {
            new_window(app);
        } else if event.id() == crate::macos_paste::PASTE_PLAIN_ITEM {
            crate::macos_paste::paste_as_plain_text(app);
        }
    });
}

/// The default macOS menu, with New Window at the top of File and Paste and
/// Match Style below Paste in Edit (#558).
fn extend_default_menu(app: &App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let item = MenuItem::with_id(
        app,
        NEW_WINDOW_ITEM,
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let mut file = false;
    let mut edit = false;
    for entry in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = entry {
            match submenu.text()?.as_str() {
                "File" => {
                    submenu.insert(&item, 0)?;
                    file = true;
                }
                "Edit" => {
                    crate::macos_paste::add_to(app, &submenu)?;
                    edit = true;
                }
                _ => {}
            }
        }
    }
    if !file {
        eprintln!("macos_windows: the default menu has no File submenu; New Window is not offered");
    }
    if !edit {
        eprintln!("macos_windows: the default menu has no Edit submenu; Paste and Match Style is not offered");
    }
    app.set_menu(menu)?;
    Ok(())
}

/// A new, empty window.
pub fn new_window(app: &AppHandle) {
    let label = registry(app).next_label();
    match label {
        Some(label) => build(app, &label),
        None => eprintln!("macos_windows: the bound on windows opened is reached"),
    }
}

/// Build the window `label` from the description of `main`. It is in the
/// registry before it exists, so nothing it raises finds it missing.
fn build(app: &AppHandle, label: &str) {
    registry(app).add(label);
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .cloned();
    let Some(mut config) = config else {
        eprintln!("macos_windows: no window labelled {MAIN_WINDOW} to copy");
        registry(app).remove(label);
        return;
    };
    config.label = label.to_string();
    let (x, y) = cascade(label);
    let built = WebviewWindowBuilder::from_config(app, &config)
        .map(|builder| builder.position(x, y))
        .and_then(|builder| builder.build());
    match built {
        Ok(window) => {
            crate::window_background::paint(app, &window);
            crate::window_shown::show_after_fallback(window);
        }
        Err(e) => {
            eprintln!("macos_windows: window {label} was not built: {e}");
            registry(app).remove(label);
        }
    }
}

/// Where the window `label` sits, in points: down and right of the top
/// left corner, one step per window, so a new one never hides the one under
/// it exactly.
fn cascade(label: &str) -> (f64, f64) {
    let number: usize = label
        .rsplit('-')
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or(1);
    let step = (number % CASCADE_STEPS) as f64;
    (60.0 + step * CASCADE_STEP, 40.0 + step * CASCADE_STEP)
}

/// The documents of one Apple event, each to the window `route_open` names.
pub fn open_documents(app: &AppHandle, paths: Vec<String>) {
    for path in paths {
        let route = registry(app).route_open();
        match route {
            Route::Main => crate::file_open::deliver(app, path),
            Route::Existing(label) => send(app, &label, &path),
            Route::New(label) => {
                registry(app).hold(&label, path);
                build(app, &label);
            }
            Route::Refused => {
                eprintln!(
                    "macos_windows: the bound on windows opened is reached; {path} not opened"
                )
            }
        }
    }
}

/// Send `path` to the shown window `label`, and bring it to the front.
fn send(app: &AppHandle, label: &str, path: &str) {
    if let Err(e) = app.emit_to(EventTarget::webview_window(label), "file-open", path) {
        eprintln!("macos_windows: file-open not sent to {label}: {e}");
    }
    if let Some(window) = app.get_webview_window(label) {
        if let Err(e) = window.set_focus() {
            eprintln!("macos_windows: {label} not brought to the front: {e}");
        }
    }
}

/// The page of `window` asks for its document, once. `main` takes what a
/// launch held for it; a later window takes what was held under its label.
/// Either way the page is told it is one of several.
pub fn take_pending(app: &AppHandle, window: &WebviewWindow) -> Option<String> {
    let label = window.label();
    let own = registry(app).take(label);
    let held = if label == MAIN_WINDOW {
        crate::file_open::take_for_main(app)
    } else {
        own
    };
    if let Err(e) = app.emit_to(
        EventTarget::webview_window(label),
        "window-coordination",
        (),
    ) {
        eprintln!("macos_windows: window-coordination not sent to {label}: {e}");
    }
    held
}

/// What a page says about its document. The window takes the document name
/// as its title, which the Window menu and the Dock list. The colour of the
/// page reaches the process on its own, `keep_page_colour` (#648).
#[tauri::command]
pub fn report_window_state(
    app: AppHandle,
    window: WebviewWindow,
    title: String,
    unsaved: bool,
    untouched: bool,
) {
    registry(&app).report(window.label(), unsaved, untouched);
    if let Err(e) = window.set_title(&title) {
        eprintln!("macos_windows: title of {} not set: {e}", window.label());
    }
}

/// A page answered Cancel to its gate, or its save failed.
#[tauri::command]
pub fn window_close_cancelled(app: AppHandle, window: WebviewWindow) {
    registry(&app).cancelled(window.label());
}

/// AppKit asks before a quit. `true` lets it end the app now; `false`
/// cancels it, and the windows are asked one at a time instead.
pub fn should_terminate(app: &AppHandle) -> bool {
    let front = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    let start = registry(app).start_quit(front.as_deref());
    match start {
        QuitStart::ApproveNow => true,
        QuitStart::Ask(label) => {
            close(app, &label);
            false
        }
    }
}

/// A window is gone. If a quit was waiting on it, ask the next one, or
/// close those left once every unsaved document has an answer.
pub fn window_destroyed(app: &AppHandle, label: &str) {
    let next = registry(app).remove(label);
    match next {
        QuitNext::Ask(label) => close(app, &label),
        QuitNext::CloseRest(labels) => {
            for label in labels {
                close(app, &label);
            }
        }
        QuitNext::Nothing => {}
    }
}

/// Ask the window `label` to close, through its gate. A window that cannot
/// be asked stays open, and the quit stops rather than skip it.
fn close(app: &AppHandle, label: &str) {
    let asked = app
        .get_webview_window(label)
        .map(|window| window.close())
        .transpose();
    match asked {
        Ok(Some(())) => {}
        Ok(None) => {
            eprintln!("macos_windows: no window {label} to ask; the quit stops");
            registry(app).cancelled(label);
        }
        Err(e) => {
            eprintln!("macos_windows: asking {label} to close failed, the quit stops: {e}");
            registry(app).cancelled(label);
        }
    }
}
