use super::{is_self_write_snapshot, remember_self_write};
use crate::{
    contributions::{self, RendererPreferences},
    foundation::{self, AppRoots},
    history::{
        CaptureSettings, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
        HistoryRepository,
    },
};
use std::collections::BTreeMap;

/// Reusable persistence boundary for platform fixtures. Native adapter tests
/// provide captured representations; this harness proves their canonical form
/// survives a closed database pool and a fresh repository instance.
struct FidelityHarness {
    _temp: tempfile::TempDir,
    roots: AppRoots,
}

impl FidelityHarness {
    async fn new() -> Self {
        let temp = tempfile::TempDir::new().expect("temporary fidelity root");
        let roots = AppRoots {
            data: temp.path().join("data"),
            config: temp.path().join("config"),
        };
        foundation::prepare(&roots)
            .await
            .expect("prepare fidelity database");
        Self { _temp: temp, roots }
    }

    async fn capture_and_restart(
        &self,
        representations: Vec<CapturedRepresentation>,
    ) -> (String, HistoryRepository) {
        let repo = HistoryRepository::connect(&self.roots.database(), self.roots.clipboard_data())
            .await
            .expect("connect capture repository");
        let (clip_id, duplicate) = repo
            .capture(
                CapturedSnapshot {
                    token: 41,
                    source_app_name: Some("Fixture Writer".into()),
                    source_app_id: Some("clipsx.fixture".into()),
                    format_observations: Vec::new(),
                    representations,
                },
                &CaptureSettings::default(),
            )
            .await
            .expect("capture fixture");
        assert!(!duplicate);
        repo.pool.close().await;
        drop(repo);

        let restarted =
            HistoryRepository::connect(&self.roots.database(), self.roots.clipboard_data())
                .await
                .expect("reconnect after simulated restart");
        (clip_id, restarted)
    }
}

fn text_representation(
    format_key: &str,
    mime: &str,
    native_type: &str,
    priority: i64,
    text: &str,
) -> CapturedRepresentation {
    CapturedRepresentation {
        format_key: format_key.into(),
        canonical_mime_type: Some(mime.into()),
        native_type: Some(native_type.into()),
        platform: "windows".into(),
        capture_priority: priority,
        payload: CapturedPayload::Text(text.into()),
    }
}

fn assert_representations(actual: &[CapturedRepresentation], expected: &[CapturedRepresentation]) {
    assert_eq!(actual.len(), expected.len());
    for (actual, expected) in actual.iter().zip(expected) {
        assert_eq!(actual.format_key, expected.format_key);
        assert_eq!(actual.canonical_mime_type, expected.canonical_mime_type);
        assert_eq!(actual.native_type, expected.native_type);
        assert_eq!(actual.platform, expected.platform);
        assert_eq!(actual.capture_priority, expected.capture_priority);
        match (&actual.payload, &expected.payload) {
            (CapturedPayload::Text(actual), CapturedPayload::Text(expected)) => {
                assert_eq!(actual, expected)
            }
            (CapturedPayload::Binary(actual), CapturedPayload::Binary(expected)) => {
                assert_eq!(actual, expected)
            }
            (CapturedPayload::Files(actual), CapturedPayload::Files(expected)) => {
                assert_eq!(actual, expected)
            }
            _ => panic!("fixture payload kind changed during round trip"),
        }
    }
}

