# Content Actions Strategy

## 🎯 Goal
Define a comprehensive set of actions for every content type, categorized by where they appear in the UI.

## 🏗️ Action Locations
1.  **Primary Toolbar (Header)**: The top 2-3 most frequent actions (icon-only).
2.  **Context Menu (Right-Click / Overflow)**: The full list of available actions.
3.  **Passive/Status**: Information displayed in the footer or metadata, not clickable.

---

## 🧩 Content Type Matrix

### 1. 📄 Text (Default)
**Primary:**
-   `Copy`
-   `Edit`
-   `Delete`

**Context Menu:**
-   `Copy as Plain Text` (Strip formatting)
-   `Pin / Unpin`
-   `Add to Favorites`
-   `Paste` (if compatible)
-   *Future:* `Summarize (AI)`, `Fix Grammar`, `Translate`

---

### 2. 🔗 URL (Link)
**Primary:**
-   `Open in Browser` (Default)
-   `Copy Link`
-   `Share`

**Context Menu:**
-   `Copy Markdown Link` (`[Title](URL)`)
-   `Copy Minified/Shortened`
-   `Archive (Wayback Machine)`
-   `Run Security Check` (VirusTotal)

---

### 3. 💻 Code
**Primary:**
-   `Copy Code`
-   `Save as Gist / File`
-   `Delete`

**Context Menu:**
-   `Copy as Image` (Carbon.now.sh style)
-   `Minify / Prettify` (Toggle)
-   `Explain Code (AI)`
-   `Open in VS Code` (if file path known)

**Passive:**
-   Language detection (e.g., "TypeScript")
-   Line count

---

### 4. 🎨 Color
**Primary:**
-   `Copy Hex`
-   `Copy RGB`
-   `Copy HSL`

**Context Menu:**
-   `Copy CSS` (`color: #...`)
-   `Copy SwiftUI` (`Color(...)`)
-   `Generate Palette` (Complementary/Analogous colors)

---

### 5. 🖼️ Image
**Primary:**
-   `Copy Image`
-   `Save to File`
-   `Open in Default Viewer`

**Context Menu:**
-   `Copy Text (OCR)`
-   `Convert to PNG/JPG`
-   `Resize`
-   `Remove Background`

**Passive:**
-   Dimensions (e.g., 1920x1080)
-   File size

---

### 6. 📁 Path (File/Folder)
**Primary:**
-   `Open File/Folder`
-   `Reveal in Explorer/Finder`
-   `Copy Absolute Path`

**Context Menu:**
-   `Open in Terminal`
-   `Copy File Content`
-   `Get Info`

---

### 7. 📧 Email
**Primary:**
-   `Compose Email` (mailto:)
-   `Copy Address`

**Context Menu:**
-   `Copy Domain` (@gmail.com)
-   `Add to Contacts`

---

### 8. 📊 CSV / Data
**Primary:**
-   `Copy as CSV`
-   `Convert to JSON`
-   `View as Table`

**Context Menu:**
-   `Copy as Markdown Table`
-   `Plot Chart` (Future)

---

### 9. 🧮 Math
**Primary:**
-   `Copy Result` (e.g., "18")
-   `Copy Equation` (e.g., "9 + 9")

**Context Menu:**
-   `Copy Full` ("9 + 9 = 18")

**Passive:**
-   Result preview in status bar

---

## 🛠️ Global Actions (All Types)
-   `Delete`
-   `Pin`
-   `Favorite`
-   `Add Tag`
