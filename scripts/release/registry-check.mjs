import { readFileSync } from 'node:fs'
import { assert } from './model.mjs'

// Run in the validated registry checkout. Published bytes must match reviewed metadata.
for (const name of ['index.json', 'index.signatures.json']) {
  const response = await fetch(
    `https://raw.githubusercontent.com/azure06/clipsx-registry/main/${name}`,
    { cache: 'no-store', signal: AbortSignal.timeout(30000) }
  )
  assert(
    response.ok && Buffer.from(await response.arrayBuffer()).equals(readFileSync(name)),
    `Published registry ${name} differs from reviewed metadata`
  )
}
const index = JSON.parse(readFileSync('index.json', 'utf8'))
assert(
  index.schemaVersion === 4 &&
    index.packages?.length &&
    index.packages.every(item => item.apiVersion === '^3.2'),
  'A nonempty signed current-contract registry is required'
)