#[tokio::test]
async fn windows_text_html_rtf_and_files_survive_restart_in_contract_order() {
    let harness = FidelityHarness::new().await;
    let files = vec![
        r"C:\fixture\first.txt".to_string(),
        r"D:\fixture\雪 report.rtf".to_string(),
    ];
    let original = vec![
        CapturedRepresentation {
            format_key: "windows:CF_HDROP".into(),
            canonical_mime_type: None,
            native_type: Some("CF_HDROP".into()),
            platform: "windows".into(),
            capture_priority: 5,
            payload: CapturedPayload::Files(files.clone()),
        },
        text_representation(
            "windows:HTML Format",
            "text/html",
            "HTML Format",
            20,
            "<table><tr><td>雪</td></tr></table>",
        ),
        text_representation(
            "windows:Rich Text Format",
            "text/rtf",
            "Rich Text Format",
            30,
            r"{\rtf1\ansi Unicode 雪}",
        ),
        text_representation(
            "windows:CF_UNICODETEXT",
            "text/plain",
            "CF_UNICODETEXT",
            100,
            "plain 雪",
        ),
    ];
    let (clip_id, repo) = harness.capture_and_restart(original.clone()).await;

    let detail = repo.detail(&clip_id).await.expect("detail after restart");
    assert_eq!(
        detail.clip.source_app_name.as_deref(),
        Some("Fixture Writer")
    );
    let file_detail = detail
        .representations
        .iter()
        .find(|representation| representation.format_key == "windows:CF_HDROP")
        .expect("file-list detail");
    assert_eq!(file_detail.file_references, files);
    assert_eq!(file_detail.storage_kind, "file_list");

    let reconstructed = repo
        .reconstruction(&clip_id)
        .await
        .expect("original reconstruction");
    assert_representations(&reconstructed, &original);

    let plain = repo
        .plain_text_reconstruction(&clip_id)
        .await
        .expect("plain-text reconstruction");
    assert_representations(&plain, &original[3..]);

    let preferences = RendererPreferences {
        by_mime_type: BTreeMap::from([
            ("text/html".into(), "builtin.original".into()),
            ("text/plain".into(), "builtin.text".into()),
        ]),
        ..RendererPreferences::default()
    };
    contributions::update_preferences(&repo, &preferences)
        .await
        .expect("update renderer preferences");
    assert_representations(
        &repo.reconstruction(&clip_id).await.unwrap(),
        &reconstructed,
    );
    assert_representations(
        &repo.plain_text_reconstruction(&clip_id).await.unwrap(),
        &plain,
    );

    remember_self_write(9_876_541, &reconstructed);
    assert!(is_self_write_snapshot(&CapturedSnapshot {
        token: 9_876_541,
        source_app_name: None,
        source_app_id: None,
        format_observations: Vec::new(),
        representations: reconstructed,
    }));
}

#[tokio::test]
async fn windows_binary_assets_survive_managed_file_restart_byte_for_byte() {
    let harness = FidelityHarness::new().await;
    let original = vec![
        CapturedRepresentation {
            format_key: "windows:PNG".into(),
            canonical_mime_type: Some("image/png".into()),
            native_type: Some("PNG".into()),
            platform: "windows".into(),
            capture_priority: 10,
            payload: CapturedPayload::Binary(vec![0x89, b'P', b'N', b'G', 1, 2, 3]),
        },
        CapturedRepresentation {
            format_key: "windows:Portable Document Format".into(),
            canonical_mime_type: Some("application/pdf".into()),
            native_type: Some("Portable Document Format".into()),
            platform: "windows".into(),
            capture_priority: 20,
            payload: CapturedPayload::Binary(b"%PDF-1.7\nfixture".to_vec()),
        },
        CapturedRepresentation {
            format_key: "windows:image/svg+xml".into(),
            canonical_mime_type: Some("image/svg+xml".into()),
            native_type: Some("image/svg+xml".into()),
            platform: "windows".into(),
            capture_priority: 30,
            payload: CapturedPayload::Binary(b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec()),
        },
        CapturedRepresentation {
            format_key: "windows:PowerPoint 16.0 Internal Slides".into(),
            canonical_mime_type: None,
            native_type: Some("PowerPoint 16.0 Internal Slides".into()),
            platform: "windows".into(),
            capture_priority: 40,
            payload: CapturedPayload::Binary(vec![0, 1, 2, 0xff]),
        },
    ];
    let (clip_id, repo) = harness.capture_and_restart(original.clone()).await;
    let reconstructed = repo
        .reconstruction(&clip_id)
        .await
        .expect("binary reconstruction");
    assert_representations(&reconstructed, &original);
    assert!(repo
        .detail(&clip_id)
        .await
        .unwrap()
        .representations
        .iter()
        .all(|representation| representation.binary_file_id.is_some()));
}
