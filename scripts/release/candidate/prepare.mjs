import { captureNotes, updateNotes } from './notes.mjs'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertPublicEnvironment } from '../core/inputs.mjs'
import {
  platforms as buildPlatforms,
  loadBuild,
  restorePlatform,
  preparationTargets,
} from '../build/builds.mjs'
import {
  assert,
  assertIdentity,
  assertMutable,
  replacementNeeded,
  assetName,
  digest,
  encode,
  readJson,
  repository,
  targets,
} from '../core/contracts.mjs'
import {
  command,
  expandZip,
  source,
  workflowArtifacts,
  downloadArtifact,
  repoApi,
  upload,
  writeAsset,
} from '../core/github.mjs'
import { directory, output, git, filesUnder, record, summarize } from '../core/context.mjs'
import { fresh, assertCurrent } from '../core/candidate.mjs'
import { checkedFrontend } from '../build/initialize.mjs'
import { selectForPr } from './approval.mjs'
import { stageWindows } from '../platforms/windows/operations.mjs'

export function collect(platform, bundleDir) {
  checkedFrontend()
  const candidate = readJson(join(directory, 'candidate.json'))
  const destination = join(directory, platform)
  mkdirSync(destination, { recursive: true })
  const inputs = filesUnder(bundleDir)
  const patterns = platform.startsWith('macos-')
    ? [/\.dmg$/, /\.app\.tar\.gz$/]
    : [/\.AppImage$/, /\.deb$/]
  const targetList =
    platform === 'linux-x64'
      ? targets.filter(item => item.platform === 'linux')
      : targets.filter(item => item.id === platform)
  const artifacts = []
  for (let index = 0; index < patterns.length; index++) {
    const matching = inputs.filter(path => patterns[index].test(path))
    assert(
      matching.length === 1,
      `Expected one ${patterns[index]} for ${platform}, found ${matching.length}`
    )
    const target = targetList[index] || targetList[0]
    let name = assetName(candidate.version, target.suffix)
    if (index === 1 && platform.startsWith('macos-')) name = name.replace(/\.dmg$/, '.app.tar.gz')
    const path = join(destination, name)
    copyFileSync(matching[0], path)
    artifacts.push(record(path))
  }
  const evidencePath = join(destination, `native-evidence-${platform}.json`)
  const evidence = readJson(
    process.env.NATIVE_EVIDENCE_PATH || join(directory, `native-evidence-${platform}.json`)
  )
  if (platform.startsWith('macos-'))
    assert(
      evidence.runtimeProbe?.verified === true &&
        evidence.runtimeProbe.fixtureSha256 ===
          candidate.build.platforms[platform].runtimeFixtureSha256 &&
        evidence.entitlementsPlist?.includes(
          'com.apple.security.cs.allow-unsigned-executable-memory'
        ),
      'Signed Mac runtime evidence is missing'
    )
  assert(
    evidence.candidateId === candidate.id && evidence.verified === true,
    'Native verification evidence does not match candidate'
  )
  writeFileSync(evidencePath, encode(evidence))
  writeFileSync(
    join(destination, `platform-${platform}.json`),
    encode({ candidateId: candidate.id, artifacts, evidence: record(evidencePath) })
  )
}

export function prepare(runId, id, target = 'missing', prNumber, notesRef) {
  if (
    process.env.GITHUB_EVENT_NAME === 'workflow_run' &&
    !workflowArtifacts(runId).some(item => /^build-ready-\d+$/.test(item.name))
  ) {
    output('work', 'false')
    output('matrix', JSON.stringify({ include: [] }))
    summarize(
      'Documentation/tooling push: no application build was requested; preparation skipped.'
    )
    return
  }
  assert(
    ['missing', 'all', ...Object.keys(buildPlatforms)].includes(target),
    'Unknown preparation target'
  )
  let release, candidate
  if (id) ({ release, candidate } = fresh(id))
  else {
    candidate = loadBuild(runId, join(directory, 'build'))
    assertPublicEnvironment(candidate)
    candidate.runId = process.env.GITHUB_RUN_ID
    candidate.runAttempt = process.env.GITHUB_RUN_ATTEMPT
    candidate.id = `${candidate.version}-${candidate.runId}-${candidate.runAttempt}`
    candidate.stagingTag = `candidate-${candidate.id}`
    candidate.createdAt = new Date().toISOString()
    candidate.preparation = {}
    source(candidate.sourceRevision)
    const notes = captureNotes(candidate, notesRef, prNumber)
    candidate.releaseNotesRevision = notes.revision
    candidate.releaseNotesSha256 = notes.sha256
    assertIdentity(candidate)
    release = repoApi('releases', 'POST', {
      tag_name: candidate.stagingTag,
      target_commitish: git(['rev-parse', 'HEAD']),
      name: `Candidate ${candidate.id}`,
      body: `Build ${runId}; awaiting packaging and Windows signing.`,
      draft: true,
      prerelease: true,
    })
    writeAsset(release, 'release-notes.md', notes.text, directory)
    writeAsset(release, 'candidate.json', candidate, directory)
  }
  assert(
    String(runId) === String(candidate.build.origin.runId),
    'Candidate belongs to another build'
  )
  assertMutable(candidate, release)
  assertPublicEnvironment(candidate)
  if (id) loadBuild(runId, join(directory, 'build'), candidate)
  if (id && notesRef) updateNotes(release, candidate, notesRef)
  const matrix = preparationTargets(candidate, target)
  writeFileSync(join(directory, 'candidate.json'), encode(candidate))
  output('candidate-id', candidate.id)
  output('matrix', JSON.stringify({ include: matrix }))
  output('work', String(matrix.length > 0))
  selectForPr(candidate, release, prNumber)
  summarize(
    `## Candidate ${candidate.id}\nBuild: ${runId}\nApp source: ${candidate.sourceRevision}\nTargets to prepare: ${matrix.map(item => item.platform).join(', ') || 'none — saved outputs reused'}\nWindows: ${release.assets.some(item => item.name === 'windows-submission.json') ? 'uploaded' : 'awaiting local signing'}\n`
  )
}

