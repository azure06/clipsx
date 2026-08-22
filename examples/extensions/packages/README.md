# Extension package output

This directory is a local, ignored destination for installable Extension API v2
archives. Package source lives in the adjacent example directories; the
repository does not track generated `.clipsx` files.

Build and validate an example for Developer Mode:

```powershell
npm run extension:pack -- examples/extensions/mermaid-viewer examples/extensions/packages/mermaid-viewer-1.0.1.clipsx
npm run extension:validate -- examples/extensions/packages/mermaid-viewer-1.0.1.clipsx
```

Published archives and their checksums belong in registry or release assets.
Repacking changes a checksum and intentionally invalidates remembered
external-data grants for a locally replaced package.
