use anyhow::Result;
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use scraper::{ElementRef, Html, Selector};
use serde_json::Value;
use std::collections::BTreeMap;

pub const PIPELINE_VERSION: &str = "3";
pub const TARGET_EMBED_BYTES: usize = 1_536;
pub const MAX_EMBED_BYTES: usize = 2_048;
pub const MAX_CONTEXT_BYTES: usize = 384;
pub const FALLBACK_OVERLAP_BYTES: usize = 256;

const STRATEGY_VERSION: &str = "1";

#[derive(Debug, Clone, PartialEq)]
pub struct SemanticFacet {
    pub id: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SemanticInput {
    pub source_kind: String,
    pub source_id: String,
    pub representation_id: Option<String>,
    pub artifact_id: Option<String>,
    pub mime_type: Option<String>,
    pub format_family: Option<String>,
    pub facets: Vec<SemanticFacet>,
    pub text: String,
    pub source_ordinal: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticBlock {
    pub kind: String,
    pub content: String,
    pub context_path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticChunk {
    pub display_text: String,
    pub embedding_text: String,
    pub kind: String,
    pub context_path: Vec<String>,
    pub strategy_id: String,
    pub strategy_version: String,
    pub fallback_reason: Option<String>,
}

pub trait SemanticChunkStrategy: Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> &'static str {
        STRATEGY_VERSION
    }
    fn accepts(&self, input: &SemanticInput) -> bool;
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>>;
}

struct JsonStrategy;
struct MarkdownStrategy;
struct TableStrategy;
struct HtmlStrategy;
struct RtfStrategy;
struct CodeStrategy;
struct OcrStrategy;
struct PlainStrategy;

static JSON: JsonStrategy = JsonStrategy;
static MARKDOWN: MarkdownStrategy = MarkdownStrategy;
static TABLE: TableStrategy = TableStrategy;
static HTML: HtmlStrategy = HtmlStrategy;
static RTF: RtfStrategy = RtfStrategy;
static CODE: CodeStrategy = CodeStrategy;
static OCR: OcrStrategy = OcrStrategy;
static PLAIN: PlainStrategy = PlainStrategy;

pub fn registered_strategies() -> [&'static dyn SemanticChunkStrategy; 8] {
    [&JSON, &MARKDOWN, &TABLE, &HTML, &RTF, &CODE, &OCR, &PLAIN]
}

pub fn chunk_input(input: &SemanticInput) -> Result<Vec<SemanticChunk>> {
    let mut declined = Vec::new();
    for strategy in registered_strategies() {
        if !strategy.accepts(input) {
            continue;
        }
        match strategy.extract_blocks(input)? {
            Some(blocks) if !blocks.is_empty() => {
                let fallback_reason = (!declined.is_empty()).then(|| declined.join(", "));
                return Ok(pack_blocks(
                    blocks,
                    strategy.id(),
                    strategy.version(),
                    fallback_reason,
                ));
            }
            _ => declined.push(format!("{} declined", strategy.id())),
        }
    }
    Ok(Vec::new())
}

pub fn strategy_quality(input: &SemanticInput) -> u8 {
    registered_strategies()
        .iter()
        .position(|strategy| {
            strategy.accepts(input)
                && strategy
                    .extract_blocks(input)
                    .is_ok_and(|blocks| blocks.is_some_and(|blocks| !blocks.is_empty()))
        })
        .map(|position| (registered_strategies().len() - position) as u8)
        .unwrap_or(0)
}

pub fn visible_fingerprint_text(input: &SemanticInput) -> String {
    let blocks = registered_strategies()
        .iter()
        .filter(|strategy| strategy.accepts(input))
        .find_map(|strategy| strategy.extract_blocks(input).ok().flatten())
        .unwrap_or_else(|| plain_blocks(&input.text, "text"));
    collapse_whitespace(
        &blocks
            .into_iter()
            .map(|block| block.content)
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn facet<'a>(input: &'a SemanticInput, id: &str) -> Option<&'a Value> {
    input
        .facets
        .iter()
        .find(|facet| facet.id == id)
        .map(|facet| &facet.payload)
}

fn mime_is(input: &SemanticInput, values: &[&str]) -> bool {
    input
        .mime_type
        .as_deref()
        .is_some_and(|mime| values.contains(&mime))
}

fn inferred_facet_allowed(input: &SemanticInput) -> bool {
    input.mime_type.is_none() || mime_is(input, &["text/plain"])
}

impl SemanticChunkStrategy for JsonStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.json-tree"
    }
    fn accepts(&self, input: &SemanticInput) -> bool {
        mime_is(input, &["application/json", "text/json"])
            || (inferred_facet_allowed(input) && facet(input, "core.data.json").is_some())
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        let Ok(value) = serde_json::from_str::<Value>(&input.text) else {
            return Ok(None);
        };
        let mut blocks = Vec::new();
        json_blocks(&value, "", &mut blocks);
        Ok(Some(blocks))
    }
}

