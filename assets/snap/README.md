# Snap packaging

Listing screenshots, the demo video and the featured banner are stored in
[store-assets/](store-assets/README.md).

The recipe wraps the immutable published Linux x64 Debian executable; it does
not compile ClipsX. The download is pinned to its SHA-256 checksum. Updating
the version requires updating the source URL and checksum together.

Build from the repository root with Snapcraft and an initialized LXD provider:

```sh
snapcraft pack --use-lxd
```

The package uses strict confinement, core24 and the GNOME desktop runtime.
ClipsX runs through X11. OCR includes English and Japanese language data.
Removable-media and password-manager-service connections may require manual
connection on the test desktop:

```sh
sudo snap install ./clipsx_0.1.3_amd64.snap --dangerous
sudo snap connect clipsx:password-manager-service
sudo snap connect clipsx:removable-media
snap run clipsx
```

This recipe is a development package, not a certified release. Before uploading
to edge, test the exact installed snap: startup, tray, clipboard capture/output,
global shortcut, OCR, extensions, authentication/deep links, restart and data
retention. WSL reports partial confinement and cannot establish normal Linux
desktop sandbox compatibility. Autostart and the application's updater also
require verification: Snap refresh owns package updates and the package is
read-only. See the [release requirements](../.agents/skills/clipsx-release/references/operations.md)
for applicable installed checks. Promote to stable only after resolving the
format-specific checks and changing the grade to stable.

Authenticate interactively in Ubuntu without sharing credentials in chat.
For a system without a keyring, export narrowly scoped credentials outside
the repository:

```sh
umask 077
mkdir -p ~/.config/clipsx-snap
snapcraft export-login ~/.config/clipsx-snap/store.credentials \
  --snaps clipsx --channels edge --acls package_access,package_push,package_release
export SNAPCRAFT_STORE_CREDENTIALS="$(cat ~/.config/clipsx-snap/store.credentials)"
snapcraft whoami
snapcraft upload ./clipsx_0.1.3_amd64.snap
snapcraft status clipsx
```

Uploading without `--release` creates an unreleased Store revision. After the
installed checks pass, upload with `--release edge` to make a revision available
to testers. Development-grade packages cannot be promoted to stable.

Store credentials stay outside source control. Successful upload and store
review must be verified before claiming availability.
