use super::PreparedShare;
use anyhow::{Context, Result};
use std::future::IntoFuture;
use tauri::WebviewWindow;
use windows::{
    core::{factory, Interface, HSTRING},
    ApplicationModel::DataTransfer::{DataPackage, DataRequestedEventArgs, DataTransferManager},
    Foundation::{TypedEventHandler, Uri},
    Storage::{IStorageItem, StorageFile},
    Win32::{Foundation::HWND, UI::Shell::IDataTransferManagerInterop},
};
use windows_collections::IVectorView;

pub async fn show(window: &WebviewWindow, payload: PreparedShare) -> Result<()> {
    let payload = match payload {
        PreparedShare::Files(paths) => WindowsPayload::Files(
            paths
                .into_iter()
                .map(|path| {
                    path.to_str()
                        .map(str::to_owned)
                        .context("shared file path is not valid Unicode")
                })
                .collect::<Result<Vec<_>>>()?,
        ),
        PreparedShare::Text(text) => WindowsPayload::Text(text),
        PreparedShare::Url(url) => WindowsPayload::Url(url),
    };
    let hwnd = window.hwnd().context("main window handle is unavailable")?;
    let hwnd_value = hwnd.0 as isize;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window.run_on_main_thread(move || {
        let result = show_on_main_thread(HWND(hwnd_value as *mut _), payload)
            .map_err(|error| error.to_string());
        let _ = sender.send(result);
    })?;
    receiver
        .recv()
        .context("share UI initialization did not complete")?
        .map_err(anyhow::Error::msg)
}

enum WindowsPayload {
    Text(String),
    Url(String),
    Files(Vec<String>),
}

fn show_on_main_thread(hwnd: HWND, payload: WindowsPayload) -> windows::core::Result<()> {
    let interop = factory::<DataTransferManager, IDataTransferManagerInterop>()?;
    let manager: DataTransferManager = unsafe { interop.GetForWindow(hwnd)? };
    let handler =
        TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
            let request = args.as_ref().expect("share request args").Request()?;
            let data: DataPackage = request.Data()?;
            data.Properties()?
                .SetTitle(&HSTRING::from("Share from ClipsX"))?;
            match &payload {
                WindowsPayload::Text(text) => data.SetText(&HSTRING::from(text))?,
                WindowsPayload::Url(url) => {
                    data.SetWebLink(&Uri::CreateUri(&HSTRING::from(url))?)?
                }
                WindowsPayload::Files(paths) => {
                    let mut storage_items: Vec<Option<IStorageItem>> =
                        Vec::with_capacity(paths.len());
                    for path in paths {
                        let operation = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))?;
                        let file = futures::executor::block_on(operation.into_future())?;
                        storage_items.push(Some(file.cast()?));
                    }
                    let items: IVectorView<IStorageItem> = storage_items.into();
                    data.SetStorageItemsReadOnly(&items)?;
                }
            }
            Ok(())
        });
    manager.DataRequested(&handler)?;
    unsafe { interop.ShowShareUIForWindow(hwnd) }
}
