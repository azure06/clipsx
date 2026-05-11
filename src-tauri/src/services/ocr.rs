// OCR service for image text extraction
//
// Architecture:
//   - `OcrService` is the single public entry point.
//   - `run_ocr(path)` returns an `OcrResult` that callers use to decide
//     whether to promote OCR output to content_text / index_text.
//   - OCR is always async, idempotent, and non-blocking for clip insertion.
//   - Failure never prevents an image clip from being stored or displayed.
//
// Platform strategy (future):
//   - macOS: Vision framework (VNRecognizeTextRequest) via the system OCR engine.
//   - Windows: Windows.Media.Ocr via WinRT.
//   - Linux: Tesseract via the `leptess` crate or subprocess.
//   - All platforms fall back to `OcrStatus::NotSupported` when no engine is
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
    pub async fn run_ocr(&self, _image_path: &str) -> Result<OcrResult> {
        // TODO: implement per-platform OCR engines:
        //   - macOS: Vision framework
        //   - Windows: Windows.Media.Ocr
        //   - Linux: Tesseract subprocess
        Ok(OcrResult::not_supported())
    }
}

impl Default for OcrService {
    fn default() -> Self {
        Self::new()
    }
}
