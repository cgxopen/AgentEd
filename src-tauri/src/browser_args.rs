//! Issue #434 - the WebView2 command line of the main window, as a pure
//! function of the Windows preferred-languages list.
//!
//! The spell checker of WebView2 checks in one language at a time, and left
//! alone it is the Windows display language, because that is what `wry` sets
//! as the environment language. `--accept-lang` reaches the checker (measured
//! on #411), so the first of the preferred languages is passed there.
//!
//! Compiled on Windows, where it is used, and under test everywhere, so the
//! Linux CI job runs the tests below.

/// What `wry` 0.54 passes when the window sets no arguments of its own.
/// A value of our own replaces it rather than adding to it, so it is restated
/// here: without it the mini menu on selection, the PDF UI and SmartScreen
/// come back.
pub const DEFAULT_DISABLES: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Longest tag accepted: the length RFC 5646 (section 4.4.1) asks every
/// implementation to be able to hold. A Windows list entry such as `ro-RO` or
/// `zh-Hant-TW` is far below it.
const MAX_TAG_LEN: usize = 35;

/// The arguments for the main window. The disables are always present; the
/// first language follows only when it looks like a language tag. An empty
/// list or a malformed first entry gives the disables alone, which is the
/// behaviour before #434 - never a guessed language.
pub fn browser_args(languages: &[String]) -> String {
    match languages.first() {
        Some(tag) if is_plausible_tag(tag) => format!("{DEFAULT_DISABLES} --accept-lang={tag}"),
        _ => DEFAULT_DISABLES.to_string(),
    }
}

/// The value goes onto a command line, so it is held to the characters a
/// language tag is made of: ASCII letters, digits and hyphens, starting with
/// a letter and not ending with a hyphen. Passed exactly as Windows gives it -
/// `ro-RO` is not cut to `ro`, which would be a guess (#434, trap 2).
fn is_plausible_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= MAX_TAG_LEN
        && tag.starts_with(|c: char| c.is_ascii_alphabetic())
        && !tag.ends_with('-')
        && tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Splits a registry multi-string (UTF-16, entries ended by a NUL, the list
/// ended by an empty entry) into its entries, reading at most `max_entries`.
/// Stops at the first empty entry, so a buffer longer than the data adds
/// nothing. An entry that is not valid UTF-16 ends the list there.
pub fn parse_multi_sz(buffer: &[u16], max_entries: usize) -> Vec<String> {
    let mut entries = Vec::new();
    for raw in buffer.split(|&unit| unit == 0).take(max_entries) {
        if raw.is_empty() {
            break;
        }
        match String::from_utf16(raw) {
            Ok(entry) => entries.push(entry),
            Err(_) => break,
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(tags: &[&str]) -> Vec<String> {
        tags.iter().map(|tag| tag.to_string()).collect()
    }

    fn utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    #[test]
    fn the_disables_are_always_present() {
        for languages in [list(&[]), list(&["ro-RO", "en-US"]), list(&["bad tag"])] {
            let args = browser_args(&languages);
            assert!(
                args.starts_with(DEFAULT_DISABLES),
                "the three disables lead every value, or the mini menu, the PDF UI \
                 and SmartScreen come back: {args}"
            );
        }
        assert_eq!(
            DEFAULT_DISABLES,
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        );
    }

    #[test]
    fn the_first_language_is_used_as_windows_gives_it() {
        assert_eq!(
            browser_args(&list(&["ro-RO", "en-US"])),
            format!("{DEFAULT_DISABLES} --accept-lang=ro-RO")
        );
        assert_eq!(
            browser_args(&list(&["en-US", "ro-RO"])),
            format!("{DEFAULT_DISABLES} --accept-lang=en-US")
        );
        assert_eq!(
            browser_args(&list(&["zh-Hant-TW"])),
            format!("{DEFAULT_DISABLES} --accept-lang=zh-Hant-TW")
        );
    }

    #[test]
    fn an_empty_list_gives_the_behaviour_before_434() {
        assert_eq!(browser_args(&[]), DEFAULT_DISABLES);
    }

    #[test]
    fn a_malformed_first_entry_gives_the_behaviour_before_434_not_the_second() {
        let long = "a".repeat(MAX_TAG_LEN + 1);
        for bad in [
            "", "ro RO", "ro-", "-ro", "1ro", "ro\"", "ro --x", "ră", &long,
        ] {
            assert_eq!(
                browser_args(&list(&[bad, "en-US"])),
                DEFAULT_DISABLES,
                "a first entry that is not a tag is never replaced by a guess: {bad:?}"
            );
        }
        assert!(is_plausible_tag(&"a".repeat(MAX_TAG_LEN)));
    }

    #[test]
    fn a_multi_string_is_read_up_to_its_terminating_empty_entry() {
        let mut buffer = utf16("ro-RO\0en-US\0\0");
        buffer.extend([0x72, 0x6f, 0]); // stale bytes after the end: ignored
        assert_eq!(parse_multi_sz(&buffer, 16), list(&["ro-RO", "en-US"]));
    }

    #[test]
    fn a_multi_string_is_read_within_its_bounds() {
        assert_eq!(parse_multi_sz(&utf16("a\0b\0c\0\0"), 2), list(&["a", "b"]));
        assert_eq!(parse_multi_sz(&[], 16), Vec::<String>::new());
        assert_eq!(parse_multi_sz(&utf16("\0"), 16), Vec::<String>::new());
        // No terminator at all: what is there is still one entry.
        assert_eq!(parse_multi_sz(&utf16("ro-RO"), 16), list(&["ro-RO"]));
        // A lone surrogate ends the list instead of being replaced.
        assert_eq!(
            parse_multi_sz(&[0x72, 0x6f, 0, 0xD800, 0], 16),
            list(&["ro"])
        );
    }
}
