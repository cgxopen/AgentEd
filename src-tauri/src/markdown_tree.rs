//! The markdown tree of the files panel, opened by hand (#746): from a folder,
//! the markdown files below it and so the folders that hold them, read
//! natively in one call. Through the fs plugin the panel paid one IPC round
//! trip per folder, 4.4 to 5.1 ms each on Windows (step zero of #746), so a
//! project of 1725 folders took 8.8 s before anything was drawn.
//!
//! **Names only.** Nothing here opens a file: each folder is listed and each
//! entry is judged by its name and its type, as the folder read reports it.
//!
//! **Bounded three times, and the last two are said.** At most `MAX_DEPTH`
//! folder levels below the root; and at most `MAX_FOLDERS` folders read or
//! `MAX_TIME` spent, whichever comes first, breadth first so the shallow levels
//! are read before the deep ones (owner decision of 2026-11-17 on #746).
//! Reaching either of the last two is returned with the tree, and the panel
//! draws a line saying so: R-C6 shows no silent cut (#172).

use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

/// Folder levels read below the root (#746): 10 by the owner, kept by the
/// step zero, where two markdown files of mdn/content in 14773 sat deeper.
pub const MAX_DEPTH: usize = 10;

/// Folders read before the walk stops (#746): about 0.2 s on a local disk,
/// 3 to 4 s on Google Drive and minutes over SSHFS, measured on the issue.
pub const MAX_FOLDERS: usize = 2000;

/// Time spent before the walk stops (#746): what keeps a slow medium to an
/// answer in about the same time as a local disk. A folder read already begun
/// is not interrupted, so the walk may pass it by the time of one read.
pub const MAX_TIME: Duration = Duration::from_secs(2);

/// Folders and files left out by name, compared in lower case: the system
/// names of #721 that do not start with a dot, and the dependency and build
/// folders of the owner decision of 2026-11-17 on #746. Names that start with
/// a dot are left out before this list is read.
const LEFT_OUT: [&str; 7] = [
    "thumbs.db",
    "ehthumbs.db",
    "desktop.ini",
    "$recycle.bin",
    "system volume information",
    "node_modules",
    "target",
];

/// Left out only as a folder: the per-user application data of Windows, which
/// held 42 per cent of the entries of a home folder in the step zero.
const LEFT_OUT_FOLDERS: [&str; 1] = ["appdata"];

/// What the walk found: the markdown files, as paths relative to the root
/// with `/` between segments, and whether a bound of folders or time stopped it.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownTree {
    pub files: Vec<String>,
    pub reached_bound: bool,
    pub folders_read: usize,
}

/// The bounds of one walk; the command passes the constants, a test smaller
/// figures.
#[derive(Clone, Copy)]
pub struct Bounds {
    pub depth: usize,
    pub folders: usize,
    pub time: Duration,
}

const BOUNDS: Bounds = Bounds {
    depth: MAX_DEPTH,
    folders: MAX_FOLDERS,
    time: MAX_TIME,
};

/// What a folder read reports of one entry: its name and what it is itself.
pub struct Entry {
    pub name: String,
    pub kind: Kind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Folder,
    File,
    /// A link, a junction, or what the read could not type: never followed.
    Other,
}

/// The tree of `root`, for the document at `document`, refused unless that
/// path lies inside `root` (`check_root`).
///
/// **The command cannot know that `document` is the open document**: it holds
/// only that the root contains the path it is given. That the path is the open
/// one is the caller's part: `src/app/sidebar-sync.ts` passes `state.filePath`
/// through `TauriIO.markdownTree`, with the folder of that document or a root a
/// click in the panel kept, which holds the document opened from it (#178).
#[tauri::command]
pub async fn markdown_tree(document: String, root: String) -> Result<MarkdownTree, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        check_root(Path::new(&document), &root)?;
        let start = Instant::now();
        walk(&root, BOUNDS, &mut list_folder, &|| start.elapsed())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether the panel may walk `root` for `document`.
