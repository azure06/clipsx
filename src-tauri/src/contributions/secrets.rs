//! Deterministic credential classification for the secret detector.
//!
//! A match hides the clip, excludes it from semantic search and assistants, and makes it
//! eligible for secret auto-clear, so every rule needs explicit credential evidence: a
//! provider-specific format, a credential-named assignment with a literal value, a credentialed
//! URL, or an authorization header. Shape or entropy alone is never evidence.

pub(super) type Classification = (&'static str, &'static str);

const PRIVATE_KEY: Classification = ("private_key", "privateKey");
const API_KEY: Classification = ("api_key", "apiKey");
const CREDENTIAL: Classification = ("credential_assignment", "credentialAssignment");
const URL_CREDENTIAL: Classification = ("url_credential", "urlCredential");
const AUTHORIZATION: Classification = ("authorization_header", "authorizationHeader");

/// Provider prefixes with the minimum total length of a real key.
const PREFIXED_KEYS: &[(&str, usize)] = &[
    ("github_pat_", 30),
    ("sk-ant-", 40),
    ("sk-proj-", 30),
    ("sk-svcacct-", 30),
    ("sk-admin-", 30),
    ("sntrys_", 30),
    ("xoxb-", 24),
    ("xoxp-", 24),
    ("xoxa-", 24),
    ("xoxr-", 24),
    ("xoxs-", 24),
    ("xapp-", 24),
    ("npm_", 40),
    ("hf_", 37),
    ("glpat-", 26),
    ("dop_v1_", 40),
    ("shpat_", 38),
    ("pypi-", 50),
];

pub(super) fn classify_document(value: &str) -> Option<Classification> {
    for line in value.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        if line.starts_with("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
            return Some(PRIVATE_KEY);
        }
        if let Some(classification) =
            classify_authorization(line).or_else(|| classify_assignment(line))
        {
            return Some(classification);
        }
        for token in line.split_ascii_whitespace() {
            let token = strip_token(token);
            if let Some(classification) = classify_assignment(token)
                .or_else(|| classify_known_key(token))
                .or_else(|| classify_url_credential(token))
            {
                return Some(classification);
            }
            // `x-token:ghp_…`, `--key=sk-…`: the key name is irrelevant when the value is a
            // recognizable provider credential.
            if let Some(classification) = token
                .split_once(['=', ':'])
                .and_then(|(_, rest)| classify_known_key(strip_token(rest)))
            {
                return Some(classification);
            }
        }
    }
    None
}

fn strip_token(token: &str) -> &str {
    token.trim_matches(|ch: char| {
        matches!(
            ch,
            '\'' | '"' | '`' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>'
        )
    })
}

fn is_key_charset(value: &str) -> bool {
    value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
}

fn classify_known_key(value: &str) -> Option<Classification> {
    if value.len() == 20
        && (value.starts_with("AKIA") || value.starts_with("ASIA"))
        && value[4..]
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
    {
        return Some(("aws_access_key", "awsAccessKey"));
    }
    let github_classic = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]
        .iter()
        .any(|prefix| value.starts_with(prefix))
        && value.len() >= 36;
    let github_fine_grained = value.starts_with("github_pat_") && value.len() >= 30;
    if (github_classic || github_fine_grained)
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return Some(("github_token", "githubToken"));
    }
    if ["sk_live_", "sk_test_", "rk_live_", "rk_test_"]
        .iter()
        .any(|prefix| value.starts_with(prefix))
        && value.len() >= 20
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return Some(("stripe_key", "stripeKey"));
    }
    if PREFIXED_KEYS
        .iter()
        .any(|(prefix, minimum)| value.starts_with(prefix) && value.len() >= *minimum)
        && is_key_charset(value)
    {
        return Some(API_KEY);
    }
    // Legacy OpenAI keys are `sk-` plus a long alphanumeric body; hyphenated slugs such as
    // `sk-learn-…` are not.
    if let Some(body) = value.strip_prefix("sk-") {
        if (32..=80).contains(&body.len())
            && body.chars().all(|ch| ch.is_ascii_alphanumeric())
            && body.chars().any(|ch| ch.is_ascii_digit())
            && body.chars().any(|ch| ch.is_ascii_alphabetic())
        {
            return Some(API_KEY);
        }
    }
    if value.starts_with("AIza") && value.len() == 39 && is_key_charset(value) {
        return Some(API_KEY);
    }
    let sendgrid = value.split('.').collect::<Vec<_>>();
    if sendgrid.len() == 3
        && sendgrid[0] == "SG"
        && sendgrid[1].len() == 22
        && sendgrid[2].len() == 43
        && sendgrid[1..].iter().all(|part| is_key_charset(part))
    {
        return Some(API_KEY);
    }
    None
}

fn classify_url_credential(token: &str) -> Option<Classification> {
    if !token.contains("://") {
        return None;
    }
    let url = url::Url::parse(token).ok()?;
    let password = url.password()?;
    (password.len() >= 4 && !is_placeholder(password)).then_some(URL_CREDENTIAL)
}

