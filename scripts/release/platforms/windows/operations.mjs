import { nsisImageDigest } from './image.mjs'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { artifactRecord } from '../../build/builds.mjs'
import {
  assert,
  assertMutable,
  replacementNeeded,
  assetName,
  digest,
  encode,
  readJson,
  repository,
  targets,
} from '../../core/contracts.mjs'
import {
  command,
  workflowArtifacts,
  downloadArtifact,
  downloadAsset,
  upload,
  writeAsset,
} from '../../core/github.mjs'
import { directory, output, record } from '../../core/context.mjs'
import { fresh, assertCurrent } from '../../core/candidate.mjs'
import { checkedFrontend } from '../../build/initialize.mjs'

export function windowsKit() {
  const frontend = checkedFrontend()
  const candidate = readJson(join(directory, 'candidate.json'))
  candidate.build.frontend = frontend
  const kit = join(directory, 'windows-kit')
  mkdirSync(kit, { recursive: true })
  command('git', [
    'archive',
    '--format=zip',
    '--output',
    resolve(kit, 'source.zip'),
    candidate.sourceRevision,
  ])
  copyFileSync(
    'src-tauri/target/x86_64-pc-windows-msvc/release/clipsx.exe',
    join(kit, 'clipsx.exe')
  )
  copyFileSync('src-tauri/tauri.auth.csp.conf.json', join(kit, 'tauri.auth.csp.conf.json'))
  // Bundling resolves frontendDist even though the frontend is embedded in the executable.
  command('tar', ['-czf', resolve(kit, 'frontend.tar.gz'), '-C', 'dist', '.'])
  candidate.windowsImages = Object.fromEntries(
    ['clipsx.exe'].map(file => {
      const bytes = readFileSync(join(kit, file))
      return [file, { size: bytes.length, sha256: nsisImageDigest(bytes), bundleType: 'nsis' }]
    })
  )
  candidate.windowsKit = [
    'source.zip',
    'clipsx.exe',
    'tauri.auth.csp.conf.json',
    'frontend.tar.gz',
  ].map(file => record(join(kit, file)))
  writeFileSync(join(kit, 'candidate.json'), encode(candidate))
  writeFileSync(join(directory, 'candidate.json'), encode(candidate))
}

export function stageWindows(id, target = 'missing') {
  const local = readJson(join(directory, 'windows-kit', 'candidate.json'))
  const snapshot = fresh(id)
  const { release, candidate } = snapshot
  assertMutable(candidate, release)
  assert(
    local.id === id && local.build.origin.runId === candidate.build.origin.runId,
    'Mixed Windows kit'
  )
  if (!replacementNeeded(candidate.windowsKit, local.windowsKit, 'windows-x64', target)) return
  const artifact = workflowArtifacts(process.env.GITHUB_RUN_ID)
    .filter(item => item.name.startsWith(`windows-kit-${id}-`))
    .sort((a, b) => b.id - a.id)[0]
  assert(artifact && !artifact.expired, 'Windows packaging kit upload missing')
  candidate.windowsKit = local.windowsKit
  candidate.windowsImages = local.windowsImages
  candidate.windowsKitArtifact = { ...artifactRecord(artifact), runId: process.env.GITHUB_RUN_ID }
  candidate.build.frontend = local.build.frontend
  assertCurrent(snapshot, true)
  writeAsset(release, 'candidate.json', candidate, directory)
}

export function prepareWindows(id) {
  const { release, candidate } = fresh(id)
  assertMutable(candidate, release)
  const artifactPath = join(directory, 'windows-kit')
  assert(candidate.windowsKitArtifact, 'Windows signing kit is not ready')
  const actual = workflowArtifacts(
    candidate.windowsKitArtifact?.runId || candidate.build.origin.runId
  ).find(item => item.id === candidate.windowsKitArtifact?.id)
  assert(
    actual &&
      !actual.expired &&
      actual.digest === candidate.windowsKitArtifact.digest &&
      actual.name === candidate.windowsKitArtifact.name,
    'Windows kit missing, expired or changed'
  )
  downloadArtifact(actual, artifactPath)
  for (const file of candidate.windowsKit)
    assert(
      digest(readFileSync(join(artifactPath, file.file))) === file.sha256,
      `Packaging input changed: ${file.file}`
    )
  const executable = readFileSync(join(artifactPath, 'clipsx.exe'))
  assert(
    digest(executable) === candidate.build.platforms['windows-x64'].sha256,
    'Windows kit executable differs from saved build'
  )
  assert(
    nsisImageDigest(executable) === candidate.windowsImages['clipsx.exe'].sha256,
    'NSIS executable identity changed'
  )
  writeFileSync(join(directory, 'signing-candidate.json'), encode(candidate))
  console.log(candidate.id)
}

export function submitWindows(id, installer, evidencePath) {
  const snapshot = fresh(id)
  const { release, candidate } = snapshot
  assertMutable(candidate, release)
  const evidence = readJson(evidencePath)
  assert(
    evidence.candidateId === id && evidence.verified === true,
    'Windows evidence identity mismatch'
  )
  const file = assetName(candidate.version, targets[0].suffix)
  const finalPath = join(directory, file)
  copyFileSync(installer, finalPath)
  const descriptor = { candidateId: id, artifact: record(finalPath), evidence }
  assertCurrent(snapshot, true)
  upload(release, [finalPath])
  writeAsset(release, 'windows-submission.json', descriptor, directory)
  assertCurrent(snapshot, true)
  command('gh', [
    'workflow',
    'run',
    'release-finalize.yml',
    '--repo',
    repository,
    '--ref',
    'main',
    '-f',
    `candidate_id=${id}`,
  ])
}

export function downloadWindows(id) {
  const { release, candidate } = fresh(id)
  const submission = JSON.parse(downloadAsset(release, 'windows-submission.json', directory))
  assert(submission.candidateId === id, 'Windows submission mismatch')
  const bytes = downloadAsset(release, submission.artifact.file, directory)
  assert(digest(bytes) === submission.artifact.sha256, 'Windows installer changed during upload')
  writeFileSync(join(directory, 'signing-candidate.json'), encode(candidate))
  output('installer', resolve(directory, submission.artifact.file))
}
