# Snap Store assets

Store listing media for ClipsX. Screenshots and video show the released Linux
0.1.3 executable under WSLg/X11 with software rendering, an isolated profile,
and sample clipboard content. AI search is unconfigured in these captures.
These assets do not certify strict Snap confinement compatibility.

| File | Content |
| --- | --- |
| `01-markdown.png` | Light theme: history and Markdown preview |
| `02-json.png` | Light theme: JSON preview |
| `03-search.png` | Light theme: text search and a matching meeting note |
| `04-link.png` | Light theme: website link preview |
| `05-dark-markdown.png` | Dark theme: Markdown preview |
| `06-dark-json.png` | Dark theme: JSON preview |
| `clipsx-linux-demo.mp4` | Silent 28-second tour of previews, search and copying |
| `featured-banner.png` | Featured banner ready for upload |
| `featured-banner.svg` | Self-contained vector source for the banner |

Screenshots and video are 1320 × 720, preserving the app's original 11:6 aspect
ratio. The video uses H.264, 25 fps, yuv420p and fast-start MP4 metadata. Snapcraft's
video field requires a hosted URL; the MP4 is the local source asset.

The banner is 1920 × 640 (3:1) and uses the website's Space Grotesk typography,
navy background and blue-violet accents. Its logo and actual app preview are
retained without distortion. The decorative background was generated with the
built-in image-generation tool; the composition is preserved in the SVG.

Use PNGs for uploads. Every PNG is below the displayed 2 MB listing limit.
Review the media before reuse when application behavior or branding changes.
The existing application icon is in
[`src-tauri/icons/128x128@2x.png`](../../src-tauri/icons/128x128@2x.png).