fn json_blocks(value: &Value, path: &str, output: &mut Vec<SemanticBlock>) {
    let serialized = serde_json::to_string(value).unwrap_or_default();
    if serialized.len() <= TARGET_EMBED_BYTES / 2
        || !matches!(value, Value::Array(_) | Value::Object(_))
    {
        output.push(SemanticBlock {
            kind: "json".into(),
            content: serialized,
            context_path: vec![format!(
                "Path: {}",
                if path.is_empty() { "/" } else { path }
            )],
        });
        return;
    }
    match value {
        Value::Object(values) => {
            let mut group = Vec::new();
            let mut group_bytes = 2;
            for (key, child) in values {
                let escaped = key.replace('~', "~0").replace('/', "~1");
                let entry = format!(
                    "{}:{}",
                    serde_json::to_string(key).unwrap_or_default(),
                    serde_json::to_string(child).unwrap_or_default()
                );
                if entry.len() > TARGET_EMBED_BYTES / 2 {
                    flush_json_object_group(path, &mut group, output);
                    group_bytes = 2;
                    json_blocks(child, &format!("{path}/{escaped}"), output);
                } else {
                    if group_bytes + entry.len() + usize::from(!group.is_empty())
                        > TARGET_EMBED_BYTES / 2
                    {
                        flush_json_object_group(path, &mut group, output);
                        group_bytes = 2;
                    }
                    group_bytes += entry.len() + usize::from(!group.is_empty());
                    group.push(entry);
                }
            }
            flush_json_object_group(path, &mut group, output);
        }
        Value::Array(values) => {
            let mut group = Vec::new();
            let mut start = 0;
            let mut group_bytes = 2;
            for (index, child) in values.iter().enumerate() {
                let entry = serde_json::to_string(child).unwrap_or_default();
                if entry.len() > TARGET_EMBED_BYTES / 2 {
                    flush_json_array_group(path, start, index, &mut group, output);
                    group_bytes = 2;
                    json_blocks(child, &format!("{path}/{index}"), output);
                    start = index + 1;
                } else {
                    if group_bytes + entry.len() + usize::from(!group.is_empty())
                        > TARGET_EMBED_BYTES / 2
                    {
                        flush_json_array_group(path, start, index, &mut group, output);
                        start = index;
                        group_bytes = 2;
                    }
                    group_bytes += entry.len() + usize::from(!group.is_empty());
                    group.push(entry);
                }
            }
            flush_json_array_group(path, start, values.len(), &mut group, output);
        }
        _ => {}
    }
}

fn flush_json_object_group(path: &str, group: &mut Vec<String>, output: &mut Vec<SemanticBlock>) {
    if group.is_empty() {
        return;
    }
    output.push(SemanticBlock {
        kind: "json_object".into(),
        content: format!("{{{}}}", group.join(",")),
        context_path: vec![format!(
            "Path: {}",
            if path.is_empty() { "/" } else { path }
        )],
    });
    group.clear();
}

fn flush_json_array_group(
    path: &str,
    start: usize,
    end: usize,
    group: &mut Vec<String>,
    output: &mut Vec<SemanticBlock>,
) {
    if group.is_empty() {
        return;
    }
    let base = if path.is_empty() { "" } else { path };
    let range = if end == start + 1 {
        format!("{base}/{start}")
    } else {
        format!("{base}/{start}-{}", end.saturating_sub(1))
    };
    output.push(SemanticBlock {
        kind: "json_array".into(),
        content: format!("[{}]", group.join(",")),
        context_path: vec![format!("Path: {range}")],
    });
    group.clear();
}

