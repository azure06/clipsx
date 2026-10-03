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
