use super::PreparedShare;
use anyhow::{bail, Result};
use ashpd::{
    desktop::{open_uri::OpenFileRequest, request::ResponseError},
    Error,
};
use std::{fs::File, path::PathBuf};
use tauri::WebviewWindow;

pub async fn show(_window: &WebviewWindow, payload: PreparedShare) -> Result<()> {
    let paths = match payload {
        PreparedShare::Files(paths) => paths,
        PreparedShare::Text(_) | PreparedShare::Url(_) => {
            bail!("Linux sharing requires a prepared file")
        }
    };
    for path in paths {
        open_with_chooser(path).await?;
    }
    Ok(())
}

async fn open_with_chooser(path: PathBuf) -> Result<()> {
    let file = File::open(path)?;
    let response = OpenFileRequest::default()
        .ask(true)
        .send_file(&file)
        .await?
        .response();
    match response {
        Ok(()) | Err(Error::Response(ResponseError::Cancelled)) => Ok(()),
        Err(error) => Err(error.into()),
    }
}
