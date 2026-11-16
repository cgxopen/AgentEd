//! Throwaway, measure/727 only, never merged: Ctrl+click (Cmd+click on a Mac)
//! on the link whose text is AGENTED_MEASURE_727_CLICK, then what followed.

use std::time::Duration;
use tauri::Manager;

macro_rules! say {
    ($($arg:tt)*) => {{
        let line = format!($($arg)*);
        eprintln!("{line}");
        let path = std::env::temp_dir().join("measure-727.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            use std::io::Write;
            let _ = writeln!(f, "{line}");
        }
    }};
}

fn click_js(label: &str) -> String {
    let label = label.replace('\\', "\\\\").replace('\'', "\\'");
    format!(
        r#"(function () {{
  var log = function (m) {{ window.__TAURI_INTERNALS__.invoke('measure_log', {{ msg: m }}); }};
  var mac = /Mac/.test(navigator.platform);
  var name = function () {{ var f = document.getElementById('filename'); return f ? f.textContent : '?'; }};
  var link = Array.prototype.find.call(document.querySelectorAll('#editor a'), function (a) {{ return a.textContent === '{label}'; }});
  if (!link) {{ log('label {label}: no link with that text; the text is ' + (document.body.innerText.indexOf('{label}') >= 0 ? 'present' : 'absent')); return; }}
  log('label {label}: href ' + link.getAttribute('href') + ', document ' + name() + ', location ' + location.href);
  var opts = {{ bubbles: true, cancelable: true, button: 0, ctrlKey: !mac, metaKey: mac }};
  link.dispatchEvent(new MouseEvent('mousedown', opts));
  link.dispatchEvent(new MouseEvent('click', opts));
  setTimeout(function () {{
    var toasts = Array.prototype.map.call(document.querySelectorAll('.toast'), function (t) {{ return t.textContent.trim(); }}).join(' | ');
    var dialogs = Array.prototype.map.call(document.querySelectorAll('.dialog-overlay .dialog-title'), function (t) {{ return t.textContent; }}).join(' | ');
    log('after: document ' + name() + ', location ' + location.href + ', toast [' + toasts + '], dialog [' + dialogs + ']');
  }}, 3000);
}})();"#
    )
}

pub fn install(app: &tauri::App) {
    let Ok(label) = std::env::var("AGENTED_MEASURE_727_CLICK") else {
        return;
    };
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(9));
        let Some(window) = handle.get_webview_window("main") else {
            say!("measure-727: no window main");
            return;
        };
        if let Err(e) = window.eval(click_js(&label)) {
            say!("measure-727: eval failed: {e}");
        }
    });
}

#[tauri::command]
pub fn measure_log(msg: String) {
    say!("measure-727: {msg}");
}
