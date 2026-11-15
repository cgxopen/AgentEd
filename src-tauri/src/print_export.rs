//! File, Export to PDF (#725): the open document written straight to the path
//! the person chose in a save dialog of ours, with no system dialog, through
//! the print engine of the web view on each platform. Measured on the two step
//! zeros of #725 (comments 6889892162 and 6890109037): the call below is the
//! one that wrote a paginated PDF on each platform, with no window, panel or
//! sheet shown.
//!
//! What reaches the page is decided by the print rules of `src/styles.css`,
//! which both routes obey; this module decides the paper, the margins and that
//! there are no headers or footers. The paper follows the system, A4 or Letter
//! (owner decision of 2026-11-15); the margins are 15 mm, as measured.

/// The paper of an export.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Paper {
    A4,
    Letter,
}

impl Paper {
    /// Width and height in millimetres.
    fn size_mm(self) -> (f64, f64) {
        match self {
            Paper::A4 => (210.0, 297.0),
            Paper::Letter => (215.9, 279.4),
        }
    }

    /// The name the page is told.
    pub fn name(self) -> &'static str {
        match self {
            Paper::A4 => "A4",
            Paper::Letter => "Letter",
        }
    }
}

/// The margin on every side, as measured on the second step zero.
const MARGIN_MM: f64 = 15.0;

/// What the export reports back to the page: the paper it used, or why it
/// failed, in words the page shows in a dialog.
type Outcome = Result<(), String>;

/// File, Export to PDF. Answers the name of the paper used once the file is
/// written, or the reason it was not.
#[tauri::command]
pub async fn export_pdf(window: tauri::WebviewWindow, path: String) -> Result<String, String> {
    let paper = system_paper();
    let (tx, mut rx) = tauri::async_runtime::channel::<Outcome>(1);
    window
        .with_webview(move |webview| start(webview, &path, paper, tx))
        .map_err(|e| format!("The window could not be reached: {e}"))?;
    match rx.recv().await {
        Some(Ok(())) => Ok(paper.name().to_string()),
        Some(Err(reason)) => Err(reason),
        None => Err("The export ended without a result.".to_string()),
    }
}

/// Sends the outcome once; a second send finds the channel full or closed and
/// is dropped, since the page waits for one answer only.
fn finish(tx: &tauri::async_runtime::Sender<Outcome>, outcome: Outcome) {
    if let Err(e) = tx.try_send(outcome) {
        eprintln!("print_export: the outcome was not delivered: {e}");
    }
}

// ── Windows: ICoreWebView2_7::PrintToPdf ──

/// The paper of the user locale, `LOCALE_IPAPERSIZE`: 1 is Letter, and every
/// other answer, 9 for A4 among them, is A4. An unreadable locale is A4.
#[cfg(windows)]
pub fn system_paper() -> Paper {
    use windows::core::PCWSTR;
    use windows::Win32::Globalization::{GetLocaleInfoEx, LOCALE_IPAPERSIZE, LOCALE_RETURN_NUMBER};
    let mut buf = [0u16; 2];
    // SAFETY: a null name is LOCALE_NAME_USER_DEFAULT; with LOCALE_RETURN_NUMBER
    // the answer is one u32, written into the two u16 of `buf`.
    let written = unsafe {
        GetLocaleInfoEx(
            PCWSTR::null(),
            LOCALE_IPAPERSIZE | LOCALE_RETURN_NUMBER,
            Some(&mut buf),
        )
    };
    if written == 0 {
        eprintln!("print_export: the paper of the locale could not be read; A4");
        return Paper::A4;
    }
    match u32::from(buf[0]) | (u32::from(buf[1]) << 16) {
        1 => Paper::Letter,
        _ => Paper::A4,
    }
}

