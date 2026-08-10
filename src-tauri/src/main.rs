#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod artifacts;
mod clipboard;
mod contracts;
mod contributions;
mod foundation;
mod history;
mod ipc;
mod output;
mod providers;
mod search;
mod shared;

fn main() {
    app::run();
}
