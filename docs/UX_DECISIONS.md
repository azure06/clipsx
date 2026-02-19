# UX Design & Decisions

*Last Updated: February 19, 2026*

This document outlines the design decisions for core interactions in Clips Next, adhering to the "Simplicity & Power" philosophy.

## 1. History View Layout

### Decision: **Compact Master-Detail**
To maximize information density while maintaining clarity, we adopt a strict **Master-Detail** layout.

#### A. The List (Master)
-   **Height**: Fixed, compact height (single line text).
-   **Content**:
    -   **Left**: Type Icon + Detected Type label (minimal width).
    -   **Middle**: Truncated text preview (1 line).
    -   **Right**: Timestamp or Shortcut hint (fades in on hover/selection).
-   **Density**: Maximize visible items (e.g., 10-15 items visible at once without scrolling).

#### B. The Preview (Detail)
-   **Location**: Fixed side panel (Right).
-   **Content**: Full content rendering.
    -   **Header**: Full metadata, timestamps, tags.
    -   **Body**: Syntax-highlighted code, full image, rendered Markdown/HTML.
    -   **Footer**: Action buttons (Copy, Open, etc.).

## 2. Visual Styling

### Decision: **Vibrant Selection State**
To make the active item pop and feel "premium":
-   **Gradient Background**: A linear gradient from **Blue to Violet** (`bg-gradient-to-r from-blue-500/20 to-violet-500/20`).
-   **Border**: Subtle matching border or glow.
-   **Text**: White or high-contrast text for the selected item.
-   **Animation**: Smooth transition on hover and selection (200ms ease-out).

## 3. Interaction Operations

### Decision: **Selection-First**
-   **Single Click**: **Selects** the item and updates the Preview Pane. Does NOT close the window or copy.
-   **Double Click**: **Copies** the item (or performs default action) and optionally closes the window.
-   **Keyboard (Enter)**: Copies the selected item.
-   **Keyboard (Arrows)**: Moves selection up/down.

## 4. Search & Filtering

### Decision: **Unified Smart Search**
-   **Single Input**: One search bar for everything.
-   **Syntactic Filters**:
    -   `type:image` or `/image` -> Filters by `detected_type = 'image'`
    -   `@date` -> Filters by `detected_type` in ('date', 'timestamp')
-   These filters are parsed from the query string and converted into SQL parameters.

## 5. Removed Features
-   **Visual "Recents" Rack**: Removed in favor of a simpler, denser list view. Users preferred a unified vertical flow.
