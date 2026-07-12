use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::RwLock as StdRwLock;

use anyhow::{anyhow, bail, Result};
use image::imageops::FilterType;
use image::GenericImageView;
use ndarray::{Array2, Array4};
use ort::{session::Session, value::Tensor};
use tokenizers::Tokenizer;
use tokio::sync::Mutex;
use tokio::task;

pub const IMAGE_MODEL_CODE: &str = "google/siglip2-base-patch16-224";
pub const IMAGE_DIMENSIONS: i32 = 768;
const IMAGE_SIZE: usize = 224;
const MAX_TOKEN_LEN: usize = 64;

struct SigLipModels {
    text_session: StdMutex<Session>,
    image_session: StdMutex<Session>,
    tokenizer: Tokenizer,
}

pub struct VisualService {
    models: Arc<StdRwLock<Option<SigLipModels>>>,
    enabled: Arc<StdRwLock<bool>>,
    load_lock: Arc<Mutex<()>>,
    app_data_dir: PathBuf,
}

impl VisualService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            models: Arc::new(StdRwLock::new(None)),
            enabled: Arc::new(StdRwLock::new(true)),
            load_lock: Arc::new(Mutex::new(())),
            app_data_dir,
        }
    }

    fn model_dir(&self) -> PathBuf {
        self.app_data_dir.join("models").join("image_embedding")
    }

    fn is_ready(&self) -> bool {
        self.models.read().unwrap().is_some()
    }

    pub fn image_model_code(&self) -> String {
        IMAGE_MODEL_CODE.to_string()
    }

    pub fn image_dimensions(&self) -> i32 {
        IMAGE_DIMENSIONS
    }

    pub fn are_models_downloaded(&self) -> bool {
        let dir = self.model_dir();
        dir.join("siglip2-base-patch16-224-vision.onnx").exists()
            && dir.join("siglip2-base-patch16-224-text.onnx").exists()
            && dir.join("siglip2-tokenizer.json").exists()
    }

    pub fn is_enabled(&self) -> bool {
        *self.enabled.read().unwrap()
    }

    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.write().unwrap() = enabled;
        if !enabled {
            self.unload_models();
        }
    }

    pub async fn preload_models(&self) -> Result<()> {
        self.ensure_ready().await
    }

    pub fn unload_models(&self) {
        *self.models.write().unwrap() = None;
    }

    pub fn delete_cached_models(&self) -> Result<()> {
        self.unload_models();
        let dir = self.model_dir();
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| {
                anyhow!(
                    "Failed to delete visual model cache {}: {}",
                    dir.display(),
                    e
                )
            })?;
        }
        Ok(())
    }

    async fn ensure_ready(&self) -> Result<()> {
        if self.is_ready() {
            return Ok(());
        }

        let _guard = self.load_lock.lock().await;
        if self.is_ready() {
            return Ok(());
        }

        let model_dir = self.model_dir();
        let loaded = task::spawn_blocking(move || load_models(model_dir))
            .await
            .map_err(|e| anyhow!("Failed to join visual model init task: {}", e))??;

        *self.models.write().unwrap() = Some(loaded);
        Ok(())
    }

    pub async fn embed_query(&self, query: String) -> Result<Vec<f32>> {
        self.ensure_ready().await?;

        let models = self.models.clone();
        task::spawn_blocking(move || {
            let guard = models.read().unwrap();
            let m = guard
                .as_ref()
                .ok_or_else(|| anyhow!("Visual models not initialized"))?;
            let mut session = m.text_session.lock().unwrap();
            embed_text(&mut session, &m.tokenizer, &query)
        })
        .await
        .map_err(|e| anyhow!("Failed to join visual query embedding task: {}", e))?
    }

    pub async fn embed_image_path(&self, image_path: String) -> Result<Vec<f32>> {
        self.ensure_ready().await?;

        let models = self.models.clone();
        task::spawn_blocking(move || {
            let guard = models.read().unwrap();
            let m = guard
                .as_ref()
                .ok_or_else(|| anyhow!("Visual models not initialized"))?;
            let mut session = m.image_session.lock().unwrap();
            embed_image(&mut session, &image_path)
        })
        .await
        .map_err(|e| anyhow!("Failed to join visual image embedding task: {}", e))?
    }
}

