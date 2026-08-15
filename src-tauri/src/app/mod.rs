//! Desktop composition root.

pub(crate) mod host;
pub(crate) mod state;
pub(crate) mod window_behavior;
pub(crate) mod window_chrome;
pub(crate) mod workers;

pub fn run() {
    crate::ipc::run();
}