#[cfg(windows)]
fn start(
    webview: tauri::webview::PlatformWebview,
    path: &str,
    paper: Paper,
    tx: tauri::async_runtime::Sender<Outcome>,
) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let inch = |mm: f64| mm / 25.4;
    let (width, height) = paper.size_mm();
    let done = tx.clone();
    let started = (|| -> windows::core::Result<()> {
        // SAFETY: COM calls on the WebView2 objects of this window, made on
        // the thread `with_webview` runs its closure on, the UI thread.
        unsafe {
            let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
            let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
            let settings = environment.CreatePrintSettings()?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            settings.SetShouldPrintBackgrounds(false)?;
            settings.SetPageWidth(inch(width))?;
            settings.SetPageHeight(inch(height))?;
            settings.SetMarginTop(inch(MARGIN_MM))?;
            settings.SetMarginBottom(inch(MARGIN_MM))?;
            settings.SetMarginLeft(inch(MARGIN_MM))?;
            settings.SetMarginRight(inch(MARGIN_MM))?;
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
                let outcome = match result {
                    Err(e) => Err(format!("The PDF could not be written: {e}")),
                    Ok(()) if success => Ok(()),
                    Ok(()) => Err("The PDF could not be written.".to_string()),
                };
                finish(&done, outcome);
                Ok(())
            }));
            core.PrintToPdf(&HSTRING::from(path), &settings, &handler)
        }
    })();
    if let Err(e) = started {
        finish(&tx, Err(format!("The PDF could not be started: {e}")));
    }
}

// ── macOS: an NSPrintOperation of the WKWebView, saving to a URL ──

/// The paper of the shared `NSPrintInfo`, which macOS sets from the default
/// printer and the region: Letter when it is 612 by 792 points, A4 otherwise.
#[cfg(target_os = "macos")]
pub fn system_paper() -> Paper {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    let Some(class) = AnyClass::get(c"NSPrintInfo") else {
        eprintln!("print_export: NSPrintInfo not found; A4");
        return Paper::A4;
    };
    // SAFETY: `sharedPrintInfo` answers an NSPrintInfo and `paperSize` an NSSize.
    let size: macos::Size = unsafe {
        let shared: *mut AnyObject = msg_send![class, sharedPrintInfo];
        if shared.is_null() {
            eprintln!("print_export: no shared NSPrintInfo; A4");
            return Paper::A4;
        }
        msg_send![shared, paperSize]
    };
    if (size.width - 612.0).abs() < 1.0 && (size.height - 792.0).abs() < 1.0 {
        Paper::Letter
    } else {
        Paper::A4
    }
}

