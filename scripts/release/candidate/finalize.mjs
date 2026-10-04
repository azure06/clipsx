import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assert,
  createManifests,
  candidateDraftMetadata,
  digest,
  readJson,
  validateInventory,
} from '../core/contracts.mjs'
import {
  command,
  downloadAsset,
  releaseById,
  repoApi,
  upload,
  writeAsset,
} from '../core/github.mjs'
import { directory, git, record, summarize } from '../core/context.mjs'
import {
  fresh,
  assertCurrent,
  verifiedFiles,
  verifySignature,
  verifyFinalized,
} from '../core/candidate.mjs'

export function finalize(id, windowsEvidencePath) {
  const snapshot = fresh(id)
  const { release, candidate } = snapshot
  if (candidate.finalizedAt) {
    verifyFinalized(release, candidate)
    summarize('Finalized assets verified and reused.')
    return
  }
  assert(
    !release.assets.some(item => item.name === 'certification.json'),
    'Certified candidates are immutable'
  )
  const submission = JSON.parse(downloadAsset(release, 'windows-submission.json', directory))
  const windowsEvidence = readJson(windowsEvidencePath)
  assert(
    windowsEvidence.candidateId === id && windowsEvidence.verified === true,
    'Windows CI verification failed'
  )
  assert(
    windowsEvidence.installerSha256 === submission.artifact.sha256,
    'Windows CI verified different bytes'
  )
  candidate.artifacts = candidate.artifacts.filter(item => item.file !== submission.artifact.file)
  candidate.artifacts.push(submission.artifact)
  assertCurrent(snapshot, true)
  writeAsset(release, 'native-evidence-windows-x64.json', windowsEvidence, directory)
  candidate.evidence = candidate.evidence.filter(
    item => item.file !== 'native-evidence-windows-x64.json'
  )
  candidate.evidence.push(record(join(directory, 'native-evidence-windows-x64.json')))
  const files = verifiedFiles(releaseById(release.id), candidate)
  validateInventory(candidate, files)
  const signatures = {}
  for (const item of candidate.artifacts.filter(item => !item.file.endsWith('.dmg'))) {
    const path = join(directory, item.file)
    const existing = release.assets.find(asset => asset.name === `${item.file}.sig`)
    if (existing) downloadAsset(release, existing.name, directory)
    else command('node', ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'sign', path])
    const signaturePath = `${path}.sig`
    verifySignature(path, signaturePath, candidate.build.updaterPublicKey)
    signatures[item.file] = readFileSync(signaturePath, 'utf8').trim()
    if (!existing) upload(release, [signaturePath])
  }
  const notes = downloadAsset(release, 'release-notes.md', directory).toString('utf8')
  assert(digest(notes) === candidate.releaseNotesSha256, 'Release notes changed')
  const manifests = createManifests(candidate, signatures, notes, candidate.createdAt)
  writeAsset(release, 'latest.json', manifests.updater, directory)
  writeAsset(release, 'downloads.json', manifests.downloads, directory)
  writeAsset(
    release,
    'SHA256SUMS',
    candidate.artifacts
      .map(item => `${item.sha256}  ${item.file}`)
      .sort()
      .join('\n') + '\n',
    directory
  )
  const current = assertCurrent(snapshot, true)
  for (const item of [...candidate.artifacts, ...candidate.evidence]) {
    const asset = current.assets.find(asset => asset.name === item.file)
    assert(
      asset?.digest === `sha256:${item.sha256}` && asset.size === item.size,
      `Finalization asset changed: ${item.file}`
    )
  }
  for (const name of [
    'release-notes.md',
    'latest.json',
    'downloads.json',
    'SHA256SUMS',
    ...candidate.artifacts
      .filter(item => !item.file.endsWith('.dmg'))
      .map(item => `${item.file}.sig`),
  ]) {
    assert(
      current.assets.find(asset => asset.name === name)?.digest ===
        `sha256:${digest(readFileSync(join(directory, name)))}`,
      `Finalization output changed: ${name}`
    )
  }
  candidate.finalization = {
    toolingRevision: git(['rev-parse', 'HEAD']),
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  }
  candidate.finalizedAt = new Date().toISOString()
  writeAsset(release, 'candidate.json', candidate, directory)
  repoApi(`releases/${release.id}`, 'PATCH', candidateDraftMetadata(candidate, release, notes))
  summarize(
    `Candidate ${id}; build ${candidate.build.origin.runId}. Next action: perform installed tests and run Certify candidate. [Finalized draft](${release.html_url})`
  )
}
