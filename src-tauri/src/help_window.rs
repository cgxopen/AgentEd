//! Issue #701 - Help, Keyboard Shortcuts and Help, User Guide, each in a
//! window of its own, so the document in front of the person is not touched
//! and no question is asked (owner decision on #701).
//!
//! **How a window learns it holds the help.** On Windows and Linux every
//! window is a process (R-C8), so the help is a second AgentEd process,
//! started with one fixed argument, `--agented-help=shortcuts` or
//! `--agented-help=guide`, and never a path. On macOS one process holds every
//! window, so the help is a new window of it, built by `macos_windows`, and
//! its label is remembered here. Either way the page asks once, through
//! `take_launch_help`, and opens the help it is told, from text bundled in
//! the page; no file is read or written for it.
//!
//! **The argument is never taken for a file, nor a file for it.** It is
//! matched as a whole argument, so a path never equals it: a file named
//! `--agented-help=guide` opened from the file manager arrives as its full
//! path and opens as a file. A bare argument that starts with `-` was a flag
//! before #701 too (`file_open::extract_file_arg`), so that file named alone
//! on a command line did not open then either; `./--agented-help=guide`
//! names it as a file.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, State, WebviewWindow};

/// The help documents, by the name the argument and the page both use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Help {
    Shortcuts,
    Guide,
}

impl Help {
    /// The name in the argument and in the answer to the page.
    pub fn name(self) -> &'static str {
        match self {
            Help::Shortcuts => "shortcuts",
            Help::Guide => "guide",
        }
    }

    /// The window title, the name the header shows (`src/help/index.ts`).
    #[cfg(not(target_os = "macos"))]
    fn title(self) -> &'static str {
        match self {
            Help::Shortcuts => "Keyboard Shortcuts",
            Help::Guide => "User Guide",
        }
    }

    /// The help a page names, or none for any other word.
    pub fn from_name(name: &str) -> Option<Help> {
        [Help::Shortcuts, Help::Guide]
            .into_iter()
            .find(|help| help.name() == name)
    }

    /// The argument a help process is started with.
    #[cfg(any(not(target_os = "macos"), test))]
    fn argument(self) -> String {
        format!("{PREFIX}{}", self.name())
    }
}

const PREFIX: &str = "--agented-help=";

/// The help a command line asks for: an argument after the executable equal
/// to one of the two arguments, whole.
#[cfg(any(not(target_os = "macos"), test))]
pub fn help_from_args(args: &[String]) -> Option<Help> {
    args.iter()
        .skip(1)
        .find_map(|arg| arg.strip_prefix(PREFIX).and_then(Help::from_name))
}

/// The help each window holds until its page asks, by window label.
#[derive(Default)]
pub struct HelpWindows(Mutex<HashMap<String, Help>>);

impl HelpWindows {
    /// Remember that the window `label` holds `help`.
    pub fn hold(&self, label: &str, help: Help) {
        let mut held = self.0.lock().unwrap_or_else(|e| e.into_inner());
        held.insert(label.to_string(), help);
    }

    /// What the window `label` holds, handed over once.
    fn take(&self, label: &str) -> Option<Help> {
        let mut held = self.0.lock().unwrap_or_else(|e| e.into_inner());
        held.remove(label)
    }
}

/// A process started with the argument: its window holds the help, and is
/// titled with its name. Called from `setup`, once the window exists.
#[cfg(not(target_os = "macos"))]
pub fn install(app: &tauri::App, args: &[String]) {
    use tauri::Manager;
    let Some(help) = help_from_args(args) else {
        return;
    };
    app.state::<HelpWindows>().hold("main", help);
    match app.get_webview_window("main") {
        Some(window) => {
            if let Err(e) = window.set_title(help.title()) {
                eprintln!("help_window: title not set: {e}");
            }
        }
        None => eprintln!("help_window: no window main to title"),
    }
}

/// Called once by each page: the help its window holds, if any.
#[tauri::command]
pub fn take_launch_help(help: State<'_, HelpWindows>, window: WebviewWindow) -> Option<String> {
    help.take(window.label())
        .map(|help| help.name().to_string())
}

/// Help, Keyboard Shortcuts and Help, User Guide: open the help named in a
/// window of its own. Any other name is refused, and nothing opens.
#[tauri::command]
pub fn open_help_window(app: AppHandle, name: String) -> Result<(), String> {
    let help = Help::from_name(&name).ok_or_else(|| format!("no help named {name}"))?;
    open(&app, help)
}

/// A second AgentEd process, started with the argument. Its exit is waited
/// for on a thread of its own, so a Linux child that ends first is reaped.
#[cfg(not(target_os = "macos"))]
fn open(_app: &AppHandle, help: Help) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("AgentEd not found: {e}"))?;
    let mut child = std::process::Command::new(exe)
        .arg(help.argument())
        .spawn()
        .map_err(|e| format!("the help window did not start: {e}"))?;
    std::thread::spawn(move || {
        if let Err(e) = child.wait() {
            eprintln!("help_window: the help process was not waited for: {e}");
        }
    });
    Ok(())
}

/// A new window of this process, built by `macos_windows`.
#[cfg(target_os = "macos")]
fn open(app: &AppHandle, help: Help) -> Result<(), String> {
    crate::macos_windows::new_help_window(app, help)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_two_arguments_name_the_two_helps() {
        for help in [Help::Shortcuts, Help::Guide] {
            assert_eq!(
                help_from_args(&args(&["agented", &help.argument()])),
                Some(help)
            );
            assert_eq!(Help::from_name(help.name()), Some(help));
        }
    }

    #[test]
    fn any_other_word_names_no_help() {
        for arg in [
            "--agented-help=",
            "--agented-help=SHORTCUTS",
            "--agented-help=guide.md",
            "--agented-help=../guide",
            "--agented-help",
        ] {
            assert_eq!(help_from_args(&args(&["agented", arg])), None, "{arg}");
        }
        assert_eq!(Help::from_name("about"), None);
    }

    #[test]
    fn the_executable_itself_is_never_read_as_the_argument() {
        assert_eq!(help_from_args(&args(&["--agented-help=guide"])), None);
    }

    /// A file named like the argument opens as a file: the file manager hands
    /// over its full path, which is not the argument and is the file to open.
    #[test]
    fn a_file_named_like_the_argument_opens_as_a_file() {
        for path in [
            "/home/a/--agented-help=guide",
            "C:\\Users\\a\\--agented-help=guide",
            "./--agented-help=guide",
        ] {
            let line = args(&["agented", path]);
            assert_eq!(help_from_args(&line), None, "{path}");
            assert_eq!(
                crate::file_open::extract_file_arg(&line),
                Some(path.to_string())
            );
        }
    }

    #[test]
    fn a_held_help_is_handed_to_its_window_once() {
        let held = HelpWindows::default();
        held.hold("doc-2", Help::Guide);
        assert_eq!(held.take("main"), None);
        assert_eq!(held.take("doc-2"), Some(Help::Guide));
        assert_eq!(held.take("doc-2"), None);
    }
}
