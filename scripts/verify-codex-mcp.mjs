// Driven by the ignored Rust integration test. Never starts a model turn.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { setTimeout, clearTimeout } from 'node:timers'

let input = ''
for await (const chunk of process.stdin) input += chunk
const fixture = JSON.parse(input)
const home = path.join(fixture.root, 'codex-home')
await fs.mkdir(home, { recursive: true })
await fs.writeFile(
  path.join(home, 'config.toml'),
  `
[analytics]
enabled = false
[mcp_servers.clipsx_read]
url = ${JSON.stringify(fixture.endpoint)}
bearer_token_env_var = "CLIPSX_TEST_READ_TOKEN"
[mcp_servers.clipsx_write]
url = ${JSON.stringify(fixture.endpoint)}
bearer_token_env_var = "CLIPSX_TEST_WRITE_TOKEN"
`
)
const child = spawn(fixture.codex, ['app-server', '--listen', 'stdio://'], {
  cwd: fixture.root,
  env: {
    ...process.env,
    CODEX_HOME: home,
    OPENAI_API_KEY: '',
    CLIPSX_TEST_READ_TOKEN: fixture.readToken,
    CLIPSX_TEST_WRITE_TOKEN: fixture.writeToken,
  },
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
})
const pending = new Map()
let nextId = 1
// Drain diagnostics, but do not print upstream bodies or credentials.
child.stderr.resume()
const lines = readline.createInterface({ input: child.stdout })
lines.on('line', line => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  const waiter = pending.get(message.id)
  if (waiter) {
    pending.delete(message.id)
    clearTimeout(waiter.timer)
    if (message.error) waiter.reject(new Error(`Codex RPC ${waiter.method}: ${message.error.code}`))
    else waiter.resolve(message.result)
  } else if (message.id !== undefined && message.method) {
    child.stdin.write(
      JSON.stringify({
        id: message.id,
        error: { code: -32601, message: 'Unexpected client request in fixture' },
      }) + '\n'
    )
  }
})
child.on('error', () => {
  for (const waiter of pending.values()) waiter.reject(new Error('Codex process failed'))
})
child.on('exit', () => {
  for (const waiter of pending.values())
    waiter.reject(new Error('Codex exited before verification'))
})
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Codex RPC timeout: ${method}`))
    }, 60_000)
    pending.set(id, { method, resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
}
try {
  const initialized = await rpc('initialize', {
    clientInfo: { name: 'clipsx_mcp_verification', version: '1' },
    capabilities: { experimentalApi: true },
  })
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
  const started = await rpc('thread/start', {
    cwd: fixture.root,
    ephemeral: true,
    approvalPolicy: 'never',
    sandbox: 'read-only',
  })
  const threadId = started.thread.id
  const catalog = await rpc('mcpServerStatus/list', { threadId, detail: 'toolsAndAuthOnly' })
  for (const [name, count] of [
    ['clipsx_read', 5],
    ['clipsx_write', 8],
  ]) {
    const server = catalog.data.find(item => item.name === name)
    assert.ok(server, `Missing ${name}`)
    assert.equal(server.toolsError, null)
    assert.equal(Object.keys(server.tools).length, count)
  }
  const call = (server, tool, args = {}) =>
    rpc('mcpServer/tool/call', { threadId, server, tool, arguments: args })
  const search = await call('clipsx_read', 'search_clips', { query: 'external fixture' })
  assert.notEqual(search.isError, true)
  assert.deepEqual(
    search.structuredContent.items.map(item => item.clip.id),
    [fixture.clipId]
  )
  const read = await call('clipsx_read', 'read_clip', { clipId: fixture.clipId })
  assert.equal(read.structuredContent.text, 'external fixture evidence')
  const secret = await call('clipsx_read', 'read_clip', { clipId: fixture.secretId })
  assert.equal(secret.isError, true)
  const image = await call('clipsx_read', 'read_clip_image', {
    clipId: fixture.imageId,
    representationId: fixture.imageRepresentationId,
  })
  assert.ok(
    image.content.some(
      part => part.type === 'image' && part.mimeType === 'image/png' && part.data.length > 0
    )
  )
  const args = {
    requestId: randomUUID(),
    format: 'plain_text',
    text: 'created by external Codex fixture',
  }
  const created = await call('clipsx_write', 'create_clip', args)
  assert.notEqual(created.isError, true)
  const replay = await call('clipsx_write', 'create_clip', args)
  assert.equal(created.structuredContent.actionId, replay.structuredContent.actionId)
  const target = created.structuredContent.clips[0]
  const organized = await call('clipsx_write', 'organize_clips', {
    requestId: randomUUID(),
    clips: [target],
    favorite: true,
    addTags: ['External fixture'],
  })
  assert.notEqual(organized.isError, true)
  const undone = await call('clipsx_write', 'undo_clipboard_action', {
    requestId: randomUUID(),
    actionId: organized.structuredContent.actionId,
  })
  assert.notEqual(undone.isError, true)
  console.log(
    JSON.stringify({
      passed: true,
      client: initialized.userAgent,
      tools: 13,
      image: true,
      secretDenied: true,
      idempotency: true,
      organizationUndo: true,
      modelTurns: 0,
    })
  )
} finally {
  for (const waiter of pending.values()) clearTimeout(waiter.timer)
  lines.close()
  child.stdin.end()
  child.kill()
}
