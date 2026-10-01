import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

export const repository = 'azure06/clipsx'
export const readinessContext = 'Release readiness'
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const encode = value => `${JSON.stringify(value, null, 2)}\n`
export const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
export const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function validateVersion(branch, npmVersion, cargoVersion, tauriVersion) {
  assert(versionPattern.test(tauriVersion), 'Production releases require a stable numeric version')
  assert(
    branch === `release/${tauriVersion}`,
    'Use release/<version> matching the application version'
  )
  assert(
    npmVersion === tauriVersion && cargoVersion === tauriVersion,
    'npm, Cargo and Tauri versions must match'
  )
  return tauriVersion
}

export function assertIdentity(candidate) {
  assert(candidate.schemaVersion === 1, 'Unsupported candidate schema')
  assert(versionPattern.test(candidate.version), 'Invalid candidate version')
  assert(
    /^[a-f0-9]{40}$/.test(candidate.sourceRevision) && /^[a-f0-9]{40}$/.test(candidate.sourceTree),
    'Invalid source identity'
  )
  assert(
    /^\d+$/.test(String(candidate.runId)) && /^\d+$/.test(String(candidate.runAttempt)),
    'Invalid workflow identity'
  )
  assert(candidate.branch === `release/${candidate.version}`, 'Candidate branch mismatch')
  assert(
    candidate.id === `${candidate.version}-${candidate.runId}-${candidate.runAttempt}`,
    'Candidate ID mismatch'
  )
  assert(candidate.stagingTag === `candidate-${candidate.id}`, 'Candidate staging tag mismatch')
  assert(
    candidate.build?.updaterPublicKey && candidate.build?.production === true,
    'Missing production build identity'
  )
}

export function assertCurrent(candidate, branchSha, run) {
  assertIdentity(candidate)
  assert(branchSha === candidate.sourceRevision, 'Candidate has been superseded by a source push')
  assert(
    String(run.id) === String(candidate.runId) &&
      String(run.run_attempt) === String(candidate.runAttempt),
    'Candidate has been superseded by another build'
  )
  assert(
    run.head_sha === candidate.sourceRevision && run.conclusion === 'success',
    'Candidate preparation must finish successfully'
  )
}

export const targets = [
  {
    id: 'windows-x64',
    platform: 'windows',
    architecture: 'x64',
    format: '.exe',
    updaterTarget: 'windows-x86_64-nsis',
    suffix: 'windows-x64-setup.exe',
    signed: true,
    notarized: false,
  },
  {
    id: 'macos-arm64',
    platform: 'macos',
    architecture: 'arm64',
    format: '.dmg',
    updaterTarget: 'darwin-aarch64-app',
    suffix: 'darwin-aarch64.dmg',
    signed: true,
    notarized: true,
  },
  {
    id: 'macos-x64',
    platform: 'macos',
    architecture: 'x64',
    format: '.dmg',
    updaterTarget: 'darwin-x86_64-app',
    suffix: 'darwin-x86_64.dmg',
    signed: true,
    notarized: true,
  },
  {
    id: 'linux-appimage-x64',
    platform: 'linux',
    architecture: 'x64',
    format: 'AppImage',
    updaterTarget: 'linux-x86_64-appimage',
    suffix: 'linux-x64.AppImage',
    signed: false,
    notarized: false,
  },
  {
    id: 'linux-deb-x64',
    platform: 'linux',
    architecture: 'x64',
    format: '.deb',
    updaterTarget: 'linux-x86_64-deb',
    suffix: 'linux-x64.deb',
    signed: false,
    notarized: false,
  },
]
export const assetName = (version, suffix) => `ClipsX_${version}_${suffix}`
export const assetUrl = (version, file) =>
  `https://github.com/${repository}/releases/download/v${version}/${file}`

export function validateInventory(candidate, files) {
  assertIdentity(candidate)
  const names = new Set()
  for (const artifact of candidate.artifacts) {
    assert(
      artifact.file === basename(artifact.file) && /^[a-zA-Z0-9_.-]+$/.test(artifact.file),
      'Unsafe asset filename'
    )
    assert(!names.has(artifact.file), 'Duplicate asset filename')
    names.add(artifact.file)
    const bytes = files.get(artifact.file)
    assert(
      bytes && digest(bytes) === artifact.sha256 && bytes.length === artifact.size,
      `Artifact changed: ${artifact.file}`
    )
  }
  for (const target of targets) {
    const expected = assetName(candidate.version, target.suffix)
    assert(names.has(expected), `Missing platform artifact: ${target.id}`)
    if (target.platform === 'macos') {
      assert(
        names.has(expected.replace(/\.dmg$/, '.app.tar.gz')),
        `Missing Mac updater archive: ${target.id}`
      )
    }
  }
}