impl SemanticChunkStrategy for MarkdownStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.markdown-ast"
    }
    fn accepts(&self, input: &SemanticInput) -> bool {
        mime_is(input, &["text/markdown", "text/x-markdown"])
            || (inferred_facet_allowed(input) && facet(input, "core.text.markdown").is_some())
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        let options = Options::ENABLE_TABLES
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_FOOTNOTES;
        let mut headings = vec![String::new(); 6];
        let mut blocks = Vec::new();
        let mut current = String::new();
        let mut kind = String::new();
        let mut heading_level = None;
        let mut code_language = None;
        for event in Parser::new_ext(&input.text, options) {
            match event {
                Event::Start(Tag::Heading { level, .. }) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None);
                    heading_level = Some(heading_index(level));
                    kind = "heading".into();
                }
                Event::End(TagEnd::Heading(_)) => {
                    if let Some(level) = heading_level.take() {
                        let heading = current.trim().to_string();
                        headings[level] = heading.clone();
                        headings.iter_mut().skip(level + 1).for_each(String::clear);
                        if !heading.is_empty() {
                            blocks.push(SemanticBlock {
                                kind: "heading".into(),
                                content: heading,
                                context_path: heading_path(&headings),
                            });
                        }
                        current.clear();
                        kind.clear();
                    }
                }
                Event::Start(Tag::Paragraph) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None);
                    kind = "paragraph".into();
                }
                Event::End(TagEnd::Paragraph) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None)
                }
                Event::Start(Tag::Item) => {
                    if current.trim().is_empty() {
                        kind = "list_item".into();
                    }
                }
                Event::End(TagEnd::Item) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None)
                }
                Event::Start(Tag::BlockQuote(_)) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None);
                    kind = "blockquote".into();
                }
                Event::End(TagEnd::BlockQuote(_)) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None)
                }
                Event::Start(Tag::CodeBlock(block_kind)) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None);
                    kind = "code".into();
                    code_language = match block_kind {
                        CodeBlockKind::Fenced(language) if !language.trim().is_empty() => {
                            Some(language.to_string())
                        }
                        _ => None,
                    };
                }
                Event::End(TagEnd::CodeBlock) => flush_markdown(
                    &mut blocks,
                    &mut current,
                    &mut kind,
                    &headings,
                    code_language.take(),
                ),
                Event::Start(Tag::Table(_)) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None);
                    kind = "table".into();
                }
                Event::End(TagEnd::Table) => {
                    flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None)
                }
                Event::End(TagEnd::TableRow) => current.push('\n'),
                Event::End(TagEnd::TableCell) => current.push_str(" | "),
                Event::Text(value) | Event::Code(value) => current.push_str(&value),
                Event::SoftBreak | Event::HardBreak => current.push('\n'),
                Event::Html(value) | Event::InlineHtml(value) => {
                    let nested = html_blocks(&value);
                    current.push_str(
                        &nested
                            .into_iter()
                            .map(|block| block.content)
                            .collect::<Vec<_>>()
                            .join(" "),
                    );
                }
                _ => {}
            }
        }
        flush_markdown(&mut blocks, &mut current, &mut kind, &headings, None);
        Ok((!blocks.is_empty()).then_some(blocks))
    }
}

fn heading_index(level: HeadingLevel) -> usize {
    match level {
        HeadingLevel::H1 => 0,
        HeadingLevel::H2 => 1,
        HeadingLevel::H3 => 2,
        HeadingLevel::H4 => 3,
        HeadingLevel::H5 => 4,
        HeadingLevel::H6 => 5,
    }
}

fn heading_path(headings: &[String]) -> Vec<String> {
    headings
        .iter()
        .filter(|heading| !heading.is_empty())
        .cloned()
        .collect()
}

fn flush_markdown(
    blocks: &mut Vec<SemanticBlock>,
    current: &mut String,
    kind: &mut String,
    headings: &[String],
    language: Option<String>,
) {
    let content = current.trim().trim_end_matches('|').trim().to_string();
    if !content.is_empty() {
        let mut context = heading_path(headings);
        if let Some(language) = language {
            context.push(format!("Language: {language}"));
        }
        blocks.push(SemanticBlock {
            kind: if kind.is_empty() {
                "paragraph"
            } else {
                kind.as_str()
            }
            .into(),
            content,
            context_path: context,
        });
    }
    current.clear();
    kind.clear();
}

