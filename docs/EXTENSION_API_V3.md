# Extension API v3.2

ClipsX is the host. Extensions are packaged WebAssembly components and optional
sandboxed detail/dialog UI assets. The current contract is
`schemaVersion = 3`, `contractRevision = 3`, `apiVersion = "^3.2"`, and
`clipsx:extension@3.2.0`. The host rejects other contract revisions. A fresh
local database at schema version 15 is required; ClipsX asks for an explicit
reset and never silently converts an older database.

## Error reporting

When the user enables desktop error reports, the host attributes unexpected
extension failures to the validated package and contribution that executed.
Reports distinguish installed package version from contribution version and
include the failure stage, safe reason code, and extension/provider/host origin.
Registry and developer-installed packages are covered; developer installs use
the telemetry source label `local`. Metadata is snapshotted before execution or
custom-view creation, so package changes cannot relabel an in-flight failure.

Durable job reports are emitted only on an authoritative terminal failure,
not on retries, waiting states, or cancellation. Custom-view error notifications
must pass the existing token, webview-label, and expiry checks; their arbitrary
message text is never sent to Sentry. Host-generated reports contain no clip
IDs, settings, operation inputs/outputs, or bridge tokens. Extensions do not
initialize Sentry, control reporting policy, or attach application metadata.
Repeated identical reports are rate limited without changing failure counters,
quarantine thresholds, job recovery, permissions, or the extension contract.

## One transformer path

On clip selection, ClipsX matches operations against the whole clip, preferring
the active representation and otherwise selecting a matching format deterministically.
Each setup gets an offline `assess` check: hidden, disabled with a reason, or ready.
The guest sees one matching representation and a format inventory (MIME, size,
storage kind), never every format's bytes or other history. Checks cannot use
network, models, package state or output effects. Tools and pins share decisions.

A run is one durable job. The pure `advance` export returns a next step or
completion. The host executes the step and calls `advance` with the saved
continuation and previous response. READ, MODEL_CALL and WRITE can occur in
whatever order the operation needs. Navigation and dialogs remain interactive.

Completion returns up to eight named typed outputs, 14 MiB combined, or no
output for an operation with a confirmed external write. Results belong to the
source clip and remain readable after restart or package removal. Only explicit
Save as new clip creates canonical history.

Optional completion `view-json` describes up to four tabs. Each has an ID, label,
layout (`single`, `split` or `stack`) and one or two panels referencing the exact
input or a named output:

```json
{
  "tabs": [
    {
      "id": "compare",
      "label": "Compare",
      "layout": "split",
      "panels": [{ "source": "input" }, { "source": "output", "outputId": "rewritten" }]
    }
  ]
}
```

ClipsX renders typed content and always retains an Output preview fallback.
The host owns result controls. Automatic work never copies or pastes. The job
snapshots its view, labels and controls, so they survive uninstall.

Operations inherit the package icon when they do not declare their own icon.
Specific operation icons take precedence; pinned buttons use current installed
icons rather than stale icon snapshots.

## Manifest

