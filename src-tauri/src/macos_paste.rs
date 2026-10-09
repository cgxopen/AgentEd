//! Issue #558 - Command+Shift+V pastes as plain text on macOS (R-C13).
//!
//! On macOS a paste reaches the web view through a menu: the key goes to the
//! page first and, when the page leaves it, to the item of the menu bar that
//! carries the chord, which sends `paste:` to the view. Measured on a macOS
//! runner on the step zero of #558: Command+Shift+V reached the page as a
//! keydown, nothing in the Edit menu carried it, and no paste event fired.
//!
//! So Edit carries **Paste and Match Style**, the name macOS gives the
//! command, with the chord AgentEd uses on Windows. It sends
//! `pasteAsPlainText:` to the view in front, which WebKit answers with a paste
//! event; the editor reads that paste as plain text when it was asked for one
//! (`src/editor/paste.ts`). The keydown asks for it when the chord is pressed;
//! for the item chosen with the pointer the page is told first, by the
//! `paste-as-plain-text` event, sent to the window in front.

use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, sel};
use tauri::menu::{MenuItem, MenuItemKind, Submenu};
use tauri::{App, AppHandle, Emitter, EventTarget, Manager, Wry};

/// The menu item Edit, Paste and Match Style.
pub const PASTE_PLAIN_ITEM: &str = "paste-as-plain-text";

/// Put Paste and Match Style below Paste in `edit`.
pub fn add_to(app: &App, edit: &Submenu<Wry>) -> tauri::Result<()> {
    let item = MenuItem::with_id(
        app,
        PASTE_PLAIN_ITEM,
        "Paste and Match Style",
        true,
        Some("CmdOrCtrl+Shift+V"),
    )?;
    let items = edit.items()?;
    let paste = items.iter().position(|entry| match entry {
        MenuItemKind::Predefined(item) => item.text().is_ok_and(|text| text == "Paste"),
        _ => false,
    });
    match paste {
        Some(at) => edit.insert(&item, at + 1),
        None => edit.append(&item),
    }
}

/// Paste the clipboard as plain text into the window in front.
pub fn paste_as_plain_text(app: &AppHandle) {
    let front = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    if let Some(label) = &front {
        if let Err(e) = app.emit_to(
            EventTarget::webview_window(label.as_str()),
            PASTE_PLAIN_ITEM,
            (),
        ) {
            eprintln!("macos_paste: {label} was not told a plain paste comes: {e}");
        }
    }
    let Some(class) = AnyClass::get(c"NSApplication") else {
        eprintln!("macos_paste: NSApplication not found; nothing pasted");
        return;
    };
    // SAFETY: `sharedApplication` and `sendAction:to:from:` are the documented
    // NSApplication messages, sent on the main thread, where menu events are
    // delivered; a nil target sends the action to the first responder.
    let sent: Bool = unsafe {
        let shared: *mut AnyObject = msg_send![class, sharedApplication];
        msg_send![
            shared,
            sendAction: sel!(pasteAsPlainText:),
            to: std::ptr::null_mut::<AnyObject>(),
            from: std::ptr::null_mut::<AnyObject>()
        ]
    };
    if !sent.as_bool() {
        eprintln!("macos_paste: nothing in front took pasteAsPlainText:; nothing pasted");
    }
}
