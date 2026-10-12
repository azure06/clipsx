// Run against an opt-in production Tauri build; this helper is never an app sidecar.
import { spawn } from 'node:child_process'
import { setTimeout, clearTimeout } from 'node:timers'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipsx-recall-runtime-'))
const reportPath = path.join(directory, 'result.json')
const executable =
  process.env.CLIPSX_RECALL_PROBE_BINARY ??
  path.join(
    root,
    'src-tauri',
    'target',
    'release',
    process.platform === 'win32' ? 'clipsx.exe' : 'clipsx'
  )

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(executable, ['--verify-recall-runtime', reportPath], {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
  })
  const timeout = setTimeout(() => {
    child.kill()
    reject(new Error('Recall webview probe timed out'))
  }, 75_000)
  child.once('error', error => {
    clearTimeout(timeout)
    reject(error)
  })
  child.once('exit', code => {
    clearTimeout(timeout)
    resolve(code)
  })
})

const report = JSON.parse(await fs.readFile(reportPath, 'utf8'))
console.log(JSON.stringify({ ...report, reportPath }, null, 2))
if (exitCode !== 0 || report.passed !== true) process.exitCode = 1