```toml
schemaVersion = 3
contractRevision = 3
packageId = "example.rewriter"
version = "2.0.0"
apiVersion = "^3.2"
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
`resultLifetime`, and `exposeInMenu` are not part of v3.2.

## Parameter presentation and Tools

Tools opens inside the preview card and groups operations by package. A package
appears once; its operations and built-in/user setups are selected inside its
workspace. Pins refer to a specific action or setup, remain device-local, and
are removed when the package or saved setup disappears. Disabling a package
does not erase its pin preferences.

Transformers may declare `parameterUi` entries in form order. Each entry has a
`field`, `label`, optional `description`, compatible `control` (`text`,
`textarea`, `select`, `checkbox`, `number`), optional `when = { field, equals }`,
and `required` while visible. References must be declared schema properties;
conditions compare a primitive value, cannot refer to the same field or form a
conditional chain, and cannot hide a globally required property. At most 32
entries and 16 KiB of metadata are accepted; labels are limited to 80 UTF-8
bytes and help text to 256. Metadata controls presentation, never capabilities.
Undescribed fields use host controls and readable labels.

```toml
[[contributions.parameterUi]]
field = "custom_instruction"
label = "Custom instruction"
control = "textarea"
when = { field = "preset", equals = "custom" }
required = true
```

Tools and saved-setup editing use the same form. Changing a controlling field
removes inactive values; Rust independently applies the same visibility and
required rules before saving or enqueueing. A built-in setup is immutable;
saving edited values creates a user setup. Saved edits require the expected
revision. A setup with missing required values must be completed and saved
before automation can select it.

A transformer may declare `setupSelectorParameter = "preset"`. This explicitly
binds the setup selector to a declared primitive enum parameter. Every built-in
setup must supply a valid value, and together they must cover every enum choice.
The bound field cannot have a visibility condition. Other parameters remain
editable even when their values came from a setup; transformers without this
metadata keep their ordinary enum controls.

The shared configuration workspace uses themed Radix selectors for grouped
built-in and saved setups. The bound parameter remains in the complete validated
values but is omitted from the parameter form. Saved setups show their defining
choice as read-only help. Select a different built-in setup to change that
choice and save a new configuration. Switching setups replaces the draft after
confirmation when it has unsaved changes. The name field appears only when
creating a setup or saving another copy.

Condition evaluation and control selection live in dedicated form modules.
Unsupported metadata is rejected. Future bounded condition operators or controls
must extend those modules and host validation together. Remote option providers
would require an explicit host capability; a control hint never permits network
access. These capabilities are not currently implemented. Stored parameters
remain plain validated values without component names or form state.

## Capture automation

An activation targets one transformer and declares representation matchers
for `clip_created`. A device-local, user-enabled rule selects all copied clips
or an exact platform/application ID, and a built-in or saved setup. The host resolves
and validates its parameters; rules do not expose a second parameter editor. The manifest filter and rule
intersect. Every accepted external capture occurrence is considered, including
a repeated copy of an existing clip. The host commits an activation intent
with the capture, then a coordinator evaluates eligibility and runs the same
transformer executor used by Tools. No guest or model work blocks capture.
Equivalent jobs reuse an outstanding or completed result; explicit Regenerate
creates another run.

Extension settings are the canonical automation editor. Tools' Manage automation
opens it with the selected setup; unsaved choices must be saved first. Rules
store `setupKind`, `setupRef`, and host-maintained parameter/label/view snapshots.
Editing a saved setup updates referencing rules and revisions in the same
transaction. Accepted capture intents and existing jobs keep their snapshots;
setup edits do not invalidate them. Deleting a setup disables its rules with
`setup_deleted`; incompatible package declarations leave rules inactive with
`setup_unavailable`. Live revocation, rule disablement and source deletion still
cancel unfinished work. Completed results remain readable.

Jobs waiting for external-write review count toward outstanding quotas and
participate in deduplication. An equivalent automatic capture cannot bypass the
pause by creating another job.

Source application IDs are normalized platform-specific keys, not publisher
proof and not the paste destination. Missing identity does not stop capture
or manual use; it prevents exact-app automation. Browser-hosted sites remain
the browser application. The same offline `assess` check evaluates the selected
input and validated parameters without effects. Facet-constrained activations wait for current detection
before disclosing input.

Background observation requires a separate checksum-bound grant and enabled
device rule. Source identity, generation, HTTP, and package state require
their own declared capabilities. A background run cannot navigate, show a
dialog, notify, write the clipboard, or paste. Package changes revoke grants.
Workers do not prompt for consent.

## Execution, storage, and recovery

Discovery reads package metadata without compiling components. Guest execution
prepares only an eligible package; installation validation and guest availability
checks remain required. Preparation uses the host's shared engine, in-memory cache,
and Wasmtime's persistent cache, with a successful fallback when disk caching is
unavailable.

Detection recovery tracks detector/representation pairs and detector versions.
Completed results, including empty facet lists, and unsupported outcomes are
terminal. Selector mismatches, oversized inputs, and guest-reported unsupported
inputs clear old facets in the same transaction. Startup batches only unfinished
pairs; explicit redetection can force all pairs. Operational failures retain their
existing retry and quarantine behavior. No package contract or execution limits
change with this recovery policy.

SQLite owns job state and deduplication. The coordinator executes one extension
transformation at a time, favors manual jobs, and periodically admits background
jobs. It revalidates source fingerprints, package checksum, live grants, enabled app rules,
state, and provider assignment before execution and completion. Cancellation
fences out late results. Interrupted jobs are recovered with bounded attempts;
provider unavailability waits and transient failures retry with bounded backoff.
Computation can repeat after a crash, but a job commits at most one output set.

Host failures preserve a safe reason separately from recovery policy. Input-size
and reported model-context limits fail without retry; missing configuration or
models wait; connection failures, provider timeouts, rate limits and server
errors use bounded retries. Guest execution deadlines are terminal. Retry
exhaustion retains the cause in `reason_code` as `retry_exhausted:<code>`.
Result tabs restore explanations from SQLite and link to generation settings or
permissions where appropriate. Action and scheduling IPC reject with structured
`{ code, recovery }` host failures, never raw provider or guest error messages.

Ollama generation enforces the existing 256 KiB prompt bound and requires a
completed stream. Explicit stream errors and invalid/incomplete responses cannot
produce successful partial results. Reported context errors remain distinct from
host size limits; ClipsX does not infer them from clip length. Output-token-limit
completion still reaches the extension as `completionReason: "length"`; it may
accept or reject that output. A rejection can explain that the preceding model
response reached its output limit. None of these errors authorize replay of a
confirmed or uncertain external write.

Outputs reuse artifact text and managed-file storage. Copy and Paste reconstruct
the complete output bundle. Binary previews use opaque host URLs. Promotion
creates a separate canonical clip with provenance in one transaction and
accepts an idempotency key. Source deletion cascades through unfinished work
and attached artifacts; completed bytes survive package removal.

A job freezes validated settings values, parameters, source, application and
package version. Editing settings changes future runs. Revocation remains live.

Before a write, the host journals its stable step ID and exact request. It saves
the response before continuing. Reliable idempotent destinations reuse the same
key on recovery. Interrupted non-idempotent delivery pauses as
`waiting_write_review`, never automatically resends, and displays partial outcomes.
Reads/model calls may repeat. Runs have a 125-second deadline, up to sixteen
steps and bounded request, response and continuation sizes.

Operations request host steps for model calls and HTTPS; direct mutating HTTPS
is rejected. Interactive actions retain the read broker. Package state writes
are validated and committed with successful jobs. The host owns provider assignment, credentials,
admission, and cancellation. Guests have no ambient history, filesystem, SQL,
clipboard, shell, or threads. Package state is device-local, schema validated,
quota bound, and committed with successful jobs. Rich settings and automation
rules remain device-local; only reviewed primitive settings are portable.

## Build and publication

Keep the package's WIT copy equal to the host WIT. Use
`clipsx-extension-tool pack`, `validate`, `inspect`, and `test` on the exact
archive. `registry-entry <archive> <release-url>` exports technical catalog
metadata, including string origin lists and reviewed portable-setting
declarations. `validate-registry <index.json>` uses Discover's actual catalog
parser and rejects an empty publication catalog; signature and archive verification
remain separate registry gates. First-party packages live in
[`clipsx-extensions`](https://github.com/azure06/clipsx-extensions).
Release archives are immutable. Registry metadata must match the archive's
identity, SHA-256 digest, and permission fingerprint; a protected signer
publishes the catalog index and signature together. The desktop app installs
only releases compatible with this contract.

User automation rules may select all copied clips with `application: null`, or
one exact safe source application. When both are enabled for an activation, the
exact rule takes precedence. All-clips rules also cover unknown application
identity, but remain subject to manifest representation/application filters and
background consent. Their label, parameters and default view are snapshotted at
capture like exact-app rules. Enabling automation does not process old history.
