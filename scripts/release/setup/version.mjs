import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, versionPattern } from '../core/contracts.mjs'
import { command } from '../core/github.mjs'

const versionFiles = [
  'package.json',
  'package-lock.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
]
const read = (root, path) => readFileSync(join(root, path), 'utf8')
const json = (value, original) =>
  `${JSON.stringify(value, null, 2)}\n`.replaceAll('\n', original.includes('\r\n') ? '\r\n' : '\n')

export function versionUpdates(root, version, subjects) {
  assert(versionPattern.test(version), 'Use a stable numeric version such as 0.1.10')
  const files = Object.fromEntries(versionFiles.map(path => [path, read(root, path)]))
  const npm = JSON.parse(files['package.json'])
  const lock = JSON.parse(files['package-lock.json'])
  const tauri = JSON.parse(files['src-tauri/tauri.conf.json'])
  const current = npm.version.split('.').map(Number),
    next = version.split('.').map(Number)
  assert(
    next.some(
      (part, index) =>
        part > current[index] && next.slice(0, index).every((value, i) => value === current[i])
    ),
    'The next version must be newer than the current version'
  )
  const cargo = files['src-tauri/Cargo.toml'].match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)
  const cargoLock = [
    ...files['src-tauri/Cargo.lock'].matchAll(
      /\[\[package\]\]\r?\nname = "clipsx"\r?\nversion = "([^"]+)"/g
    ),
  ]
  assert(
    cargoLock.length === 1 &&
      [lock.version, lock.packages[''].version, tauri.version, cargo?.[1], cargoLock[0][1]].every(
        value => value === npm.version
      ),
    'Existing version fields disagree; resolve them before preparation'
  )
  npm.version = lock.version = lock.packages[''].version = tauri.version = version
  files['package.json'] = json(npm, files['package.json'])
  files['package-lock.json'] = json(lock, files['package-lock.json'])
  files['src-tauri/tauri.conf.json'] = json(tauri, files['src-tauri/tauri.conf.json'])
  files['src-tauri/Cargo.toml'] = files['src-tauri/Cargo.toml'].replace(
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(".*$)/m,
    `$1${version}$2`
  )
  files['src-tauri/Cargo.lock'] = files['src-tauri/Cargo.lock'].replace(
    /(\[\[package\]\]\r?\nname = "clipsx"\r?\nversion = ")[^"]+(".*$)/m,
    `$1${version}$2`
  )
  const notesPath = `docs/releases/${version}.md`
  if (!existsSync(join(root, notesPath))) {
    const lines = subjects
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    assert(lines.length, 'No changes found for draft release notes')
    files[notesPath] = `# ClipsX ${version}\n\n${lines.map(line => `- ${line}`).join('\n')}\n`
  }
  return files
}

export function prepareVersion(version) {
  assert(
    command('git', ['branch', '--show-current']).trim() === 'develop',
    'Prepare ordinary releases on develop'
  )
  assert(
    !command('git', ['diff', '--name-only', 'HEAD', '--', ...versionFiles]).trim(),
    'Version files have local edits; preserve or finish those edits first'
  )
  const tag = command('git', ['tag', '--merged', 'HEAD', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .find(tag => /^v\d+\.\d+\.\d+$/.test(tag))
  const subjects = command('git', [
    'log',
    '--no-merges',
    '--format=%s',
    ...(tag ? [`${tag}..HEAD`] : ['-30']),
  ])
  const files = versionUpdates(process.cwd(), version, subjects)
  for (const [path, content] of Object.entries(files)) writeFileSync(path, content)
  console.log(
    `Prepared ${version} on develop. Review the generated release notes and version diff, run relevant checks, then create release/${version}. No build or workflow was started.`
  )
}