#[cfg(target_os = "macos")]
fn start(
    webview: tauri::webview::PlatformWebview,
    path: &str,
    paper: Paper,
    tx: tauri::async_runtime::Sender<Outcome>,
) {
    if let Err(reason) = macos::run(webview.inner().cast(), path, paper, tx.clone()) {
        finish(&tx, Err(reason));
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{finish, Outcome, Paper, MARGIN_MM};
    use objc2::encode::{Encode, Encoding};
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::sel;
    use std::ffi::{c_void, CString};
    use std::sync::OnceLock;

    #[repr(C)]
    #[derive(Clone, Copy, Debug)]
    pub struct Size {
        pub width: f64,
        pub height: f64,
    }
    // SAFETY: the layout of NSSize, two CGFloat, which are f64 on Apple Silicon.
    unsafe impl Encode for Size {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug)]
    struct Point {
        x: f64,
        y: f64,
    }
    // SAFETY: the layout of NSPoint.
    unsafe impl Encode for Point {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug)]
    struct Rect {
        origin: Point,
        size: Size,
    }
    // SAFETY: the layout of NSRect.
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]);
    }

    #[link(name = "AppKit", kind = "framework")]
    extern "C" {
        static NSPrintJobSavingURL: *const AnyObject;
        static NSPrintSaveJob: *const AnyObject;
    }

    /// WebKit on macOS lays a print out at 72 CSS pixels to the inch, where
    /// WebView2 and WebKitGTK lay it out at 96; the second step zero measured
    /// 7 pages here against 4 there for the same paper and margins. A scale of
    /// 72/96 on the print info is meant to give the same layout.
    const SCALE: f64 = 0.75;

    /// The one delegate AppKit tells when an operation has run: its class is
    /// registered and the object made once, and kept for the life of the
    /// process, since the operation does not retain its delegate. Its
    /// address is kept, as a raw pointer is not `Sync`.
    fn delegate() -> Option<*mut AnyObject> {
        static DELEGATE: OnceLock<Option<usize>> = OnceLock::new();
        let address = *DELEGATE.get_or_init(|| {
            let superclass = AnyClass::get(c"NSObject")?;
            let mut builder = ClassBuilder::new(c"AgentEdPdfExportDelegate", superclass)?;
            // SAFETY: AppKit calls the selector with the operation, the
            // success flag and the context info, the signature below.
            unsafe {
                builder.add_method(
                    sel!(printOperationDidRun:success:contextInfo:),
                    did_run
                        as extern "C-unwind" fn(
                            *mut AnyObject,
                            Sel,
                            *mut AnyObject,
                            Bool,
                            *mut c_void,
                        ),
                );
            }
            let class = builder.register();
            // SAFETY: `new` on an NSObject subclass answers a retained object.
            let object: *mut AnyObject = unsafe { msg_send![class, new] };
            (!object.is_null()).then_some(object as usize)
        });
        address.map(|a| a as *mut AnyObject)
    }

    /// The end of the operation: the context info is the sender boxed by `run`.
    extern "C-unwind" fn did_run(
        _this: *mut AnyObject,
        _cmd: Sel,
        _op: *mut AnyObject,
        success: Bool,
        context: *mut c_void,
    ) {
        if context.is_null() {
            eprintln!("print_export: the operation ended with no context");
            return;
        }
        // SAFETY: `run` leaked this box for exactly one call.
        let tx = unsafe { Box::from_raw(context.cast::<tauri::async_runtime::Sender<Outcome>>()) };
        let outcome = if success.as_bool() {
            Ok(())
        } else {
            Err("The PDF could not be written.".to_string())
        };
        finish(&tx, outcome);
    }

    pub fn run(
        webview: *mut AnyObject,
        path: &str,
        paper: Paper,
        tx: tauri::async_runtime::Sender<Outcome>,
    ) -> Result<(), String> {
        let class = |name: &std::ffi::CStr| {
            AnyClass::get(name).ok_or_else(|| format!("{name:?} not found"))
        };
        let delegate = delegate().ok_or("The export delegate could not be made.")?;
        let path =
            CString::new(path).map_err(|_| "The file name holds a null character.".to_string())?;
        let pt = |mm: f64| mm / 25.4 * 72.0;
        let (width, height) = paper.size_mm();
        // SAFETY: messages to AppKit and WebKit objects of this window, on the
        // main thread `with_webview` runs its closure on, with the argument and
        // return types those methods declare.
        unsafe {
            let ns_path: *mut AnyObject =
                msg_send![class(c"NSString")?, stringWithUTF8String: path.as_ptr()];
            let url: *mut AnyObject = msg_send![class(c"NSURL")?, fileURLWithPath: ns_path];
            let shared: *mut AnyObject = msg_send![class(c"NSPrintInfo")?, sharedPrintInfo];
            let info: *mut AnyObject = msg_send![shared, copy];
            if info.is_null() {
                return Err("The print settings could not be made.".to_string());
            }
            let _: () =
                msg_send![info, setPaperSize: Size { width: pt(width), height: pt(height) }];
            let margin = pt(MARGIN_MM);
            let _: () = msg_send![info, setTopMargin: margin];
            let _: () = msg_send![info, setBottomMargin: margin];
            let _: () = msg_send![info, setLeftMargin: margin];
            let _: () = msg_send![info, setRightMargin: margin];
            let _: () = msg_send![info, setScalingFactor: SCALE];
            let _: () = msg_send![info, setJobDisposition: NSPrintSaveJob];
            let dictionary: *mut AnyObject = msg_send![info, dictionary];
            let _: () = msg_send![dictionary, setObject: url, forKey: NSPrintJobSavingURL];
            let operation: *mut AnyObject = msg_send![webview, printOperationWithPrintInfo: info];
            if operation.is_null() {
                return Err("The print operation could not be made.".to_string());
            }
            let _: () = msg_send![operation, setShowsPrintPanel: false];
            let _: () = msg_send![operation, setShowsProgressPanel: false];
            // WebKit prints from a view with no frame unless it is given one.
            let view: *mut AnyObject = msg_send![operation, view];
            let bounds: Rect = msg_send![webview, bounds];
            let _: () = msg_send![view, setFrame: bounds];
            let window: *mut AnyObject = msg_send![webview, window];
            let context = Box::into_raw(Box::new(tx)).cast::<c_void>();
            let _: () = msg_send![
                operation,
                runOperationModalForWindow: window,
                delegate: delegate,
                didRunSelector: sel!(printOperationDidRun:success:contextInfo:),
                contextInfo: context
            ];
            // The operation holds the print info now; the copy made here is released.
            let _: () = msg_send![info, release];
        }
        Ok(())
    }
}

