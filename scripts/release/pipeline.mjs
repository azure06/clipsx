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
  appInputs,
  inputsDigest,
  assertAppInputs,
  publicEnvironment,
  assertPublicEnvironment,
} from './inputs.mjs'
import {
  platforms as buildPlatforms,
  legacyRun,
  legacySource,
  loadBuild,
  restorePlatform,
  verifyExecutable,
  artifactRecord,
  validateBuildDescriptor,
  preparationTargets,
} from './builds.mjs'
import {
  assert,
  assertCertified,
  assertIdentity,
  assertBuildRun,
  assertMutable,
  selectedCandidate,
  assertManifests,
  assetName,
  createManifests,
  candidateDraftMetadata,
  certificationChecks,
  digest,
  encode,
  imageDigest,
  nsisImageDigest,
  publicationMode,
  readJson,
  repository,
  targets,
  validateInventory,
  validateVersion,
} from './model.mjs'
import {
  command,
  expandZip,
  source,
  workflowArtifacts,
  downloadArtifact,
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
    schemaVersion: 2,
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
      origin: { runId, attempt: runAttempt, sourceRevision: git(['rev-parse', 'HEAD']), branch },
      appInputs: appInputs(),
      appInputsSha256: inputsDigest(appInputs()),
      publicEnvironment: publicEnvironment(),
      recipeRevision: process.env.RELEASE_RECIPE_REVISION || git(['rev-parse', 'HEAD']),
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
  if (platform.startsWith('macos-') && candidate.version !== '0.1.0')
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

function windowsKit() {
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

function checkedFrontend() {
  const candidate = readJson(join(directory, 'candidate.json'))
  return checkFrontend(process.cwd(), true, {
    GITHUB_RUN_ID: candidate.build.origin.runId,
    BUILD_RUN_ATTEMPT: candidate.build.origin.attempt,
  })
}

function summarize(text) {
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
}
function assertOrigin(candidate) {
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
function fresh(id) {
  const release = findCandidate(id)
  const { candidate, bytes } = loadCandidate(release, directory)
  assertOrigin(candidate)
  return { release, candidate, bytes }
}
function selectForPr(candidate, release, prNumber) {
  const pulls = prNumber
    ? [repoApi(`pulls/${prNumber}`)]
    : repoApi(
        `pulls?state=open&base=main&head=${encodeURIComponent(`azure06:${candidate.branch}`)}`
      )
  for (const pr of pulls) {
    assert(
      pr.base.ref === 'main' &&
        pr.head.ref === candidate.branch &&
        pr.head.repo.full_name === repository,
      'Wrong release PR'
    )
    // Automatic preparation does not replace a maintainer's existing selection.
    if (!prNumber && selectedCandidate(pr.body)) continue
    const body = (pr.body || '').replace(/\n?<!-- clipsx-release-candidate: [^\n]* -->/g, '')
    repoApi(`pulls/${pr.number}`, 'PATCH', {
      body: `${body}\n<!-- clipsx-release-candidate: ${candidate.id} -->`,
    })
    status(pr.head.sha, 'pending', `Awaiting Windows signing: ${candidate.id}`, release.html_url)
  }
}
function migrateLegacy(dryRun = false) {
  const release = findCandidate(`0.1.0-${legacyRun}-1`)
  const { candidate } = loadCandidate(release, directory)
  if (candidate.schemaVersion === 2) {
    assertOrigin(candidate)
    return { release, candidate }
  }
  assert(
    candidate.schemaVersion === 1 &&
      candidate.sourceRevision === legacySource &&
      candidate.runId === legacyRun &&
      String(candidate.runAttempt) === '1',
    'Only the verified 0.1.0 build can be migrated'
  )
  assertMutable(candidate, release)
  const origin = {
    runId: legacyRun,
    attempt: '1',
    sourceRevision: legacySource,
    branch: 'release/0.1.0',
  }
  assertBuildRun(repoApi(`actions/runs/${legacyRun}/attempts/1`), origin)
  source(legacySource)
  const artifacts = workflowArtifacts(legacyRun)
  const frontend = artifacts.find(item => item.name === 'frontend-1')
  const frontendPath = join(directory, 'legacy-frontend')
  downloadArtifact(frontend, frontendPath)
  const manifest = readJson(join(frontendPath, 'frontend.json'))
  assert(
    manifest.sourceRevision === legacySource &&
      manifest.runId === legacyRun &&
      manifest.runAttempt === '1',
    'Legacy frontend identity mismatch'
  )
  candidate.schemaVersion = 2
  candidate.build.origin = origin
  candidate.build.frontendArtifact = artifactRecord(frontend)
  candidate.build.frontend = manifest
  candidate.build.appInputs = appInputs(legacySource)
  candidate.build.appInputsSha256 = inputsDigest(candidate.build.appInputs)
  candidate.build.publicEnvironment = publicEnvironment(candidate.build.publicEnvironment)
  candidate.build.platforms = {}
  for (const platform of Object.keys(buildPlatforms)) {
    const artifact = artifacts.find(item => item.name === `compiled-${platform}-1`)
    const path = join(directory, 'legacy', platform)
    downloadArtifact(artifact, path)
    command('tar', ['-xzf', resolve(path, 'compiled.tar.gz')])
    const checkpoint = readJson('.release/compiled.json')
    const binary = `src-tauri/target/${buildPlatforms[platform].target}/release/clipsx${platform === 'windows-x64' ? '.exe' : ''}`
    verifyExecutable(
      readFileSync(binary),
      checkpoint,
      candidate,
      platform,
      readFileSync(join(frontendPath, 'frontend.json'))
    )
    candidate.build.platforms[platform] = { ...checkpoint, artifact: artifactRecord(artifact) }
  }
  const kit = artifacts.find(item => item.name === 'windows-signing-inputs-1')
  const kitPath = join(directory, 'legacy-kit')
  downloadArtifact(kit, kitPath)
  for (const file of candidate.windowsKit)
    assert(
      digest(readFileSync(join(kitPath, file.file))) === file.sha256,
      'Legacy Windows kit changed'
    )
  candidate.windowsKitArtifact = artifactRecord(kit)
  delete candidate.windowsImage
  verifiedFiles(release, candidate)
  candidate.preparation = Object.fromEntries(
    ['macos-arm64', 'macos-x64', 'linux-x64'].map(platform => {
      const name = `native-evidence-${platform}.json`
      const evidence = JSON.parse(downloadAsset(release, name, directory))
      assert(
        evidence.candidateId === candidate.id &&
          evidence.sourceRevision === legacySource &&
          evidence.verified === true &&
          evidence.runId === legacyRun,
        'Legacy signing evidence mismatch'
      )
      return [
        platform,
        { toolingRevision: legacySource, runId: legacyRun, runAttempt: '1', evidence: name },
      ]
    })
  )
  candidate.migration = {
    originalDescriptorSha256: digest(downloadAsset(release, 'candidate.json', directory)),
    toolingRevision: git(['rev-parse', 'HEAD']),
    at: new Date().toISOString(),
  }
  candidate.releaseNotesSha256 = digest(downloadAsset(release, 'release-notes.md', directory))
  validateBuildDescriptor(candidate, repoApi(`actions/runs/${legacyRun}/attempts/1`), artifacts)
  if (dryRun) writeFileSync(join(directory, 'migrated-candidate.json'), encode(candidate))
  else writeAsset(release, 'candidate.json', candidate, directory)
  summarize(
    `Imported candidate ${candidate.id}. Existing Mac/Linux assets preserved. **Zero app/frontend builds.**\nNext: Windows signing.`
  )
  return { release, candidate }
}
function prepare(runId, id, target = 'missing', prNumber) {
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
  if (String(runId) === legacyRun && (!id || id === `0.1.0-${legacyRun}-1`))
    ({ release, candidate } = migrateLegacy())
  else if (id) ({ release, candidate } = fresh(id))
  else {
    candidate = loadBuild(runId, join(directory, 'build'))
    candidate.runId = process.env.GITHUB_RUN_ID
    candidate.runAttempt = process.env.GITHUB_RUN_ATTEMPT
    candidate.id = `${candidate.version}-${candidate.runId}-${candidate.runAttempt}`
    candidate.stagingTag = `candidate-${candidate.id}`
    candidate.createdAt = new Date().toISOString()
    candidate.preparation = {}
    source(candidate.sourceRevision)
    candidate.releaseNotesSha256 = digest(
      command('git', ['show', `${candidate.sourceRevision}:docs/releases/${candidate.version}.md`])
    )
    assertIdentity(candidate)
    release = repoApi('releases', 'POST', {
      tag_name: candidate.stagingTag,
      target_commitish: git(['rev-parse', 'HEAD']),
      name: `Candidate ${candidate.id}`,
      body: `Build ${runId}; awaiting packaging and Windows signing.`,
      draft: true,
      prerelease: true,
    })
    writeAsset(
      release,
      'release-notes.md',
      command('git', ['show', `${candidate.sourceRevision}:docs/releases/${candidate.version}.md`]),
      directory
    )
    writeAsset(release, 'candidate.json', candidate, directory)
  }
  assert(
    String(runId) === String(candidate.build.origin.runId),
    'Candidate belongs to another build'
  )
  assertMutable(candidate, release)
  assertPublicEnvironment(candidate)
  loadBuild(runId, join(directory, 'build'), candidate)
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
function restore(id, platform) {
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
function stagePlatform(id, platform) {
  const { release, candidate } = fresh(id)
  assertMutable(candidate, release)
  const local = readJson(join(directory, platform, `platform-${platform}.json`))
  assert(local.candidateId === id, 'Mixed candidate platform output')
  for (const item of [...local.artifacts, local.evidence])
    assert(
      digest(readFileSync(join(directory, platform, item.file))) === item.sha256,
      'Platform output changed'
    )
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
  writeAsset(release, 'candidate.json', candidate, directory)
}
function packageSource(id) {
  const { candidate } = fresh(id)
  assertMutable(candidate, findCandidate(id))
  command('git', ['init'])
  command('git', ['remote', 'add', 'origin', `https://github.com/${repository}.git`])
  source(candidate.sourceRevision)
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
function stagePrepared(id) {
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
    if (platform === 'windows-x64') stageWindows(id)
    else stagePlatform(id, platform)
  }
  summarize(
    `Candidate ${id}: successful outputs saved. Next: local Windows signing, then finalization and installed tests.`
  )
}
function prepareWindows(id) {
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
  if (!candidate.windowsImages['clipsx.exe'].bundleType) {
    assert(
      imageDigest(executable) === candidate.windowsImages['clipsx.exe'].sha256,
      'Legacy Windows executable identity changed'
    )
    candidate.windowsImages['clipsx.exe'] = {
      size: executable.length,
      sha256: nsisImageDigest(executable),
      bundleType: 'nsis',
    }
    writeAsset(release, 'candidate.json', candidate, directory)
  }
  assert(
    nsisImageDigest(executable) === candidate.windowsImages['clipsx.exe'].sha256,
    'NSIS executable identity changed'
  )
  writeFileSync(join(directory, 'signing-candidate.json'), encode(candidate))
  console.log(candidate.id)
}
function stageWindows(id) {
  const local = readJson(join(directory, 'windows-kit', 'candidate.json'))
  const { release, candidate } = fresh(id)
  assertMutable(candidate, release)
  const artifact = workflowArtifacts(process.env.GITHUB_RUN_ID)
    .filter(item => item.name.startsWith(`windows-kit-${id}-`))
    .sort((a, b) => b.id - a.id)[0]
  assert(artifact && !artifact.expired, 'Windows packaging kit upload missing')
  candidate.windowsKit = local.windowsKit
  candidate.windowsImages = local.windowsImages
  candidate.windowsKitArtifact = { ...artifactRecord(artifact), runId: process.env.GITHUB_RUN_ID }
  candidate.build.frontend = local.build.frontend
  writeAsset(release, 'candidate.json', candidate, directory)
}

function submitWindows(id, installer, evidencePath) {
  const { release, candidate } = fresh(id)
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
  command(
    process.env.RELEASE_VERIFIER ||
      `tools/release-verify/target/release/clipsx-release-verify${process.platform === 'win32' ? '.exe' : ''}`,
    [publicKey, file, signature]
  )
}

function verifyFinalized(release, candidate) {
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

function finalize(id, windowsEvidencePath) {
  const { release, candidate, bytes: originalDescriptor } = fresh(id)
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
  candidate.finalization = {
    toolingRevision: git(['rev-parse', 'HEAD']),
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  }
  candidate.finalizedAt = new Date().toISOString()
  writeAsset(release, 'candidate.json', candidate, directory)
  repoApi(`releases/${release.id}`, 'PATCH', candidateDraftMetadata(candidate, release, notes))
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

function certify(id, prNumber) {
  assert(/^\d+$/.test(String(prNumber)), 'Select the release PR number')
  const pr = repoApi(`pulls/${prNumber}`)
  const { release, candidate, bytes } = fresh(id)
  assert(candidate.finalizedAt, 'Candidate must be finalized before certification')
  assert(
    pr.base.ref === 'main' &&
      pr.head.ref === candidate.branch &&
      pr.head.repo.full_name === repository &&
      pr.state === 'open',
    'Wrong release PR'
  )
  assertAppInputs(candidate, source(pr.head.sha))
  assertPublicEnvironment(candidate)
  assert(
    selectedCandidate(pr.body) === id,
    'Select this candidate on the release PR before certifying'
  )
  const checks = certificationChecks(
    id,
    prNumber,
    process.env.CERTIFY_ALL_PLATFORMS,
    process.env.CERTIFY_0_1_0_EXCEPTION
  )
  if (candidate.version !== '0.1.0') {
    assert(
      process.env.CERTIFY_MAC_EXTENSIONS === 'true',
      'Confirm installed extension installation, execution and restart on both Mac architectures'
    )
    checks.macExtensions = 'passed'
  }
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
    assert(existing.releasePrNumber === Number(prNumber), 'Candidate was certified for another PR')
    assertCertified(candidate, existing, bytes, inventory)
    status(pr.head.sha, 'success', `Certified candidate ${id}`, release.html_url)
    if (pr.draft) command('gh', ['pr', 'ready', String(prNumber), '--repo', repository])
    return
  }
  const certification = {
    schemaVersion: 2,
    releasePrNumber: Number(prNumber),
    appInputsSha256: candidate.build.appInputsSha256,
    candidateId: id,
    sourceRevision: candidate.sourceRevision,
    sourceTree: candidate.sourceTree,
    candidateSha256: digest(bytes),
    inventorySha256: digest(encode(inventory)),
    evidence,
    checks,
    platforms: targets.map(item => item.id),
    actor: process.env.GITHUB_ACTOR,
    toolingRevision: git(['rev-parse', 'HEAD']),
    certifiedAt: new Date().toISOString(),
  }
  writeAsset(release, 'certification.json', certification, directory)
  status(pr.head.sha, 'success', `Certified candidate ${id}`, release.html_url)
  if (pr.draft) command('gh', ['pr', 'ready', String(prNumber), '--repo', repository])
}

function readiness() {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const pulls = event.pull_request
    ? [repoApi(`pulls/${event.pull_request.number}`)]
    : repoApi('pulls?state=open&base=main&per_page=100')
  for (const pr of pulls) {
    if (!pr.head.ref.startsWith('release/')) {
      status(pr.head.sha, 'success', 'No desktop release is associated with this PR', pr.html_url)
      continue
    }
    try {
      assert(
        pr.head.repo.full_name === repository,
        'Release candidates must originate from this repository'
      )
      const id = selectedCandidate(pr.body)
      if (!id) {
        status(
          pr.head.sha,
          'pending',
          'Build/prepare a candidate, then select it for this PR',
          pr.html_url
        )
        continue
      }
      const { release, candidate, bytes } = fresh(id)
      assertAppInputs(candidate, source(pr.head.sha))
      assertPublicEnvironment(candidate)
      // CI coverage belongs to the selected successful build, even after docs-only pushes.
      repoApi(`statuses/${pr.head.sha}`, 'POST', {
        state: 'success',
        context: 'CI',
        description: `Verified build ${candidate.build.origin.runId}; app inputs match`,
        target_url: `https://github.com/${repository}/actions/runs/${candidate.build.origin.runId}`,
      })
      if (!candidate.finalizedAt) {
        const missing = ['macos-arm64', 'macos-x64', 'linux-x64'].filter(
          platform => !candidate.preparation?.[platform]
        )
        const message = missing.length
          ? `Awaiting packaging: ${missing.join(', ')}`
          : release.assets.some(item => item.name === 'windows-submission.json')
            ? 'Awaiting Windows verification and finalization'
            : 'Awaiting local Windows signing'
        status(pr.head.sha, 'pending', message, release.html_url)
        continue
      }
      if (!release.assets.some(item => item.name === 'certification.json')) {
        status(
          pr.head.sha,
          'pending',
          'Awaiting installed-platform and updater certification',
          release.html_url
        )
        continue
      }
      const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
      assert(
        certification.releasePrNumber === pr.number &&
          certification.appInputsSha256 === candidate.build.appInputsSha256,
        'Certification belongs to another release selection'
      )
      assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
      status(pr.head.sha, 'success', `Certified candidate ${id}`, release.html_url)
    } catch (error) {
      status(pr.head.sha, 'failure', error.message, pr.html_url)
      console.error(`Release PR ${pr.number}: ${error.message}`)
      process.exitCode = 1
    }
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
  const id = selectedCandidate(pr.body)
  assert(id, 'Merged PR has no explicit candidate selection')
  const release = releases.find(item => item.draft && item.tag_name === `candidate-${id}`)
  assert(release, 'Selected candidate draft does not exist')
  const { candidate, bytes } = loadCandidate(release, directory)
  assertOrigin(candidate)
  assertAppInputs(candidate, source(pr.merge_commit_sha))
  assertPublicEnvironment(candidate)
  const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
  assert(
    certification.releasePrNumber === pr.number &&
      certification.appInputsSha256 === candidate.build.appInputsSha256,
    'Certification selection mismatch'
  )
  assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
  verifyFinalized(release, candidate)
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
  writeFileSync(join(directory, 'ruleset-original.json'), encode(rule))
  const checks = rule.rules.find(item => item.type === 'required_status_checks')
  assert(checks, 'Existing main ruleset has no required-check rule')
  const proof = process.env.RELEASE_GATE_PROOF_SHA
  assert(
    /^[a-f0-9]{40}$/.test(proof || ''),
    'Provide RELEASE_GATE_PROOF_SHA for a successful infrastructure CI gate'
  )
  const runs = repoApi(`commits/${proof}/check-runs?per_page=100`).check_runs
  assert(
    runs.some(
      item =>
        item.name === 'CI' && item.app?.slug === 'github-actions' && item.conclusion === 'success'
    ),
    'Replacement CI gate has not passed'
  )
  const obsolete = new Set([
    'Frontend · Lint & Format',
    'Frontend · Test (ubuntu-latest)',
    'Frontend · Test (macos-latest)',
    'Frontend · Test (windows-latest)',
    'Rust · Fmt & Clippy',
    'Rust · Test (Linux)',
    'Rust · Test (macOS)',
    'Rust · Test (Windows)',
    'Build · Compile Check',
  ])
  checks.parameters.required_status_checks = checks.parameters.required_status_checks.filter(
    item => !obsolete.has(item.context)
  )
  for (const context of ['CI', 'Release readiness'])
    if (!checks.parameters.required_status_checks.some(item => item.context === context))
      checks.parameters.required_status_checks.push({ context })
  writeFileSync(join(directory, 'ruleset-before.json'), encode(rule))
  repoApi(`rulesets/${rule.id}`, 'PUT', {
    name: rule.name,
    target: rule.target,
    enforcement: rule.enforcement,
    bypass_actors: rule.bypass_actors,
    conditions: rule.conditions,
    rules: rule.rules,
  })
  console.log(
    'Obsolete check names replaced by proven CI. Release readiness and unrelated protections retained.'
  )
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
  assert(
    selectedCandidate(pr.body) === candidate.id,
    'Published candidate differs from selected release'
  )
  assertAppInputs(candidate, source(pr.merge_commit_sha))
  const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
  assert(
    certification.releasePrNumber === pr.number &&
      certification.appInputsSha256 === candidate.build.appInputsSha256,
    'Published certification selection mismatch'
  )
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
    case 'check-legacy':
      return migrateLegacy(true)
    case 'package-source':
      return packageSource(...parameters)
    case 'stage-prepared':
      return stagePrepared(...parameters)
    case 'prepare':
      return prepare(...parameters)
    case 'restore':
      return restore(...parameters)
    case 'stage-platform':
      return stagePlatform(...parameters)
    case 'stage-windows':
      return stageWindows(...parameters)
    case 'prepare-windows':
      return prepareWindows(...parameters)
    case 'submit-windows':
      return submitWindows(...parameters)
    case 'finalization-state': {
      const { candidate } = fresh(process.argv[3])
      output('finalized', String(Boolean(candidate.finalizedAt)))
      return
    }
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