impl SemanticChunkStrategy for TableStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.delimited-table"
    }
    fn accepts(&self, input: &SemanticInput) -> bool {
        mime_is(input, &["text/csv", "text/tab-separated-values"])
            || (inferred_facet_allowed(input) && facet(input, "core.data.table").is_some())
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        let delimiter = if mime_is(input, &["text/tab-separated-values"])
            || facet(input, "core.data.table").and_then(|value| value["delimiter"].as_str())
                == Some("\t")
        {
            b'\t'
        } else {
            b','
        };
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(delimiter)
            .has_headers(false)
            .flexible(false)
            .from_reader(input.text.as_bytes());
        let rows = reader.records().collect::<std::result::Result<Vec<_>, _>>();
        let Ok(rows) = rows else {
            return Ok(None);
        };
        if rows.len() < 2 || rows[0].len() < 2 {
            return Ok(None);
        }
        let headers = rows[0].iter().map(str::to_string).collect::<Vec<_>>();
        if rows.iter().any(|row| row.len() != headers.len()) {
            return Ok(None);
        }
        let context = vec![format!("Columns: {}", headers.join(" | "))];
        Ok(Some(
            rows.into_iter()
                .skip(1)
                .map(|row| SemanticBlock {
                    kind: "table_row".into(),
                    content: row.iter().collect::<Vec<_>>().join(" | "),
                    context_path: context.clone(),
                })
                .collect(),
        ))
    }
}

impl SemanticChunkStrategy for HtmlStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.html-dom"
    }
    fn accepts(&self, input: &SemanticInput) -> bool {
        mime_is(input, &["text/html", "application/xhtml+xml"])
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        let blocks = html_blocks(&input.text);
        Ok((!blocks.is_empty()).then_some(blocks))
    }
}

fn html_blocks(input: &str) -> Vec<SemanticBlock> {
    let document = Html::parse_fragment(input);
    let selector = Selector::parse("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table").unwrap();
    let row_selector = Selector::parse("tr").unwrap();
    let cell_selector = Selector::parse("th,td").unwrap();
    let mut headings = vec![String::new(); 6];
    let mut blocks = Vec::new();
    for element in document.select(&selector) {
        let tag = element.value().name();
        if has_selected_ancestor(element, &["p", "li", "blockquote", "pre", "table"]) {
            continue;
        }
        if tag.starts_with('h') && tag.len() == 2 {
            let level = tag.as_bytes()[1].saturating_sub(b'1') as usize;
            let text = visible_element_text(element);
            if level < headings.len() && !text.is_empty() {
                headings[level] = text.clone();
                headings.iter_mut().skip(level + 1).for_each(String::clear);
                blocks.push(SemanticBlock {
                    kind: "heading".into(),
                    content: text,
                    context_path: heading_path(&headings),
                });
            }
            continue;
        }
        if tag == "table" {
            let rows = element
                .select(&row_selector)
                .map(|row| {
                    row.select(&cell_selector)
                        .map(visible_element_text)
                        .filter(|cell| !cell.is_empty())
                        .collect::<Vec<_>>()
                })
                .filter(|row| !row.is_empty())
                .collect::<Vec<_>>();
            let headers = rows.first().cloned().unwrap_or_default();
            let mut context = heading_path(&headings);
            if !headers.is_empty() {
                context.push(format!("Columns: {}", headers.join(" | ")));
            }
            for row in rows.into_iter().skip(1) {
                blocks.push(SemanticBlock {
                    kind: "table_row".into(),
                    content: row.join(" | "),
                    context_path: context.clone(),
                });
            }
            continue;
        }
        let content = visible_element_text(element);
        if !content.is_empty() {
            blocks.push(SemanticBlock {
                kind: match tag {
                    "li" => "list_item",
                    "blockquote" => "blockquote",
                    "pre" => "code",
                    _ => "paragraph",
                }
                .into(),
                content,
                context_path: heading_path(&headings),
            });
        }
    }
    blocks
}

fn has_selected_ancestor(element: ElementRef<'_>, tags: &[&str]) -> bool {
    element.ancestors().skip(1).any(|node| {
        ElementRef::wrap(node).is_some_and(|ancestor| tags.contains(&ancestor.value().name()))
    })
}

fn visible_element_text(element: ElementRef<'_>) -> String {
    let mut parts = Vec::new();
    for node in element.descendants() {
        let Some(text) = node.value().as_text() else {
            continue;
        };
        let hidden = node.ancestors().any(|ancestor| {
            ElementRef::wrap(ancestor).is_some_and(|element| {
                matches!(
                    element.value().name(),
                    "script" | "style" | "template" | "noscript" | "svg"
                )
            })
        });
        if !hidden {
            parts.push(text.as_ref());
        }
    }
    collapse_whitespace(&parts.join(" "))
}

