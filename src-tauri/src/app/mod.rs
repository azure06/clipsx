//! Desktop composition root.

pub(crate) mod state;

pub fn run() {
    crate::ipc::run();
}
