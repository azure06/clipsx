# Extension API v3.1

ClipsX is the host. Extensions are packaged WebAssembly components and optional
sandboxed detail/dialog UI assets. The current contract is
`schemaVersion = 3`, `contractRevision = 2`, `apiVersion = "^3.1"`, and
`clipsx:extension@3.1.0`. The host rejects other contract revisions. A fresh
local database at schema version 12 is required; ClipsX asks for an explicit
reset and never silently converts an older database.

## One transformer path

A transformer receives one host-selected representation, validated parameters,
bounded invocation context, and only its declared broker capabilities. It
returns one to eight typed output representations, up to 14 MiB combined.
Every run is a SQLite-backed extension job. Successful outputs are stored as
clip-owned artifacts, and each job appears as a tab alongside the source
clip's Text, HTML, and other views. The tab survives navigation, restart,
package disablement, update, and uninstall. Deleting the source removes its
jobs and outputs. A result is not a canonical history entry until the user
chooses **Save as new clip**.

```text
Tools → transformer/setup → parameter form → Run
      → host job → guest transform → artifact outputs → clip result tab
Capture rule → same job executor, without clipboard or paste effects
```

The transformer declares up to four named result presentations. Each composes
the host-provided `input` and `output` modules as `single`, `split`, or `stack`.
The host renders each typed output, including HTML and source views; the
extension chooses the available arrangements and their labels. `input` is
always the exact representation supplied to the transformer. Presentation
declarations are snapshotted on the job so tabs survive uninstall. Guests
cannot replace the source bytes or inject markup into host controls. Without
a declaration, the host offers Result and Compare. The guest may declare
which of Copy, Paste, Save as new clip, and Regenerate the host should show.
Cancel, Retry, and Delete follow job state and are host controls. Paste obeys
ClipsX's normal paste policy. Automatic jobs never copy, paste, or promote.

## Manifest

```toml
schemaVersion = 3
contractRevision = 2
packageId = "example.rewriter"
version = "2.0.0"
apiVersion = "^3.1"
displayName = "Rewriter"

[permissions]
selectedInput = true
providers = ["generation.text"]

[[contributions]]
id = "rewrite"
kind = "transformer"
displayName = "Rewrite"
execution = "capability_backed"
parameterSchema = { type = "object", properties = { preset = { type = "string", enum = ["business", "casual"] } }, required = ["preset"], additionalProperties = false }
defaultView = "compare"
resultControls = ["copy", "paste", "save_as_clip", "regenerate"]

[[contributions.resultPresentations]]
id = "result"
displayName = "Rewrite"
layout = "single"
modules = ["output"]

[[contributions.resultPresentations]]
id = "compare"
displayName = "Compare"
layout = "split"
modules = ["input", "output"]

[[contributions.setups]]
id = "business"
displayName = "Business"
parameters = { preset = "business" }

[[contributions.matchers]]
mimeTypes = ["text/plain"]
```

Built-in setups are named fixed parameter fragments declared by the package.
ClipsX renders the remaining parameter fields from the bounded schema and
validates the complete value before a run. Users may also save their own named
setups locally. Saved setups store a label, parameters, and preferred view,
not generated output. Editing a setup never changes existing result tabs.
Incompatible setups are shown as unavailable after an update; uninstall
removes saved setups, but retained result tabs remain readable.

The manifest also supports detectors, source renderers, non-transform actions,
capture activations, package settings, and declared package state. A non-
transform action may open a declared HTTPS destination, notify, or open a
declared dialog. Transformer preset actions, action output dispositions,
`resultLifetime`, and `exposeInMenu` are not part of v3.1.

## Capture automation

An activation targets one transformer and declares representation matchers
for `clip_created`. A device-local, user-enabled application rule selects an
exact platform/application ID and parameters. The manifest filter and rule
intersect. Every accepted external capture occurrence is considered, including
a repeated copy of an existing clip. The host commits an activation intent
with the capture, then a coordinator evaluates eligibility and runs the same
transformer executor used by Tools. No guest or model work blocks capture.
Equivalent jobs reuse an outstanding or completed result; explicit Regenerate
creates another run.

Source application IDs are normalized platform-specific keys, not publisher
proof and not the paste destination. Missing identity does not stop capture
or manual use; it prevents exact-app automation. Browser-hosted sites remain
the browser application. The optional `prepare-transform` export may skip
or refine validated parameters without HTTP, generation, state writes, or
output effects. Facet-constrained activations wait for current detection
before disclosing input.

Background observation requires a separate checksum-bound grant and enabled
device rule. Source identity, generation, HTTP, and package state require
their own declared capabilities. A background run cannot navigate, show a
dialog, notify, write the clipboard, or paste. Package changes revoke grants.
Workers do not prompt for consent.

## Execution, storage, and recovery

SQLite owns job state and deduplication. The coordinator executes one extension
transformation at a time, favors manual jobs, and periodically admits background
jobs. It revalidates source fingerprints, package checksum, grants, configuration,
state, and provider assignment before execution and completion. Cancellation
fences out late results. Interrupted jobs are recovered with bounded attempts;
provider unavailability waits and transient failures retry with bounded backoff.
Computation can repeat after a crash, but a job commits at most one output set.

Outputs reuse artifact text and managed-file storage. Copy and Paste reconstruct
the complete output bundle. Binary previews use opaque host URLs. Promotion
creates a separate canonical clip with provenance in one transaction and
accepts an idempotency key. Source deletion cascades through unfinished work
and attached artifacts; completed bytes survive package removal.

The WIT broker exposes bounded structured generation requests, declared HTTPS,
and declared package state keys. The host owns provider assignment, credentials,
admission, and cancellation. Guests have no ambient history, filesystem, SQL,
clipboard, shell, or threads. Package state is device-local, schema validated,
quota bound, and committed with successful jobs. Rich settings and automation
rules remain device-local; only reviewed primitive settings are portable.

## Build and publication

Keep the package's WIT copy equal to the host WIT. Use
`clipsx-extension-tool pack`, `validate`, `inspect`, and `test` on the exact
archive. First-party packages live in
[`clipsx-extensions`](https://github.com/azure06/clipsx-extensions).
Release archives are immutable. Registry metadata must match the archive's
identity, SHA-256 digest, and permission fingerprint; a protected signer
publishes the catalog index and signature together. The desktop app installs
only releases compatible with this contract.
