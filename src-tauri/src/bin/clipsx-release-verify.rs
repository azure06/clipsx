//! Verify release signatures using exactly the updater's Minisign decoding rules.
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

fn verify(bytes: &[u8], public_key: &str, signature: &str) -> Result<()> {
    let key_text = String::from_utf8(STANDARD.decode(public_key.trim())?)?;
    let signature_text = String::from_utf8(STANDARD.decode(signature.trim())?)?;
    let key = PublicKey::decode(&key_text)?;
    let signature = Signature::decode(&signature_text)?;
    key.verify(bytes, &signature, true)?;
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        bail!("Usage: clipsx-release-verify <embedded-public-key> <artifact> <signature-file>");
    }
    let bytes = std::fs::read(&args[1]).context("Cannot read release artifact")?;
    let signature = std::fs::read_to_string(&args[2]).context("Cannot read updater signature")?;
    verify(&bytes, &args[0], &signature).context("Updater signature verification failed")?;
    println!("Verified {}", args[1]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_key_or_signature_encoding() {
        assert!(verify(b"installer", "not base64!", "not base64!").is_err());
        assert!(verify(
            b"installer",
            &STANDARD.encode("not a public key"),
            &STANDARD.encode("not a signature")
        )
        .is_err());
    }

    #[test]
    fn verifies_updater_encoding_and_rejects_tampered_bytes_and_wrong_key() {
        let key = STANDARD.encode("untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3");
        let signature = STANDARD.encode(concat!(
            "untrusted comment: signature from minisign secret key\n",
            "RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/",
            "z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n",
            "trusted comment: timestamp:1556193335\tfile:test\n",
            "y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg=="
        ));
        assert!(verify(b"test", &key, &signature).is_ok());
        assert!(verify(b"Test", &key, &signature).is_err());
        let other_key = include_str!("../../tauri.conf.json");
        let configuration: serde_json::Value = serde_json::from_str(other_key).unwrap();
        assert!(verify(
            b"test",
            configuration["plugins"]["updater"]["pubkey"]
                .as_str()
                .unwrap(),
            &signature
        )
        .is_err());
    }
}