impl SemanticChunkStrategy for RtfStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.rtf-blocks"
    }
    fn accepts(&self, input: &SemanticInput) -> bool {
        mime_is(input, &["text/rtf", "application/rtf"])
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        let lower = input.text.to_ascii_lowercase();
        if ["\\bin", "\\object", "\\objdata", "\\field", "\\pict"]
            .iter()
            .any(|control| lower.contains(control))
        {
            return Ok(None);
        }
        let parsed =
            std::panic::catch_unwind(|| rtf_parser::RtfDocument::try_from(input.text.as_str()));
        let Ok(Ok(document)) = parsed else {
            return Ok(None);
        };
        Ok(Some(plain_blocks(&document.get_text(), "paragraph")))
    }
}

impl SemanticChunkStrategy for CodeStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.code-blocks"
    }
    fn accepts(&self, input: &SemanticInput) -> bool {
        inferred_facet_allowed(input) && facet(input, "core.text.code").is_some()
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        let language = facet(input, "core.text.code")
            .and_then(|value| value["language"].as_str())
            .unwrap_or("unknown");
        let mut blocks = Vec::new();
        let mut current = Vec::new();
        let normalized = normalize_lines(&input.text);
        for line in normalized.lines() {
            if (!current.is_empty() && declaration_line(line))
                || (line.trim().is_empty() && !current.is_empty())
            {
                push_code_block(&mut blocks, &mut current, language);
            }
            if !line.trim().is_empty() {
                current.push(line);
            }
        }
        push_code_block(&mut blocks, &mut current, language);
        Ok((!blocks.is_empty()).then_some(blocks))
    }
}

fn declaration_line(line: &str) -> bool {
    let line = line.trim_start();
    [
        "fn ",
        "pub fn ",
        "async fn ",
        "def ",
        "class ",
        "function ",
        "interface ",
        "struct ",
        "enum ",
        "impl ",
        "const ",
        "export ",
    ]
    .iter()
    .any(|prefix| line.starts_with(prefix))
}

fn push_code_block(blocks: &mut Vec<SemanticBlock>, current: &mut Vec<&str>, language: &str) {
    let content = current.join("\n").trim().to_string();
    if !content.is_empty() {
        let declaration = content.lines().next().unwrap_or_default().trim();
        let mut context = vec![format!("Language: {language}")];
        if declaration_line(declaration) {
            context.push(format!("Declaration: {declaration}"));
        }
        blocks.push(SemanticBlock {
            kind: "code".into(),
            content,
            context_path: context,
        });
    }
    current.clear();
}

impl SemanticChunkStrategy for OcrStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.ocr-text"
    }
    fn accepts(&self, input: &SemanticInput) -> bool {
        input.source_kind == "ocr"
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        Ok(Some(plain_blocks(&input.text, "ocr")))
    }
}

impl SemanticChunkStrategy for PlainStrategy {
    fn id(&self) -> &'static str {
        "builtin.chunker.plain-text"
    }
    fn accepts(&self, _input: &SemanticInput) -> bool {
        true
    }
    fn extract_blocks(&self, input: &SemanticInput) -> Result<Option<Vec<SemanticBlock>>> {
        let context = match input.source_kind.as_str() {
            "note" => vec!["Note:".into()],
            "tags" => vec!["Tags:".into()],
            _ => Vec::new(),
        };
        let blocks = plain_blocks(&input.text, &input.source_kind)
            .into_iter()
            .map(|mut block| {
                block.context_path = context.clone();
                block
            })
            .collect::<Vec<_>>();
        Ok(Some(blocks))
    }
}

fn plain_blocks(text: &str, kind: &str) -> Vec<SemanticBlock> {
    normalize_lines(text)
        .split("\n\n")
        .flat_map(|paragraph| {
            let paragraph = paragraph.trim();
            if paragraph.len() > MAX_EMBED_BYTES {
                paragraph
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            } else if paragraph.is_empty() {
                Vec::new()
            } else {
                vec![paragraph.to_string()]
            }
        })
        .map(|content| SemanticBlock {
            kind: kind.into(),
            content,
            context_path: Vec::new(),
        })
        .collect()
}

