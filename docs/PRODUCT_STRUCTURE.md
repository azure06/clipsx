# Product structure

This document defines the target navigation and settings ownership for the remaining pre-release work. It is organized by the question a user is trying to answer.

## Navigation map

```text
Clips
├─ History
└─ Preview                         resizable device-local split

Intelligence
├─ Overview                        Is everything working?
├─ Search                          What content and syntax does search use?
├─ Models                          Which local models power embeddings/generation?
├─ Indexing                        What is pending, failed, or rebuildable?
└─ OCR                             Is text extraction available and healthy?

Extensions
├─ Installed                       What is installed and enabled?
│  └─ <package>
│     ├─ Overview                  Identity, version, update, enablement
│     ├─ Settings                  Manifest-declared non-secret settings
│     ├─ Permissions               Declared access, grants, credentials
│     ├─ Actions                   Placement, pinning, shortcuts
│     └─ Diagnostics               Compatibility, failures, recovery
├─ Discover                        What can I install?
├─ Built-ins                       What ships with ClipsX?
└─ Developer                       Local packages, validation, diagnostics

Settings
├─ General                         Appearance, language, window behavior
├─ Clipboard                       Capture and paste behavior, exclusions
├─ Keyboard                        App-wide and built-in action shortcuts
├─ Storage                         Retention and size limits
├─ Privacy                         Clearing and sensitive-data behavior
├─ Sync                            Status, scope, conflicts, devices
├─ Account                         Identity and authentication
└─ Advanced                        Autostart, updater, diagnostics, reset/import/export
```

## Placement rules

| User question | Owner | Does not belong in |
| --- | --- | --- |
| Can search find this content? | Intelligence / Search | Extensions |
| Is Ollama connected? | Intelligence / Models | Extension settings |
| Why are embeddings pending? | Intelligence / Indexing | Extensions footer |
| How do I configure one package? | Extension package detail | Global Settings |
| Which key runs an extension action? | Extension detail / Actions | Installed-list footer |
| Which key opens ClipsX or runs a built-in action? | Settings / Keyboard | Intelligence |
| Is configuration synchronized? | Settings / Sync | Account details |
| Is a package broken or incompatible? | Extension detail / Diagnostics | Developer Mode only |

Main list pages show identity, health, and the next action. Configuration and diagnostics live on detail pages. Future or unavailable capabilities do not occupy full settings sections; they appear only where their status changes a current decision.

## Settings ownership

SQLite remains the persistence layer. JSON is the typed value and import/export format, not a second live settings store.

| Scope | Examples | Storage and sync rule |
| --- | --- | --- |
| Profile, syncable | language, theme, search behavior, non-secret package settings, desired packages, enablement, shortcuts | Namespaced typed records in SQLite; eligible for account sync |
| Device-local | window bounds, history/preview ratio, autostart, capture limits, local provider endpoint/model and its meaning-similarity floor, local package path | `config_device_values` or a relational device-owned table; never copied automatically to another device |
| Secret | provider/API credentials | OS credential store only; never exported or synchronized as ordinary settings |
| Consent | checksum-bound extension grants and invocation tokens | Local security state; never synchronized; package updates require fresh consent |
| Operational | package quarantine, provider health, pending jobs, sync cursor | Relational local state; rebuilt or reconciled, not treated as preferences |
| Derived | OCR, FTS projections, chunks, embeddings, previews | Rebuildable local data; never settings and not part of settings sync |

Extension settings are keyed by stable `packageId` and manifest `settingId`, validated by the host, and retained independently from package bytes. Removing a package must offer an explicit choice to retain or delete its non-secret settings; credentials and grants are removed by default.

## Sync boundary

The first release syncs configuration, not clipboard content.

```text
Local typed setting
  -> classify profile/device/secret/operational
  -> append profile change with record revision + device ID
  -> authenticated remote profile store
  -> merge per record, preserve tombstones
  -> validate through the owning subsystem
  -> apply locally
```

Sync includes profile settings, extension installation intent, compatible requested version, extension enablement, non-secret extension settings, and app/extension shortcuts. A receiving device downloads and validates package bytes through the registry; package archives are not synchronized directly.

Sync excludes clips, managed files, local endpoints/models, machine integration, credentials, permission grants, invocation tokens, caches, indexes, jobs, and diagnostics. Conflict resolution is record-level, deterministic, and visible in Sync diagnostics; whole-file or whole-profile last-write-wins is not acceptable.

## Integrity invariants

| Mutation | Required result |
| --- | --- |
| Delete clip / clear / retention | Cascade representations, facets, compact views, OCR artifacts/jobs, search documents/chunks/embeddings/jobs, tag links; enqueue final managed-file deletion |
| Edit note | Rebuild lexical projection and enqueue the active semantic generation |
| Add/remove/delete tag | Refresh every affected clip's lexical and semantic projection |
| OCR/extraction completes or changes | Refresh search projection and invalidate/requeue affected semantic chunks |
| Extension update/removal | Invalidate its derived facets/views and grants without mutating canonical clip content |

The schema already provides clip-owned cascades for the current derived tables. Release work must add mutation-level tests that prove the full invariant and detect future tables that omit ownership cleanup.

## Shortcut model

One command registry should describe built-in and extension actions. Each command has a stable ID, context predicate, default shortcut, user override, conflict result, and discoverable label. UI handlers consume the registry rather than defining unrelated hard-coded keys.

Current hard-coded behavior that must enter the audit includes search focus, history navigation, numbered activation, copy, open in editor, favorite, pin, delete, representations, transform actions, and extension actions. Context-only commands such as opening links, composing email, calling a phone number, tags, renderer/view switching, and panel resizing need an explicit decision: configurable shortcut, menu-only, or intentionally unbound.
