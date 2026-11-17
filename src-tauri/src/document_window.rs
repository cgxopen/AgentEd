//! Issue #731 - a relative link to a markdown file opened in a window of its
//! own, with Ctrl+Shift+click (Cmd+Shift+click on a Mac): the document in
//! front of the person is not touched and no question is asked (owner
//! decision on #731).
//!
//! **The window is the help window of #701 with a path.** On Windows and Linux
//! every window is a process (R-C8), so the window is a second AgentEd process
//! started by `help_window::start_second_process`, through the path of the
//! running executable, with the path as its one argument and no shell between;
//! it reaches the page of the new process by the command-line route of
//! `file_open.rs`, as a file opened from the file manager does. On macOS the
//! window is a window of this process, through `macos_windows::open_documents`,
//! the route of a file opened from Finder.
//!
//! **What this side checks.** The page resolves the link (#727), asks that the
//! file be markdown and be there, and only then asks for the window. Here the
//! path must be absolute and name a file that is there: an absolute path never
//! starts with `-`, so the second process cannot read it as a flag
//! (`file_open::extract_file_arg`), and a relative one would be read against
//! whatever folder the new process starts in. Whether it is markdown is the
//! page's answer, as for every other route that opens a file (#636): the page
//! of the new process asks it again before anything opens.
//!
//! **A file already open in another window opens a second time** (owner
//! decision on #731): nothing here looks for it, and R-C14 guards the saves.

use std::path::Path;

use tauri::AppHandle;

/// The path as the new window is given it, or why it is refused.
pub fn checked_path(path: &str) -> Result<&str, String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(format!("not an absolute path: {path}"));
    }
    if !candidate.is_file() {
        return Err(format!("no file at {path}"));
    }
    Ok(path)
}

/// Ctrl+Shift+click on a relative link to a markdown file: open `path` in a
/// window of its own.
#[tauri::command]
pub fn open_document_window(app: AppHandle, path: String) -> Result<(), String> {
    let path = checked_path(&path)?.to_string();
    open(&app, path)
}

/// A second AgentEd process with the path as its one argument.
#[cfg(not(target_os = "macos"))]
fn open(_app: &AppHandle, path: String) -> Result<(), String> {
    crate::help_window::start_second_process(std::ffi::OsStr::new(&path))
        .map_err(|e| format!("the window did not start: {e}"))
}

/// A window of this process holding the file.
#[cfg(target_os = "macos")]
fn open(app: &AppHandle, path: String) -> Result<(), String> {
    crate::macos_windows::open_documents(app, vec![path]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_path_is_refused() {
        for path in [
            "a.md",
            "./a.md",
            "../a.md",
            "-dash.md",
            "--agented-help=guide",
        ] {
            assert!(checked_path(path).is_err(), "{path}");
        }
    }

    /// A relative path is refused even when it names a file that is there,
    /// read against the folder this process runs in: the tests run in the
    /// crate, whose `Cargo.toml` is there.
    #[test]
    fn a_relative_path_to_a_file_that_is_there_is_refused() {
        assert!(Path::new("Cargo.toml").is_file());
        for path in ["Cargo.toml", "./Cargo.toml"] {
            assert!(checked_path(path).is_err(), "{path}");
        }
    }

    #[test]
    fn a_path_with_no_file_is_refused() {
        let missing = std::env::temp_dir().join("agented-731-not-there.md");
        let _ = std::fs::remove_file(&missing);
        assert!(checked_path(missing.to_str().unwrap()).is_err());
    }

    #[test]
    fn a_folder_is_refused() {
        let folder = std::env::temp_dir();
        assert!(checked_path(folder.to_str().unwrap()).is_err());
    }

    #[test]
    fn an_absolute_path_to_a_file_is_given_as_it_is() {
        let dir = std::env::temp_dir().join("agented-731 ăîșț");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("-dash a&b.md");
        std::fs::write(&file, "# x\n").unwrap();
        let path = file.to_str().unwrap();
        assert_eq!(checked_path(path), Ok(path));
        // It cannot be read as a flag by the second process: it starts with
        // the root of the disk, never with a dash.
        assert!(!path.starts_with('-'));
        let _ = std::fs::remove_file(&file);
    }
}