fn pack_blocks(
    blocks: Vec<SemanticBlock>,
    strategy_id: &str,
    strategy_version: &str,
    fallback_reason: Option<String>,
) -> Vec<SemanticChunk> {
    let mut chunks = Vec::new();
    let mut pending: Option<SemanticBlock> = None;
    let flush = |chunks: &mut Vec<SemanticChunk>, block: SemanticBlock| {
        chunks.extend(chunk_block(
            block,
            strategy_id,
            strategy_version,
            fallback_reason.clone(),
        ));
    };
    for block in blocks {
        let block = SemanticBlock {
            content: block.content.trim().to_string(),
            ..block
        };
        if block.content.is_empty() {
            continue;
        }
        if let Some(mut current) = pending.take() {
            let same_context = current.context_path == block.context_path;
            let combined = format!("{}\n\n{}", current.content, block.content);
            if same_context
                && contextual_text(&current.context_path, &combined).len() <= TARGET_EMBED_BYTES
            {
                current.content = combined;
                if current.kind != block.kind {
                    current.kind = "section".into();
                }
                pending = Some(current);
            } else {
                flush(&mut chunks, current);
                pending = Some(block);
            }
        } else {
            pending = Some(block);
        }
    }
    if let Some(block) = pending {
        flush(&mut chunks, block);
    }
    chunks
}

fn chunk_block(
    block: SemanticBlock,
    strategy_id: &str,
    strategy_version: &str,
    fallback_reason: Option<String>,
) -> Vec<SemanticChunk> {
    let prefix = context_prefix(&block.context_path);
    let available = MAX_EMBED_BYTES
        .saturating_sub(prefix.len())
        .saturating_sub(if prefix.is_empty() { 0 } else { 2 })
        .max(128);
    let bodies = if contextual_text(&block.context_path, &block.content).len() <= MAX_EMBED_BYTES {
        vec![block.content]
    } else {
        split_text_windows(
            &block.content,
            available,
            FALLBACK_OVERLAP_BYTES.min(available / 8),
        )
    };
    bodies
        .into_iter()
        .filter(|body| !body.trim().is_empty())
        .map(|body| SemanticChunk {
            embedding_text: contextual_text(&block.context_path, &body),
            display_text: body,
            kind: block.kind.clone(),
            context_path: block.context_path.clone(),
            strategy_id: strategy_id.into(),
            strategy_version: strategy_version.into(),
            fallback_reason: fallback_reason.clone(),
        })
        .collect()
}

fn contextual_text(context: &[String], content: &str) -> String {
    let prefix = context_prefix(context);
    if prefix.is_empty() {
        content.trim().to_string()
    } else {
        format!("{prefix}\n\n{}", content.trim())
    }
}

fn context_prefix(context: &[String]) -> String {
    if context.is_empty() {
        return String::new();
    }
    let value = if context.iter().all(|item| !item.contains(':')) {
        format!("Section: {}", context.join(" > "))
    } else {
        context.join("\n")
    };
    truncate_utf8(&value, MAX_CONTEXT_BYTES)
}

fn normalize_lines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_utf8(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].trim_end().to_string()
}

pub fn split_text_windows(text: &str, max_bytes: usize, overlap_bytes: usize) -> Vec<String> {
    debug_assert!(max_bytes > 0);
    debug_assert!(overlap_bytes < max_bytes);
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let hard_end = floor_char_boundary(text, (start + max_bytes).min(text.len()));
        let mut end = hard_end;
        if hard_end < text.len() {
            let window = &text[start..hard_end];
            let minimum = window.len() / 2;
            end = window
                .rfind("\n\n")
                .map(|index| index + start + 2)
                .filter(|index| *index - start >= minimum)
                .or_else(|| {
                    window
                        .rfind('\n')
                        .map(|index| index + start + 1)
                        .filter(|index| *index - start >= minimum)
                })
                .or_else(|| {
                    window
                        .char_indices()
                        .rev()
                        .find(|(index, value)| *index >= minimum && value.is_whitespace())
                        .map(|(index, value)| index + start + value.len_utf8())
                })
                .unwrap_or(hard_end);
        }
        if end <= start {
            end = hard_end;
        }
        let chunk = text[start..end].trim();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }
        if end >= text.len() {
            break;
        }
        let proposed = end.saturating_sub(overlap_bytes).max(start + 1);
        let next = ceil_char_boundary(text, proposed);
        start = if next >= end { end } else { next };
    }
    chunks
}

