# Microsoft Store promotional graphics

The current set is in `v2/`: six separate 1920 × 1080 PNG compositions with editable,
self-contained SVG sources. It uses six user-supplied Windows captures of
Extensions, Intelligence, and Markdown previews in dark and light mode. Code previews are excluded.
The main page leads each theme group: light images 01–03, dark images 04–06.

| PNG | Theme | Caption |
| --- | --- | --- |
| `v2/01-light-main.png` | Light | A clearer view of your notes. |
| `v2/02-light-extensions.png` | Light | More ways to work with clips. |
| `v2/03-light-intelligence.png` | Light | Your models. Your machine. |
| `v2/04-dark-main.png` | Dark | Your notes, beautifully readable. |
| `v2/05-dark-extensions.png` | Dark | Extend your clipboard. |
| `v2/06-dark-intelligence.png` | Dark | Choose your local intelligence. |

The `upload/` folder contains the six numbered screenshot PNGs and the box/poster art.
Upload numbered images individually in Screenshots. In Store logos, choose one
box-art size and the poster:

| Art | Size | Store field |
| --- | --- | --- |
| `box-art-brand-blue-1080x1080.png` | 1080 × 1080 | 1:1 Box art, smaller alternative |
| `box-art-brand-blue-2160x2160.png` | 2160 × 2160 | 1:1 Box art, preferred export |
| `poster-art-1440x2160.png` | 1440 × 2160 | 2:3 Poster art |

Box art uses the identity-studio Brand Blue mark on its light gradient tile.
The light poster uses the Ink mark and the light main-page capture. Art SVG
sources are in `v2/art/`. Run `create-art.mjs`
after `create-assets.mjs` to regenerate the art and its upload copies.
The renderer refreshes these copies when generating the layouts.
`v2/contact-sheet.png` is a review preview only.
Each numbered SVG embeds its screenshot and logo; it can be edited without
external image files. The screenshot is uniformly scaled, preserving its
original aspect ratio. A 12 px corner mask removes the captured desktop pixels
outside the app's rounded outline; the UI interior is unchanged.

The backgrounds use the ClipsX navy, blue and violet palette. The corner brand
marks use identity-studio's exact geometry and its adaptive monochrome pair:
Pearl on dark backgrounds, Ink on light backgrounds. The geometry comes from
`clipsx-web/src/components/brand/IconLab.tsx`. In-app icons are unchanged.
The Linux Snap banner is a branding reference; its Linux captures are not used.
AI captions identify Ollama and separately installed models as prerequisites.
These graphics are listing media, not release certification evidence.

`create-assets.mjs` renders the layouts using the workspace's bundled Sharp
dependency, the captures in `v2/inputs/`, and the sibling website's icon geometry. Existing
SVGs are self-contained and do not require that renderer to view or edit them.
Review the graphics before updating the Microsoft Store submission.
