import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, repository, encode, readinessContext, digest } from './contracts.mjs'

const execute = (program, args, options = {}) =>
  execFileSync(
    // Git Bash's GNU tar interprets Windows drive letters as remote hosts.
    program === 'tar' && process.platform === 'win32'
      ? join(process.env.SystemRoot, 'System32', 'tar.exe')
      : program,
    args,
    {
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    }
  )
// A plain external-call adapter lets orchestration tests record side effects.
export const services = { command: execute }
export const command = (...args) => services.command(...args)
const assetCache = new Map()
export const clearAssetCache = () => assetCache.clear()
export function api(path, method = 'GET', body) {
  if (services.api) return services.api(path, method, body)
  const args = ['api', path, '--method', method]
  if (body !== undefined) args.push('--input', '-')
  const output = command('gh', args, {
    input: body === undefined ? undefined : JSON.stringify(body),
  })
  return output.trim() ? JSON.parse(output) : null
}
export const repoApi = (path, method, body) => api(`repos/${repository}/${path}`, method, body)
export const releaseById = id => repoApi(`releases/${id}`)
export function findCandidate(id) {
  assert(/^\d+\.\d+\.\d+-\d+-\d+$/.test(id), 'Invalid candidate ID')
  const releases = JSON.parse(
    command('gh', ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])
  ).flat()
  const release = releases.find(item => item.tag_name === `candidate-${id}`)
  assert(release?.draft, 'Candidate staging draft was not found or is already published')
  return release
}
export function downloadAsset(release, name, directory) {
  assert(/^[a-zA-Z0-9_.-]+$/.test(name) && name !== '.' && name !== '..', 'Unsafe asset filename')
  const asset = release.assets.find(item => item.name === name)
  assert(asset, `Missing release asset: ${name}`)
  mkdirSync(directory, { recursive: true })
  const key = `${asset.id}:${asset.digest}`
  const bytes =
    assetCache.get(key) ||
    command(
      'gh',
      [
        'api',
        `repos/${repository}/releases/assets/${asset.id}`,
        '-H',
        'Accept: application/octet-stream',
      ],
      { maxBuffer: 1024 * 1024 * 1024, encoding: null }
    )
  if (asset.digest)
    assert(digest(bytes) === asset.digest.replace(/^sha256:/, ''), 'Release asset changed')
  assetCache.set(key, bytes)
  writeFileSync(join(directory, name), bytes)
  return bytes
}
export function upload(release, paths) {
  command('gh', [
    'release',
    'upload',
    release.tag_name,
    ...paths,
    '--repo',
    repository,
    '--clobber',
  ])
}
export function writeAsset(release, name, value, directory) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, typeof value === 'string' ? value : encode(value))
  if (
    release.assets.some(
      item => item.name === name && item.digest === `sha256:${digest(readFileSync(path))}`
    )
  )
    return
  upload(release, [path])
}
export function status(sha, state, description, targetUrl) {
  repoApi(`statuses/${sha}`, 'POST', {
    state,
    context: readinessContext,
    description: description.slice(0, 140),
    target_url: targetUrl,
  })
}
export function loadCandidate(release, directory) {
  const bytes = downloadAsset(release, 'candidate.json', directory)
  const candidate = JSON.parse(bytes)
  return {
    candidate,
    bytes,
    releaseNotesRevision: candidate.releaseNotesRevision || candidate.sourceRevision,
  }
}
export function workflowArtifacts(runId) {
  assert(/^\d+$/.test(String(runId)), 'Invalid workflow run ID')
  const pages = JSON.parse(
    command('gh', [
      'api',
      `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      '--paginate',
      '--slurp',
    ])
  )
  return pages.flatMap(page => page.artifacts)
}
export function downloadArtifact(artifact, directory) {
  assert(artifact && !artifact.expired, 'Build artifact missing or expired')
  mkdirSync(directory, { recursive: true })
  if (services.artifact) return services.artifact(artifact, directory)
  // Artifact IDs are immutable; never resolve a selected candidate through "latest".
  const zip = command('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], {
    maxBuffer: 1024 * 1024 * 1024,
    encoding: null,
  })
  if (artifact.digest)
    assert(
      digest(zip) === artifact.digest.replace(/^sha256:/, ''),
      'Build artifact archive changed'
    )
  const path = join(directory, 'artifact.zip')
  writeFileSync(path, zip)
  expandZip(path, directory)
}
export function expandZip(path, destination) {
  if (process.platform === 'win32') {
    const quote = value => `'${value.replaceAll("'", "''")}'`
    const script = `Expand-Archive -LiteralPath ${quote(path)} -DestinationPath ${quote(destination)} -Force`
    command('powershell.exe', [
      '-NoProfile',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ])
  } else command('unzip', ['-o', path, '-d', destination])
}
export const releases = () =>
  JSON.parse(
    command('gh', ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])
  ).flat()
export function source(ref) {
  assert(/^[a-f0-9]{40}$/.test(ref), 'Invalid source revision')
  try {
    command('git', ['cat-file', '-e', `${ref}^{commit}`])
  } catch {
    command('git', ['fetch', '--no-tags', 'origin', ref])
  }
  return ref
}
export const localJson = path => JSON.parse(readFileSync(path, 'utf8'))
