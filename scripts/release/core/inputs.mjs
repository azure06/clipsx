import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, digest, encode } from './contracts.mjs'

// One conservative classification for routing and app-source equivalence.
const appRoots = ['src/', 'src-tauri/', 'public/']
const appFiles = new Set([
  'package.json',
  'package-lock.json',
  'index.html',
  'app-icon.svg',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'rust-toolchain.toml',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tailwind.config.js',
  'postcss.config.js',
  'scripts/production-env.mjs',
  'scripts/validate-production-env.mjs',
  'scripts/tauri-auth-csp.mjs',
  'scripts/generate-tauri-auth-csp.mjs',
])
const recipes = new Set([
  '.github/workflows/release.yml',
  '.github/workflows/checks.yml',
  '.github/workflows/ci.yml',
  'scripts/release/preflight.mjs',
  'eslint.config.js',
  'vitest.config.ts',
  'deny.toml',
  'rustfmt.toml',
  'scripts/check-js-licenses.mjs',
])
export function classify(path) {
  if (appRoots.some(prefix => path.startsWith(prefix)) || appFiles.has(path)) return 'app'
  if (path.startsWith('scripts/release/') && path.endsWith('.test.mjs')) return 'release'
  if (
    recipes.has(path) ||
    path.startsWith('scripts/release/build/') ||
    path === 'scripts/release/core/inputs.mjs' ||
    path === 'scripts/release/core/environment.mjs'
  )
    return 'recipe'
  if (
    /^(CODE_OF_CONDUCT|SECURITY|SUPPORT)\.md$/.test(path) ||
    path === '.github/PULL_REQUEST_TEMPLATE.md' ||
    /^\.github\/ISSUE_TEMPLATE\/[^/]+\.(md|ya?ml)$/.test(path)
  )
    return 'docs'
  if (
    path.startsWith('scripts/release/') ||
    path.startsWith('.github/') ||
    path.startsWith('tools/release-verify/')
  )
    return 'release'
  if (
    path.startsWith('docs/') ||
    path.startsWith('.agents/') ||
    path.startsWith('.codegraph/') ||
    /^(README|AGENTS|CONTRIBUTING)\.md$/.test(path) ||
    ['.gitignore', '.gitleaksignore', '.gitleaks.toml', '.env.example'].includes(path)
  )
    return 'docs'
  // Unknown files must not silently bypass validation or disappear from identity.
  return 'app'
}
const git = (args, cwd = process.cwd()) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
export function appInputs(ref = 'HEAD', cwd) {
  assert(/^[a-f0-9]{40}$/.test(ref) || ref === 'HEAD', 'Use an exact source commit')
  return git(['ls-tree', '-r', '-z', ref], cwd)
    .split('\0')
    .filter(Boolean)
    .map(row => {
      const [metadata, path] = row.split('\t')
      const [mode, type, blob] = metadata.split(' ')
      assert(type === 'blob', 'Submodules are not supported release inputs')
      return { path, mode, blob }
    })
    .filter(item => classify(item.path) === 'app')
    .sort((a, b) => a.path.localeCompare(b.path))
}
export const inputsDigest = inputs => digest(encode(inputs))
export function assertAppInputs(candidate, ref) {
  assert(
    inputsDigest(appInputs(ref)) === candidate.build.appInputsSha256,
    'App inputs differ from selected build; select/build the intended app revision'
  )
}
export { publicEnvironment, assertPublicEnvironment } from './environment.mjs'

export function decisions(paths) {
  const kinds = paths.map(classify)
  return {
    app: kinds.includes('app'),
    build: kinds.some(kind => ['app', 'recipe'].includes(kind)),
    tooling:
      kinds.some(kind => ['recipe', 'release'].includes(kind)) ||
      paths.includes('src-tauri/src/bin/clipsx-release-verify.rs'),
    docs: kinds.includes('docs'),
  }
}
export function route(paths) {
  return paths.some(path => ['app', 'recipe'].includes(classify(path)))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const forced = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
  const before = event.pull_request?.base.sha || event.before
  const after = event.pull_request?.head.sha || event.after
  const paths =
    !before || /^0+$/.test(before)
      ? ['src/new-release']
      : git(['diff', '--name-only', '-z', before, after]).split('\0').filter(Boolean)
  const releasePr =
    event.pull_request?.head.ref.startsWith('release/') &&
    event.pull_request.base.ref === 'main' &&
    event.pull_request.head.repo.full_name === event.repository.full_name
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `build=${forced || route(paths)}\napp=${decisions(paths).app}\ntooling=${decisions(paths).tooling}\ndocs=${decisions(paths).docs}\nrelease-pr=${Boolean(releasePr)}\n`
  )
  console.log(
    encode({
      build: forced || route(paths),
      changes: paths.map(path => ({ path, kind: classify(path) })),
    })
  )
}
