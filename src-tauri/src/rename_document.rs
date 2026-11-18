//! File, Rename (#752): the open document renamed inside its own folder, by a
//! native command rather than the `rename` of the fs plugin.
//!
//! **Why not the plugin** (step zero of #752, owner decision B): its `rename`
//! is checked against the scope of `capabilities/default.json`, which is `**`,
//! so a permission for it would let the page move any file anywhere that scope
//! reaches; and `std::fs::rename` under it replaces a file already at the new
//! name, without a word, measured on NTFS, an SMB share, Google Drive and ext4.
//! This command adds no permission and reaches one thing: a new name for a
//! file, in the folder it is in.
//!
//! **What it refuses**, before anything is touched:
//! - a name that is empty, `.` or `..`, or holds a separator, so the file
//!   cannot leave its folder;
//! - an extension other than `.md`, `.markdown` and `.mkd`, which AgentEd
//!   could not open again (R-C11); a name typed with none keeps the old one;
//! - a name already taken by another file, told apart from the same file
//!   spelled with other letter case by the listing of the folder;
//! - a document no longer on disk.
//!
//! **What it cannot promise**: the check of a taken name is made just before
//! the rename, and a file appearing under the new name in that instant would
//! still be replaced (owner decision of 2026-11-18, said in the File, Rename
//! part at the end of R-C14 in REQUIREMENTS.md).

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

/// The extensions a document may be renamed to, in lower case (R-C11).
const MARKDOWN: [&str; 3] = ["md", "markdown", "mkd"];

/// Why a rename was not made, for the message the person reads.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum Refusal {
    /// Empty, `.` or `..`, or holding a separator.
    InvalidName,
    /// An extension AgentEd does not open, as typed.
    Extension(String),
    /// Another file already has the name, as it would be written.
    Taken(String),
    /// The document is no longer at its path.
    Gone,
    /// Another program holds the file without letting it be renamed.
    Locked,
    /// The system does not let this folder be changed.
    Denied,
    /// Anything else, with what the system said.
    Other(String),
}

/// Rename the document at `document` to `name`, in its folder, and answer the
/// new path.
#[tauri::command]
pub async fn rename_document(document: String, name: String) -> Result<String, Refusal> {
    tauri::async_runtime::spawn_blocking(move || rename(Path::new(&document), &name))
        .await
        .map_err(|e| Refusal::Other(e.to_string()))?
}

/// The work of the command, apart from its thread, so a test can call it.
pub fn rename(document: &Path, name: &str) -> Result<String, Refusal> {
    let (folder, old_name) = split(document)?;
    let new_name = final_name(name, &old_name)?;
    let target = folder.join(&new_name);
    if new_name == old_name {
        return Ok(document.to_string_lossy().into_owned());
    }
    if !document.exists() {
        return Err(Refusal::Gone);
    }
    if taken(&folder, &old_name, &new_name, &target) {
        return Err(Refusal::Taken(new_name));
    }
    fs::rename(document, &target).map_err(refusal_of)?;
    Ok(target.to_string_lossy().into_owned())
}

/// The folder of the document and its file name. A path that is not absolute
/// or climbs with `..` is not a document AgentEd opened.
fn split(document: &Path) -> Result<(PathBuf, String), Refusal> {
    if !document.is_absolute() || document.components().any(|c| c == Component::ParentDir) {
        return Err(Refusal::Other("not the path of an open document".into()));
    }
    match (document.parent(), document.file_name()) {
        (Some(folder), Some(file)) => {
            Ok((folder.to_path_buf(), file.to_string_lossy().into_owned()))
        }
        _ => Err(Refusal::Other("not the path of an open document".into())),
    }
}

/// The extension of a name as a person typed it: the text after the last dot,
/// when it is a short run of letters and digits. `v1.2 notes` has none, since
/// what follows its dot holds a space; `report.txt` has `txt`.
fn typed_extension(name: &str) -> Option<&str> {
    let (stem, ext) = name.rsplit_once('.')?;
    let short_word =
        !ext.is_empty() && ext.len() <= 10 && ext.chars().all(|c| c.is_ascii_alphanumeric());
    (!stem.is_empty() && short_word).then_some(ext)
}

