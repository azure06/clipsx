import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createServer } from 'node:http'
import { assert, encode, validateInventory } from '../core/contracts.mjs'
import { downloadAsset } from '../core/github.mjs'
import { directory } from '../core/context.mjs'
import { fresh, verifiedFiles } from '../core/candidate.mjs'

export function upgradeFeed(id, port = '8787') {
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
