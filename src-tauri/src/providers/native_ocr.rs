use super::{
    contracts::{
        ocr::{OcrLanguage, OcrProvider, OcrProviderDiagnostics},
        visual_embedding::VisualInput,
        ProviderDescriptor,
    },
    error::{ProviderError, ProviderResult},
};
use async_trait::async_trait;

pub const NATIVE_OCR_PROVIDER_ID: &str = "builtin.ocr.native";

#[derive(Debug, Clone, Default)]
pub struct NativeOcrProvider;

impl NativeOcrProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl OcrProvider for NativeOcrProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            provider_id: NATIVE_OCR_PROVIDER_ID.into(),
            provider_version: "3".into(),
            model_id: platform_model_id().into(),
            model_revision: "system-managed".into(),
        }
    }

    async fn diagnostics(&self) -> ProviderResult<OcrProviderDiagnostics> {
        platform_diagnostics().await
    }

    async fn recognize(&self, input: &VisualInput, language: &str) -> ProviderResult<String> {
        platform_recognize(input, language).await
    }
}

pub fn resolve_language(
    preference: &str,
    application_language: &str,
    languages: &[OcrLanguage],
) -> Option<String> {
    if preference != "auto" {
        return languages
            .iter()
            .find(|language| language.id.eq_ignore_ascii_case(preference))
            .map(|language| language.id.clone());
    }
    let normalized_application = application_language.replace('_', "-");
    languages
        .iter()
        .find(|language| language.id.eq_ignore_ascii_case(&normalized_application))
        .or_else(|| {
            let prefix = normalized_application.split('-').next().unwrap_or_default();
            languages
                .iter()
                .find(|language| language_family(&language.id).eq_ignore_ascii_case(prefix))
        })
        .or_else(|| {
            languages
                .iter()
                .find(|language| language_family(&language.id).eq_ignore_ascii_case("en"))
        })
        .or_else(|| languages.first())
        .map(|language| language.id.clone())
}

fn language_family(value: &str) -> &str {
    match value.split(['-', '_']).next().unwrap_or_default() {
        "eng" => "en",
        "jpn" => "ja",
        value => value,
    }
}

fn platform_model_id() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows-media-ocr"
    } else if cfg!(target_os = "macos") {
        "apple-vision"
    } else if cfg!(target_os = "linux") {
        "tesseract"
    } else {
        "unsupported"
    }
}

fn unavailable(message: impl Into<String>) -> ProviderError {
    ProviderError::Unavailable(message.into())
}

#[cfg(target_os = "windows")]
enum WindowsOcrRequest {
    Diagnostics(std::sync::mpsc::SyncSender<ProviderResult<OcrProviderDiagnostics>>),
    Recognize(
        Vec<u8>,
        String,
        tokio::sync::oneshot::Sender<ProviderResult<String>>,
    ),
}

#[cfg(target_os = "windows")]
fn windows_sender() -> ProviderResult<std::sync::mpsc::SyncSender<WindowsOcrRequest>> {
    use std::sync::{mpsc, OnceLock};
    static SENDER: OnceLock<mpsc::SyncSender<WindowsOcrRequest>> = OnceLock::new();
    if let Some(sender) = SENDER.get() {
        return Ok(sender.clone());
    }
    let (sender, receiver) = mpsc::sync_channel(2);
    std::thread::Builder::new()
        .name("clipsx-winrt-ocr".into())
        .spawn(move || windows_worker(receiver))
        .map_err(|error| unavailable(format!("unable to start WinRT OCR executor: {error}")))?;
    let _ = SENDER.set(sender.clone());
    Ok(SENDER.get().cloned().unwrap_or(sender))
}