export function createManifests(candidate, signatures, notes, date) {
  const platforms = {}
  const downloads = []
  for (const target of targets) {
    const file = assetName(candidate.version, target.suffix)
    const artifact = candidate.artifacts.find(item => item.file === file)
    assert(artifact, `Missing download: ${target.id}`)
    const updaterFile = target.platform === 'macos' ? file.replace(/\.dmg$/, '.app.tar.gz') : file
    const signature = signatures[updaterFile]?.trim()
    assert(
      signature && /^[A-Za-z0-9+/=]+$/.test(signature),
      `Missing updater signature: ${target.id}`
    )
    platforms[target.updaterTarget] = { url: assetUrl(candidate.version, updaterFile), signature }
    downloads.push({
      id: target.id,
      platform: target.platform,
      architecture: target.architecture,
      format: target.format,
      url: assetUrl(candidate.version, file),
      sha256: artifact.sha256,
      signed: target.signed,
      notarized: target.notarized,
    })
  }
  // Retain OS/architecture fallback entries for previously installed clients.
  for (const [fallback, specific] of Object.entries({
    'windows-x86_64': 'windows-x86_64-nsis',
    'darwin-aarch64': 'darwin-aarch64-app',
    'darwin-x86_64': 'darwin-x86_64-app',
    'linux-x86_64': 'linux-x86_64-appimage',
  }))
    platforms[fallback] = platforms[specific]
  return {
    updater: { version: candidate.version, notes, pub_date: date, platforms },
    downloads: {
      schemaVersion: 1,
      version: candidate.version,
      tag: `v${candidate.version}`,
      sourceRevision: candidate.sourceRevision,
      targets: downloads,
    },
  }
}

export function assertCertified(candidate, certification, candidateBytes, inventory) {
  assert(
    certification.schemaVersion === 1 && certification.candidateId === candidate.id,
    'Certification belongs to another candidate'
  )
  assert(
    certification.sourceRevision === candidate.sourceRevision &&
      certification.sourceTree === candidate.sourceTree,
    'Certification source mismatch'
  )
  assert(
    certification.candidateSha256 === digest(candidateBytes),
    'Candidate changed after certification'
  )
  assert(
    certification.inventorySha256 === digest(encode(inventory)),
    'Release assets changed after certification'
  )
  assert(
    certification.evidence && targets.every(target => certification.platforms.includes(target.id)),
    'Missing installed-platform certification'
  )
}

export function assertManifests(candidate, signatures, notes, updater, downloads, checksums) {
  const expected = createManifests(candidate, signatures, notes, candidate.createdAt)
  assert(
    encode(updater) === encode(expected.updater),
    'Updater manifest differs from finalized inventory'
  )
  assert(
    encode(downloads) === encode(expected.downloads),
    'Download manifest differs from finalized inventory'
  )
  const expectedChecksums =
    candidate.artifacts
      .map(item => `${item.sha256}  ${item.file}`)
      .sort()
      .join('\n') + '\n'
  assert(checksums === expectedChecksums, 'Checksums differ from finalized inventory')
}

export function assertLatestRun(candidate, run) {
  assertCurrent(candidate, candidate.sourceRevision, run)
}

export function publicationMode(releases, version) {
  const existing = releases.find(item => item.tag_name === `v${version}`)
  if (!existing) return { operation: 'publish' }
  assert(!existing.draft && !existing.prerelease, 'Conflicting production release')
  return { operation: 'verify', release: existing }
}

export function assertMerged(candidate, tree) {
  assert(tree === candidate.sourceTree, 'Merged source tree differs from certified candidate')
}

// Authenticode may change only the checksum, certificate-directory entry and
// appended certificate table. Hash the original image while excluding those fields.
export function imageDigest(bytes, originalSize = bytes.length) {
  assert(bytes.length >= originalSize && originalSize > 256, 'Invalid executable size')
  assert(bytes.subarray(0, 2).toString() === 'MZ', 'Expected a Windows PE executable')
  const pe = bytes.readUInt32LE(0x3c)
  assert(
    pe + 24 + 144 < originalSize && bytes.subarray(pe, pe + 4).equals(Buffer.from([80, 69, 0, 0])),
    'Invalid PE header'
  )
  const optional = pe + 24
  const magic = bytes.readUInt16LE(optional)
  assert(magic === 0x10b || magic === 0x20b, 'Unknown PE format')
  const security = optional + (magic === 0x20b ? 112 : 96) + 32
  const certificateOffset = bytes.readUInt32LE(security)
  const certificateSize = bytes.readUInt32LE(security + 4)
  if (bytes.length !== originalSize || certificateSize) {
    assert(
      certificateOffset >= originalSize && certificateOffset + certificateSize === bytes.length,
      'Unexpected data outside the signed image'
    )
    assert(
      bytes.subarray(originalSize, certificateOffset).every(value => value === 0),
      'Unexpected signature padding'
    )
  }
  const image = Buffer.from(bytes.subarray(0, originalSize))
  image.fill(0, optional + 64, optional + 68)
  image.fill(0, security, security + 8)
  return digest(image)
}