/// The name as it will be written: trimmed, checked, and given the extension of
/// the old name when it was typed without one.
fn final_name(name: &str, old_name: &str) -> Result<String, Refusal> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err(Refusal::InvalidName);
    }
    match typed_extension(name) {
        Some(ext) if MARKDOWN.contains(&ext.to_ascii_lowercase().as_str()) => Ok(name.to_string()),
        Some(ext) => Err(Refusal::Extension(ext.to_string())),
        None => {
            let old_ext = typed_extension(old_name).unwrap_or("md");
            Ok(format!("{name}.{old_ext}"))
        }
    }
}

/// Whether `new_name` belongs to another file than the document.
///
/// A path that answers as present is not enough: on a folder that ignores
/// letter case, `Note.md` answers for `note.md` itself, and the canonical path
/// does not tell them apart on Google Drive (step zero of #752). The listing
/// does: when the names differ only in case and the folder holds no entry
/// spelled exactly as the new name, the one entry is the document, and the
/// rename only changes its case. Bounded by the entries of one folder.
fn taken(folder: &Path, old_name: &str, new_name: &str, target: &Path) -> bool {
    if !target.exists() {
        return false;
    }
    if new_name.to_lowercase() != old_name.to_lowercase() {
        return true;
    }
    let listed = fs::read_dir(folder)
        .map(|entries| {
            entries
                .flatten()
                .any(|e| e.file_name().to_string_lossy() == new_name)
        })
        .unwrap_or(true);
    listed
}

