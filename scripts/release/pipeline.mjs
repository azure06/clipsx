import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { validateProductionEnvironment } from '../production-env.mjs'
import { checkFrontend } from './frontend.mjs'
import {
  assert,
  assertCertified,
  assertCurrent,
  assertIdentity,
  assertMerged,
  assertManifests,
  assertLatestRun,
  assetName,
  createManifests,
  digest,
  encode,
  imageDigest,
  publicationMode,
  readJson,
  repository,
  targets,
  validateInventory,
  validateVersion,
} from './model.mjs'
import {
  command,
  currentRun,
  downloadAsset,
  findCandidate,
  loadCandidate,
  releaseById,
  repoApi,
  status,
  upload,
  writeAsset,
} from './github.mjs'

const directory = resolve(process.env.RELEASE_WORKDIR || '.release')
const output = (name, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
const git = args => command('git', args).trim()
const filesUnder = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? filesUnder(join(dir, item.name)) : [join(dir, item.name)]
  )
const record = path => ({
  file: basename(path),
  sha256: digest(readFileSync(path)),
  size: readFileSync(path).length,
})
const metadataInventory = release =>
  release.assets
    .filter(item => item.name !== 'certification.json')
    .map(item => ({
      file: item.name,
      sha256: item.digest?.replace(/^sha256:/, ''),
      size: item.size,
    }))
    .sort((a, b) => a.file.localeCompare(b.file))

function initialize() {
  const config = readJson('src-tauri/tauri.conf.json')
  assert(
    !config.plugins.updater.dangerousInsecureTransportProtocol,
    'Production updater cannot use insecure transport'
  )
  assert(
    config.plugins.updater.endpoints.length === 1 &&
      config.plugins.updater.endpoints[0] ===
        `https://github.com/${repository}/releases/latest/download/latest.json`,
    'Stable updater endpoint must be retained'
  )
  const cargoVersion = readFileSync('src-tauri/Cargo.toml', 'utf8').match(
    /^version\s*=\s*"([^"]+)"/m
  )?.[1]
  const branch = process.env.GITHUB_REF_NAME
  const version = validateVersion(
    branch,
    readJson('package.json').version,
    cargoVersion,
    config.version
  )
  assert(
    existsSync(`docs/releases/${version}.md`),
    `Add docs/releases/${version}.md before preparing this release`
  )
  const runId = process.env.GITHUB_RUN_ID
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT
  const id = `${version}-${runId}-${runAttempt}`
  const candidate = {
    schemaVersion: 1,
    id,
    version,
    branch,
    runId,
    runAttempt,
    sourceRevision: git(['rev-parse', 'HEAD']),
    sourceTree: git(['rev-parse', 'HEAD^{tree}']),
    stagingTag: `candidate-${id}`,
    createdAt: new Date().toISOString(),
    build: {
      production: true,
      configuration: Object.fromEntries(
        [
          'src-tauri/tauri.conf.json',
          'src-tauri/tauri.production-build.conf.json',
          'package-lock.json',
          'src-tauri/Cargo.lock',
        ].map(file => [file, digest(readFileSync(file))])
      ),
      updaterPublicKey: config.plugins.updater.pubkey,
      windowsInstaller: 'nsis',
      macArchitectures: ['arm64', 'x64'],
      linuxPackages: ['appimage', 'deb'],
    },
    artifacts: [],
    evidence: [],
  }
  assertIdentity(candidate)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'candidate.json'), encode(candidate))
  output('candidate-id', id)
  output('version', version)
}