pub fn subdivide_chunk(chunk: &SemanticChunk, target_body_bytes: usize) -> Vec<SemanticChunk> {
    let prefix = context_prefix(&chunk.context_path);
    let available = target_body_bytes
        .min(
            MAX_EMBED_BYTES
                .saturating_sub(prefix.len())
                .saturating_sub(2),
        )
        .max(128);
    split_text_windows(
        &chunk.display_text,
        available,
        (available / 8).min(FALLBACK_OVERLAP_BYTES),
    )
    .into_iter()
    .map(|body| SemanticChunk {
        embedding_text: contextual_text(&chunk.context_path, &body),
        display_text: body,
        kind: chunk.kind.clone(),
        context_path: chunk.context_path.clone(),
        strategy_id: chunk.strategy_id.clone(),
        strategy_version: chunk.strategy_version.clone(),
        fallback_reason: Some("provider context limit required subdivision".into()),
    })
    .collect()
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

pub fn deduplicate_inputs(inputs: Vec<SemanticInput>) -> Vec<SemanticInput> {
    let mut selected = BTreeMap::<String, (u8, SemanticInput)>::new();
    let mut metadata = Vec::new();
    for input in inputs {
        if matches!(input.source_kind.as_str(), "note" | "tags") {
            metadata.push(input);
            continue;
        }
        let fingerprint = visible_fingerprint_text(&input);
        if fingerprint.is_empty() {
            continue;
        }
        let quality = strategy_quality(&input);
        match selected.get(&fingerprint) {
            Some((existing, _)) if *existing >= quality => {}
            _ => {
                selected.insert(fingerprint, (quality, input));
            }
        }
    }
    metadata.extend(selected.into_values().map(|(_, input)| input));
    metadata.sort_by_key(|input| input.source_ordinal);
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(mime: &str, text: &str, facets: &[(&str, Value)]) -> SemanticInput {
        SemanticInput {
            source_kind: "representation".into(),
            source_id: "representation-1".into(),
            representation_id: Some("representation-1".into()),
            artifact_id: None,
            mime_type: Some(mime.into()),
            format_family: Some("text".into()),
            facets: facets
                .iter()
                .map(|(id, payload)| SemanticFacet {
                    id: (*id).into(),
                    payload: payload.clone(),
                })
                .collect(),
            text: text.into(),
            source_ordinal: 0,
        }
    }

    #[test]
    fn html_uses_headings_ignores_scripts_and_packs_paragraphs() {
        let chunks = chunk_input(&input(
            "text/html",
            "<h1>Guide</h1><p>First paragraph.</p><script>secret()</script><p>Second paragraph.</p><ul><li>One item</li></ul><table><tr><th>Name</th><th>Role</th></tr><tr><td>Ada</td><td>Engineer</td></tr></table>",
            &[],
        ))
        .unwrap();
        assert!(chunks
            .iter()
            .any(|chunk| chunk.embedding_text.contains("Section: Guide")));
        assert!(chunks
            .iter()
            .any(|chunk| chunk.display_text.contains("First paragraph")));
        assert!(chunks
            .iter()
            .any(|chunk| chunk.display_text.contains("One item")));
        assert!(chunks
            .iter()
            .any(|chunk| chunk.embedding_text.contains("Columns: Name | Role")));
        assert!(!chunks
            .iter()
            .any(|chunk| chunk.embedding_text.contains("secret")));
    }

    #[test]
    fn markdown_carries_heading_context_and_code_language() {
        let chunks = chunk_input(&input(
            "text/markdown",
            "# Search\n\nMeaning text.\n\n```rust\nfn search() {}\n```",
            &[],
        ))
        .unwrap();
        assert!(chunks
            .iter()
            .any(|chunk| chunk.embedding_text.contains("Section: Search")));
        assert!(chunks
            .iter()
            .any(|chunk| chunk.embedding_text.contains("Language: rust")));
    }

    #[test]
    fn json_chunks_include_pointer_paths() {
        let value = serde_json::json!({"items": (0..2_000).collect::<Vec<_>>()});
        let chunks = chunk_input(&input("application/json", &value.to_string(), &[])).unwrap();
        assert!(chunks.len() > 1);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.embedding_text.contains("Path: /items/")));
    }

    #[test]
    fn table_repeats_headers_as_embedding_context() {
        let chunks = chunk_input(&input(
            "text/csv",
            "name,note\nAda,\"first, quoted\"\nLinus,second",
            &[],
        ))
        .unwrap();
        assert!(chunks
            .iter()
            .all(|chunk| chunk.embedding_text.contains("Columns: name | note")));
        assert!(chunks
            .iter()
            .all(|chunk| !chunk.display_text.contains("Columns:")));
        assert!(chunks
            .iter()
            .any(|chunk| chunk.display_text.contains("first, quoted")));
    }

    #[test]
    fn rtf_extracts_visible_text_and_rejects_unsafe_controls() {
        let chunks = chunk_input(&input(
            "text/rtf",
            r#"{\rtf1\ansi First paragraph.\par Second paragraph.}"#,
            &[],
        ))
        .unwrap();
        assert!(chunks
            .iter()
            .any(|chunk| chunk.display_text.contains("First paragraph")));
        assert!(chunks
            .iter()
            .all(|chunk| chunk.strategy_id == "builtin.chunker.rtf-blocks"));

        let fallback =
            chunk_input(&input("text/rtf", r#"{\rtf1\object\objdata unsafe}"#, &[])).unwrap();
        assert!(fallback
            .iter()
            .all(|chunk| chunk.strategy_id == "builtin.chunker.plain-text"));
        assert!(fallback.iter().all(|chunk| chunk.fallback_reason.is_some()));
    }

    #[test]
    fn invalid_inferred_json_falls_through_to_plain_text() {
        let facet = serde_json::json!({"schemaVersion": 1});
        let chunks = chunk_input(&input(
            "text/plain",
            "{not valid json but still searchable",
            &[("core.data.json", facet)],
        ))
        .unwrap();
        assert_eq!(chunks[0].strategy_id, "builtin.chunker.plain-text");
        assert!(chunks[0]
            .fallback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("json-tree")));
    }

    #[test]
    fn inferred_code_and_ocr_use_separate_bounded_strategies() {
        let code_facet = serde_json::json!({"schemaVersion":1,"language":"javascript"});
        let code = chunk_input(&input(
            "text/plain",
            "function first() { return 1 }\n\nfunction second() { return 2 }",
            &[("core.text.code", code_facet)],
        ))
        .unwrap();
        assert!(code
            .iter()
            .all(|chunk| chunk.strategy_id == "builtin.chunker.code-blocks"));
        assert!(code
            .iter()
            .all(|chunk| chunk.embedding_text.contains("Language: javascript")));

        let mut ocr = input(
            "text/plain",
            "First OCR paragraph.\n\nSecond OCR paragraph.",
            &[],
        );
        ocr.source_kind = "ocr".into();
        let ocr = chunk_input(&ocr).unwrap();
        assert!(ocr
            .iter()
            .all(|chunk| chunk.strategy_id == "builtin.chunker.ocr-text"));
        assert!(ocr.iter().all(|chunk| chunk.context_path.is_empty()));
    }

    #[test]
    fn metadata_labels_are_embedding_only() {
        let mut note = input("text/plain", "Remember this document", &[]);
        note.source_kind = "note".into();
        let chunks = chunk_input(&note).unwrap();
        assert!(chunks[0].embedding_text.starts_with("Note:\n\n"));
        assert_eq!(chunks[0].display_text, "Remember this document");
    }

    #[test]
    fn distinct_representation_content_is_retained() {
        let mut first = input("text/html", "<p>First source</p>", &[]);
        first.source_id = "first".into();
        let mut second = input("text/plain", "Second source", &[]);
        second.source_id = "second".into();
        let selected = deduplicate_inputs(vec![first, second]);
        assert_eq!(selected.len(), 2);
    }

    #[test]
    fn all_embedding_inputs_are_hard_bounded_and_unicode_safe() {
        let chunks = chunk_input(&input("text/plain", &"文🙂".repeat(2_000), &[])).unwrap();
        assert!(chunks.len() > 2);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.embedding_text.len() <= MAX_EMBED_BYTES));
        assert!(chunks
            .iter()
            .all(|chunk| std::str::from_utf8(chunk.embedding_text.as_bytes()).is_ok()));
    }

    #[test]
    fn equivalent_html_and_plain_sources_prefer_html() {
        let mut html = input("text/html", "<p>Hello world</p>", &[]);
        html.source_id = "html".into();
        let mut plain = input("text/plain", "Hello world", &[]);
        plain.source_id = "plain".into();
        let selected = deduplicate_inputs(vec![plain, html]);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].source_id, "html");
    }
}
