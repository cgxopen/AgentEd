//! The document a launch or the OS asks AgentEd to open (R-C11).
//!
//! Two routes bring one. On every platform the command line: a `.md` path
//! in `argv` at start-up, which is how Windows and Linux open a file from
//! the file manager. On macOS an Apple event instead: Finder, Open With and
//! `open -a` send no argument, and Tauri delivers the file as
//! `RunEvent::Opened`, at start-up and again whenever one is opened while
//! AgentEd runs, since LaunchServices hands it to the running instance.
//!
//! Either way the path reaches the page as the `file-open` event, which
//! `src/platform/file-open.ts` listens to and hands to `openFilePath`, so a
//! file arriving while a document is open meets the unsaved-changes gate.
//!
//! **A path that arrives before the page listens is held, not emitted**
//! (#541). Measured on a macOS runner: `Opened` arrived at 121 to 319 ms,
//! before the page began to load, in five cold starts of five; and the
//! command-line route, which emitted after a fixed 500 ms, lost its file
//! when the page began to load at 1407 ms. So nothing is emitted until the
//! page has asked once, through `take_pending_file_open`, after installing
//! its listener; until then the latest path waits here.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

/// Only a markdown document is opened, on either route. A name that does
/// not end in `.md` is ignored, as the command line always did.
fn is_markdown(path: &str) -> bool {
    path.ends_with(".md")
}

/// Extract a file path from CLI arguments (skip the executable name)
pub fn extract_file_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1) // skip executable path
        .find(|arg| !arg.starts_with('-')) // skip flags
        .filter(|path| is_markdown(path))
        .cloned()
}

/// The first markdown file among the URLs of an Apple event, as a path.
///
/// The URL carries the path percent-encoded, a space as `%20`, and Finder
/// spells a letter such as ș decomposed, measured on #541. `to_file_path`
/// reads the escapes back into the path the file system names; the
/// decomposed spelling is kept, since it is the name macOS handed over.
/// Several files opened at once bring one document, the first: a window
/// holds one (R-C8).
#[cfg(any(target_os = "macos", test))]
pub fn markdown_path_from_urls(urls: &[tauri::Url]) -> Option<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(|path| path.to_str().map(str::to_string))
        .find(|path| is_markdown(path))
}

/// What the page has asked for and what waits for it.
#[derive(Default)]
pub struct PendingOpen(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    page_listens: bool,
    path: Option<String>,
}

impl PendingOpen {
    /// Offer a path. Returned when the page already listens, so the caller
    /// emits it; held otherwise, replacing any path held before it, since
    /// the latest request is the one the user made last.
    fn offer(&self, path: String) -> Option<String> {
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if pending.page_listens {
            Some(path)
        } else {
            pending.path = Some(path);
            None
        }
    }

    /// The page listens from now on; whatever was held is handed over.
    fn take(&self) -> Option<String> {
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.page_listens = true;
        pending.path.take()
    }
}

/// Called once by the page, after its `file-open` listener is installed.
/// The answer is the path a launch was asked to open, if one is waiting.
#[tauri::command]
pub fn take_pending_file_open(pending: State<'_, PendingOpen>) -> Option<String> {
    pending.take()
}

/// Send a path to the page now, or hold it until the page asks.
pub fn deliver(app: &AppHandle, path: String) {
    if let Some(path) = app.state::<PendingOpen>().offer(path) {
        emit_file_open(app, &path);
    }
}

/// Emit file-open event to the main window
fn emit_file_open(app: &AppHandle, path: &str) {
    if let Err(e) = app.emit("file-open", path.to_string()) {
        eprintln!("Failed to emit file-open event: {e}");
    }
    // Bring window to foreground. Both calls are best-effort — the window
    // may already be gone if the user closed it between event arrival and
    // here. Each failure is logged to stderr, which a Windows release build
    // has no console for (the attribute at the top of main.rs).
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_focus() {
            eprintln!("Failed to focus main window: {e}");
        }
        if let Err(e) = window.unminimize() {
            eprintln!("Failed to unminimize main window: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_command_line_names_the_first_markdown_argument_after_the_flags() {
        assert_eq!(
            extract_file_arg(&args(&["agented", "--flag", "/d/a.md"])),
            Some("/d/a.md".to_string())
        );
        assert_eq!(extract_file_arg(&args(&["agented", "/d/a.txt"])), None);
        assert_eq!(extract_file_arg(&args(&["agented"])), None);
    }

    #[test]
    fn a_path_offered_before_the_page_asks_is_held_and_handed_over_once() {
        let pending = PendingOpen::default();
        assert_eq!(pending.offer("/d/a.md".into()), None);
        assert_eq!(pending.take(), Some("/d/a.md".to_string()));
        assert_eq!(pending.take(), None);
    }

    #[test]
    fn the_latest_path_offered_before_the_page_asks_is_the_one_kept() {
        let pending = PendingOpen::default();
        assert_eq!(pending.offer("/d/a.md".into()), None);
        assert_eq!(pending.offer("/d/b.md".into()), None);
        assert_eq!(pending.take(), Some("/d/b.md".to_string()));
    }

    #[test]
    fn once_the_page_has_asked_a_path_is_returned_to_be_emitted() {
        let pending = PendingOpen::default();
        assert_eq!(pending.take(), None);
        assert_eq!(pending.offer("/d/b.md".into()), Some("/d/b.md".to_string()));
        assert_eq!(pending.take(), None);
    }

    fn urls(list: &[&str]) -> Vec<tauri::Url> {
        list.iter()
            .map(|s| tauri::Url::parse(s).expect("a URL"))
            .collect()
    }

    // The URLs below are the ones measured on a macOS runner (#541). They
    // are POSIX paths, which `to_file_path` reads only on a Unix host.
    #[cfg(unix)]
    #[test]
    fn an_apple_event_url_is_read_back_into_its_path() {
        assert_eq!(
            markdown_path_from_urls(&urls(&["file:///Users/runner/docs/a.md"])),
            Some("/Users/runner/docs/a.md".to_string())
        );
        assert_eq!(
            markdown_path_from_urls(&urls(&["file:///Users/runner/My%20Notes/s%CC%A6.md"])),
            Some("/Users/runner/My Notes/s\u{326}.md".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_apple_event_opens_its_first_markdown_file_and_nothing_else() {
        assert_eq!(markdown_path_from_urls(&urls(&["file:///d/e.txt"])), None);
        assert_eq!(
            markdown_path_from_urls(&urls(&["https://example.com/a.md"])),
            None
        );
        assert_eq!(
            markdown_path_from_urls(&urls(&[
                "file:///d/e.txt",
                "file:///d/b.md",
                "file:///d/c.md"
            ])),
            Some("/d/b.md".to_string())
        );
    }
}
