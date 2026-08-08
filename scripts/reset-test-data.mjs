/* global console, process */
import { lstat, readdir, rm } from 'node:fs/promises'
import { resolve, parse, relative, sep } from 'node:path'

const argumentIndex = process.argv.indexOf('--root')
const suppliedRoot = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined
if (!suppliedRoot) throw new Error('Usage: node scripts/reset-test-data.mjs --root <isolated-test-root>')

const root = resolve(suppliedRoot)
const repository = resolve(process.cwd())
if (root === parse(root).root || root === repository || !relative(root, repository).startsWith(`..${sep}`)) {
  throw new Error('Refusing to reset a filesystem root, repository root, or path inside this repository.')
}

const marker = resolve(root, '.clipsx-test-root')
try {
  const metadata = await lstat(marker)
  if (!metadata.isFile()) throw new Error('missing marker')
} catch {
  throw new Error(`Refusing to reset ${root}: it does not contain the .clipsx-test-root sentinel.`)
}

for (const entry of await readdir(root)) {
  if (entry !== '.clipsx-test-root') await rm(resolve(root, entry), { recursive: true, force: true })
}

console.log(`Reset isolated ClipsX test root: ${root}`)