/// `Authorization: Bearer …` and bare `Bearer …`. JWTs are only credentials in this context.
fn classify_authorization(line: &str) -> Option<Classification> {
    let lower = line.to_ascii_lowercase();
    let schemes: &[&str] = if lower.contains("authorization") {
        &["bearer ", "basic "]
    } else {
        &["bearer "]
    };
    schemes
        .iter()
        .any(|scheme| {
            lower.match_indices(scheme).any(|(index, _)| {
                line[index + scheme.len()..]
                    .split_whitespace()
                    .next()
                    .map(strip_token)
                    .is_some_and(|credential| {
                        credential.len() >= 16
                            && credential.chars().all(|ch| {
                                ch.is_ascii_alphanumeric()
                                    || matches!(ch, '.' | '_' | '-' | '~' | '+' | '/' | '=')
                            })
                            && credential
                                .chars()
                                .any(|ch| ch.is_ascii_digit() || ch == '.')
                            && !is_placeholder(credential)
                    })
            })
        })
        .then_some(AUTHORIZATION)
}

/// `api_key=…`, `"client_secret": "…"`, `const password = "…"`.
fn classify_assignment(text: &str) -> Option<Classification> {
    let (key, raw) = text.split_once(['=', ':'])?;
    let minimum = credential_key_minimum(key)?;
    let raw = raw
        .trim()
        .trim_start_matches(['=', '>'])
        .trim()
        .trim_end_matches([',', ';', '}', ')'])
        .trim_end();
    let quoted = raw.starts_with(['\'', '"', '`']);
    let value = raw.trim_matches(['\'', '"', '`']);
    is_credential_literal(value, quoted, minimum).then_some(CREDENTIAL)
}

/// Returns the minimum value length when the key names a credential. Keys are matched by word, so
/// `max_tokens`, `token_type`, `next_page_token`, `PWD` and `secretsmanager` are not credentials.
fn credential_key_minimum(key: &str) -> Option<usize> {
    let segment = key
        .split_whitespace()
        .last()?
        .trim_matches(|ch: char| !ch.is_ascii_alphanumeric());
    let words = key_words(segment);
    let (last, rest) = words.split_last()?;
    let previous = rest.last().map(String::as_str);
    match last.as_str() {
        "password" | "passwd" | "passphrase" => Some(6),
        "secret" => Some(8),
        "apikey" | "apitoken" | "authtoken" | "accesstoken" => Some(12),
        "key" if matches!(previous, Some("api" | "access" | "secret" | "private")) => Some(12),
        "token" if rest.is_empty() => Some(12),
        "token"
            if matches!(
                previous,
                Some(
                    "api"
                        | "auth"
                        | "access"
                        | "bearer"
                        | "refresh"
                        | "session"
                        | "secret"
                        | "bot"
                        | "personal"
                        | "private"
                        | "client"
                )
            ) =>
        {
            Some(12)
        }
        _ => None,
    }
}

