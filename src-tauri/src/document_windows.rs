//! Issue #559 - the windows of AgentEd on macOS, one document each (R-C8),
//! and the decisions taken about them: where a document opened from Finder
//! goes, and in what order a quit asks about unsaved changes.
//!
//! macOS hands a document opened from Finder or Open With to the running
//! AgentEd rather than starting another (#541), so a second document needs
//! a second window in this process. Measured on a macOS runner on the step
//! zero of #559 (comment 6088666875): two windows each keep their own
//! document and undo history, R-C14 holds across them, and Open Recent is
//! one list both read.
//!
//! This module holds no window: it is the bookkeeping, pure so that it is
//! tested on every platform. `macos_windows.rs` applies its answers to the
//! windows themselves, on macOS alone. Windows and Linux keep one window per
//! process and compile none of this outside the tests.
//!
//! ── What a window reports ──
//!
//! Each page reports whether its document has unsaved changes and whether it
//! is an empty, untouched Untitled one, every time either changes. A window
//! that has not reported yet counts as holding unsaved changes and as not
//! untouched, which is the safe direction for both decisions below: a quit
//! asks it rather than ending it, and a document is not given to it.

use std::collections::{BTreeMap, VecDeque};

/// The window Tauri builds from `tauri.conf.json`.
pub const MAIN_WINDOW: &str = "main";

/// The label of every window opened after `main`, followed by a number. The
/// capability in `capabilities/document-windows.json` names `doc-*`, and a
/// window outside every capability has no unsaved-changes gate: measured on
/// #559, Cmd+W closed one holding typed text without a question.
pub const DOCUMENT_WINDOW_PREFIX: &str = "doc-";

/// Most windows opened in one session, so a label never runs out and a
/// stuck loop cannot open windows without end.
pub const MAX_WINDOWS_OPENED: usize = 10_000;

/// What a window last said about its document.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Report {
    unsaved: bool,
    untouched: bool,
}

/// Before the first report: asked at a quit, and given no document.
const UNREPORTED: Report = Report {
    unsaved: true,
    untouched: false,
};

/// Where a document opened from Finder goes.
#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    /// To `main`, whose page has not asked yet: the cold start, held for it.
    Main,
    /// To a window already shown, an empty untouched Untitled one.
    Existing(String),
    /// To a new window under this label.
    New(String),
    /// Nowhere: the bound on windows opened is reached.
    Refused,
}

/// What a quit does first.
#[derive(Debug, PartialEq, Eq)]
pub enum QuitStart {
    /// Nothing is unsaved anywhere: let macOS end the app now.
    ApproveNow,
    /// Ask this window; the rest wait for its answer. Also the answer to a
    /// quit asked while one is already asking: the same window is asked
    /// again, so a quit whose Cancel never arrived here is not stuck, and a
    /// gate already showing its dialog refuses the second request.
    Ask(String),
}

/// What follows a window answering a quit.
#[derive(Debug, PartialEq, Eq)]
pub enum QuitNext {
    /// Ask this window next.
    Ask(String),
    /// Every unsaved document is answered: close the windows that are left,
    /// each through its own gate, which lets a clean one go at once.
    CloseRest(Vec<String>),
    /// No quit is under way, or the window was not the one asked.
    Nothing,
}

#[derive(Default)]
pub struct Registry {
    windows: BTreeMap<String, Report>,
    /// Windows whose page has asked for its document, so it can be sent one.
    listening: Vec<String>,
    /// A document held for a window whose page has not asked yet.
    held: BTreeMap<String, String>,
    opened: usize,
    /// `main` was given the document of a cold start, before it listened.
    main_claimed: bool,
    /// The windows with unsaved changes still to ask, the one asked first.
    quit: Option<VecDeque<String>>,
}

impl Registry {
    /// A window now exists under `label`.
    pub fn add(&mut self, label: &str) {
        self.windows.insert(label.to_string(), UNREPORTED);
    }

    /// The window `label` is gone: forget it, and if a quit was waiting on
    /// it, say what comes next.
    pub fn remove(&mut self, label: &str) -> QuitNext {
        self.windows.remove(label);
        self.listening.retain(|l| l != label);
        self.held.remove(label);
        let Some(queue) = self.quit.as_mut() else {
            return QuitNext::Nothing;
        };
        let was_asked = queue.front().is_some_and(|front| front == label);
        queue.retain(|l| l != label);
        if !was_asked {
            return QuitNext::Nothing;
        }
        match queue.front() {
            Some(next) => QuitNext::Ask(next.clone()),
            None => {
                self.quit = None;
                QuitNext::CloseRest(self.windows.keys().cloned().collect())
            }
        }
    }

