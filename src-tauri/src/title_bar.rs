//! Issue #615 - whether the title bar of a window is drawn over its content.
//!
//! On macOS `tauri.macos.conf.json` sets the title bar of `main` to the
//! overlay style: the three system buttons stand over the left of the header,
//! and the header becomes the title bar. The page has to know it to leave
//! room for the buttons and to mark the bar as the place a window is dragged
//! from, and no window API of the page reports the style. So the page asks
//! here, and the answer is read from the configuration the window was built
//! from: the question is how this window draws its title bar, and the config
//! is what decides it, on every platform.
//!
//! A document window of macOS (#559) has no description of its own: it is
//! built from the one of `main` under a label `doc-N`, in `macos_windows.rs`,
//! so its question is answered from `main`.

use tauri::utils::config::WindowConfig;
use tauri::TitleBarStyle;

/// The label whose description a window was built from.
fn described_by(label: &str) -> &str {
    #[cfg(any(target_os = "macos", test))]
    if label.starts_with(crate::document_windows::DOCUMENT_WINDOW_PREFIX) {
        return crate::document_windows::MAIN_WINDOW;
    }
    label
}

/// Whether the window `label` draws its title bar over its content, by the
/// descriptions in `windows`; an error where no description names it.
pub fn is_overlay(windows: &[WindowConfig], label: &str) -> Result<bool, String> {
    let described = described_by(label);
    windows
        .iter()
        .find(|window| window.label == described)
        .map(|window| window.title_bar_style == TitleBarStyle::Overlay)
        .ok_or_else(|| format!("no window description for `{label}`"))
}

/// Asked by the page of each window once, at start (`src/platform/tauri.ts`).
#[tauri::command]
pub fn title_bar_overlay(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<bool, String> {
    is_overlay(&app.config().app.windows, window.label())
}

#[cfg(test)]
mod tests {
    use super::is_overlay;
    use tauri::utils::config::WindowConfig;

    /// The windows Tauri reads on a target: the base file, with the array of
    /// the platform file over it when that file restates one, as JSON Merge
    /// Patch replaces an array whole.
    fn windows_with(platform: &str) -> Vec<WindowConfig> {
        let base: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json should parse");
        let own: serde_json::Value =
            serde_json::from_str(platform).expect("the platform file should parse");
        let windows = own["app"]
            .get("windows")
            .unwrap_or(&base["app"]["windows"])
            .clone();
        serde_json::from_value(windows).expect("the windows should parse as window descriptions")
    }

    #[test]
    fn main_and_every_document_window_draw_over_their_content_on_macos() {
        let windows = windows_with(include_str!("../tauri.macos.conf.json"));
        assert_eq!(is_overlay(&windows, "main"), Ok(true));
        assert_eq!(is_overlay(&windows, "doc-1"), Ok(true));
        assert_eq!(is_overlay(&windows, "doc-42"), Ok(true));
    }

    #[test]
    fn windows_and_the_base_keep_their_title_bar_out_of_the_content() {
        let on_windows = windows_with(include_str!("../tauri.windows.conf.json"));
        assert_eq!(is_overlay(&on_windows, "main"), Ok(false));
        let base = windows_with("{}");
        assert_eq!(is_overlay(&base, "main"), Ok(false));
    }

    #[test]
    fn a_window_no_description_names_is_an_error() {
        let windows = windows_with("{}");
        assert_eq!(
            is_overlay(&windows, "settings"),
            Err("no window description for `settings`".to_string())
        );
    }
}
