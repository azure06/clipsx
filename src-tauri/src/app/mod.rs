//! Desktop composition root.

pub(crate) mod crash_reports;
pub(crate) mod diagnostics;
pub(crate) mod global_shortcut;
pub(crate) mod host;
mod runtime_probe;
pub(crate) mod settings;
pub(crate) mod state;
pub(crate) mod telemetry;
pub(crate) mod window_behavior;
pub(crate) mod window_chrome;
pub(crate) mod workers;

pub fn run() {
    #[cfg(feature = "recall-runtime-probe")]
    if let Some(path) = std::env::args_os()
        .skip(1)
        .collect::<Vec<_>>()
        .as_slice()
        .strip_prefix(&[std::ffi::OsString::from("--verify-recall-runtime")])
    {
        if path.len() != 1 {
            eprintln!("Usage: ClipsX --verify-recall-runtime <result.json>");
            std::process::exit(1);
        }
        if crate::recall::runtime_probe::run(std::path::PathBuf::from(&path[0])).is_err() {
            std::process::exit(1);
        }
        return;
    }
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() == Some(std::ffi::OsStr::new("--verify-extension-runtime")) {
        let result = match (arguments.next(), arguments.next()) {
            (Some(path), None) => {
                tauri::async_runtime::block_on(runtime_probe::verify(std::path::Path::new(&path)))
            }
            _ => Err(anyhow::anyhow!(
                "Usage: ClipsX --verify-extension-runtime <component.wasm>"
            )),
        };
        if let Err(error) = result {
            eprintln!("Extension runtime verification failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    crate::ipc::run();
}