    /// What the page of `label` says about its document now.
    pub fn report(&mut self, label: &str, unsaved: bool, untouched: bool) {
        if let Some(report) = self.windows.get_mut(label) {
            *report = Report { unsaved, untouched };
        }
    }

    /// A label for a new window that no window carries, or `None` past the
    /// bound.
    pub fn next_label(&mut self) -> Option<String> {
        while self.opened < MAX_WINDOWS_OPENED {
            self.opened += 1;
            let label = format!("{DOCUMENT_WINDOW_PREFIX}{}", self.opened);
            if !self.windows.contains_key(&label) {
                return Some(label);
            }
        }
        None
    }

    /// Hold `path` for the window `label` until its page asks.
    pub fn hold(&mut self, label: &str, path: String) {
        self.held.insert(label.to_string(), path);
    }

    /// The page of `label` asks once, and listens from then on.
    pub fn take(&mut self, label: &str) -> Option<String> {
        if !self.listening.iter().any(|l| l == label) {
            self.listening.push(label.to_string());
        }
        self.held.remove(label)
    }

    /// Where the next document opened from Finder goes. Each call settles
    /// one document, so several opened at once each find their own window:
    /// an untouched window taken here no longer counts as untouched.
    pub fn route_open(&mut self) -> Route {
        if !self.main_claimed && !self.listening.iter().any(|l| l == MAIN_WINDOW) {
            self.main_claimed = true;
            return Route::Main;
        }
        let untouched = self
            .listening
            .iter()
            .find(|label| self.windows.get(*label).is_some_and(|r| r.untouched))
            .cloned();
        if let Some(label) = untouched {
            if let Some(report) = self.windows.get_mut(&label) {
                report.untouched = false;
            }
            return Route::Existing(label);
        }
        match self.next_label() {
            Some(label) => Route::New(label),
            None => Route::Refused,
        }
    }

    /// A quit was asked for. `front` is the window in front, asked first.
    pub fn start_quit(&mut self, front: Option<&str>) -> QuitStart {
        if let Some(asked) = self.quit.as_ref().and_then(|queue| queue.front()) {
            return QuitStart::Ask(asked.clone());
        }
        let mut unsaved: VecDeque<String> = self
            .windows
            .iter()
            .filter(|(_, report)| report.unsaved)
            .map(|(label, _)| label.clone())
            .collect();
        if unsaved.is_empty() {
            return QuitStart::ApproveNow;
        }
        if let Some(front) = front {
            if let Some(at) = unsaved.iter().position(|l| l == front) {
                if let Some(label) = unsaved.remove(at) {
                    unsaved.push_front(label);
                }
            }
        }
        let first = unsaved.front().cloned();
        self.quit = Some(unsaved);
        match first {
            Some(label) => QuitStart::Ask(label),
            None => QuitStart::ApproveNow,
        }
    }

    /// The window `label` answered Cancel to its gate. A quit asking it
    /// stops there, and nothing else is asked or closed.
    pub fn cancelled(&mut self, label: &str) {
        if self
            .quit
            .as_ref()
            .and_then(|queue| queue.front())
            .is_some_and(|front| front == label)
        {
            self.quit = None;
        }
    }

