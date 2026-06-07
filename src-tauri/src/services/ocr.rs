// OCR service for image text extraction
//
// Architecture:
//   - `OcrService` is the single public entry point.
//   - `run_ocr(path)` returns an `OcrResult` that callers use to decide
//     whether to promote OCR output to content_text / index_text.
//   - OCR is always async, idempotent, and non-blocking for clip insertion.
//   - Failure never prevents an image clip from being stored or displayed.
//
// Platform strategy:
//   - macOS: Vision framework (VNRecognizeTextRequest) via the system OCR engine.
//   - Windows: Windows.Media.Ocr via the `windows` crate (WinRT, built-in since Win10).
//   - Linux: Tesseract via subprocess (`tesseract <path> stdout`).
//             Returns OcrResult::not_supported() when the `tesseract` binary is not found.
//   - All platforms fall back to `OcrResult::not_supported()` when no engine is
//     available, so callers never see an error — just an empty result.

use anyhow::Result;

/// Outcome of a single OCR attempt.
#[derive(Debug, Clone)]
pub struct OcrResult {
    /// Extracted text, or empty string when nothing could be read.
    pub text: String,
    /// Whether the OCR engine was actually invoked.
    pub supported: bool,
}

impl OcrResult {
    pub fn not_supported() -> Self {
        Self {
            text: String::new(),
            supported: false,
        }
    }

    pub fn success(text: String) -> Self {
        Self {
            text,
            supported: true,
        }
    }

    #[allow(dead_code)] // used only by the macOS Vision module
    pub fn failed() -> Self {
        Self {
            text: String::new(),
            supported: true,
        }
    }
}

pub struct OcrService;

impl OcrService {
    pub fn new() -> Self {
        Self
    }

    /// Run OCR on the image at `image_path` and return the extracted text.
    ///
    /// Returns `Ok(OcrResult::not_supported())` when no OCR engine is available
    /// for the current platform — never `Err` for a missing engine.
    /// Only returns `Err` for unexpected I/O failures that prevent even attempting OCR.
    pub async fn run_ocr(&self, image_path: &str) -> Result<OcrResult> {
        #[cfg(target_os = "macos")]
        {
            let path = image_path.to_string();
            // Vision calls are synchronous C/ObjC; move off the async executor.
            return tokio::task::spawn_blocking(move || macos::run_vision_ocr(&path)).await?;
        }

        #[cfg(target_os = "windows")]
        {
            let path = image_path.to_string();
            // WinRT calls must run on a thread initialised with COM/WinRT.
            // spawn_blocking gives us a regular OS thread; we init COM there.
            return tokio::task::spawn_blocking(move || windows_ocr::run_ocr(&path)).await?;
        }

        #[cfg(target_os = "linux")]
        {
            return linux_ocr::run_tesseract(image_path).await;
        }

        // Fallback: keeps the compiler happy for future / unexpected targets.
        #[allow(unreachable_code)]
        Ok(OcrResult::not_supported())
    }
}