///
/// - Both absolute, so a bare name never resolves against the working folder.
/// - The document inside the root, compared by components: the walk starts at
///   the folder of the document or a folder above it within the panel.
/// - No `..` in either, so inside means inside.
/// - On unix, no component of the root that starts with a dot: the fs scope
///   of the panel, the pattern `**` in `capabilities/default.json`, refuses
///   such a path there, since Tauri matches it with a literal leading dot on
///   unix (`tauri` 2.12.1, `scope/fs.rs`). This command does not pass through
///   that scope, so it states the same refusal itself. Windows matches without
///   it, and so does this.
///
/// **What it grants is names, and what `listDir` already reaches.** The root
/// holds the path given, and the walk never follows a link (see
/// `list_folder`), so nothing below the root leaves it; a root on a share is
/// a share only because that path is on it, and the caller passes the open
/// document. Under the scope of `capabilities/default.json` the fs plugin
/// lists the same folders through `listDir`: everything on Windows, and
/// everything outside dot folders on unix, which the refusal above and the
/// walk keep to. **One exception, measured on #746**: on an SSHFS-Win drive
/// letter the scope refuses every path, since Windows cannot canonicalize it,
/// where this command lists the names. No file is read either way.
pub fn check_root(document: &Path, root: &Path) -> Result<(), String> {
    if !document.is_absolute() || !root.is_absolute() {
        return Err("not an absolute path".into());
    }
    let has_parent_dir = |p: &Path| p.components().any(|c| c == Component::ParentDir);
    if has_parent_dir(document) || has_parent_dir(root) {
        return Err("a path climbs with ..".into());
    }
    match document.parent() {
        Some(folder) if folder.starts_with(root) => {}
        _ => return Err("the document is not inside the root".into()),
    }
    if cfg!(unix) && root.components().any(|c| starts_with_dot(c.as_os_str())) {
        return Err("a dot folder, which the fs scope refuses on this platform".into());
    }
    Ok(())
}

fn starts_with_dot(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('.')
}

fn is_markdown(lower: &str) -> bool {
    [".md", ".markdown", ".mkd"]
        .iter()
        .any(|ext| lower.len() > ext.len() && lower.ends_with(ext))
}

/// List one folder from the disk.
///
/// **A link is never followed nor listed.** `file_type` reports the entry
/// itself, not what it points to, so a symbolic link or a Windows junction is
/// `Other`: no loop, and no path to another machine.
pub fn list_folder(path: &Path) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path)?.flatten() {
        let kind = match entry.file_type() {
            Ok(t) if t.is_dir() => Kind::Folder,
            Ok(t) if t.is_file() => Kind::File,
            _ => Kind::Other,
        };
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
        });
    }
    Ok(entries)
}

/// One folder waiting to be read: where it is, its path relative to the root,
/// and its level, 0 for the root.
struct Pending {
    path: PathBuf,
    relative: String,
    depth: usize,
}

/// Walk `root` breadth first within `bounds`, listing each folder with `list`
/// and reading the time spent from `elapsed`, both passed in so a test can
/// stand a slow listing and its clock in for the disk.
///
/// The root that cannot be read is an error, which the panel answers as a
/// folder that could not be read. A folder below it that cannot be read is
/// passed over, as the walk of the fs plugin did: its markdown is not known,
/// so by the rule of #746 it is not shown, and the rest of the tree is.
pub fn walk(
    root: &Path,
    bounds: Bounds,
    list: &mut dyn FnMut(&Path) -> io::Result<Vec<Entry>>,
    elapsed: &dyn Fn() -> Duration,
) -> Result<MarkdownTree, String> {
    let mut files = Vec::new();
    let mut queue = VecDeque::from([Pending {
        path: root.to_path_buf(),
        relative: String::new(),
        depth: 0,
    }]);
    let mut folders_read = 0;
    let mut reached_bound = false;
    // Bounded: each pass reads one folder, and at most `bounds.folders` are.
    while let Some(folder) = queue.pop_front() {
        // The root is always read, so the answer is never empty for want of time.
        if folders_read == bounds.folders || (folders_read > 0 && elapsed() >= bounds.time) {
            reached_bound = true;
            break;
        }
        let entries = match list(&folder.path) {
            Ok(entries) => entries,
            Err(e) if folders_read == 0 => return Err(e.to_string()),
            Err(_) => continue,
        };
        folders_read += 1;
        read_level(entries, &folder, bounds, &mut files, &mut queue);
    }
    Ok(MarkdownTree {
        files,
        reached_bound,
        folders_read,
    })
}

