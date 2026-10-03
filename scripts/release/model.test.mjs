import test from 'node:test'
import nodeAssert from 'node:assert/strict'
import {
  assertCertified,
  assertBuildRun,
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
  targets,
  validateInventory,
  validateVersion,
} from './model.mjs'

const fixture = () => {
  const candidate = {
    schemaVersion: 2,
    id: '0.1.0-123-1',
    stagingTag: 'candidate-0.1.0-123-1',
    version: '0.1.0',
    branch: 'release/0.1.0',
    sourceRevision: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    runId: '123',
    runAttempt: '1',
    build: {
      production: true,
      updaterPublicKey: 'key',
      appInputsSha256: 'c'.repeat(64),
      origin: {
        runId: '123',
        sourceRevision: 'a'.repeat(40),
        branch: 'release/0.1.0',
        attempt: '1',
      },
    },
    artifacts: [],
  }
  const files = new Map()
  for (const target of targets) {
    const names = [assetName(candidate.version, target.suffix)]
    if (target.platform === 'macos') names.push(names[0].replace(/\.dmg$/, '.app.tar.gz'))
    for (const file of names) {
      const bytes = Buffer.from(file)
      files.set(file, bytes)
      candidate.artifacts.push({ file, size: bytes.length, sha256: digest(bytes) })
    }
  }
  return { candidate, files }
}

test('release identity requires matching stable versions', () => {
  nodeAssert.equal(validateVersion('release/0.1.0', '0.1.0', '0.1.0', '0.1.0'), '0.1.0')
  nodeAssert.throws(() => validateVersion('main', '0.1.0', '0.1.0', '0.1.0'))
  nodeAssert.throws(() => validateVersion('release/0.1.0', '0.1.1', '0.1.0', '0.1.0'))
  nodeAssert.throws(() =>
    validateVersion('release/0.1.0-rc.1', '0.1.0-rc.1', '0.1.0-rc.1', '0.1.0-rc.1')
  )
})
test('selected builds require successful repository-owned release workflow provenance', () => {
  const { candidate } = fixture()
  const origin = candidate.build.origin
  const run = {
    id: 123,
    run_attempt: 1,
    head_sha: candidate.sourceRevision,
    head_repository: { full_name: 'azure06/clipsx' },
    head_branch: candidate.branch,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    path: '.github/workflows/release.yml',
  }
  assertBuildRun(run, origin)
  nodeAssert.throws(() => assertBuildRun({ ...run, run_attempt: 2 }, origin))
  for (const changed of [
    { head_sha: 'c'.repeat(40) },
    { id: 124 },
    { conclusion: 'failure' },
    { path: '.github/workflows/ci.yml' },
    { event: 'pull_request' },
    { head_repository: { full_name: 'attacker/clipsx' } },
  ])
    nodeAssert.throws(() => assertBuildRun({ ...run, ...changed }, origin))
})
test('incomplete, tampered, duplicate and unsafe inventories are rejected', () => {
  const { candidate, files } = fixture()
  validateInventory(candidate, files)
  files.set(candidate.artifacts[0].file, Buffer.from('tampered'))
  nodeAssert.throws(() => validateInventory(candidate, files))
  const second = fixture()
  second.candidate.artifacts.pop()
  nodeAssert.throws(() => validateInventory(second.candidate, second.files))
  const third = fixture()
  third.candidate.artifacts.push(third.candidate.artifacts[0])
  nodeAssert.throws(() => validateInventory(third.candidate, third.files))
  const fourth = fixture()
  fourth.candidate.artifacts[0].file = '../setup.exe'
  nodeAssert.throws(() => validateInventory(fourth.candidate, fourth.files))
})
test('updater routing uses the matching format and architecture with compatible fallbacks', () => {
  const { candidate } = fixture()
  const signatures = Object.fromEntries(
    candidate.artifacts.filter(item => !item.file.endsWith('.dmg')).map(item => [item.file, 'YWJj'])
  )
  const { updater, downloads } = createManifests(
    candidate,
    signatures,
    'Notes',
    '2026-10-01T00:00:00Z'
  )
  nodeAssert.equal(downloads.targets.length, 5)
  nodeAssert.match(updater.platforms['windows-x86_64-nsis'].url, /setup\.exe$/)
  nodeAssert.match(updater.platforms['linux-x86_64-deb'].url, /\.deb$/)
  nodeAssert.match(updater.platforms['linux-x86_64-appimage'].url, /\.AppImage$/)
  nodeAssert.match(updater.platforms['darwin-aarch64-app'].url, /darwin-aarch64\.app\.tar\.gz$/)
  nodeAssert.deepEqual(
    updater.platforms['windows-x86_64'],
    updater.platforms['windows-x86_64-nsis']
  )
  nodeAssert.throws(() => createManifests(candidate, {}, 'Notes', 'date'))
})
test('certification binds source and complete draft inventory', () => {
  const { candidate } = fixture()
  const bytes = Buffer.from(encode(candidate)),
    inventory = [{ file: 'latest.json', sha256: 'c'.repeat(64), size: 20 }]
  const certification = {
    schemaVersion: 2,
    candidateId: candidate.id,
    sourceRevision: candidate.sourceRevision,
    sourceTree: candidate.sourceTree,
    candidateSha256: digest(bytes),
    inventorySha256: digest(encode(inventory)),
    evidence: 'https://example.com/evidence',
    platforms: targets.map(item => item.id),
  }
  assertCertified(candidate, certification, bytes, inventory)
  nodeAssert.throws(() =>
    assertCertified(candidate, certification, Buffer.from('changed'), inventory)
  )
  nodeAssert.throws(() =>
    assertCertified(candidate, certification, bytes, [
      ...inventory,
      { file: 'extra', sha256: 'd'.repeat(64), size: 1 },
    ])
  )
  nodeAssert.throws(() =>
    assertCertified(candidate, { ...certification, platforms: [] }, bytes, inventory)
  )
})
test('signed PE image verification permits only Authenticode changes', () => {
  const original = Buffer.alloc(512)
  original.write('MZ')
  original.writeUInt32LE(64, 0x3c)
  original.write('PE\0\0', 64)
  original.writeUInt16LE(0x20b, 88)
  original[400] = 42
  const signed = Buffer.concat([original, Buffer.alloc(32, 9)])
  signed.writeUInt32LE(123, 88 + 64)
  signed.writeUInt32LE(512, 88 + 112 + 32)
  signed.writeUInt32LE(32, 88 + 112 + 36)
  nodeAssert.equal(imageDigest(signed, original.length), imageDigest(original))
  signed[400] = 43
  nodeAssert.notEqual(imageDigest(signed, original.length), imageDigest(original))
  nodeAssert.throws(() =>
    imageDigest(Buffer.concat([signed, Buffer.from('extra')]), original.length)
  )
})