#[cfg(target_os = "windows")]
fn windows_worker(receiver: std::sync::mpsc::Receiver<WindowsOcrRequest>) {
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
    let initialized = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    for request in receiver {
        match request {
            WindowsOcrRequest::Diagnostics(response) => {
                let result = if initialized.is_err() {
                    Err(unavailable("unable to initialize the WinRT MTA apartment"))
                } else {
                    windows_diagnostics()
                };
                let _ = response.send(result);
            }
            WindowsOcrRequest::Recognize(bytes, language, response) => {
                let result = if initialized.is_err() {
                    Err(unavailable("unable to initialize the WinRT MTA apartment"))
                } else {
                    windows_recognize(&bytes, &language)
                };
                let _ = response.send(result);
            }
        }
    }
    if initialized.is_ok() {
        unsafe { RoUninitialize() };
    }
}

#[cfg(target_os = "windows")]
fn windows_languages() -> ProviderResult<Vec<OcrLanguage>> {
    use windows::Media::Ocr::OcrEngine;
    let values = OcrEngine::AvailableRecognizerLanguages().map_err(|error| {
        unavailable(format!(
            "unable to enumerate Windows OCR languages: {error}"
        ))
    })?;
    let mut languages = Vec::new();
    for index in 0..values.Size().unwrap_or(0) {
        let language = values.GetAt(index).map_err(|error| {
            unavailable(format!("unable to read Windows OCR language: {error}"))
        })?;
        let id = language.LanguageTag().map_err(|error| {
            unavailable(format!("unable to read Windows OCR language tag: {error}"))
        })?;
        let label = language.DisplayName().unwrap_or_else(|_| id.clone());
        languages.push(OcrLanguage {
            id: id.to_string(),
            label: label.to_string(),
        });
    }
    Ok(languages)
}

#[cfg(target_os = "windows")]
fn windows_diagnostics() -> ProviderResult<OcrProviderDiagnostics> {
    let languages = windows_languages()?;
    let available = !languages.is_empty();
    let provider_version = windows::System::Profile::AnalyticsInfo::VersionInfo()
        .and_then(|value| value.DeviceFamilyVersion())
        .ok()
        .and_then(|value| value.to_string().parse::<u64>().ok())
        .map(|value| {
            format!(
                "Windows.Media.Ocr {}.{}.{}.{}",
                (value >> 48) & 0xffff,
                (value >> 32) & 0xffff,
                (value >> 16) & 0xffff,
                value & 0xffff
            )
        })
        .unwrap_or_else(|| "Windows.Media.Ocr".into());
    Ok(OcrProviderDiagnostics {
        provider_id: NATIVE_OCR_PROVIDER_ID.into(),
        provider_version,
        available,
        languages,
        recovery_code: (!available).then(|| "windows_ocr_language_missing".into()),
        recovery_message: (!available).then(|| {
            "Install an OCR-capable Windows language pack in Settings > Time & language, then restart ClipsX."
                .into()
        }),
    })
}

#[cfg(target_os = "windows")]
fn windows_recognize(bytes: &[u8], language: &str) -> ProviderResult<String> {
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };
    let stream = InMemoryRandomAccessStream::new()
        .map_err(|error| unavailable(format!("unable to create image stream: {error}")))?;
    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|error| unavailable(format!("unable to create image writer: {error}")))?;
    writer
        .WriteBytes(bytes)
        .map_err(|error| unavailable(format!("unable to write image bytes: {error}")))?;
    writer
        .StoreAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| unavailable(format!("unable to store image bytes: {error}")))?;
    writer
        .DetachStream()
        .map_err(|error| unavailable(format!("unable to detach image stream: {error}")))?;
    stream
        .Seek(0)
        .map_err(|error| unavailable(format!("unable to rewind image stream: {error}")))?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .and_then(|operation| operation.join())
        .map_err(|error| ProviderError::InvalidOutput(format!("unsupported image: {error}")))?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| {
            ProviderError::InvalidOutput(format!("unable to decode image: {error}"))
        })?;
    let language = Language::CreateLanguage(&HSTRING::from(language)).map_err(|error| {
        ProviderError::InvalidConfiguration(format!("invalid OCR language: {error}"))
    })?;
    let engine = OcrEngine::TryCreateFromLanguage(&language).map_err(|error| {
        ProviderError::InvalidConfiguration(format!("OCR language is not installed: {error}"))
    })?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .and_then(|operation| operation.join())
        .map_err(|error| ProviderError::InvalidOutput(format!("recognition failed: {error}")))?;
    result
        .Text()
        .map(|text| text.to_string())
        .map_err(|error| ProviderError::InvalidOutput(format!("invalid OCR output: {error}")))
}