/// Judge the entries of one folder: a markdown file is kept, a folder is
/// queued while the depth bound allows, everything else is passed over.
fn read_level(
    entries: Vec<Entry>,
    folder: &Pending,
    bounds: Bounds,
    files: &mut Vec<String>,
    queue: &mut VecDeque<Pending>,
) {
    for entry in entries {
        let lower = entry.name.to_lowercase();
        // A dot file or a dot folder: left out and never descended (#721, and
        // the owner decision of 2026-11-17 on #746, on every platform).
        if entry.name.starts_with('.') || LEFT_OUT.contains(&lower.as_str()) {
            continue;
        }
        let relative = if folder.relative.is_empty() {
            entry.name.clone()
        } else {
            format!("{}/{}", folder.relative, entry.name)
        };
        match entry.kind {
            Kind::Folder => {
                if folder.depth < bounds.depth && !LEFT_OUT_FOLDERS.contains(&lower.as_str()) {
                    queue.push_back(Pending {
                        path: folder.path.join(&entry.name),
                        relative,
                        depth: folder.depth + 1,
                    });
                }
            }
            Kind::File if is_markdown(&lower) => files.push(relative),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A fresh folder under the system temp folder, removed on drop.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(files: &[&str]) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let n = NEXT.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!("agented-746-{}-{n}", std::process::id()));
            for file in files {
                let path = root.join(file);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                if !file.ends_with('/') {
                    fs::write(&path, "x").unwrap();
                }
            }
            fs::create_dir_all(&root).unwrap();
            Fixture(root)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// The walk on the disk, with a clock that never moves.
    fn disk(root: &Path, bounds: Bounds) -> Result<MarkdownTree, String> {
        walk(root, bounds, &mut list_folder, &|| Duration::ZERO)
    }

    fn sorted(tree: &MarkdownTree) -> Vec<&str> {
        let mut files: Vec<&str> = tree.files.iter().map(String::as_str).collect();
        files.sort_unstable();
        files
    }

    #[test]
    fn markdown_files_at_every_level_are_kept_and_nothing_else() {
        let f = Fixture::new(&[
            "doc.md",
            "notes.markdown",
            "old.MKD",
            "image.png",
            "readme.txt",
            "a/b/deep.md",
            "empty/",
            "pictures/photo.jpg",
        ]);
        let tree = disk(&f.0, BOUNDS).unwrap();
        assert_eq!(
            sorted(&tree),
            ["a/b/deep.md", "doc.md", "notes.markdown", "old.MKD"]
        );
        assert!(!tree.reached_bound);
    }

    #[test]
    fn the_depth_bound_reads_ten_levels_and_no_more() {
        let ten = "1/2/3/4/5/6/7/8/9/10/at-ten.md";
        let eleven = "1/2/3/4/5/6/7/8/9/10/11/at-eleven.md";
        let f = Fixture::new(&[ten, eleven]);
        let tree = disk(&f.0, BOUNDS).unwrap();
        assert_eq!(sorted(&tree), [ten]);
        // The depth bound is a rule of R-C6, not the folder bound: no line.
        assert!(!tree.reached_bound);
    }

    #[test]
    fn the_folder_bound_stops_breadth_first_and_says_so() {
        let f = Fixture::new(&["top.md", "a/a.md", "b/b.md", "a/deep/deep.md"]);
        let tree = disk(
            &f.0,
            Bounds {
                folders: 3,
                ..BOUNDS
            },
        )
        .unwrap();
        // The root, a and b are read; a/deep, one level down, is not.
        assert_eq!(sorted(&tree), ["a/a.md", "b/b.md", "top.md"]);
        assert!(tree.reached_bound);
        assert_eq!(tree.folders_read, 3);
    }

    #[test]
    fn a_walk_that_ends_at_the_bound_exactly_has_not_reached_it() {
        let f = Fixture::new(&["top.md", "a/a.md"]);
        let tree = disk(
            &f.0,
            Bounds {
                folders: 2,
                ..BOUNDS
            },
        )
        .unwrap();
        assert_eq!(sorted(&tree), ["a/a.md", "top.md"]);
        assert!(!tree.reached_bound);
    }

    #[test]
    fn dependency_build_and_system_folders_are_left_out_in_any_case() {
        let f = Fixture::new(&[
            "doc.md",
            "node_modules/pkg/README.md",
            "Node_Modules/pkg/README.md",
            "target/doc/README.md",
            "AppData/Local/README.md",
            "$RECYCLE.BIN/x.md",
            "System Volume Information/x.md",
            "vendor/README.md",
        ]);
        let tree = disk(&f.0, BOUNDS).unwrap();
        assert_eq!(sorted(&tree), ["doc.md", "vendor/README.md"]);
    }

    #[test]
    fn appdata_is_left_out_as_a_folder_only() {
        let f = Fixture::new(&["appdata.md", "AppData"]);
        let tree = disk(&f.0, BOUNDS).unwrap();
        assert_eq!(sorted(&tree), ["appdata.md"]);
    }

    #[test]
    fn dot_folders_are_not_descended_and_dot_files_not_listed_on_every_platform() {
        let f = Fixture::new(&[
            "doc.md",
            ".cursor/rules/rule.md",
            ".git/info.md",
            "a/.hidden/inner.md",
            ".notes.md",
            "a/visible.md",
        ]);
        let tree = disk(&f.0, BOUNDS).unwrap();
        assert_eq!(sorted(&tree), ["a/visible.md", "doc.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_neither_followed_nor_listed() {
        let f = Fixture::new(&["doc.md", "real/inside.md"]);
        std::os::unix::fs::symlink(f.0.join("real"), f.0.join("linked")).unwrap();
        std::os::unix::fs::symlink(f.0.join("doc.md"), f.0.join("alias.md")).unwrap();
        std::os::unix::fs::symlink(&f.0, f.0.join("real/loop")).unwrap();
        let tree = disk(&f.0, BOUNDS).unwrap();
        assert_eq!(sorted(&tree), ["doc.md", "real/inside.md"]);
    }

    #[test]
    fn a_root_that_cannot_be_read_is_an_error() {
        let f = Fixture::new(&[]);
        assert!(disk(&f.0.join("missing"), BOUNDS).is_err());
    }

    #[test]
    fn the_root_must_hold_the_document() {
        let f = Fixture::new(&["proj/sub/doc.md", "other/x.md"]);
        let doc = f.0.join("proj/sub/doc.md");
        assert!(check_root(&doc, &f.0.join("proj/sub")).is_ok());
        assert!(check_root(&doc, &f.0.join("proj")).is_ok());
        assert!(check_root(&doc, &f.0.join("other")).is_err());
        assert!(check_root(&doc, &f.0.join("proj/sub/deeper")).is_err());
        assert!(check_root(&doc, &f.0.join("pro")).is_err());
    }

    #[test]
    fn relative_paths_and_parent_steps_are_refused() {
        let f = Fixture::new(&["proj/doc.md"]);
        let doc = f.0.join("proj/doc.md");
        assert!(check_root(Path::new("proj/doc.md"), Path::new("proj")).is_err());
        assert!(check_root(&doc, &f.0.join("proj/x/..")).is_err());
        assert!(check_root(&f.0.join("proj/../proj/doc.md"), &f.0.join("proj")).is_err());
    }

    #[test]
    fn a_root_under_a_dot_folder_follows_the_fs_scope_of_the_platform() {
        let f = Fixture::new(&[".config/notes/doc.md"]);
        let root = f.0.join(".config/notes");
        let answer = check_root(&root.join("doc.md"), &root);
        assert_eq!(answer.is_err(), cfg!(unix));
    }

    /// A listing that takes `step` of a pretend clock for every folder read, so
    /// the time limit is reached by count rather than by waiting.
    fn slow(root: &Path, bounds: Bounds, step: Duration) -> MarkdownTree {
        let clock = std::cell::Cell::new(Duration::ZERO);
        let mut list = |path: &Path| {
            clock.set(clock.get() + step);
            list_folder(path)
        };
        walk(root, bounds, &mut list, &|| clock.get()).unwrap()
    }

    #[test]
    fn the_time_limit_stops_the_walk_shallow_levels_first_and_says_so() {
        let f = Fixture::new(&[
            "top.md",
            "a/a.md",
            "b/b.md",
            "a/deep/deep.md",
            "b/deep/deep2.md",
        ]);
        // 0.7 s a folder against 2 s: the root, a and b are read, the third
        // brings the clock to 2.1 s, and the next level is not read.
        let tree = slow(&f.0, BOUNDS, Duration::from_millis(700));
        assert_eq!(sorted(&tree), ["a/a.md", "b/b.md", "top.md"]);
        assert!(tree.reached_bound);
        assert_eq!(tree.folders_read, 3);
    }

    #[test]
    fn a_walk_inside_the_time_limit_reads_everything_without_the_line() {
        let f = Fixture::new(&["top.md", "a/a.md", "a/deep/deep.md"]);
        let tree = slow(&f.0, BOUNDS, Duration::from_millis(100));
        assert_eq!(sorted(&tree), ["a/a.md", "a/deep/deep.md", "top.md"]);
        assert!(!tree.reached_bound);
    }

    #[test]
    fn the_root_is_read_even_when_its_own_read_exceeds_the_time_limit() {
        let f = Fixture::new(&["top.md", "a/a.md"]);
        let tree = slow(&f.0, BOUNDS, Duration::from_secs(5));
        assert_eq!(sorted(&tree), ["top.md"]);
        assert!(tree.reached_bound);
    }
}
