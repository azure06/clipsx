// Run against an opt-in production Tauri build with a locally installed tool-capable Ollama model.
import { spawn } from 'node:child_process'
import { setTimeout, clearTimeout } from 'node:timers'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipsx-recall-acceptance-'))
await fs.writeFile(path.join(directory, 'probe.marker'), 'ClipsX isolated Recall acceptance\n')
const executable =
  process.env.CLIPSX_RECALL_PROBE_BINARY ??
  path.join(
    root,
    'src-tauri',
    'target',
    'release',
    process.platform === 'win32' ? 'clipsx.exe' : 'clipsx'
  )
const model = process.argv[2]
if (!model) throw new Error('Pass an installed tool-capable Ollama model ID')
for (const phase of ['first', 'restart']) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--verify-recall-acceptance', directory, phase, model], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Native acceptance ${phase} timed out; evidence: ${directory}`))
    }, 615_000)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  let report
  try {
    report = JSON.parse(await fs.readFile(path.join(directory, `${phase}.json`), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    report = {
      passed: false,
      phase,
      failure:
        exitCode === 3
          ? 'native_probe_feature_required'
          : exitCode === 2
            ? 'native_watchdog_timeout'
            : 'native_probe_no_report',
    }
  }
  console.log(JSON.stringify({ ...report, reportDirectory: directory }, null, 2))
  if (exitCode !== 0 || report.passed !== true) {
    process.exitCode = 1
    break
  }
}