function collect(platform, bundleDir) {
  checkFrontend(process.cwd(), true)
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

function windowsKit() {
  const frontend = checkFrontend(process.cwd(), true)
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
  copyFileSync(
    'src-tauri/target/x86_64-pc-windows-msvc/release/clipsx-extension-tool.exe',
    join(kit, 'clipsx-extension-tool.exe')
  )
  copyFileSync('src-tauri/tauri.auth.csp.conf.json', join(kit, 'tauri.auth.csp.conf.json'))
  // Bundling resolves frontendDist even though the frontend is embedded in the executable.
  command('tar', ['-czf', resolve(kit, 'frontend.tar.gz'), '-C', 'dist', '.'])
  const exe = readFileSync(join(kit, 'clipsx.exe'))
  candidate.windowsImage = { size: exe.length, sha256: imageDigest(exe) }
  candidate.windowsImages = Object.fromEntries(
    ['clipsx.exe', 'clipsx-extension-tool.exe'].map(file => {
      const bytes = readFileSync(join(kit, file))
      return [file, { size: bytes.length, sha256: imageDigest(bytes) }]
    })
  )
  candidate.build.publicEnvironment = Object.fromEntries(
    [
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_NEXT_PUBLIC_SITE_URL',
      'VITE_SENTRY_DSN',
      'VITE_SENTRY_RELEASE',
    ].map(name => [name, process.env[name] || ''])
  )
  candidate.windowsKit = [
    'source.zip',
    'clipsx.exe',
    'clipsx-extension-tool.exe',
    'tauri.auth.csp.conf.json',
    'frontend.tar.gz',
  ].map(file => record(join(kit, file)))
  writeFileSync(join(kit, 'candidate.json'), encode(candidate))
  writeFileSync(join(directory, 'candidate.json'), encode(candidate))
}

function stage() {
  const candidates = filesUnder(directory)
    .filter(path => basename(path) === 'candidate.json')
    .map(readJson)
  const candidate = candidates.find(item => item.windowsKit)
  assert(candidate, 'Missing Windows packaging kit identity')
  assertCurrent(candidate, repoApi(`branches/${encodeURIComponent(candidate.branch)}`).commit.sha, {
    id: candidate.runId,
    run_attempt: candidate.runAttempt,
    head_sha: candidate.sourceRevision,
    conclusion: 'success',
  })
  const platforms = filesUnder(directory)
    .filter(path => /^platform-/.test(basename(path)))
    .map(readJson)
  assert(
    platforms.length === 3 &&
      ['macos-arm64', 'macos-x64', 'linux-x64'].every(name =>
        filesUnder(directory).some(path => basename(path) === `platform-${name}.json`)
      ),
    'Incomplete CI platform inventory'
  )
  for (const platform of platforms) {
    assert(platform.candidateId === candidate.id, 'Mixed candidate outputs')
    candidate.artifacts.push(...platform.artifacts)
    candidate.evidence.push(platform.evidence)
  }
  const release = repoApi('releases', 'POST', {
    tag_name: candidate.stagingTag,
    target_commitish: candidate.sourceRevision,
    name: `Candidate ${candidate.id}`,
    body: `Unpublished candidate ${candidate.id}. Windows signing and installed certification are pending.`,
    draft: true,
    prerelease: true,
  })
  const assetPaths = filesUnder(directory).filter(
    path =>
      candidate.artifacts.some(item => item.file === basename(path)) ||
      candidate.evidence.some(item => item.file === basename(path))
  )
  upload(release, assetPaths)
  writeAsset(release, 'candidate.json', candidate, directory)
  writeAsset(
    release,
    'release-notes.md',
    readFileSync(`docs/releases/${candidate.version}.md`, 'utf8'),
    directory
  )
  output('candidate-id', candidate.id)
  console.log(
    `Candidate ${candidate.id} staged. Run scripts/release/sign-windows.ps1 -RunId ${candidate.runId} -CertificateThumbprint <thumbprint>.`
  )
}

function fresh(id) {
  const release = findCandidate(id)
  const { candidate, bytes } = loadCandidate(release, directory)
  const current = currentRun(candidate)
  assertCurrent(candidate, current.sha, current.run)
  assert(
    candidate.build.updaterPublicKey ===
      readJson('src-tauri/tauri.conf.json').plugins.updater.pubkey,
    'Updater public key differs from trusted configuration'
  )
  return { release, candidate, bytes }
}

function prepareWindows(runId) {
  assert(/^\d+$/.test(runId), 'Invalid run ID')
  const run = repoApi(`actions/runs/${runId}`)
  const artifactPath = join(directory, 'windows-kit')
  command('gh', [
    'run',
    'download',
    runId,
    '--repo',
    repository,
    '--name',
    `windows-signing-inputs-${run.run_attempt}`,
    '--dir',
    artifactPath,
  ])
  const candidate = readJson(join(artifactPath, 'candidate.json'))
  const { release } = fresh(candidate.id)
  for (const file of candidate.windowsKit)
    assert(
      digest(readFileSync(join(artifactPath, file.file))) === file.sha256,
      `Packaging input changed: ${file.file}`
    )
  // The staging descriptor is authoritative, not the downloaded kit's copy.
  const staged = loadCandidate(release, directory).candidate
  assert(
    encode(staged.windowsKit) === encode(candidate.windowsKit) &&
      encode(staged.windowsImage) === encode(candidate.windowsImage),
    'Packaging inputs do not match staged candidate'
  )
  writeFileSync(join(directory, 'signing-candidate.json'), encode(staged))
  console.log(candidate.id)
}

function submitWindows(id, installer, evidencePath) {
  const { release, candidate } = fresh(id)
  assert(
    !release.assets.some(item => item.name === 'certification.json'),
    'Certified candidates cannot be changed'
  )
  const evidence = readJson(evidencePath)
  assert(
    evidence.candidateId === id && evidence.verified === true,
    'Windows evidence identity mismatch'
  )
  const file = assetName(candidate.version, targets[0].suffix)
  const finalPath = join(directory, file)
  copyFileSync(installer, finalPath)
  const descriptor = { candidateId: id, artifact: record(finalPath), evidence }
  upload(release, [finalPath])
  writeAsset(release, 'windows-submission.json', descriptor, directory)
  fresh(id)
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

function downloadWindows(id) {
  const { release, candidate } = fresh(id)
  const submission = JSON.parse(downloadAsset(release, 'windows-submission.json', directory))
  assert(submission.candidateId === id, 'Windows submission mismatch')
  const bytes = downloadAsset(release, submission.artifact.file, directory)
  assert(digest(bytes) === submission.artifact.sha256, 'Windows installer changed during upload')
  writeFileSync(join(directory, 'signing-candidate.json'), encode(candidate))
  output('installer', resolve(directory, submission.artifact.file))
}

function verifiedFiles(release, candidate) {
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

function verifySignature(file, signature, publicKey) {
  command(process.env.RELEASE_VERIFIER || 'src-tauri/target/release/clipsx-release-verify', [
    publicKey,
    file,
    signature,
  ])
}

function verifyFinalized(release, candidate) {
  validateInventory(candidate, verifiedFiles(release, candidate))
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

function finalize(id, windowsEvidencePath) {
  const { release, candidate, bytes: originalDescriptor } = fresh(id)
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
    command('node', ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'sign', path])
    const signaturePath = `${path}.sig`
    verifySignature(path, signaturePath, candidate.build.updaterPublicKey)
    signatures[item.file] = readFileSync(signaturePath, 'utf8').trim()
    upload(release, [signaturePath])
  }
  const notes = downloadAsset(release, 'release-notes.md', directory).toString('utf8')
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
  const latest = fresh(id)
  assert(
    digest(latest.bytes) === digest(originalDescriptor),
    'Candidate descriptor changed during finalization'
  )
  candidate.finalizedAt = new Date().toISOString()
  writeAsset(release, 'candidate.json', candidate, directory)
  repoApi(`releases/${release.id}`, 'PATCH', { body: notes })
  console.log(
    `Candidate ${id} finalized. Download installers, test every platform, then run Certify candidate.`
  )
}

function completeInventory(release, candidate) {
  const required = [...candidate.artifacts, ...candidate.evidence].map(item => item.file)
  required.push(
    'candidate.json',
    'latest.json',
    'downloads.json',
    'SHA256SUMS',
    'windows-submission.json'
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

function certify(id) {
  const { release, candidate, bytes } = fresh(id)
  assert(candidate.finalizedAt, 'Candidate must be finalized before certification')
  assert(
    process.env.CERTIFY_ALL_PLATFORMS === 'true',
    'Explicit installed-platform confirmation is required'
  )
  const evidence = process.env.CERTIFICATION_EVIDENCE?.trim()
  assert(
    evidence && /^https:\/\//.test(evidence),
    'Provide an HTTPS installed-test evidence reference'
  )
  verifyFinalized(release, candidate)
  const inventory = completeInventory(release, candidate)
  const latest = fresh(id)
  assert(
    digest(latest.bytes) === digest(bytes),
    'Candidate descriptor changed during certification'
  )
  assert(
    digest(encode(completeInventory(latest.release, candidate))) === digest(encode(inventory)),
    'Draft changed during certification'
  )
  if (release.assets.some(item => item.name === 'certification.json')) {
    const existing = JSON.parse(downloadAsset(release, 'certification.json', directory))
    assertCertified(candidate, existing, bytes, inventory)
    status(candidate.sourceRevision, 'success', `Certified candidate ${id}`, release.html_url)
    readyPullRequest(candidate)
    return
  }
  const certification = {
    schemaVersion: 1,
    candidateId: id,
    sourceRevision: candidate.sourceRevision,
    sourceTree: candidate.sourceTree,
    candidateSha256: digest(bytes),
    inventorySha256: digest(encode(inventory)),
    evidence,
    platforms: targets.map(item => item.id),
    actor: process.env.GITHUB_ACTOR,
    certifiedAt: new Date().toISOString(),
  }
  writeAsset(release, 'certification.json', certification, directory)
  status(candidate.sourceRevision, 'success', `Certified candidate ${id}`, release.html_url)
  readyPullRequest(candidate)
}

function readyPullRequest(candidate) {
  const pulls = repoApi(
    `pulls?state=open&base=main&head=${encodeURIComponent(`azure06:${candidate.branch}`)}`
  )
  for (const pr of pulls) {
    assert(pr.head.sha === candidate.sourceRevision, 'Release PR changed during certification')
    if (pr.draft) command('gh', ['pr', 'ready', String(pr.number), '--repo', repository])
  }
}

function readiness() {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const runEvent = event.workflow_run
  if (runEvent && !runEvent.head_branch?.startsWith('release/')) return
  const pr =
    event.pull_request ||
    (runEvent && {
      head: { ref: runEvent.head_branch, sha: runEvent.head_sha, repo: runEvent.head_repository },
      html_url: runEvent.html_url,
    })
  assert(pr, 'Missing pull request event')
  if (!pr.head.ref.startsWith('release/')) {
    status(pr.head.sha, 'success', 'No desktop release is associated with this PR', pr.html_url)
    return
  }
  if (pr.head.repo.full_name !== repository) {
    status(pr.head.sha, 'failure', 'Release candidates must come from this repository', pr.html_url)
    return
  }
  try {
    const runs = repoApi(
      `actions/workflows/release.yml/runs?branch=${encodeURIComponent(pr.head.ref)}&per_page=1`
    )
    const run = runs.workflow_runs[0]
    assert(run, 'Prepare this release candidate first')
    const id = `${pr.head.ref.slice(8)}-${run.id}-${run.run_attempt}`
    const { release, candidate, bytes } = fresh(id)
    assert(candidate.sourceRevision === pr.head.sha, 'Candidate does not match PR head')
    const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
    assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
    status(pr.head.sha, 'success', `Certified candidate ${id}`, release.html_url)
  } catch (error) {
    status(pr.head.sha, 'pending', error.message, pr.html_url)
  }
}

function publicationContext() {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const pr = event.pull_request || repoApi(`pulls/${process.env.RELEASE_PR_NUMBER}`)
  assert(
    pr.merged &&
      pr.base.ref === 'main' &&
      pr.head.repo.full_name === repository &&
      pr.head.ref.startsWith('release/'),
    'Publication requires a merged release PR'
  )
  const version = pr.head.ref.slice(8)
  assert(/^\d+\.\d+\.\d+$/.test(version), 'Invalid release branch version')
  return { pr, version }
}

function publish() {
  const { pr, version } = publicationContext()
  const releases = JSON.parse(
    command('gh', ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])
  ).flat()
  const mode = publicationMode(releases, version)
  if (mode.operation === 'verify') {
    verifyPublished(mode.release, pr)
    output('release-version', version)
    output('source-revision', readJson(join(directory, 'candidate.json')).sourceRevision)
    return
  }
  const drafts = releases
    .filter(item => item.draft && item.tag_name.startsWith(`candidate-${version}-`))
    .sort((a, b) => b.id - a.id)
  let match
  for (const release of drafts) {
    const loaded = loadCandidate(release, directory)
    if (
      loaded.candidate.sourceRevision === pr.head.sha &&
      release.assets.some(item => item.name === 'certification.json')
    ) {
      match = { release, ...loaded }
      break
    }
  }
  assert(match, 'No certified candidate exists for the merged PR')
  const { release, candidate, bytes } = match
  assertIdentity(candidate)
  const latestRuns = repoApi(
    `actions/workflows/release.yml/runs?branch=${encodeURIComponent(candidate.branch)}&per_page=1`
  )
  assertLatestRun(candidate, latestRuns.workflow_runs[0] || {})
  assertMerged(candidate, git(['rev-parse', `${pr.merge_commit_sha}^{tree}`]))
  assert(
    candidate.build.updaterPublicKey ===
      readJson('src-tauri/tauri.conf.json').plugins.updater.pubkey,
    'Updater key changed'
  )
  const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
  assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
  verifyFinalized(release, candidate)
  // Detect draft mutation during downloads before changing its publication state.
  assertCertified(
    candidate,
    certification,
    bytes,
    completeInventory(releaseById(release.id), candidate)
  )
  const tag = `v${version}`
  const tags = repoApi(`git/matching-refs/tags/${tag}`)
  assert(
    !tags.some(item => item.ref === `refs/tags/${tag}`),
    'Production version tag already exists'
  )
  const publicReleases = releases.filter(
    item => !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/.test(item.tag_name)
  )
  const newer = publicReleases.some(item => compareVersions(item.tag_name.slice(1), version) >= 0)
  assert(!newer, 'Release version must be newer than published versions')
  const latestBeforePublish = repoApi(
    `actions/workflows/release.yml/runs?branch=${encodeURIComponent(candidate.branch)}&per_page=1`
  )
  assertLatestRun(candidate, latestBeforePublish.workflow_runs[0] || {})
  // Updating the draft is retryable. Do not create a tag separately from publication.
  repoApi(`releases/${release.id}`, 'PATCH', {
    tag_name: tag,
    target_commitish: pr.merge_commit_sha,
    name: `ClipsX ${tag}`,
    prerelease: false,
    draft: false,
    make_latest: 'true',
  })
  verifyPublished(releaseById(release.id), pr)
  output('release-version', version)
  output('source-revision', candidate.sourceRevision)
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number),
    b = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

function configureReadiness() {
  const workflow = repoApi('actions/workflows/release-readiness.yml')
  assert(workflow.state === 'active', 'Deploy the readiness workflow on main first')
  repoApi('contents/.github/workflows/release-readiness.yml?ref=main')
  const rulesets = repoApi('rulesets')
  const rules = rulesets
    .map(item => repoApi(`rulesets/${item.id}`))
    .filter(
      item =>
        item.enforcement === 'active' &&
        item.conditions?.ref_name?.include?.includes('refs/heads/main')
    )
  assert(rules.length === 1, 'Expected exactly one active ruleset protecting main')
  const rule = rules[0]
  const checks = rule.rules.find(item => item.type === 'required_status_checks')
  assert(checks, 'Existing main ruleset has no required-check rule')
  if (checks.parameters.required_status_checks.some(item => item.context === 'Release readiness'))
    return
  checks.parameters.required_status_checks.push({ context: 'Release readiness' })
  repoApi(`rulesets/${rule.id}`, 'PUT', {
    name: rule.name,
    target: rule.target,
    enforcement: rule.enforcement,
    bypass_actors: rule.bypass_actors,
    conditions: rule.conditions,
    rules: rule.rules,
  })
  console.log('Release readiness added. All existing rules and checks were retained.')
}

function configurePublic() {
  validateProductionEnvironment(process.env)
  const variables = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_NEXT_PUBLIC_SITE_URL: process.env.VITE_NEXT_PUBLIC_SITE_URL,
    SENTRY_DESKTOP_DSN: process.env.VITE_SENTRY_DSN || process.env.SENTRY_DSN,
  }
  assert(variables.SENTRY_DESKTOP_DSN, 'A public desktop Sentry DSN is required')
  if (process.env.WINDOWS_SIGNING_CERT_THUMBPRINT) {
    assert(
      /^[a-fA-F0-9]{40}$/.test(process.env.WINDOWS_SIGNING_CERT_THUMBPRINT),
      'Invalid Windows certificate thumbprint'
    )
    variables.WINDOWS_SIGNING_CERT_THUMBPRINT =
      process.env.WINDOWS_SIGNING_CERT_THUMBPRINT.toUpperCase()
  }
  for (const [name, value] of Object.entries(variables)) {
    command('gh', ['variable', 'set', name, '--repo', repository, '--body', value])
    console.log(`Configured public repository variable ${name}`)
  }
}

function upgradeFeed(id, port = '8787') {
  assert(
    /^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535,
    'Invalid loopback port'
  )
  const { release, candidate } = fresh(id)
  assert(candidate.finalizedAt, 'Finalize the candidate before testing upgrades')
  const files = verifiedFiles(release, candidate)
  validateInventory(candidate, files)
  const manifest = JSON.parse(downloadAsset(release, 'latest.json', directory))
  for (const entry of Object.values(manifest.platforms)) {
    const file = basename(new URL(entry.url).pathname)
    assert(files.has(file), 'Unknown updater file in manifest')
    entry.url = `http://127.0.0.1:${port}/${file}`
  }
  files.set('latest.json', Buffer.from(encode(manifest)))
  const overlay = {
    version: '0.0.0',
    bundle: { createUpdaterArtifacts: false },
    plugins: {
      updater: {
        endpoints: [`http://127.0.0.1:${port}/latest.json`],
        pubkey: candidate.build.updaterPublicKey,
        dangerousInsecureTransportProtocol: true,
      },
    },
  }
  const overlayPath = join(directory, 'PRIVATE-upgrade-fixture.conf.json')
  writeFileSync(overlayPath, encode(overlay))
  const server = createServer((request, response) => {
    const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname.slice(1)
    const bytes = files.get(path)
    if (!bytes || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'Content-Type': path === 'latest.json' ? 'application/json' : 'application/octet-stream',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
    })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  })
  server.listen(Number(port), '127.0.0.1', () =>
    console.log(
      `Private test feed on http://127.0.0.1:${port}. Fixture overlay: ${overlayPath}. Never ship this overlay. Ctrl+C stops the feed.`
    )
  )
}

function verifyPublished(release, pr) {
  const { candidate, bytes } = loadCandidate(release, directory)
  assert(
    release.tag_name === `v${candidate.version}` && !release.draft && !release.prerelease,
    'Unexpected published release identity'
  )
  let tagObject = repoApi(`git/ref/tags/${release.tag_name}`).object
  while (tagObject.type === 'tag') tagObject = repoApi(`git/tags/${tagObject.sha}`).object
  const tagCommit = tagObject.sha
  assert(tagCommit === pr.merge_commit_sha, 'Production tag points to a different merged commit')
  assert(candidate.sourceRevision === pr.head.sha, 'Published candidate does not match merged PR')
  assertMerged(candidate, git(['rev-parse', `${pr.merge_commit_sha}^{tree}`]))
  const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
  assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
  verifyFinalized(release, candidate)
  const manifests = {}
  const isLatest = repoApi('releases/latest').id === release.id
  for (const name of ['latest.json', 'downloads.json']) {
    const response = command('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '60',
      `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`,
    ])
    manifests[name] = JSON.parse(response)
    assert(
      encode(manifests[name]) === encode(readJson(join(directory, name))),
      `Public manifest changed: ${name}`
    )
    if (isLatest) {
      const stable = command('curl', [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        '60',
        `https://github.com/${repository}/releases/latest/download/${name}`,
      ])
      assert(
        encode(JSON.parse(stable)) === encode(manifests[name]),
        `Stable discovery endpoint differs: ${name}`
      )
    }
  }
  assert(
    manifests['latest.json'].version === candidate.version &&
      manifests['downloads.json'].sourceRevision === candidate.sourceRevision,
    'Public manifest identity mismatch'
  )
  for (const item of candidate.artifacts) {
    const path = join(directory, item.file)
    command('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '300',
      '--output',
      path,
      `https://github.com/${repository}/releases/download/${release.tag_name}/${item.file}`,
    ])
    assert(
      digest(readFileSync(path)) === item.sha256,
      `Public download hash mismatch: ${item.file}`
    )
    if (!item.file.endsWith('.dmg')) {
      command('curl', [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        '60',
        '--output',
        `${path}.sig`,
        `https://github.com/${repository}/releases/download/${release.tag_name}/${item.file}.sig`,
      ])
      verifySignature(path, `${path}.sig`, candidate.build.updaterPublicKey)
    }
  }
}

export function main(args) {
  const [operation, ...parameters] = args
  mkdirSync(directory, { recursive: true })
  switch (operation) {
    case 'initialize':
      return initialize()
    case 'collect':
      return collect(...parameters)
    case 'windows-kit':
      return windowsKit()
    case 'stage':
      return stage()
    case 'prepare-windows':
      return prepareWindows(...parameters)
    case 'submit-windows':
      return submitWindows(...parameters)
    case 'download-windows':
      return downloadWindows(...parameters)
    case 'finalize':
      return finalize(...parameters)
    case 'certify':
      return certify(...parameters)
    case 'readiness':
      return readiness()
    case 'publish':
      return publish()
    case 'configure-readiness':
      return configureReadiness()
    case 'configure-public':
      return configurePublic()
    case 'upgrade-feed':
      return upgradeFeed(...parameters)
    default:
      throw new Error(`Unknown release operation: ${operation}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