// ── Linux: a WebKitPrintOperation printed to the Print to File backend ──

/// The GTK default paper, which GTK reads from the locale: Letter when its
/// name says so, A4 otherwise and when there is none.
#[cfg(target_os = "linux")]
pub fn system_paper() -> Paper {
    match gtk::PaperSize::default() {
        Some(name) if name.as_str().contains("letter") => Paper::Letter,
        Some(_) => Paper::A4,
        None => {
            eprintln!("print_export: no GTK default paper; A4");
            Paper::A4
        }
    }
}

#[cfg(target_os = "linux")]
fn start(
    webview: tauri::webview::PlatformWebview,
    path: &str,
    paper: Paper,
    tx: tauri::async_runtime::Sender<Outcome>,
) {
    use webkit2gtk::{PrintOperation, PrintOperationExt};
    let operation = PrintOperation::new(&webview.inner());
    let settings = gtk::PrintSettings::new();
    settings.set_printer("Print to File");
    settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
    let uri = match gtk::glib::filename_to_uri(path, None) {
        Ok(uri) => uri,
        Err(e) => return finish(&tx, Err(format!("The file name could not be used: {e}"))),
    };
    settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri.as_str()));
    let setup = gtk::PageSetup::new();
    let name = match paper {
        Paper::A4 => "iso_a4",
        Paper::Letter => "na_letter",
    };
    setup.set_paper_size(&gtk::PaperSize::new(Some(name)));
    setup.set_top_margin(MARGIN_MM, gtk::Unit::Mm);
    setup.set_bottom_margin(MARGIN_MM, gtk::Unit::Mm);
    setup.set_left_margin(MARGIN_MM, gtk::Unit::Mm);
    setup.set_right_margin(MARGIN_MM, gtk::Unit::Mm);
    operation.set_print_settings(&settings);
    operation.set_page_setup(&setup);
    // Whichever of `failed` and `finished` arrives first is the answer;
    // `finish` drops a later one. The operation is held until `finished`, so
    // it outlives this function for as long as the printing takes.
    let held = std::rc::Rc::new(std::cell::RefCell::new(Some(operation.clone())));
    let failed = tx.clone();
    operation.connect_failed(move |_, e| {
        finish(&failed, Err(format!("The PDF could not be written: {e}")))
    });
    operation.connect_finished(move |_| {
        finish(&tx, Ok(()));
        held.borrow_mut().take();
    });
    operation.print();
}
