use super::PreparedShare;
use anyhow::{Context, Result};
use cocoa::{
    appkit::NSView,
    base::{id, nil},
    foundation::{NSArray, NSAutoreleasePool, NSString},
};
use objc::{class, msg_send, sel, sel_impl};
use tauri::WebviewWindow;

pub async fn show(window: &WebviewWindow, payload: PreparedShare) -> Result<()> {
    let ns_view = window
        .ns_view()
        .context("main native view is unavailable")? as usize;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window.run_on_main_thread(move || {
        let result = unsafe { show_on_main_thread(ns_view as id, payload) }
            .map_err(|error| error.to_string());
        let _ = sender.send(result);
    })?;
    receiver
        .recv()
        .context("share UI initialization did not complete")?
        .map_err(anyhow::Error::msg)
}

unsafe fn show_on_main_thread(view: id, payload: PreparedShare) -> Result<()> {
    let pool = NSAutoreleasePool::new(nil);
    let mut values: Vec<id> = Vec::new();
    match payload {
        PreparedShare::Text(text) => {
            values.push(NSString::alloc(nil).init_str(&text));
        }
        PreparedShare::Url(url) => {
            let string = NSString::alloc(nil).init_str(&url);
            let value: id = msg_send![class!(NSURL), URLWithString: string];
            values.push(value);
        }
        PreparedShare::Files(paths) => {
            for path in paths {
                let path = path
                    .to_str()
                    .context("shared file path is not valid Unicode")?;
                let string = NSString::alloc(nil).init_str(path);
                let url: id = msg_send![class!(NSURL), fileURLWithPath: string];
                values.push(url);
            }
        }
    }
    let items = NSArray::arrayWithObjects(nil, &values);
    let picker: id = msg_send![class!(NSSharingServicePicker), alloc];
    let picker: id = msg_send![picker, initWithItems: items];
    let bounds = NSView::bounds(view);
    let _: () = msg_send![picker, showRelativeToRect: bounds ofView: view preferredEdge: 3usize];
    let _: () = msg_send![picker, autorelease];
    let _: () = msg_send![pool, drain];
    Ok(())
}