    /// Whether a quit is asking.
    #[cfg(test)]
    pub fn quitting(&self) -> bool {
        self.quit.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listening(labels: &[&str]) -> Registry {
        let mut registry = Registry::default();
        for label in labels {
            registry.add(label);
            registry.take(label);
        }
        registry
    }

    #[test]
    fn the_document_of_a_cold_start_waits_for_main() {
        let mut registry = Registry::default();
        registry.add(MAIN_WINDOW);
        assert_eq!(registry.route_open(), Route::Main);
        // A second one before `main` listens goes beside it, not over it.
        assert_eq!(registry.route_open(), Route::New("doc-1".into()));
    }

    #[test]
    fn a_document_opened_while_one_is_shown_goes_beside_it() {
        let mut registry = listening(&[MAIN_WINDOW]);
        registry.report(MAIN_WINDOW, false, false);
        assert_eq!(registry.route_open(), Route::New("doc-1".into()));
        assert_eq!(registry.route_open(), Route::New("doc-2".into()));
    }

    #[test]
    fn an_empty_untouched_window_takes_the_document_once() {
        let mut registry = listening(&[MAIN_WINDOW, "doc-1"]);
        registry.report(MAIN_WINDOW, false, false);
        registry.report("doc-1", false, true);
        assert_eq!(registry.route_open(), Route::Existing("doc-1".into()));
        // Several at once: the next finds a window of its own.
        assert_eq!(registry.route_open(), Route::New("doc-2".into()));
    }

    #[test]
    fn a_window_that_has_not_reported_takes_nothing_and_is_asked_at_a_quit() {
        let mut registry = listening(&[MAIN_WINDOW]);
        registry.add("doc-1");
        registry.take("doc-1");
        registry.report(MAIN_WINDOW, false, false);
        assert!(matches!(registry.route_open(), Route::New(_)));
        assert_eq!(registry.start_quit(None), QuitStart::Ask("doc-1".into()));
    }

    #[test]
    fn a_quit_with_nothing_unsaved_is_approved_at_once() {
        let mut registry = listening(&[MAIN_WINDOW, "doc-1"]);
        registry.report(MAIN_WINDOW, false, true);
        registry.report("doc-1", false, false);
        assert_eq!(registry.start_quit(Some("doc-1")), QuitStart::ApproveNow);
        assert!(!registry.quitting());
    }

    #[test]
    fn a_quit_asks_one_unsaved_window_at_a_time_the_front_one_first() {
        let mut registry = listening(&[MAIN_WINDOW, "doc-1", "doc-2"]);
        registry.report(MAIN_WINDOW, true, false);
        registry.report("doc-1", false, false);
        registry.report("doc-2", true, false);
        assert_eq!(
            registry.start_quit(Some("doc-2")),
            QuitStart::Ask("doc-2".into())
        );
        // Asked again while asking: the same window, not the next.
        assert_eq!(
            registry.start_quit(Some("doc-1")),
            QuitStart::Ask("doc-2".into())
        );
        assert_eq!(registry.remove("doc-2"), QuitNext::Ask(MAIN_WINDOW.into()));
        assert_eq!(
            registry.remove(MAIN_WINDOW),
            QuitNext::CloseRest(vec!["doc-1".into()])
        );
        assert!(!registry.quitting());
    }

    #[test]
    fn a_cancel_stops_the_quit_and_nothing_else_is_asked() {
        let mut registry = listening(&[MAIN_WINDOW, "doc-1"]);
        registry.report(MAIN_WINDOW, true, false);
        registry.report("doc-1", true, false);
        assert_eq!(
            registry.start_quit(Some("doc-1")),
            QuitStart::Ask("doc-1".into())
        );
        // A cancel from a window not being asked changes nothing.
        registry.cancelled(MAIN_WINDOW);
        assert!(registry.quitting());
        registry.cancelled("doc-1");
        assert!(!registry.quitting());
        // A window closed by hand afterwards does not resume it.
        assert_eq!(registry.remove(MAIN_WINDOW), QuitNext::Nothing);
    }

    #[test]
    fn a_window_closed_by_hand_while_another_is_asked_leaves_the_queue() {
        let mut registry = listening(&[MAIN_WINDOW, "doc-1", "doc-2"]);
        for label in [MAIN_WINDOW, "doc-1", "doc-2"] {
            registry.report(label, true, false);
        }
        assert_eq!(registry.start_quit(None), QuitStart::Ask("doc-1".into()));
        assert_eq!(registry.remove("doc-2"), QuitNext::Nothing);
        assert_eq!(registry.remove("doc-1"), QuitNext::Ask(MAIN_WINDOW.into()));
    }

    #[test]
    fn a_held_document_is_handed_to_its_own_window_once() {
        let mut registry = Registry::default();
        registry.add("doc-1");
        registry.hold("doc-1", "/d/b.md".into());
        assert_eq!(registry.take("doc-2"), None);
        assert_eq!(registry.take("doc-1"), Some("/d/b.md".to_string()));
        assert_eq!(registry.take("doc-1"), None);
    }

    #[test]
    fn labels_are_bounded() {
        let mut registry = Registry {
            opened: MAX_WINDOWS_OPENED - 1,
            ..Registry::default()
        };
        assert_eq!(
            registry.next_label(),
            Some(format!("doc-{MAX_WINDOWS_OPENED}"))
        );
        assert_eq!(registry.next_label(), None);
        assert_eq!(registry.route_open(), Route::Main);
        registry.add(MAIN_WINDOW);
        registry.take(MAIN_WINDOW);
        registry.report(MAIN_WINDOW, false, false);
        assert_eq!(registry.route_open(), Route::Refused);
    }
}