/// What a failed rename tells the person: another program holding the file
/// (Windows sharing and lock violations, os errors 32 and 33), a folder the
/// system protects, a file gone, or what the system said.
fn refusal_of(e: io::Error) -> Refusal {
    match (e.kind(), e.raw_os_error()) {
        (io::ErrorKind::NotFound, _) => Refusal::Gone,
        (_, Some(32 | 33)) if cfg!(windows) => Refusal::Locked,
        (io::ErrorKind::PermissionDenied, _) => Refusal::Denied,
        _ => Refusal::Other(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A fresh folder under the system temp folder with `files` in it, removed
    /// on drop.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(files: &[(&str, &str)]) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let n = NEXT.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!("agented-752-{}-{n}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            for (name, text) in files {
                fs::write(root.join(name), text).unwrap();
            }
            Fixture(root)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }

        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_name_typed_without_an_extension_keeps_the_old_one() {
        let f = Fixture::new(&[("draft.markdown", "text")]);
        let new = rename(&f.path("draft.markdown"), "final").unwrap();
        assert_eq!(new, f.path("final.markdown").to_string_lossy());
        assert_eq!(f.names(), ["final.markdown"]);
        assert_eq!(
            fs::read_to_string(f.path("final.markdown")).unwrap(),
            "text"
        );
    }

    #[test]
    fn the_three_markdown_extensions_are_accepted_in_any_case() {
        let f = Fixture::new(&[("a.md", "")]);
        rename(&f.path("a.md"), "b.MKD").unwrap();
        rename(&f.path("b.MKD"), "c.Markdown").unwrap();
        rename(&f.path("c.Markdown"), "d.md").unwrap();
        assert_eq!(f.names(), ["d.md"]);
    }

    #[test]
    fn another_extension_is_refused_and_nothing_moves() {
        let f = Fixture::new(&[("a.md", "")]);
        assert_eq!(
            rename(&f.path("a.md"), "a.txt"),
            Err(Refusal::Extension("txt".into()))
        );
        assert_eq!(f.names(), ["a.md"]);
    }

    #[test]
    fn a_dot_followed_by_words_is_part_of_the_name() {
        let f = Fixture::new(&[("a.md", "")]);
        rename(&f.path("a.md"), "v1.2 notes").unwrap();
        assert_eq!(f.names(), ["v1.2 notes.md"]);
    }

    #[test]
    fn a_separator_or_dot_dot_is_refused_so_the_file_stays_in_its_folder() {
        let f = Fixture::new(&[("a.md", "")]);
        for name in ["../a.md", "sub/a.md", "sub\\a.md", "..", ".", "", "   "] {
            assert_eq!(
                rename(&f.path("a.md"), name),
                Err(Refusal::InvalidName),
                "{name:?}"
            );
        }
        assert_eq!(f.names(), ["a.md"]);
    }

    #[test]
    fn a_name_taken_by_another_file_is_refused_and_both_files_keep_their_text() {
        let f = Fixture::new(&[("a.md", "A"), ("b.md", "B")]);
        assert_eq!(
            rename(&f.path("a.md"), "b"),
            Err(Refusal::Taken("b.md".into()))
        );
        assert_eq!(fs::read_to_string(f.path("a.md")).unwrap(), "A");
        assert_eq!(fs::read_to_string(f.path("b.md")).unwrap(), "B");
    }

    /// `B.md` for `a.md` while `b.md` exists. On a folder that ignores case
    /// (NTFS, the default macOS volume, Google Drive) the two names are one
    /// file, and it is not the document, so the name is taken. On a folder that
    /// keeps case (ext4, measured on CI) `B.md` is another name, free, and the
    /// rename is made beside `b.md`. Either way `b.md` keeps its text.
    #[test]
    fn a_name_in_other_letter_case_than_another_file_follows_the_folder() {
        let f = Fixture::new(&[("a.md", "A"), ("b.md", "B")]);
        let answer = rename(&f.path("a.md"), "B.md");
        if cfg!(target_os = "linux") {
            assert!(answer.is_ok());
            assert_eq!(f.names(), ["B.md", "b.md"]);
        } else {
            assert_eq!(answer, Err(Refusal::Taken("B.md".into())));
        }
        assert_eq!(fs::read_to_string(f.path("b.md")).unwrap(), "B");
    }

    #[test]
    fn a_change_of_letter_case_alone_renames_the_same_file() {
        let f = Fixture::new(&[("note.md", "N")]);
        let new = rename(&f.path("note.md"), "Note.md").unwrap();
        assert_eq!(new, f.path("Note.md").to_string_lossy());
        assert_eq!(f.names(), ["Note.md"]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn on_a_folder_that_keeps_case_a_file_named_in_other_case_is_another_file() {
        let f = Fixture::new(&[("note.md", "n"), ("Note.md", "N")]);
        assert_eq!(
            rename(&f.path("note.md"), "Note.md"),
            Err(Refusal::Taken("Note.md".into()))
        );
        assert_eq!(f.names(), ["Note.md", "note.md"]);
    }

    #[test]
    fn the_same_name_is_no_change() {
        let f = Fixture::new(&[("a.md", "")]);
        assert_eq!(
            rename(&f.path("a.md"), "a.md").unwrap(),
            f.path("a.md").to_string_lossy()
        );
        assert_eq!(
            rename(&f.path("a.md"), "a").unwrap(),
            f.path("a.md").to_string_lossy()
        );
    }

    #[test]
    fn a_document_gone_from_disk_is_refused() {
        let f = Fixture::new(&[]);
        assert_eq!(rename(&f.path("gone.md"), "new"), Err(Refusal::Gone));
        assert!(f.names().is_empty());
    }

    #[test]
    fn a_document_gone_is_said_to_be_gone_even_when_the_new_name_is_taken() {
        let f = Fixture::new(&[("taken.md", "T")]);
        assert_eq!(rename(&f.path("gone.md"), "taken"), Err(Refusal::Gone));
        assert_eq!(fs::read_to_string(f.path("taken.md")).unwrap(), "T");
    }

    #[test]
    fn a_path_that_is_not_absolute_or_climbs_is_refused() {
        assert!(matches!(
            rename(Path::new("a.md"), "b"),
            Err(Refusal::Other(_))
        ));
        let f = Fixture::new(&[("a.md", "")]);
        let climbing = f.0.join("x").join("..").join("a.md");
        assert!(matches!(rename(&climbing, "b"), Err(Refusal::Other(_))));
        assert_eq!(f.names(), ["a.md"]);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_held_by_another_program_is_said_to_be_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new(&[("held.md", "")]);
        // Share read and write, not delete: what the step zero measured as
        // os error 32.
        let _held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0x1 | 0x2)
            .open(f.path("held.md"))
            .unwrap();
        assert_eq!(rename(&f.path("held.md"), "free"), Err(Refusal::Locked));
    }

    #[test]
    fn the_refusals_reach_the_page_as_kind_and_detail() {
        assert_eq!(
            serde_json::to_string(&Refusal::Taken("b.md".into())).unwrap(),
            r#"{"kind":"taken","detail":"b.md"}"#
        );
        assert_eq!(
            serde_json::to_string(&Refusal::Locked).unwrap(),
            r#"{"kind":"locked"}"#
        );
    }
}
