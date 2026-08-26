-- Validated contribution icons are package-owned derived UI data. Cache each
-- themed pair once per installed contribution; per-clip compact models retain
-- only their bounded presentation data and renderer reference.
CREATE TABLE extension_contribution_icons (
    extension_id TEXT NOT NULL REFERENCES extension_installs(id) ON DELETE CASCADE,
    contribution_id TEXT PRIMARY KEY NOT NULL,
    light_svg_data_url TEXT NOT NULL CHECK (length(light_svg_data_url) BETWEEN 1 AND 175000),
    dark_svg_data_url TEXT CHECK (dark_svg_data_url IS NULL OR length(dark_svg_data_url) BETWEEN 1 AND 175000),
    scale_percent INTEGER NOT NULL CHECK (scale_percent BETWEEN 75 AND 200),
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_extension_contribution_icons_extension
    ON extension_contribution_icons(extension_id);
