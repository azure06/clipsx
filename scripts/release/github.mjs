import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, repository, encode, readinessContext, preparationAttempt } from './model.mjs'

export const command = (program, args, options = {}) =>
  execFileSync(program, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options })
export function api(path, method = 'GET', body) {
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
  const bytes = execFileSync(
    'gh',
    [
      'api',
      `repos/${repository}/releases/assets/${asset.id}`,
      '-H',
      'Accept: application/octet-stream',
    ],
    { maxBuffer: 1024 * 1024 * 1024 }
  )
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
  return { candidate: JSON.parse(bytes), bytes }
}
export function workflowArtifacts(runId) {
  assert(/^\d+$/.test(String(runId)), 'Invalid workflow run ID')
  const pages = JSON.parse(command('gh', ['api', `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`, '--paginate', '--slurp']))
  return pages.flatMap(page => page.artifacts)
}
export function runWithPreparation(run) {
  if (!run?.id) return run || {}
  const pages = JSON.parse(command('gh', ['api', `repos/${repository}/actions/runs/${run.id}/jobs?filter=all&per_page=100`, '--paginate', '--slurp']))
  return { ...run, preparation_attempt: preparationAttempt(run, workflowArtifacts(run.id), pages.flatMap(page => page.jobs)) }
}
export function currentRun(candidate) {
  const branch = repoApi(`branches/${encodeURIComponent(candidate.branch)}`)
  const runs = repoApi(
    `actions/workflows/release.yml/runs?branch=${encodeURIComponent(candidate.branch)}&per_page=1`
  )
  assert(runs.workflow_runs.length, 'No preparation workflow exists for this branch')
  return { sha: branch.commit.sha, run: runWithPreparation(runs.workflow_runs[0]) }
}
export const localJson = path => JSON.parse(readFileSync(path, 'utf8'))