fn key_words(segment: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut previous_lower = false;
    for ch in segment.chars() {
        if !ch.is_ascii_alphanumeric() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            previous_lower = false;
            continue;
        }
        if ch.is_ascii_uppercase() && previous_lower && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        current.push(ch.to_ascii_lowercase());
        previous_lower = ch.is_ascii_lowercase();
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// A credential value is a literal, not a reference, placeholder, mask, path or type name.
fn is_credential_literal(value: &str, quoted: bool, minimum: usize) -> bool {
    if value.len() < minimum
        || value.chars().any(char::is_whitespace)
        || value.starts_with(['$', '%', '<', '{', '[', '/', '~'])
        || value.starts_with("./")
        || is_placeholder(value)
    {
        return false;
    }
    if value
        .chars()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        < 4
    {
        return false;
    }
    if quoted {
        return true;
    }
    // Bare values that are code (`getPassword()`, `Option<String>`, `process.env.TOKEN`) or plain
    // words (`string`, `required`) are references, not credentials.
    !value.contains(['(', ')', '[', ']', '<', '>', '{', '}'])
        && !value
            .chars()
            .all(|ch| ch.is_ascii_alphabetic() || matches!(ch, '_' | '.' | ':'))
}

fn is_placeholder(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value
        .chars()
        .all(|ch| matches!(ch, '*' | 'x' | 'X' | '•' | '.' | '-' | '_' | '#' | '?'))
        || lower.contains("...")
        || lower.contains('…')
        || [
            "changeme",
            "change-me",
            "change_me",
            "password",
            "passwd",
            "secret",
            "example",
            "placeholder",
            "redacted",
            "null",
            "none",
            "undefined",
            "true",
            "false",
            "required",
            "token",
            "string",
        ]
        .contains(&lower.as_str())
        || [
            "your",
            "example",
            "dummy",
            "fake",
            "sample",
            "placeholder",
            "insert",
            "replace",
        ]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::classify_document;

    fn kind(value: &str) -> Option<&'static str> {
        classify_document(value).map(|(kind, _)| kind)
    }

    #[test]
    fn names_provider_credentials() {
        for (value, expected) in [
            ("AKIAIOSFODNN7EXAMPLE", "aws_access_key"),
            ("ASIAIOSFODNN7EXAMPLE", "aws_access_key"),
            ("ghp_0123456789abcdefghijklmnopqrstuvwxyz", "github_token"),
            (
                "github_pat_0123456789abcdefghijklmnopqrstuv",
                "github_token",
            ),
            ("sk_test_0123456789abcdefghijklmnop", "stripe_key"),
            (
                "sk-ant-api03-0123456789abcdefghijklmnopqrstuvwxyz",
                "api_key",
            ),
            ("sk-proj-0123456789abcdefghijklmnop", "api_key"),
            ("sk-0123456789abcdefghijklmnopqrstuvwxyzABCD", "api_key"),
            ("sntrys_0123456789abcdefghijklmnopqr", "api_key"),
            (concat!("xoxb-", "0123456789-abcdefghijklmnop"), "api_key"),
            ("npm_0123456789abcdefghijklmnopqrstuvwxyz", "api_key"),
            ("hf_0123456789abcdefghijklmnopqrstuvwxyz", "api_key"),
            ("glpat-0123456789abcdefghij", "api_key"),
            ("AIza0123456789abcdefghijklmnopqrstuvwxy", "api_key"),
            (
                "SG.0123456789abcdefghijkl.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
                "api_key",
            ),
            (
                "-----BEGIN PRIVATE KEY-----\nvalue\n-----END PRIVATE KEY-----",
                "private_key",
            ),
            (
                "postgres://app:hunter2hunter@db.internal:5432/app",
                "url_credential",
            ),
        ] {
            assert_eq!(kind(value), Some(expected), "{value}");
        }
    }

    #[test]
    fn finds_credentials_inside_clipboard_documents() {
        for value in [
            "APP_NAME=ClipsX\nAPI_KEY=Abcdefghijklmnop123456\nDEBUG=false",
            "{\n  \"client_secret\": \"correct-horse-battery-staple\"\n}",
            "{\"password\":\"hunter2!\"}",
            "const password = \"hunter2!\"",
            "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY",
            "user=admin password=hunter22 host=db",
            "curl -H 'Authorization: Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjbGlwc3gifQ.c2lnbmF0dXJl' https://example.com",
            "curl -H x-token:ghp_0123456789abcdefghijklmnopqrstuvwxyz https://example.com",
            "token=eyJhbGciOiJub25lIn0.eyJzdWIiOiJjbGlwc3gifQ.c2lnbmF0dXJl",
            "Bearer 0123456789abcdef0123456789abcdef",
            "notes\n-----BEGIN PRIVATE KEY-----\nvalue\n-----END PRIVATE KEY-----",
        ] {
            assert!(classify_document(value).is_some(), "{value}");
        }
    }

    #[test]
    fn leaves_identifiers_hashes_tokens_without_context_and_code_alone() {
        for value in [
            // Shape alone is not evidence: hashes, ids, slugs, blobs, unlabeled JWT/JWE.
            "aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY",
            "da39a3ee5e6b4b0d3255bfef95601890afd80709",
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "550e8400e29b41d4a716446655440000",
            "550e8400-e29b-41d4-a716-446655440000",
            "release-2026-10-build-4821-linux-x86_64-musl",
            "eyJhbGciOiJub25lIn0.eyJzdWIiOiJjbGlwc3gifQ.c2lnbmF0dXJl",
            "eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ.a2V5.aXY.Y2lwaGVydGV4dA.dGFn",
            "https://example.com/a/long/path/that/is/not/a/secret",
            "this is ordinary prose that happens to be longer than thirty two characters",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
            "sk-learn-pipeline-with-hyphenated-slug-name-2026",
            // Credential-like keys with non-credential keys, values or code.
            "PWD=/Users/me/project",
            "max_tokens: 100000000",
            "token_type: bearer-scheme-value",
            "next_page_token=Abcdefghijklmnop123456",
            "csrf_token=Abcdefghijklmnop123456",
            "secretsmanager://prod/app/config",
            "const password = getPassword()",
            "secret_key = os.environ[\"SECRET_KEY\"]",
            "token: Option<String>",
            "password: string,",
            "password=********",
            "password: ${DB_PASSWORD}",
            "api_key=<your-api-key>",
            "API_KEY=your_api_key_here",
            "secret: /run/secrets/db_password",
            "token=process.env.GITHUB_TOKEN",
            "postgres://user:password@localhost/app",
            "Authorization: Bearer <token>",
            "bearer tokens are described in the specification",
        ] {
            assert_eq!(classify_document(value), None, "{value}");
        }
    }
}
