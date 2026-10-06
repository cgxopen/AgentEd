//! The shell open scope against the cases in `shell-open-cases.json` (#448).
//!
//! tauri-plugin-shell 2.3.5 compiles `plugins.shell.open` as `^{scope}$`
//! (`scope.rs:96`) and matches the raw string the frontend hands it
//! (`scope.rs:210`). This compiles it the same way, with the same `regex`
//! crate the plugin resolves to in `Cargo.lock`, so a case that passes here
//! is a string the plugin admits. What the frontend hands for a link is
//! asserted in `src/app/link-open.test.ts` over the same file, which is what
//! joins the two halves.

use regex::Regex;
use serde_json::Value;

fn scope() -> Regex {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json is JSON");
    let open = config["plugins"]["shell"]["open"]
        .as_str()
        .expect("plugins.shell.open is a regular expression string");
    Regex::new(&format!("^{open}$")).expect("the scope compiles as the plugin compiles it")
}

fn cases() -> Value {
    serde_json::from_str(include_str!("../shell-open-cases.json")).expect("the cases are JSON")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("a list")
        .iter()
        .map(|entry| entry.as_str().expect("a string").to_string())
        .collect()
}

#[test]
fn the_scope_admits_every_address_a_link_hands_it() {
    let scope = scope();
    let refused: Vec<String> = cases()["links"]
        .as_array()
        .expect("a list of links")
        .iter()
        .map(|link| {
            link["handed"]
                .as_str()
                .expect("a handed address")
                .to_string()
        })
        .filter(|handed| !scope.is_match(handed))
        .collect();
    assert!(refused.is_empty(), "refused: {refused:#?}");
}

#[test]
fn the_scope_admits_a_reachable_file_wherever_it_sits() {
    let scope = scope();
    let refused: Vec<String> = strings(&cases()["admittedPaths"])
        .into_iter()
        .filter(|path| !scope.is_match(path))
        .collect();
    assert!(refused.is_empty(), "refused: {refused:#?}");
}

#[test]
fn the_scope_refuses_every_other_scheme_extension_and_shape() {
    let scope = scope();
    let admitted: Vec<String> = strings(&cases()["refused"])
        .into_iter()
        .filter(|refused| scope.is_match(refused))
        .collect();
    assert!(admitted.is_empty(), "admitted: {admitted:#?}");
}

/// #549: About opens the notices file each bundle installs, through this
/// scope, so its path on every platform has to be admitted.
#[test]
fn the_scope_admits_the_notices_file_of_every_bundle() {
    let scope = scope();
    let refused: Vec<String> = strings(&cases()["noticesPaths"])
        .into_iter()
        .filter(|path| !scope.is_match(path))
        .collect();
    assert!(refused.is_empty(), "refused: {refused:#?}");
}