export function restore(id, platform) {
  const { candidate } = fresh(id)
  loadBuild(candidate.build.origin.runId, join(directory, 'build'), candidate)
  writeFileSync(join(directory, 'candidate.json'), encode(candidate))
  const frontendDir = join(directory, 'frontend')
  downloadArtifact(candidate.build.frontendArtifact, frontendDir)
  copyFileSync(join(frontendDir, 'frontend.json'), '.release/frontend.json')
  command('tar', ['-xzf', resolve(frontendDir, 'frontend.tar.gz')])
  checkedFrontend()
  restorePlatform(candidate, platform, join(directory, 'executable'))
}

export function stagePlatform(id, platform, target = 'missing') {
  const snapshot = fresh(id)
  const { release, candidate } = snapshot
  assertMutable(candidate, release)
  const local = readJson(join(directory, platform, `platform-${platform}.json`))
  assert(local.candidateId === id, 'Mixed candidate platform output')
  for (const item of [...local.artifacts, local.evidence])
    assert(
      digest(readFileSync(join(directory, platform, item.file))) === item.sha256,
      'Platform output changed'
    )
  const prior = candidate.preparation?.[platform] && {
    artifacts: candidate.artifacts.filter(item =>
      local.artifacts.some(next => next.file === item.file)
    ),
    evidence: candidate.evidence.find(item => item.file === local.evidence.file),
  }
  if (
    !replacementNeeded(
      prior,
      { artifacts: local.artifacts, evidence: local.evidence },
      platform,
      target
    )
  )
    return
  const names = new Set([...local.artifacts, local.evidence].map(item => item.file))
  candidate.artifacts = candidate.artifacts.filter(item => !names.has(item.file))
  candidate.evidence = candidate.evidence.filter(item => !names.has(item.file))
  candidate.artifacts.push(...local.artifacts)
  candidate.evidence.push(local.evidence)
  candidate.preparation ||= {}
  candidate.preparation[platform] = {
    toolingRevision: process.env.RELEASE_TOOLING_REVISION || git(['rev-parse', 'HEAD']),
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    evidence: local.evidence.file,
  }
  upload(
    release,
    [...names].map(name => join(directory, platform, name))
  )
  assertCurrent(snapshot, true)
  writeAsset(release, 'candidate.json', candidate, directory)
}

export function packageSource(id) {
  command('git', ['init'])
  command('git', ['remote', 'add', 'origin', `https://github.com/${repository}.git`])
  const { candidate, release } = fresh(id)
  assertMutable(candidate, release)
  const paths = command('git', ['ls-tree', '-r', '--name-only', candidate.sourceRevision]).split(
    '\n'
  )
  assert(
    !paths.some(path => /^(\.tooling|\.release|\.git)(\/|$)/i.test(path)),
    'Build source overlaps trusted tooling or release workspace'
  )
  // The separate trusted checkout and release workspace cannot be overwritten by build source.
  const zip = join(directory, 'source.zip')
  command('git', ['archive', '--format=zip', '--output', zip, candidate.sourceRevision])
  expandZip(zip, process.cwd())
  command('git', ['read-tree', candidate.sourceRevision])
  command('git', ['update-ref', 'HEAD', candidate.sourceRevision])
  writeFileSync(join(directory, 'candidate.json'), encode(candidate))
  writeFileSync(
    join(directory, 'bundle.conf.json'),
    encode({
      build: { beforeBuildCommand: null, beforeBundleCommand: null },
      bundle: { createUpdaterArtifacts: false },
    })
  )
}

export function stagePrepared(id, target = 'missing') {
  const artifacts = workflowArtifacts(process.env.GITHUB_RUN_ID)
  for (const platform of Object.keys(buildPlatforms)) {
    const prefix = platform === 'windows-x64' ? `windows-kit-${id}-` : `prepared-${id}-${platform}-`
    const artifact = artifacts
      .filter(item => item.name.startsWith(prefix))
      .sort((a, b) => b.id - a.id)[0]
    if (!artifact) continue
    const path =
      platform === 'windows-x64' ? join(directory, 'windows-kit') : join(directory, platform)
    downloadArtifact(artifact, path)
    if (platform === 'windows-x64') stageWindows(id, target)
    else stagePlatform(id, platform, target)
  }
  summarize(
    `Candidate ${id}: successful outputs saved. Next: local Windows signing, then finalization and installed tests.`
  )
}
