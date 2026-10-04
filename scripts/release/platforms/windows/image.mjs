import { assert, digest, readJson } from '../../core/contracts.mjs'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// Tauri patches exactly this fixed-width installer marker before Authenticode signing.
// Everything else remains covered by the original PE image hash.
export function nsisImageDigest(bytes, originalSize = bytes.length, packaged = false) {
  const unknown = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')
  const nsis = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS')
  const image = Buffer.from(bytes)
  const source = image.subarray(0, originalSize)
  const unknownOffset = source.indexOf(unknown)
  const nsisOffset = source.indexOf(nsis)
  const offset = unknownOffset >= 0 ? unknownOffset : nsisOffset
  assert(
    offset >= 0 && !(unknownOffset >= 0 && nsisOffset >= 0),
    'Expected one Tauri bundle type marker'
  )
  const marker = unknownOffset >= 0 ? unknown : nsis
  assert(source.indexOf(marker, offset + 1) === -1, 'Ambiguous Tauri bundle type marker')
  assert(
    !packaged || nsisOffset >= 0,
    'Installed application must identify its NSIS updater format'
  )
  nsis.copy(image, offset)
  return imageDigest(image, originalSize)
}

export function verifyImages(candidatePath, binaryRoot, installed = false) {
  const candidate = readJson(candidatePath)
  for (const [name, image] of Object.entries(candidate.windowsImages))
    assert(
      nsisImageDigest(readFileSync(join(binaryRoot, name)), image.size, installed) === image.sha256,
      'Executable differs from saved build: ' + name
    )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  verifyImages(process.argv[2], process.argv[3], process.argv[4] === 'installed')
