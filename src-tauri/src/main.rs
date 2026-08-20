#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod artifacts;
mod clipboard;
mod contracts;
mod contributions;
mod extensions;
mod foundation;
mod history;
mod ipc;
mod output;
mod providers;
mod search;
mod shared;
mod text;

fn main() {
    app::run();
}
