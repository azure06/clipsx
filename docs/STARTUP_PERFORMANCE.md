# ClipsX release startup measurements

Measured 2026-10-01 on Windows 10.0.26200, Intel Core Ultra 7 255H, 16 logical CPUs,
31 GiB RAM. Ten release launches before and ten after, using the same isolated app
identity and a coherent SQLite backup of the existing database: 21 clips, six
enabled extensions. Application data and the running development app were preserved.

The after series follows one convergence/warm-up launch on the original fixture.
That launch recorded 36 missing unsupported outcomes. Warm-up runs and debug
measurements are excluded from the table. No builds ran during measured launches.

## Medians

| Measurement                                            |      Before |       After |
| ------------------------------------------------------ | ----------: | ----------: |
| First history from process launch                      |    737.6 ms |    695.4 ms |
| First history from webview navigation                  |    400.5 ms |    365.2 ms |
| Initial history query                                  |     16.5 ms |     16.5 ms |
| Foundation preparation                                 |      5.0 ms |      4.5 ms |
| Repository open/recovery                               |      3.5 ms |      3.0 ms |
| Extension stale recovery                               |   3687.0 ms |      4.5 ms |
| Component preparation per request                      |    266.0 ms |      2.0 ms |
| Native CPU used in approximately the first ten seconds | 7.211 CPU s | 0.586 CPU s |
| Stale recovery passes per restart                      |          36 |           0 |
| Component preparations per restart                     |       10–11 |           1 |
| Fresh component compilations per restart               |       10–11 |           0 |

First-history launch median improved 5.7%; native CPU consumption fell 91.9%. The history query did not worsen. Every after launch reported zero stale recovery work and a persistent-cache hit for its one required component. The guest-call regression test independently verifies zero detection calls after reopening an unchanged repository.

## Method and limits

The first-history metric uses the local Performance API mark
`clipsx.first-history-paint`, taken after two animation frames with a nonempty
history mounted. It is a render/paint proxy, not pixel detection. Process-launch
latency includes process creation and WebView2 startup. The same mark was added to
the baseline benchmark copy. Existing timing records were enabled below their
release logging thresholds in both copies, and baseline component preparation
received the same timer. These are benchmark-only logging changes.

CPU samples use Windows process times at roughly 200 ms intervals and report
cumulative native app CPU-seconds around ten seconds. WebView2 child-process CPU,
whole-device power, and memory were not measured. The paint improvement is modest
and this ten-run series is not a claim of statistical significance or other-device
performance. The resource reduction and elimination of repeated work are consistent
across all measured restarts.

The harness redirects storage, logs, and the component cache into its isolated
profile and disables error reporting and autostart in the copied database. It
opens and terminates only benchmark processes. No database reset or package upgrade
was applied to the real app. The epoch timer and execution limits remain unchanged.

## Per-launch results

| Launch | Before history (ms) | After history (ms) | Before query (ms) | After query (ms) | Before native CPU (s) | After native CPU (s) |
| ------ | ------------------: | -----------------: | ----------------: | ---------------: | --------------------: | -------------------: |
| 1      |              1501.7 |              711.4 |               101 |               31 |                 7.328 |                0.688 |
| 2      |               813.2 |              690.3 |                62 |                3 |                 6.719 |                0.531 |
| 3      |               735.1 |              743.2 |                 9 |               13 |                 6.828 |                0.547 |
| 4      |               766.9 |              699.9 |                 2 |                3 |                 6.875 |                0.625 |
| 5      |               722.1 |              688.6 |                24 |               32 |                 7.125 |                0.594 |
| 6      |               736.1 |              729.5 |                 2 |               29 |                 7.031 |                0.578 |
| 7      |               719.7 |              691.4 |                41 |               40 |                 7.875 |                0.547 |
| 8      |               724.1 |              699.4 |                46 |                6 |                 7.297 |                0.641 |
| 9      |               742.0 |              685.9 |                 2 |               20 |                 7.594 |                0.625 |
| 10     |               739.0 |              689.6 |                 2 |                7 |                 7.750 |                0.500 |

## Validation

- Focused frontend tests: 57 passing tests across eight files, including pending
  telemetry, telemetry-policy races, pending tray/language saves, language changes,
  recovery screens, secondary-screen navigation, and Recall.
- Focused Rust tests: 66 extension tests and 25 contribution tests passed.
  Three existing archive-dependent extension tests remain ignored. Real WIT-derived
  components cover restart convergence, empty/unsupported/oversized inputs,
  version changes, forced redetection, failures, concurrent preparation, persistent
  cache reuse, cache fallback, and rejection before preparation.
- TypeScript checking, frontend lint, Rust formatting, Rust lint, production
  frontend build, and production desktop build without installer bundling passed.
  Frontend lint retains one existing Fast Refresh warning in ExtensionJobStatus.
- Architecture/API links and patch whitespace checked.

Raw results, CPU samples, source snapshots, isolated executables, and harness scripts
are retained locally in `src-tauri/target/startup-audit/`. Frontend source snapshots
are ZIP archives so normal test discovery cannot run obsolete snapshot tests.
`baseline-results.json`, `after-results.json`, and `after-warmup-results.json` contain
the complete timing and CPU observations. No clipboard content is in this report.