#[cfg(target_os = "windows")]
async fn platform_diagnostics() -> ProviderResult<OcrProviderDiagnostics> {
    use std::sync::mpsc;
    let sender = windows_sender()?;
    let (response_sender, response_receiver) = mpsc::sync_channel(1);
    tokio::task::spawn_blocking(move || {
        sender.send(WindowsOcrRequest::Diagnostics(response_sender))
    })
    .await
    .map_err(|_| unavailable("Windows OCR diagnostics task stopped"))?
    .map_err(|_| unavailable("Windows OCR executor stopped"))?;
    response_receiver
        .recv()
        .map_err(|_| unavailable("Windows OCR executor dropped diagnostics"))?
}

#[cfg(target_os = "windows")]
async fn platform_recognize(input: &VisualInput, language: &str) -> ProviderResult<String> {
    let sender = windows_sender()?;
    let (response_sender, response_receiver) = tokio::sync::oneshot::channel();
    let request =
        WindowsOcrRequest::Recognize(input.bytes.to_vec(), language.into(), response_sender);
    tokio::task::spawn_blocking(move || sender.send(request))
        .await
        .map_err(|_| unavailable("Windows OCR queue task stopped"))?
        .map_err(|_| unavailable("Windows OCR executor stopped"))?;
    response_receiver
        .await
        .map_err(|_| unavailable("Windows OCR executor dropped its response"))?
}

#[cfg(target_os = "linux")]
fn parse_tesseract_languages(stdout: &[u8]) -> Vec<OcrLanguage> {
    String::from_utf8_lossy(stdout)
        .lines()
        .skip(1)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|id| OcrLanguage {
            id: id.into(),
            label: match id {
                "eng" => "English".into(),
                "jpn" => "Japanese".into(),
                _ => id.into(),
            },
        })
        .collect()
}

#[cfg(target_os = "linux")]
async fn platform_diagnostics() -> ProviderResult<OcrProviderDiagnostics> {
    tokio::task::spawn_blocking(|| {
        let version = match std::process::Command::new("tesseract").arg("--version").output() {
            Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("tesseract")
                .trim()
                .to_string(),
            _ => {
                return Ok(OcrProviderDiagnostics {
                    provider_id: NATIVE_OCR_PROVIDER_ID.into(),
                    provider_version: "unavailable".into(),
                    available: false,
                    languages: Vec::new(),
                    recovery_code: Some("tesseract_missing".into()),
                    recovery_message: Some("Install Tesseract and at least one language pack (for example tesseract-ocr-eng or tesseract-ocr-jpn), then restart ClipsX.".into()),
                });
            }
        };
        let language_output = std::process::Command::new("tesseract")
            .arg("--list-langs")
            .output()
            .map_err(|error| unavailable(format!("unable to list Tesseract languages: {error}")))?;
        let languages = if language_output.status.success() {
            parse_tesseract_languages(&language_output.stdout)
        } else {
            Vec::new()
        };
        let available = !languages.is_empty();
        Ok(OcrProviderDiagnostics {
            provider_id: NATIVE_OCR_PROVIDER_ID.into(),
            provider_version: version,
            available,
            languages,
            recovery_code: (!available).then(|| "tesseract_language_missing".into()),
            recovery_message: (!available).then(|| "Install a Tesseract language pack such as tesseract-ocr-eng or tesseract-ocr-jpn, then retry.".into()),
        })
    })
    .await
    .map_err(|_| unavailable("Tesseract diagnostics task stopped"))?
}

