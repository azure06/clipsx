//! Desktop composition root.

pub(crate) mod host;
pub(crate) mod state;
pub(crate) mod window_chrome;

pub fn run() {
    crate::ipc::run();
}