fn load_models(model_dir: PathBuf) -> Result<SigLipModels> {
    let vision_path = model_dir.join("siglip2-base-patch16-224-vision.onnx");
    let text_path = model_dir.join("siglip2-base-patch16-224-text.onnx");
    let tokenizer_path = model_dir.join("siglip2-tokenizer.json");

    if !vision_path.exists() {
        bail!(
            "SigLIP2 vision model not found at {}",
            vision_path.display()
        );
    }
    if !text_path.exists() {
        bail!("SigLIP2 text model not found at {}", text_path.display());
    }
    if !tokenizer_path.exists() {
        bail!(
            "SigLIP2 tokenizer not found at {}",
            tokenizer_path.display()
        );
    }

    let image_session = Session::builder()?.commit_from_file(&vision_path)?;
    let text_session = Session::builder()?.commit_from_file(&text_path)?;
    let tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| anyhow!("Failed to load SigLIP2 tokenizer: {}", e))?;

    Ok(SigLipModels {
        text_session: StdMutex::new(text_session),
        image_session: StdMutex::new(image_session),
        tokenizer,
    })
}

fn embed_image(session: &mut Session, image_path: &str) -> Result<Vec<f32>> {
    let img = image::open(image_path)
        .map_err(|e| anyhow!("Failed to open image {}: {}", image_path, e))?;

    let resized = img.resize_exact(IMAGE_SIZE as u32, IMAGE_SIZE as u32, FilterType::Lanczos3);

    // Normalize to [-1, 1]: (pixel/255 - 0.5) / 0.5 = pixel/127.5 - 1.0
    let mut pixel_values = Array4::<f32>::zeros([1, 3, IMAGE_SIZE, IMAGE_SIZE]);
    for y in 0..IMAGE_SIZE {
        for x in 0..IMAGE_SIZE {
            let pixel = resized.get_pixel(x as u32, y as u32);
            pixel_values[[0, 0, y, x]] = pixel[0] as f32 / 127.5 - 1.0;
            pixel_values[[0, 1, y, x]] = pixel[1] as f32 / 127.5 - 1.0;
            pixel_values[[0, 2, y, x]] = pixel[2] as f32 / 127.5 - 1.0;
        }
    }

    let tensor = Tensor::from_array(pixel_values)
        .map_err(|e| anyhow!("Failed to create pixel_values tensor: {}", e))?;
    let outputs = session
        .run(ort::inputs!["pixel_values" => tensor])
        .map_err(|e| anyhow!("SigLIP2 vision inference failed: {}", e))?;

    extract_pooler_output(&outputs)
}

/// Build the ONNX input map for the text encoder, including only the inputs
/// that the loaded model actually declares.  Some exported SigLIP2 variants
/// drop `attention_mask` from their graph; sending an undeclared input causes
/// ORT to return an error, so we gate it on presence.
///
/// Accepting declared_input_names as a slice of &str makes this testable
/// without a real ONNX session.
fn build_text_inputs<'v>(
    declared_input_names: &[&str],
    input_ids: ort::value::Tensor<i64>,
    attention_mask: ort::value::Tensor<i64>,
) -> Vec<(
    std::borrow::Cow<'static, str>,
    ort::session::SessionInputValue<'v>,
)>
where
    ort::value::Tensor<i64>: Into<ort::session::SessionInputValue<'v>>,
{
    let mut inputs: Vec<(
        std::borrow::Cow<'static, str>,
        ort::session::SessionInputValue<'v>,
    )> = vec![("input_ids".into(), input_ids.into())];

    if declared_input_names.contains(&"attention_mask") {
        inputs.push(("attention_mask".into(), attention_mask.into()));
    }

    inputs
}

