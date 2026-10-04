import { join } from 'node:path'
import { inputsDigest, assertAppInputs } from './inputs.mjs'
import {
  assert,
  assertMutable,
  assertIdentity,
  assertBuildRun,
  assertManifests,
  digest,
  readJson,
  validateInventory,
} from './contracts.mjs'
import {
  command,
  source,
  downloadAsset,
  findCandidate,
  loadCandidate,
  repoApi,
  releaseById,
} from './github.mjs'
import { directory } from './context.mjs'

export const metadataInventory = release =>
  release.assets
    .filter(item => item.name !== 'certification.json')
    .map(item => ({
      file: item.name,
      sha256: item.digest?.replace(/^sha256:/, ''),
      size: item.size,
    }))
    .sort((a, b) => a.file.localeCompare(b.file))

export function assertOrigin(candidate) {
  assertIdentity(candidate)
  assertAppInputs(candidate, source(candidate.sourceRevision))
  assertBuildRun(
    repoApi(
      `actions/runs/${candidate.build.origin.runId}/attempts/${candidate.build.origin.attempt}`
    ),
    candidate.build.origin
  )
  assert(
    inputsDigest(candidate.build.appInputs) === candidate.build.appInputsSha256,
    'App inventory changed'
  )
  assert(
    candidate.build.updaterPublicKey ===
      readJson(process.env.RELEASE_TRUSTED_CONFIG || 'src-tauri/tauri.conf.json').plugins.updater
        .pubkey,
    'Updater public key differs from trusted configuration'
  )
}

export function fresh(id) {
  const release = findCandidate(id)
  const { candidate, bytes } = loadCandidate(release, directory)
  assertOrigin(candidate)
  return { release, candidate, bytes }
}

export function assertCurrent(snapshot, mutable = false) {
  const current = releaseById(snapshot.release.id)
  if (mutable) assertMutable(snapshot.candidate, current)
  const asset = current.assets.find(item => item.name === 'candidate.json')
  assert(
    asset?.digest === `sha256:${digest(snapshot.bytes)}`,
    'Candidate descriptor changed during operation'
  )
  return current
}

export function verifiedFiles(release, candidate) {
  const files = new Map()
  for (const item of [...candidate.artifacts, ...candidate.evidence]) {
    const bytes = downloadAsset(release, item.file, directory)
    assert(
      digest(bytes) === item.sha256 && bytes.length === item.size,
      `Asset changed: ${item.file}`
    )
    files.set(item.file, bytes)
  }
  return files
}

export function verifySignature(file, signature, publicKey) {
  command(
    process.env.RELEASE_VERIFIER ||
      `tools/release-verify/target/release/clipsx-release-verify${process.platform === 'win32' ? '.exe' : ''}`,
    [publicKey, file, signature]
  )
}

export function verifyFinalized(release, candidate) {
  validateInventory(candidate, verifiedFiles(release, candidate))
  assert(
    digest(downloadAsset(release, 'release-notes.md', directory)) === candidate.releaseNotesSha256,
    'Release notes changed'
  )
  const signatures = {}
  for (const item of candidate.artifacts.filter(item => !item.file.endsWith('.dmg'))) {
    signatures[item.file] = downloadAsset(release, `${item.file}.sig`, directory)
      .toString('utf8')
      .trim()
    verifySignature(
      join(directory, item.file),
      join(directory, `${item.file}.sig`),
      candidate.build.updaterPublicKey
    )
  }
  assertManifests(
    candidate,
    signatures,
    downloadAsset(release, 'release-notes.md', directory).toString('utf8'),
    JSON.parse(downloadAsset(release, 'latest.json', directory)),
    JSON.parse(downloadAsset(release, 'downloads.json', directory)),
    downloadAsset(release, 'SHA256SUMS', directory).toString('utf8')
  )
}

export function completeInventory(release, candidate) {
  const required = [...candidate.artifacts, ...candidate.evidence].map(item => item.file)
  required.push(
    'candidate.json',
    'latest.json',
    'downloads.json',
    'SHA256SUMS',
    'windows-submission.json',
    'release-notes.md'
  )
  required.push(
    ...candidate.artifacts
      .filter(item => !item.file.endsWith('.dmg'))
      .map(item => `${item.file}.sig`)
  )
  assert(
    required.every(file => release.assets.some(item => item.name === file)),
    'Candidate draft is incomplete'
  )
  const inventory = metadataInventory(release)
  assert(
    inventory.every(item => /^[a-f0-9]{64}$/.test(item.sha256 || '')),
    'GitHub asset digests are missing'
  )
  return inventory
}
