import test from 'node:test'
import nodeAssert from 'node:assert/strict'
import {
  assertCertified,
  assertCurrent,
  assertMerged,
  assertManifests,
  assertLatestRun,
  assetName,
  createManifests,
  digest,
  encode,
  imageDigest,
  publicationMode,
  targets,
  validateInventory,
  validateVersion,
} from './model.mjs'

const fixture = () => {
  const candidate = {
    schemaVersion: 1,
    id: '0.1.0-123-1',
    stagingTag: 'candidate-0.1.0-123-1',
    version: '0.1.0',
    branch: 'release/0.1.0',
    sourceRevision: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    runId: '123',
    runAttempt: '1',
    build: { production: true, updaterPublicKey: 'key' },
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
test('changed source, superseded run attempts and failed builds are rejected', () => {
  const { candidate } = fixture()
  const run = { id: 123, run_attempt: 1, head_sha: candidate.sourceRevision, conclusion: 'success' }
  assertCurrent(candidate, candidate.sourceRevision, run)
  nodeAssert.throws(() => assertCurrent(candidate, 'c'.repeat(40), run))
  nodeAssert.throws(() =>
    assertCurrent(candidate, candidate.sourceRevision, { ...run, run_attempt: 2 })
  )
  nodeAssert.throws(() =>
    assertCurrent(candidate, candidate.sourceRevision, { ...run, conclusion: 'failure' })
  )
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
    schemaVersion: 1,
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
  assertMerged(candidate, candidate.sourceTree)
  nodeAssert.throws(() => assertMerged(candidate, 'd'.repeat(40)))
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

test('publication rejects a newer preparation even after the release branch is deleted', () => {
  const { candidate } = fixture()
  const run = { id: 123, run_attempt: 1, head_sha: candidate.sourceRevision, conclusion: 'success' }
  assertLatestRun(candidate, run)
  nodeAssert.throws(() => assertLatestRun(candidate, { ...run, id: 124 }))
  nodeAssert.throws(() => assertLatestRun(candidate, { ...run, run_attempt: 2 }))
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