fn embed_text(session: &mut Session, tokenizer: &Tokenizer, text: &str) -> Result<Vec<f32>> {
    let encoding = tokenizer
        .encode(text, true)
        .map_err(|e| anyhow!("Tokenization failed: {}", e))?;

    let ids: Vec<i64> = encoding
        .get_ids()
        .iter()
        .take(MAX_TOKEN_LEN)
        .map(|&id| id as i64)
        .collect();
    let mask: Vec<i64> = encoding
        .get_attention_mask()
        .iter()
        .take(MAX_TOKEN_LEN)
        .map(|&m| m as i64)
        .collect();
    let seq_len = ids.len();

    let input_ids = Tensor::from_array(Array2::from_shape_vec([1, seq_len], ids)?)
        .map_err(|e| anyhow!("Failed to create input_ids tensor: {}", e))?;
    let attention_mask = Tensor::from_array(Array2::from_shape_vec([1, seq_len], mask)?)
        .map_err(|e| anyhow!("Failed to create attention_mask tensor: {}", e))?;

    // Collect owned names so the immutable borrow on session is dropped before
    // the mutable borrow in session.run().
    let declared_owned: Vec<String> = session
        .inputs()
        .iter()
        .map(|o| o.name().to_owned())
        .collect();
    let declared: Vec<&str> = declared_owned.iter().map(String::as_str).collect();
    let ort_inputs = build_text_inputs(&declared, input_ids, attention_mask);

    let outputs = session.run(ort_inputs).map_err(|e| {
        anyhow!(
            "SigLIP2 text inference failed (model inputs: [{}]): {}",
            declared_owned.join(", "),
            e
        )
    })?;

    extract_pooler_output(&outputs)
}

fn extract_pooler_output(outputs: &ort::session::SessionOutputs) -> Result<Vec<f32>> {
    // Both the text and vision ONNX exports expose two outputs:
    //   - last_hidden_state  [1, seq_len, 768] — per-token states, NOT the embedding
    //   - pooler_output      [1, 768]          — the L2-normalised sequence embedding
    // We must select by name; the iteration order of SessionOutputs is insertion
    // order (= model declaration order), which puts last_hidden_state first, so
    // .values().next() would silently return the wrong tensor.
    let output = outputs.get("pooler_output").ok_or_else(|| {
        anyhow!(
            "SigLIP2 model has no 'pooler_output'; available outputs: {:?}",
            outputs.keys().collect::<Vec<_>>()
        )
    })?;
    let (shape, data) = output
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow!("Failed to extract SigLIP2 pooler_output tensor: {}", e))?;
    let dims = &shape[..];
    if dims.len() != 2 || dims[0] != 1 {
        bail!("Unexpected SigLIP2 pooler_output shape: {:?}", dims);
    }
    let dim = dims[1] as usize;
    Ok(data.iter().take(dim).cloned().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ids_tensor(len: usize) -> Tensor<i64> {
        Tensor::from_array(Array2::from_shape_vec([1, len], vec![1i64; len]).unwrap()).unwrap()
    }

    fn make_mask_tensor(len: usize) -> Tensor<i64> {
        Tensor::from_array(Array2::from_shape_vec([1, len], vec![1i64; len]).unwrap()).unwrap()
    }

    #[test]
    fn build_text_inputs_omits_attention_mask_when_not_declared() {
        let declared = &["input_ids"];
        let inputs = build_text_inputs(declared, make_ids_tensor(3), make_mask_tensor(3));
        let names: Vec<&str> = inputs.iter().map(|(k, _)| k.as_ref()).collect();
        assert_eq!(names, vec!["input_ids"]);
    }

    #[test]
    fn build_text_inputs_includes_attention_mask_when_declared() {
        let declared = &["input_ids", "attention_mask"];
        let inputs = build_text_inputs(declared, make_ids_tensor(3), make_mask_tensor(3));
        let names: Vec<&str> = inputs.iter().map(|(k, _)| k.as_ref()).collect();
        assert_eq!(names, vec!["input_ids", "attention_mask"]);
    }

    #[test]
    fn build_text_inputs_ignores_unrecognised_optional_inputs() {
        // A future model might declare extra inputs we don't know about.
        // build_text_inputs only adds what it explicitly handles; unknown
        // declared names are benignly ignored.
        let declared = &["input_ids", "attention_mask", "token_type_ids"];
        let inputs = build_text_inputs(declared, make_ids_tensor(4), make_mask_tensor(4));
        let names: Vec<&str> = inputs.iter().map(|(k, _)| k.as_ref()).collect();
        // token_type_ids is declared by the model but we don't send it — that
        // is intentional: we only send what we know how to produce.
        assert_eq!(names, vec!["input_ids", "attention_mask"]);
    }
}
