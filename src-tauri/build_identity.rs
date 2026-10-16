#[cfg(not(test))]
use std::process::Command;

#[cfg(not(test))]
fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn identity(
    explicit: Option<String>,
    ci_revision: Option<String>,
    mut query: impl FnMut(&[&str]) -> Option<String>,
) -> (Option<String>, Option<bool>) {
    let commit = explicit
        .filter(|value| !value.trim().is_empty())
        .or_else(|| ci_revision.filter(|value| !value.trim().is_empty()))
        .or_else(|| query(&["rev-parse", "HEAD"]))
        .filter(|value| {
            (7..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
    let modified = query(&["status", "--porcelain", "--untracked-files=normal"])
        .map(|status| !status.is_empty());
    (commit, modified)
}

#[cfg(not(test))]
pub fn emit() {
    println!("cargo:rerun-if-env-changed=CLIPSX_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=build_identity.rs");
    // Resolve paths through Git so linked worktrees and packed refs work too.
    // Never watch a missing path: Cargo would rebuild on every invocation.
    for name in ["HEAD", "index", "refs", "packed-refs"] {
        if let Some(path) = git(&["rev-parse", "--git-path", name]) {
            if std::path::Path::new(&path).exists() {
                println!("cargo:rerun-if-changed={path}");
            }
        }
    }
    if let Some(root) = git(&["rev-parse", "--show-toplevel"]) {
        if let Some(files) = git(&[
            "ls-files",
            "--full-name",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            ":/",
        ]) {
            for file in files.split('\0').filter(|file| !file.is_empty()) {
                let path = std::path::Path::new(&root).join(file);
                if path.is_file() {
                    println!("cargo:rerun-if-changed={}", path.display());
                }
            }
        }
        // Detect additions without traversing node_modules or native build output.
        for directory in [
            "src",
            "src-tauri/src",
            "public",
            "scripts",
            "docs",
            ".github",
            ".agents",
            "assets",
        ] {
            let path = std::path::Path::new(&root).join(directory);
            if path.is_dir() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }
    let (commit, modified) = identity(
        std::env::var("CLIPSX_BUILD_COMMIT").ok(),
        std::env::var("GITHUB_SHA").ok(),
        git,
    );
    println!(
        "cargo:rustc-env=CLIPSX_BUILD_COMMIT={}",
        commit.unwrap_or_default()
    );
    println!(
        "cargo:rustc-env=CLIPSX_BUILD_MODIFIED={}",
        modified.map(|value| value.to_string()).unwrap_or_default()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_build_keeps_artifacts_fresh() {
        let directory = std::env::temp_dir().join(format!(
            "clipsx-build-identity-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(directory.join("src")).unwrap();
        std::fs::write(
            directory.join("Cargo.toml"),
            "[package]\nname=\"identity-check\"\nversion=\"0.0.0\"\nedition=\"2021\"\n",
        )
        .unwrap();
        std::fs::write(directory.join("src/main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(
            directory.join("build_identity.rs"),
            include_str!("build_identity.rs"),
        )
        .unwrap();
        std::fs::write(
            directory.join("build.rs"),
            "mod build_identity; fn main() { build_identity::emit(); }\n",
        )
        .unwrap();
        let check = || {
            let output = std::process::Command::new("cargo")
                .args(["check", "--offline", "--message-format=json"])
                .current_dir(&directory)
                .env("CARGO_TARGET_DIR", directory.join("target"))
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap()
        };
        check();
        let second = check();
        let artifacts: Vec<_> = second
            .lines()
            .filter(|line| line.contains("\"reason\":\"compiler-artifact\""))
            .collect();
        assert!(!artifacts.is_empty());
        assert!(
            artifacts.iter().all(|line| line.contains("\"fresh\":true")),
            "{}",
            second
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn explicit_revision_precedes_ci_and_git() {
        assert_eq!(
            identity(
                Some("abcdef012345".into()),
                Some("123456789abc".into()),
                |_| Some(String::new())
            ),
            (Some("abcdef012345".into()), Some(false))
        );
    }

    #[test]
    fn ci_revision_works_without_git() {
        assert_eq!(
            identity(None, Some("123456789abc".into()), |_| None),
            (Some("123456789abc".into()), None)
        );
    }

    #[test]
    fn checkout_records_revision_and_modified_files() {
        assert_eq!(
            identity(None, None, |args| Some(
                if args[0] == "rev-parse" {
                    "abcdef012345"
                } else {
                    " M src/main.rs"
                }
                .into()
            )),
            (Some("abcdef012345".into()), Some(true))
        );
    }

    #[test]
    fn missing_git_is_supported() {
        assert_eq!(identity(None, None, |_| None), (None, None));
    }

    #[test]
    fn invalid_revision_is_not_embedded() {
        assert_eq!(
            identity(Some("invalid\nvalue".into()), None, |_| None),
            (None, None)
        );
    }
}
