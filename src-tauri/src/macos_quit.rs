//! Issue #539 - every app quit on macOS goes through the unsaved-changes
//! gate (R-C3).
//!
//! Cmd+Q, AgentEd > Quit AgentEd, Quit from the Dock and a logout all end in
//! `-[NSApplication terminate:]`: the Quit item of the default menu sends it
//! (muda 0.20.0), and the quit Apple event the Dock and a logout send is
//! handled by AppKit with it. Before terminating, AppKit asks the app
//! delegate `applicationShouldTerminate:`, the one place a quit can be
//! cancelled. tao 0.37.1 declares only `applicationWillTerminate:`, which
//! comes after the decision, so the application received `RunEvent::Exit`
//! alone and nothing reached the gate. Measured on a macOS runner on #539:
//! as shipped, all three quits delivered `Exit` with no close request.
//!
//! So `applicationShouldTerminate:` is added here to the app delegate class
//! tao registers. It answers Cancel and asks the main window to close. The
//! close request reaches `installCloseGuard` in `src/platform/tauri.ts`,
//! which asks when there are unsaved changes, exactly as the red window
//! button does. Approved, the guard destroys the window; the last window
//! gone raises `ExitRequested` with code `None`, which nothing prevents, and
//! tao ends the event loop with `-[NSApplication stop:]`, which does not
//! send `terminate:` again. Cancelled, the window and the app stay.
//!
//! Answering Cancel to a logout makes macOS stop the logout, even when
//! nothing is unsaved and the app then quits by itself: the user logs out
//! again. `NSTerminateLater` could let an approved quit continue it, but it
//! waits in a modal run loop the gate dialog was not measured in.

use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::sel;
use tauri::{App, AppHandle, Manager};

/// The window `tauri.conf.json` declares, which Tauri builds on macOS.
const MAIN_WINDOW: &str = "main";

/// The app delegate class tao 0.37.1 registers (`app_delegate.rs`). A tao
/// that renames it, or declares the method itself, makes `install` fail and
/// say so, rather than replace anything.
const TAO_APP_DELEGATE: &std::ffi::CStr = c"TaoAppDelegateParent";

/// `NSApplicationTerminateReply`: an `NSUInteger`, so `Q` in the method's
/// type encoding below.
const NS_TERMINATE_CANCEL: usize = 0;

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Add `applicationShouldTerminate:` to tao's app delegate class. Called
/// from `setup`, before the event loop can deliver a quit.
///
/// A failure is written to stderr, which a macOS app started from Finder
/// shows nowhere: quitting then ends the app without asking, as every build
/// before #539 did.
pub fn install(app: &App) {
    if APP.set(app.handle().clone()).is_err() {
        eprintln!("macos_quit: install called twice; the first handle is kept");
        return;
    }
    let Some(class) = AnyClass::get(TAO_APP_DELEGATE) else {
        eprintln!("macos_quit: the tao app delegate class was not found; quit is not gated");
        return;
    };
    // SAFETY: `should_terminate` has the C signature the type encoding
    // `Q@:@` describes - an NSUInteger return, then self, _cmd and the
    // sender - which is the signature AppKit calls
    // `applicationShouldTerminate:` with. `class_addMethod` copies what it is
    // given and does not keep the string.
    let added = unsafe {
        let imp = std::mem::transmute::<
            extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
            Imp,
        >(should_terminate);
        objc2::ffi::class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            sel!(applicationShouldTerminate:),
            imp,
            c"Q@:@".as_ptr(),
        )
    };
    if !added.as_bool() {
        eprintln!(
            "macos_quit: the tao app delegate already answers applicationShouldTerminate:; \
             quit is left to it"
        );
    }
}

/// AppKit's question before a quit. Always Cancel: the quit, if the user
/// approves it, happens through the window close instead.
///
/// When the window cannot be asked, the answer is still Cancel. The app
/// stays open with the document in it, as `installCloseGuard` keeps the
/// window open when its gate fails, and the failure goes to stderr.
extern "C-unwind" fn should_terminate(
    _this: *mut AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> usize {
    match APP
        .get()
        .and_then(|app| app.get_webview_window(MAIN_WINDOW))
    {
        Some(window) => {
            if let Err(e) = window.close() {
                eprintln!("macos_quit: asking the window to close failed, staying open: {e}");
            }
        }
        None => eprintln!("macos_quit: no main window to ask, staying open"),
    }
    NS_TERMINATE_CANCEL
}
