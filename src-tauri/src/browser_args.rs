//! Issue #434 - the WebView2 command line of the main window, as a pure
//! function of the Windows preferred-languages list and the display language.
//!
//! The spell checker of WebView2 checks in one language at a time, and left
//! alone it is the Windows display language, because that is what `wry` sets
//! as the environment language. `--accept-lang` reaches the checker (measured
//! on #411), and the checker takes the first entry of it that it has a
//! dictionary for, skipping the others (measured on #434).
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

/// The arguments for the main window, owner decision of 2026-09-23 on #434
/// (variant A). The disables are always present. `--accept-lang` carries, in
/// this order and without duplicates:
///
/// 1. the first preferred language, exactly as Windows gives it - `ro-RO` on
///    the owner machine, which alone gives the checker no Romanian;
/// 2. its primary subtag - `ro`, the form the checker has a dictionary for;
/// 3. the display language - what the checker used before #434, so a first
///    language it has no dictionary for falls back to today rather than to no
///    checker at all, which is what an existing profile got without it.
///
/// If the first preferred language or the display language is missing or not
/// a plausible tag, no `--accept-lang` is passed: the behaviour before #434,
/// never a guessed language.
pub fn browser_args(languages: &[String], display: Option<&str>) -> String {
    let (Some(first), Some(display)) = (languages.first(), display) else {
        return DEFAULT_DISABLES.to_string();
    };
    if !is_plausible_tag(first) || !is_plausible_tag(display) {
        return DEFAULT_DISABLES.to_string();
    }
    let primary = first.split('-').next().unwrap_or(first);
    let mut accepted: Vec<&str> = Vec::with_capacity(3);
    for tag in [first.as_str(), primary, display] {
        if !accepted.iter().any(|seen| seen.eq_ignore_ascii_case(tag)) {
            accepted.push(tag);
        }
    }
    format!("{DEFAULT_DISABLES} --accept-lang={}", accepted.join(","))
}

/// The value goes onto a command line, so it is held to the characters a
/// language tag is made of: ASCII letters, digits and hyphens, starting with
/// a letter and not ending with a hyphen. So the primary subtag of a
/// plausible tag is itself one.
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

    fn accept(value: &str) -> String {
        format!("{DEFAULT_DISABLES} --accept-lang={value}")
    }

    #[test]
    fn the_disables_are_always_present() {
        let cases: [(Vec<String>, Option<&str>); 4] = [
            (list(&[]), Some("en-US")),
            (list(&["ro-RO", "en-US"]), Some("en-US")),
            (list(&["ro-RO"]), None),
            (list(&["bad tag"]), Some("en-US")),
        ];
        for (languages, display) in cases {
            let args = browser_args(&languages, display);
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

    /// The rows measured on the owner machine on #434, rounds 1 and 2: each
    /// value below is one that was passed there and read back.
    #[test]
    fn the_measured_rows_are_what_is_passed() {
        // Round 2, run 1: Romanian, dictionary [ro].
        assert_eq!(
            browser_args(&list(&["ro-RO", "en-US"]), Some("en-US")),
            accept("ro-RO,ro,en-US")
        );
        // Round 1: English for an en-US user, dictionary [en-US].
        assert_eq!(
            browser_args(&list(&["en-US", "ro-RO"]), Some("en-US")),
            accept("en-US,en")
        );
        // Round 2, runs 2 and 3: no dictionary for the first, today's [en-US].
        assert_eq!(
            browser_args(&list(&["qaa-QM"]), Some("en-US")),
            accept("qaa-QM,qaa,en-US")
        );
    }

    #[test]
    fn the_display_language_always_closes_the_list() {
        for first in ["ro-RO", "ro", "de-DE", "zh-Hant-TW", "qaa-QM"] {
            let args = browser_args(&list(&[first]), Some("en-GB"));
            assert!(
                args.ends_with(",en-GB") || args.ends_with("=en-GB"),
                "without the display language, a first language the checker has \
                 no dictionary for leaves an existing profile with none (#434, \
                 round 2, run 4): {args}"
            );
        }
    }

    #[test]
    fn duplicates_are_left_out_in_any_case() {
        assert_eq!(
            browser_args(&list(&["ro"]), Some("en-US")),
            accept("ro,en-US")
        );
        assert_eq!(
            browser_args(&list(&["en-US"]), Some("en-us")),
            accept("en-US,en")
        );
        assert_eq!(browser_args(&list(&["en"]), Some("EN")), accept("en"));
        assert_eq!(
            browser_args(&list(&["zh-Hant-TW"]), Some("zh")),
            accept("zh-Hant-TW,zh")
        );
    }

    #[test]
    fn a_missing_part_gives_the_behaviour_before_434() {
        assert_eq!(browser_args(&[], Some("en-US")), DEFAULT_DISABLES);
        assert_eq!(browser_args(&list(&["ro-RO"]), None), DEFAULT_DISABLES);
        assert_eq!(browser_args(&list(&["ro-RO"]), Some("")), DEFAULT_DISABLES);
    }

    #[test]
    fn a_malformed_first_entry_gives_the_behaviour_before_434_not_the_second() {
        let long = "a".repeat(MAX_TAG_LEN + 1);
        for bad in [
            "", "ro RO", "ro-", "-ro", "1ro", "ro\"", "ro --x", "ră", &long,
        ] {
            assert_eq!(
                browser_args(&list(&[bad, "en-US"]), Some("en-US")),
                DEFAULT_DISABLES,
                "a first entry that is not a tag is never replaced by a guess: {bad:?}"
            );
            assert_eq!(
                browser_args(&list(&["ro-RO"]), Some(bad)),
                DEFAULT_DISABLES,
                "nor is a display language that is not a tag: {bad:?}"
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
