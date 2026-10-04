import test from 'node:test'
import assert from 'node:assert/strict'
import { services } from '../core/github.mjs'
import { verifySymbolUuids } from './symbols.mjs'
test('normal saved-build symbols must match the executable UUID without compilation', () => {
  const original = services.command,
    trace = []
  const uuid = '12345678-1234-1234-1234-123456789abc'
  try {
    services.command = (program, args) => {
      trace.push({ program, args })
      return `UUID: ${uuid} (arm64) ${args[1]}`
    }
    assert.equal(verifySymbolUuids('saved/clipsx', 'saved/clipsx.dSYM'), uuid)
    assert.deepEqual(
      trace.map(item => item.program),
      ['dwarfdump', 'dwarfdump']
    )
    services.command = (_, args) => (args[1].endsWith('.dSYM') ? 'UUID: wrong' : 'UUID: ' + uuid)
    assert.throws(() => verifySymbolUuids('saved/clipsx', 'saved/clipsx.dSYM'), /does not match/)
  } finally {
    services.command = original
  }
})