#[cfg(target_os = "linux")]
async fn platform_recognize(input: &VisualInput, language: &str) -> ProviderResult<String> {
    let bytes = input.bytes.to_vec();
    let language = language.to_string();
    tokio::task::spawn_blocking(move || {
        let dir = tempfile::TempDir::new()
            .map_err(|error| unavailable(format!("unable to prepare OCR input: {error}")))?;
        let input = dir.path().join("input.png");
        std::fs::write(&input, bytes)
            .map_err(|error| unavailable(format!("unable to stage OCR input: {error}")))?;
        let output = std::process::Command::new("tesseract")
            .arg(&input)
            .arg("stdout")
            .arg("-l")
            .arg(&language)
            .output()
            .map_err(|error| unavailable(format!("unable to start Tesseract: {error}")))?;
        if !output.status.success() {
            let diagnostic = String::from_utf8_lossy(&output.stderr);
            return Err(ProviderError::InvalidOutput(format!(
                "Tesseract recognition failed: {}",
                diagnostic.trim()
            )));
        }
        String::from_utf8(output.stdout)
            .map_err(|_| ProviderError::InvalidOutput("Tesseract returned non-UTF-8 text".into()))
    })
    .await
    .map_err(|_| unavailable("Tesseract recognition task stopped"))?
}

#[cfg(target_os = "macos")]
async fn platform_diagnostics() -> ProviderResult<OcrProviderDiagnostics> {
    tokio::task::spawn_blocking(macos_diagnostics)
        .await
        .map_err(|_| unavailable("Vision diagnostics task stopped"))?
}

#[cfg(target_os = "macos")]
fn macos_diagnostics() -> ProviderResult<OcrProviderDiagnostics> {
    use cocoa::{
        base::{id, nil},
        foundation::{NSAutoreleasePool, NSString},
    };
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let values: id = msg_send![class!(VNRecognizeTextRequest),
            supportedRecognitionLanguagesForTextRecognitionLevel: 1i64
            revision: 1usize
            error: std::ptr::null_mut::<id>()];
        let mut languages = Vec::new();
        if values != nil {
            let count: usize = msg_send![values, count];
            for index in 0..count {
                let value: id = msg_send![values, objectAtIndex: index];
                let text = NSString::UTF8String(value);
                if !text.is_null() {
                    let id = std::ffi::CStr::from_ptr(text)
                        .to_string_lossy()
                        .into_owned();
                    languages.push(OcrLanguage {
                        label: id.clone(),
                        id,
                    });
                }
            }
        }
        let process_info: id = msg_send![class!(NSProcessInfo), processInfo];
        let os_version: id = msg_send![process_info, operatingSystemVersionString];
        let os_version = NSString::UTF8String(os_version);
        let provider_version = if os_version.is_null() {
            "Apple Vision revision 1".into()
        } else {
            format!(
                "Apple Vision revision 1 ({})",
                std::ffi::CStr::from_ptr(os_version).to_string_lossy()
            )
        };
        let _: () = msg_send![pool, drain];
        let available = !languages.is_empty();
        Ok(OcrProviderDiagnostics {
            provider_id: NATIVE_OCR_PROVIDER_ID.into(),
            provider_version,
            available,
            languages,
            recovery_code: (!available).then(|| "vision_languages_unavailable".into()),
            recovery_message: (!available).then(|| {
                "No Vision text-recognition language is available on this macOS installation."
                    .into()
            }),
        })
    }
}

#[cfg(target_os = "macos")]
async fn platform_recognize(input: &VisualInput, language: &str) -> ProviderResult<String> {
    let bytes = input.bytes.to_vec();
    let language = language.to_string();
    tokio::task::spawn_blocking(move || macos_recognize(&bytes, &language))
        .await
        .map_err(|_| unavailable("Vision recognition task stopped"))?
}

