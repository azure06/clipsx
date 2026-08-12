//! Desktop composition root.

pub(crate) mod host;
pub(crate) mod state;

pub fn run() {
    crate::ipc::run();
}