test('manifests and checksum routing cannot drift from the certified inventory', () => {
  const { candidate } = fixture()
  candidate.createdAt = '2026-10-01T00:00:00Z'
  const signatures = Object.fromEntries(
    candidate.artifacts.filter(item => !item.file.endsWith('.dmg')).map(item => [item.file, 'YWJj'])
  )
  const manifests = createManifests(candidate, signatures, 'Notes', candidate.createdAt)
  const sums =
    candidate.artifacts
      .map(item => `${item.sha256}  ${item.file}`)
      .sort()
      .join('\n') + '\n'
  assertManifests(candidate, signatures, 'Notes', manifests.updater, manifests.downloads, sums)
  const changed = structuredClone(manifests)
  changed.updater.platforms['linux-x86_64-deb'].url =
    changed.updater.platforms['linux-x86_64-appimage'].url
  nodeAssert.throws(() =>
    assertManifests(candidate, signatures, 'Notes', changed.updater, manifests.downloads, sums)
  )
  changed.downloads.targets[0].sha256 = 'e'.repeat(64)
  nodeAssert.throws(() =>
    assertManifests(candidate, signatures, 'Notes', manifests.updater, changed.downloads, sums)
  )
  nodeAssert.throws(() =>
    assertManifests(
      candidate,
      signatures,
      'Notes',
      manifests.updater,
      manifests.downloads,
      'changed'
    )
  )
})

