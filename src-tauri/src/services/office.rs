use crate::services::intelligence::{ContentType, IntelligenceService};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfficeApp {
    Word,
    Excel,
    PowerPoint,
    Generic,
}

impl OfficeApp {
    pub fn as_metadata_value(self) -> &'static str {
        match self {
            Self::Word => "word",
            Self::Excel => "excel",
            Self::PowerPoint => "powerpoint",
            Self::Generic => "office",
        }
    }

    fn from_hints(
        native_source_app: &str,
        active_app_name: Option<&str>,
        ole_type: Option<&str>,
    ) -> Self {
        let native_lower = native_source_app.to_lowercase();
        let active_lower = active_app_name.unwrap_or_default().to_lowercase();
        let ole_lower = ole_type.unwrap_or_default().to_lowercase();

        if native_lower.contains("powerpoint")
            || active_lower.contains("powerpoint")
            || ole_lower.contains("slide")
            || ole_lower.contains("powerpoint")
        {
            return Self::PowerPoint;
        }

        if native_lower.contains("word")
            || active_lower.contains("word")
            || ole_lower.contains("word")
        {
            return Self::Word;
        }

        if native_lower.contains("excel")
            || active_lower.contains("excel")
            || ole_lower.contains("excel")
            || ole_lower.contains("biff")
            || ole_lower.contains("xml spreadsheet")
            || ole_lower.contains("workbook")
            || ole_lower.contains("worksheet")
        {
            return Self::Excel;
        }

        Self::Generic
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfficeKind {
    Spreadsheet,
    Document,
    Slides,
}

impl OfficeKind {
    pub fn as_metadata_value(self) -> &'static str {
        match self {
            Self::Spreadsheet => "spreadsheet",
            Self::Document => "document",
            Self::Slides => "slides",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfficeTableSource {
    Html,
    CsvText,
    PlainText,
}

impl OfficeTableSource {
    pub fn as_metadata_value(self) -> &'static str {
        match self {
            Self::Html => "html",
            Self::CsvText => "csv_text",
            Self::PlainText => "plain_text",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfficeTableData {
    pub source: OfficeTableSource,
    pub delimiter: Option<String>,
    pub rows: Option<usize>,
    pub columns: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfficeClassification {
    pub app: OfficeApp,
    pub kind: OfficeKind,
    pub table: Option<OfficeTableData>,
}

pub fn classify_office_payload(
    native_source_app: &str,
    active_app_name: Option<&str>,
    ole_type: Option<&str>,
    html_data: Option<&str>,
    extracted_text: &str,
) -> OfficeClassification {
    let app = OfficeApp::from_hints(native_source_app, active_app_name, ole_type);
    let html_table = html_data.and_then(detect_html_table);
    let delimited_text = detect_delimited_table(extracted_text);

    let kind = match app {
        OfficeApp::PowerPoint => OfficeKind::Slides,
        OfficeApp::Word => OfficeKind::Document,
        OfficeApp::Excel => OfficeKind::Spreadsheet,
        OfficeApp::Generic if html_table.is_some() || delimited_text.is_some() => {
            OfficeKind::Spreadsheet
        }
        OfficeApp::Generic => OfficeKind::Document,
    };

    let table = match kind {
        OfficeKind::Spreadsheet => build_table_data(html_table, delimited_text, extracted_text),
        OfficeKind::Document | OfficeKind::Slides => None,
    };

    OfficeClassification { app, kind, table }
}

fn build_table_data(
    html_table: Option<(usize, usize)>,
    delimited_text: Option<(String, usize, usize)>,
    extracted_text: &str,
) -> Option<OfficeTableData> {
    if let Some((rows, columns)) = html_table {
        return Some(OfficeTableData {
            source: OfficeTableSource::Html,
            delimiter: delimited_text
                .as_ref()
                .map(|(delimiter, _, _)| delimiter.clone()),
            rows: Some(rows),
            columns: Some(columns),
        });
    }

    if let Some((delimiter, rows, columns)) = delimited_text {
        return Some(OfficeTableData {
            source: OfficeTableSource::CsvText,
            delimiter: Some(delimiter),
            rows: Some(rows),
            columns: Some(columns),
        });
    }

    if extracted_text.trim().is_empty() {
        return None;
    }

    Some(OfficeTableData {
        source: OfficeTableSource::PlainText,
        delimiter: None,
        rows: None,
        columns: None,
    })
}

fn detect_delimited_table(text: &str) -> Option<(String, usize, usize)> {
    let detection = IntelligenceService::detect(text);
    if detection.detected_type != ContentType::Csv {
        return None;
    }

    let delimiter = detection.metadata["delimiter"].as_str()?.to_string();
    let rows = detection.metadata["rows"]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())?;
    let columns = detection.metadata["columns"]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())?;

    Some((delimiter, rows, columns))
}

fn detect_html_table(html: &str) -> Option<(usize, usize)> {
    let lower = html.to_lowercase();
    if !lower.contains("<table") {
        return None;
    }

    let rows = lower.matches("<tr").count();
    let columns = lower
        .split("<tr")
        .skip(1)
        .map(|row| row.matches("<td").count() + row.matches("<th").count())
        .max()
        .unwrap_or(0);

    if rows == 0 || columns == 0 {
        return None;
    }

    Some((rows, columns))
}

#[cfg(test)]
mod tests {
    use super::{
        classify_office_payload, detect_html_table, OfficeApp, OfficeKind, OfficeTableSource,
    };

    #[test]
    fn classifies_html_table_office_payload_as_spreadsheet() {
        let result = classify_office_payload(
            "Microsoft Excel",
            Some("Microsoft Excel"),
            Some("Biff12"),
            Some(
                "<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Pens</td><td>12</td></tr></table>",
            ),
            "",
        );

        assert_eq!(result.app, OfficeApp::Excel);
        assert_eq!(result.kind, OfficeKind::Spreadsheet);
        assert_eq!(
            result.table.as_ref().map(|table| table.source),
            Some(OfficeTableSource::Html)
        );
        assert_eq!(result.table.as_ref().and_then(|table| table.rows), Some(2));
        assert_eq!(
            result.table.as_ref().and_then(|table| table.columns),
            Some(2)
        );
    }

    #[test]
    fn classifies_delimited_text_office_payload_as_spreadsheet() {
        let result = classify_office_payload(
            "Microsoft Office",
            Some("Microsoft Excel"),
            Some("Native"),
            None,
            "name\tage\nalice\t30\nbob\t25",
        );

        assert_eq!(result.app, OfficeApp::Excel);
        assert_eq!(result.kind, OfficeKind::Spreadsheet);
        assert_eq!(
            result.table.as_ref().map(|table| table.source),
            Some(OfficeTableSource::CsvText)
        );
        assert_eq!(
            result
                .table
                .as_ref()
                .and_then(|table| table.delimiter.as_deref()),
            Some("\t")
        );
        assert_eq!(result.table.as_ref().and_then(|table| table.rows), Some(3));
        assert_eq!(
            result.table.as_ref().and_then(|table| table.columns),
            Some(2)
        );
    }

    #[test]
    fn classifies_word_payload_as_document() {
        let result = classify_office_payload(
            "Microsoft Word",
            Some("Microsoft Word"),
            Some("Embed Source"),
            None,
            "Quarterly report body",
        );

        assert_eq!(result.app, OfficeApp::Word);
        assert_eq!(result.kind, OfficeKind::Document);
        assert_eq!(result.table, None);
    }

    #[test]
    fn keeps_word_table_payload_as_document() {
        let result = classify_office_payload(
            "Microsoft Office",
            Some("Microsoft Word"),
            Some("Embed Source"),
            Some("<table><tr><th>Name</th></tr><tr><td>Pens</td></tr></table>"),
            "Name\tQty\nPens\t12",
        );

        assert_eq!(result.app, OfficeApp::Word);
        assert_eq!(result.kind, OfficeKind::Document);
        assert_eq!(result.table, None);
    }

    #[test]
    fn detects_html_table_dimensions() {
        let table = detect_html_table(
            "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
        );

        assert_eq!(table, Some((2, 2)));
    }
}