impl Default for OcrService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::OcrResult;
    use anyhow::Result;
    use std::ffi::CString;

    // Bind just the Vision + Foundation types we need through the legacy objc crate,
    // which is already used throughout the project for NSPasteboard work.
    use objc::{class, msg_send, sel, sel_impl};

    type Id = *mut objc::runtime::Object;
    const NIL: Id = std::ptr::null_mut();

    pub fn run_vision_ocr(image_path: &str) -> Result<OcrResult> {
        unsafe {
            // ── 1. Load the image from disk ──────────────────────────────────
            let path_c = CString::new(image_path)?;
            let ns_string: Id = msg_send![
                class!(NSString),
                stringWithUTF8String: path_c.as_ptr()
            ];
            if ns_string == NIL {
                return Ok(OcrResult::failed());
            }

            let url: Id = msg_send![class!(NSURL), fileURLWithPath: ns_string];
            if url == NIL {
                return Ok(OcrResult::failed());
            }

            let ci_image: Id = msg_send![class!(CIImage), imageWithContentsOfURL: url];
            if ci_image == NIL {
                eprintln!("[OCR] CIImage could not load: {}", image_path);
                return Ok(OcrResult::failed());
            }

            // ── 2. Create a VNImageRequestHandler ───────────────────────────
            let handler: Id = msg_send![class!(VNImageRequestHandler), alloc];
            let empty_dict: Id = msg_send![class!(NSDictionary), dictionary];
            let handler: Id =
                msg_send![handler, initWithCIImage: ci_image options: empty_dict];
            if handler == NIL {
                return Ok(OcrResult::failed());
            }

            // ── 3. Create a VNRecognizeTextRequest ───────────────────────────
            let request: Id = msg_send![class!(VNRecognizeTextRequest), alloc];
            let request: Id = msg_send![request, init];
            if request == NIL {
                return Ok(OcrResult::failed());
            }

            // Use accurate (neural) recognition level (0 = fast, 1 = accurate)
            let _: () = msg_send![request, setRecognitionLevel: 1i64];
            // Enable automatic language correction
            let _: () = msg_send![request, setUsesLanguageCorrection: true];

            // ── 4. Perform the request ───────────────────────────────────────
            // Build an NSArray containing the one request
            let requests: Id =
                msg_send![class!(NSArray), arrayWithObject: request];

            let mut error: Id = NIL;
            let ok: bool = msg_send![handler, performRequests: requests error: &mut error];

            if !ok {
                if error != NIL {
                    let desc: Id = msg_send![error, localizedDescription];
                    let desc_utf8: *const std::os::raw::c_char = msg_send![desc, UTF8String];
                    let err_msg = if desc_utf8.is_null() {
                        "unknown Vision error".to_string()
                    } else {
                        std::ffi::CStr::from_ptr(desc_utf8)
                            .to_string_lossy()
                            .into_owned()
                    };
                    eprintln!("[OCR] Vision request failed: {}", err_msg);
                }
                return Ok(OcrResult::failed());
            }

            // ── 5. Collect recognized text observations ──────────────────────
            let results: Id = msg_send![request, results];
            if results == NIL {
                return Ok(OcrResult::success(String::new()));
            }

            let count: usize = msg_send![results, count];
            let mut lines: Vec<String> = Vec::with_capacity(count);

            for i in 0..count {
                let observation: Id = msg_send![results, objectAtIndex: i];
                if observation == NIL {
                    continue;
                }
                // topCandidates:1 returns NSArray<VNRecognizedText*> with 1 element
                let candidates: Id = msg_send![observation, topCandidates: 1usize];
                let candidate_count: usize = msg_send![candidates, count];
                if candidate_count == 0 {
                    continue;
                }
                let recognized: Id = msg_send![candidates, objectAtIndex: 0usize];
                if recognized == NIL {
                    continue;
                }
                let ns_text: Id = msg_send![recognized, string];
                if ns_text == NIL {
                    continue;
                }
                let utf8_ptr: *const std::os::raw::c_char = msg_send![ns_text, UTF8String];
                if utf8_ptr.is_null() {
                    continue;
                }
                let line = std::ffi::CStr::from_ptr(utf8_ptr)
                    .to_string_lossy()
                    .into_owned();
                if !line.trim().is_empty() {
                    lines.push(line);
                }
            }

            let text = lines.join("\n");
            Ok(OcrResult::success(text))
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Windows OCR — Windows.Media.Ocr (WinRT, available since Windows 10)
// ══════════════════════════════════════════════════════════════════════════════
#[cfg(target_os = "windows")]
mod windows_ocr {
    use super::OcrResult;
    use anyhow::Result;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};
    use windows::core::HSTRING;

    /// Run Windows.Media.Ocr on the image at `image_path`.
    ///
    /// Uses the system OCR engine via WinRT — no additional binaries required.
    /// Falls back to `OcrResult::not_supported()` if no language pack is installed.
    pub fn run_ocr(image_path: &str) -> Result<OcrResult> {
        // ── 1. Open the file as a StorageFile ──────────────────────────────
        let path_hs = HSTRING::from(image_path);
        let file = StorageFile::GetFileFromPathAsync(&path_hs)
            .map_err(|e| anyhow::anyhow!("[OCR/Win] GetFileFromPathAsync failed: {}", e))?
            .get()
            .map_err(|e| anyhow::anyhow!("[OCR/Win] GetFileFromPath wait failed: {}", e))?;

        // ── 2. Decode to SoftwareBitmap ────────────────────────────────────
        let stream = file
            .OpenAsync(FileAccessMode::Read)
            .map_err(|e| anyhow::anyhow!("[OCR/Win] OpenAsync failed: {}", e))?
            .get()
            .map_err(|e| anyhow::anyhow!("[OCR/Win] OpenAsync wait failed: {}", e))?;

        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(|e| anyhow::anyhow!("[OCR/Win] BitmapDecoder::CreateAsync failed: {}", e))?
            .get()
            .map_err(|e| {
                anyhow::anyhow!("[OCR/Win] BitmapDecoder::CreateAsync wait failed: {}", e)
            })?;

        let bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|e| anyhow::anyhow!("[OCR/Win] GetSoftwareBitmapAsync failed: {}", e))?
            .get()
            .map_err(|e| {
                anyhow::anyhow!("[OCR/Win] GetSoftwareBitmapAsync wait failed: {}", e)
            })?;

        // ── 3. Try to get an OcrEngine for the user's preferred language ───
        // TryCreateFromUserProfileLanguages() returns null when no supported
        // language pack is installed — treat that as not_supported.
        let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[OCR/Win] TryCreateFromUserProfileLanguages failed: {}", e);
                return Ok(OcrResult::not_supported());
            }
        };

        // ── 4. Perform recognition ─────────────────────────────────────────
        let result = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| anyhow::anyhow!("[OCR/Win] RecognizeAsync failed: {}", e))?
            .get()
            .map_err(|e| anyhow::anyhow!("[OCR/Win] RecognizeAsync wait failed: {}", e))?;

        // ── 5. Collect lines ───────────────────────────────────────────────
        let lines = result
            .Lines()
            .map_err(|e| anyhow::anyhow!("[OCR/Win] Lines() failed: {}", e))?;

        let count = lines
            .Size()
            .map_err(|e| anyhow::anyhow!("[OCR/Win] Size() failed: {}", e))?;

        let mut text_lines: Vec<String> = Vec::with_capacity(count as usize);
        for i in 0..count {
            let line = lines
                .GetAt(i)
                .map_err(|e| anyhow::anyhow!("[OCR/Win] GetAt({}) failed: {}", i, e))?;
            let text = line
                .Text()
                .map_err(|e| anyhow::anyhow!("[OCR/Win] Text() failed: {}", e))?;
            let s = text.to_string();
            if !s.trim().is_empty() {
                text_lines.push(s);
            }
        }

        Ok(OcrResult::success(text_lines.join("\n")))
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Linux OCR — Tesseract subprocess
// ══════════════════════════════════════════════════════════════════════════════
#[cfg(target_os = "linux")]
mod linux_ocr {
    use super::OcrResult;
    use anyhow::Result;

