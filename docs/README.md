# ClipsX documentation

Use these documents in this order:

1. [V1_V2_GAP_ANALYSIS.md](V1_V2_GAP_ANALYSIS.md) — evidence-backed baseline, resolved gaps, remaining gaps, and detailed recovery phases.
2. [UI_PARITY.md](UI_PARITY.md) — authoritative user-facing release gate and current status by workflow.
3. [ROADMAP.md](ROADMAP.md) — dependency order and milestone sequencing.
4. [ARCHITECTURE.md](ARCHITECTURE.md) — stable design, ownership boundaries, contracts, and invariants.
5. [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md) — platform-specific known gaps and required clipboard/desktop tests.
6. [RELEASE.md](RELEASE.md) — release prerequisites and final smoke checklist.

Supporting references:

- [LEGACY_V1_REFERENCE.md](LEGACY_V1_REFERENCE.md) — how to use the archived V1 source without restoring its architecture.
- [EXTENSION_API_V1.md](EXTENSION_API_V1.md) — frozen extension package, WIT, sandbox, and failure contracts.
- [platform-format-matrix.json](platform-format-matrix.json) — normative capture/reconstruction format contract.

## Status vocabulary

All delivery documents use the same terms:

| Status | Meaning |
|---|---|
| **Verified** | Implemented and its stated acceptance gate passes. A qualifier such as **backend** or **automated** limits the claim to that layer. |
| **Implemented — validation pending** | Code and wiring exist, but the required platform/desktop gate has not run. |
| **Partial** | Some layers exist, but the user workflow or required contract is incomplete. |
| **Missing** | Required parity behavior has no current implementation. |
| **Decision required** | The implementation and prior behavior differ; product policy must be fixed before release. |
| **Intentional current limitation** | Behavior is deliberately bounded and must not be advertised more broadly. |
| **Deferred/excluded** | Deliberately outside the current parity target. |

Backend code existing by itself is never enough for **Verified** user-facing status.

## Current execution point

- Recovery R0, IPC/startup boundary: **Verified** by automated tests.
- Recovery R1, desktop host integration: **Implemented — validation pending**.
- Recovery R2, typed presentation boundary: **Next**.
- Recovery R3–R7: blocked in dependency order behind R2, as described in the roadmap.

When implementation changes architecture or a status gate, update the owning document in the same change. Avoid copying detailed status into `ARCHITECTURE.md`; link to the parity matrix or roadmap instead.
