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
//! tao registers. Since #559 there can be several windows, and what it
//! answers depends on them (`macos_windows.rs`):
//!
//! - **Nothing unsaved in any window: Now.** macOS ends the app. Until #559
//!   the answer was always Cancel: measured on #546 and again on the step
//!   zero of #559, the quit Apple event carrying the logout reason was
//!   answered User canceled. Whether that stopped a real logout is another
//!   matter, which a runner cannot try; the owner logged out of a Mac with
//!   nothing unsaved at preview.4 and the logout went on (#558).
//! - **Otherwise: Cancel**, and the windows holding unsaved changes are
//!   asked to close one at a time, the one in front first. Each close
//!   request reaches `installCloseGuard` in `src/platform/tauri.ts`, which
//!   asks exactly as the red window button does. Approved, the guard
//!   destroys the window and the next is asked; once every one has an
//!   answer the clean windows close too, and the last window gone raises
//!   `ExitRequested` with code `None`, which nothing prevents, and tao ends
//!   the event loop with `-[NSApplication stop:]`, which does not send
//!   `terminate:` again. The first Cancel stops the quit, and every window
//!   still open stays.
//!
//! A logout with unsaved changes is answered Cancel too, and the windows ask
//! one at a time; whether macOS then stops the logout is not measured here.
//! `NSTerminateLater` could let an approved quit continue it, but it waits in
//! a modal run loop the gate dialog was not measured in.

use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::sel;
use tauri::{App, AppHandle};

/// The app delegate class tao 0.37.1 registers (`app_delegate.rs`). A tao
/// that renames it, or declares the method itself, makes `install` fail and
/// say so, rather than replace anything.
const TAO_APP_DELEGATE: &std::ffi::CStr = c"TaoAppDelegateParent";

/// `NSApplicationTerminateReply`: an `NSUInteger`, so `Q` in the method's
/// type encoding below.
const NS_TERMINATE_CANCEL: usize = 0;

/// `NSTerminateNow`: macOS ends the app.
const NS_TERMINATE_NOW: usize = 1;

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

/// AppKit's question before a quit (#539, #559).
///
/// With nothing unsaved in any window the answer is Now, and macOS ends the
/// app, with no Cancel that could stop a logout. Otherwise it is Cancel, and
/// the windows holding unsaved changes are asked one at a time instead, the one in front
/// first; a quit the user approves in every one ends the app when its last
/// window is gone, and the first Cancel stops it (`macos_windows.rs`).
///
/// When the app cannot be reached the answer is Cancel: the app stays open
/// with every document in it, and the failure goes to stderr.
extern "C-unwind" fn should_terminate(
    _this: *mut AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> usize {
    match APP.get() {
        Some(app) if crate::macos_windows::should_terminate(app) => NS_TERMINATE_NOW,
        Some(_) => NS_TERMINATE_CANCEL,
        None => {
            eprintln!("macos_quit: no app to ask, staying open");
            NS_TERMINATE_CANCEL
        }
    }
}