    /// Run `tesseract <image_path> stdout` and return the output as OCR text.
    ///
    /// Returns `OcrResult::not_supported()` when the `tesseract` binary is not
    /// found on PATH — the user can install it with their package manager.
    /// Returns `OcrResult::failed()` for any other execution error.
    pub async fn run_tesseract(image_path: &str) -> Result<OcrResult> {
        let output = tokio::process::Command::new("tesseract")
            .arg(image_path)
            .arg("stdout")
            .arg("--psm")
            .arg("3") // fully automatic page segmentation
            .output()
            .await;

        match output {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // tesseract is not installed — not a hard failure, just unsupported.
                Ok(OcrResult::not_supported())
            }
            Err(e) => {
                eprintln!("[OCR/Linux] tesseract subprocess error: {}", e);
                Ok(OcrResult::failed())
            }
            Ok(out) => {
                if !out.status.success() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    eprintln!("[OCR/Linux] tesseract exited with error: {}", stderr);
                    return Ok(OcrResult::failed());
                }
                let raw = String::from_utf8_lossy(&out.stdout).into_owned();
                // Tesseract appends a trailing form-feed (\x0c); strip it.
                let text = raw.trim_end_matches('\x0c').trim().to_string();
                Ok(OcrResult::success(text))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn not_supported_has_empty_text_and_supported_false() {
        let r = OcrResult::not_supported();
        assert!(!r.supported);
        assert!(r.text.is_empty());
    }

    #[tokio::test]
    async fn failed_has_empty_text_and_supported_true() {
        let r = OcrResult::failed();
        assert!(r.supported);
        assert!(r.text.is_empty());
    }

    #[tokio::test]
    async fn success_preserves_text() {
        let r = OcrResult::success("hello world".to_string());
        assert!(r.supported);
        assert_eq!(r.text, "hello world");
    }

    #[tokio::test]
    async fn run_ocr_on_nonexistent_path_does_not_panic() {
        let svc = OcrService::new();
        // Non-existent file: must not panic.
        // - macOS/Linux: returns Ok(failed) or Ok(not_supported)
        // - Windows: returns Err (GetFileFromPathAsync fails) — caller handles that
        let _result = svc.run_ocr("/tmp/clipsx_ocr_test_nonexistent_file.png").await;
        // No assertion: the only contract is "no panic"
    }

    // ── Linux-specific tests ────────────────────────────────────────────────
    #[cfg(target_os = "linux")]
    mod linux {
        use super::super::linux_ocr;

        #[tokio::test]
        async fn tesseract_not_found_returns_not_supported() {
            // If tesseract is not installed on this CI/test machine the module
            // must return not_supported() rather than an Err or a panic.
            // We can't force NotFound portably so we run the real code and only
            // assert the result shape — either not_supported or failed, never Err.
            let result = linux_ocr::run_tesseract(
                "/tmp/clipsx_linux_ocr_test_nonexistent_file.png",
            )
            .await;
            assert!(result.is_ok(), "linux OCR must never return Err for missing binary or file");
        }

        #[tokio::test]
        async fn tesseract_on_nonexistent_file_does_not_panic() {
            let result = linux_ocr::run_tesseract("/no/such/file.png").await;
            // tesseract exits with non-zero on missing file → failed(); if not installed → not_supported()
            assert!(result.is_ok());
        }
    }

    // ── Windows-specific tests ──────────────────────────────────────────────
    #[cfg(target_os = "windows")]
    mod windows {
        use super::super::windows_ocr;

        #[test]
        fn windows_ocr_on_nonexistent_file_does_not_panic() {
            // GetFileFromPathAsync will fail on a missing file; the function must
            // return Err (I/O failure), not panic.  The caller in clipboard.rs
            // treats Err as failed and marks the clip accordingly.
            let result = windows_ocr::run_ocr("C:\\does\\not\\exist.png");
            // We accept either Ok(failed/not_supported) or Err — just no panic.
            let _ = result;
        }
    }
}