#[cfg(target_os = "macos")]
fn macos_recognize(bytes: &[u8], language: &str) -> ProviderResult<String> {
    use cocoa::{
        base::{id, nil},
        foundation::{NSArray, NSAutoreleasePool, NSString},
    };
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let ns_data: id =
            msg_send![class!(NSData), dataWithBytes: bytes.as_ptr() length: bytes.len()];
        let ci_image: id = msg_send![class!(CIImage), imageWithData: ns_data];
        if ci_image == nil {
            let _: () = msg_send![pool, drain];
            return Err(ProviderError::InvalidOutput(
                "Vision could not decode the image".into(),
            ));
        }
        let handler: id = msg_send![class!(VNImageRequestHandler), alloc];
        let handler: id = msg_send![handler, initWithCIImage: ci_image options: nil];
        let request: id = msg_send![class!(VNRecognizeTextRequest), new];
        let _: () = msg_send![request, setRecognitionLevel: 1i64];
        let language = NSString::alloc(nil).init_str(language);
        let languages = NSArray::arrayWithObject(nil, language);
        let _: () = msg_send![request, setRecognitionLanguages: languages];
        let requests = NSArray::arrayWithObject(nil, request);
        let ok: bool =
            msg_send![handler, performRequests: requests error: std::ptr::null_mut::<id>()];
        if !ok {
            let _: () = msg_send![pool, drain];
            return Err(ProviderError::InvalidOutput(
                "Vision recognition failed".into(),
            ));
        }
        let results: id = msg_send![request, results];
        let count: usize = if results == nil {
            0
        } else {
            msg_send![results, count]
        };
        let mut parts = Vec::with_capacity(count);
        for index in 0..count {
            let observation: id = msg_send![results, objectAtIndex: index];
            let candidates: id = msg_send![observation, topCandidates: 1usize];
            let candidate_count: usize = msg_send![candidates, count];
            if candidate_count == 0 {
                continue;
            }
            let candidate: id = msg_send![candidates, objectAtIndex: 0usize];
            let value: id = msg_send![candidate, string];
            let text = NSString::UTF8String(value);
            if !text.is_null() {
                parts.push(
                    std::ffi::CStr::from_ptr(text)
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        let _: () = msg_send![pool, drain];
        Ok(parts.join("\n"))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
async fn platform_diagnostics() -> ProviderResult<OcrProviderDiagnostics> {
    Ok(OcrProviderDiagnostics {
        provider_id: NATIVE_OCR_PROVIDER_ID.into(),
        provider_version: "unsupported".into(),
        available: false,
        languages: Vec::new(),
        recovery_code: Some("platform_unsupported".into()),
        recovery_message: Some("OCR is not supported on this platform.".into()),
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
async fn platform_recognize(_input: &VisualInput, _language: &str) -> ProviderResult<String> {
    Err(unavailable("OCR is not supported on this platform"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn language(id: &str) -> OcrLanguage {
        OcrLanguage {
            id: id.into(),
            label: id.into(),
        }
    }

    #[test]
    fn automatic_language_prefers_app_then_english_then_first() {
        let languages = vec![language("ja-JP"), language("en-US")];
        assert_eq!(
            resolve_language("auto", "ja", &languages).as_deref(),
            Some("ja-JP")
        );
        assert_eq!(
            resolve_language("auto", "fr", &languages).as_deref(),
            Some("en-US")
        );
        assert_eq!(
            resolve_language("ja-JP", "en", &languages).as_deref(),
            Some("ja-JP")
        );
        assert_eq!(resolve_language("fr-FR", "en", &languages), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_tesseract_language_output() {
        let values =
            parse_tesseract_languages(b"List of available languages in /tmp (2):\neng\njpn\n");
        assert_eq!(
            values,
            vec![
                OcrLanguage {
                    id: "eng".into(),
                    label: "English".into()
                },
                OcrLanguage {
                    id: "jpn".into(),
                    label: "Japanese".into()
                }
            ]
        );
    }
}