test('duplicate publication and verification retries reuse the existing release', () => {
  nodeAssert.equal(publicationMode([], '0.1.0').operation, 'publish')
  const published = { id: 12, tag_name: 'v0.1.0', draft: false, prerelease: false }
  const result = publicationMode([published], '0.1.0')
  nodeAssert.equal(result.operation, 'verify')
  nodeAssert.equal(result.release, published)
  nodeAssert.deepEqual(publicationMode([published], '0.1.0'), result)
  nodeAssert.throws(() => publicationMode([{ ...published, draft: true }], '0.1.0'))
  nodeAssert.throws(() => publicationMode([{ ...published, prerelease: true }], '0.1.0'))
})

test('NSIS image identity permits only Tauri installer marker and Authenticode changes', () => {
  const original = Buffer.alloc(512)
  original.write('MZ')
  original.writeUInt32LE(128, 0x3c)
  original.set([80, 69, 0, 0], 128)
  original.writeUInt16LE(0x20b, 152)
  original.write('__TAURI_BUNDLE_TYPE_VAR_UNK', 320)
  const expected = nsisImageDigest(original)
  nodeAssert.throws(() => nsisImageDigest(original, original.length, true))
  const packaged = Buffer.concat([original, Buffer.alloc(32)])
  packaged.write('__TAURI_BUNDLE_TYPE_VAR_NSS', 320)
  packaged.writeUInt32LE(512, 296)
  packaged.writeUInt32LE(32, 300)
  nodeAssert.equal(nsisImageDigest(packaged, original.length, true), expected)
  const tampered = Buffer.from(packaged)
  tampered[400] = 1
  nodeAssert.notEqual(nsisImageDigest(tampered, original.length, true), expected)
  const wrongFormat = Buffer.from(packaged)
  wrongFormat.write('__TAURI_BUNDLE_TYPE_VAR_MSI', 320)
  nodeAssert.throws(() => nsisImageDigest(wrongFormat, original.length, true))
})

test('draft metadata updates preserve candidate tag and never publish', () => {
  const { candidate } = fixture()
  const release = {
    draft: true,
    tag_name: candidate.stagingTag,
    target_commitish: 'a'.repeat(40),
    name: 'Candidate',
  }
  const metadata = candidateDraftMetadata(candidate, release, 'Final notes')
  nodeAssert.equal(metadata.tag_name, candidate.stagingTag)
  nodeAssert.equal(metadata.target_commitish, release.target_commitish)
  nodeAssert.equal(metadata.body, 'Final notes')
  nodeAssert.equal(metadata.draft, true)
  nodeAssert.equal(metadata.prerelease, true)
  nodeAssert.throws(() => candidateDraftMetadata(candidate, { ...release, draft: false }, 'notes'))
  nodeAssert.throws(() =>
    candidateDraftMetadata(candidate, { ...release, tag_name: 'untagged' }, 'notes')
  )
})

test('updater deferral is restricted to the explicitly approved 0.1.0 candidate and PR', () => {
  nodeAssert.equal(
    certificationChecks('0.1.0-36969301315-1', '27', 'false', 'true').updaterUpgrades,
    'deferred'
  )
  nodeAssert.equal(
    certificationChecks('0.2.0-123-1', '28', 'true', 'false').updaterUpgrades,
    'confirmed'
  )
  nodeAssert.throws(() => certificationChecks('0.2.0-123-1', '27', 'false', 'true'))
  nodeAssert.throws(() => certificationChecks('0.1.0-36969301315-1', '28', 'false', 'true'))
  nodeAssert.throws(() => certificationChecks('0.1.0-36969301315-1', '27', 'true', 'true'))
  nodeAssert.throws(() => certificationChecks('0.2.0-123-1', '28', 'false', 'false'))
})

test('future releases cannot reuse certification without installed Mac extension evidence', () => {
  const { candidate } = fixture()
  candidate.version = '0.1.1'
  const bytes = encode(candidate),
    inventory = []
  const certificate = {
    schemaVersion: 2,
    candidateId: candidate.id,
    sourceRevision: candidate.sourceRevision,
    sourceTree: candidate.sourceTree,
    candidateSha256: digest(bytes),
    inventorySha256: digest(encode(inventory)),
    evidence: 'https://example.com/results',
    platforms: targets.map(item => item.id),
  }
  nodeAssert.throws(() => assertCertified(candidate, certificate, bytes, inventory))
  assertCertified(
    candidate,
    { ...certificate, checks: { macExtensions: 'passed' } },
    bytes,
    inventory
  )
})
