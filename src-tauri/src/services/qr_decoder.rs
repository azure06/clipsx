/// Internal QR decoding placeholder.
///
/// This module and its Tauri command are intentionally retained for the
/// deferred QR feature, but they are not connected to the UI or release
/// surface. Until a decoder is implemented, both functions deterministically
/// report that no QR code was found.
use anyhow::Result;

/// Decode QR code from raw image bytes.
#[allow(dead_code)]
pub fn decode_qr_from_bytes(_image_bytes: &[u8]) -> Result<Option<String>> {
    // Deferred: integrate a decoder and image preprocessing here.
    Ok(None)
}

/// Decode QR code from an image path.
pub fn decode_qr_from_path(_path: &str) -> Result<Option<String>> {
    // Deferred: load image bytes and delegate to decode_qr_from_bytes.
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_decoder_is_an_explicit_no_result_placeholder() -> Result<()> {
        assert_eq!(decode_qr_from_bytes(b"placeholder")?, None);
        assert_eq!(decode_qr_from_path("placeholder.png")?, None);
        Ok(())
    }
}
