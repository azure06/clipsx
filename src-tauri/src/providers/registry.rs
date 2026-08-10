#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCapability {
    TextEmbedding,
    VisualEmbedding,
    VisionDescription,
    Generation,
    Ocr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderRegistration {
    pub id: &'static str,
    pub capability: ProviderCapability,
    pub available: bool,
}

pub fn provider_capabilities() -> &'static [ProviderRegistration] {
    const REGISTRY: &[ProviderRegistration] = &[
        ProviderRegistration {
            id: "builtin.embedding.ollama",
            capability: ProviderCapability::TextEmbedding,
            available: true,
        },
        ProviderRegistration {
            id: "builtin.visual.disabled",
            capability: ProviderCapability::VisualEmbedding,
            available: false,
        },
        ProviderRegistration {
            id: "builtin.vision-description.disabled",
            capability: ProviderCapability::VisionDescription,
            available: false,
        },
        ProviderRegistration {
            id: "builtin.generation.disabled",
            capability: ProviderCapability::Generation,
            available: false,
        },
        ProviderRegistration {
            id: "builtin.ocr.native",
            capability: ProviderCapability::Ocr,
            available: true,
        },
    ];
    REGISTRY
}
