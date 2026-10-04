import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
test('root loader discovers nested tests from a tooling checkout with a different cwd', () => {
  const work = mkdtempSync(join(tmpdir(), 'clipsx-loader-'))
  try {
    const tooling = join(work, '.tooling', 'scripts', 'release')
    mkdirSync(join(tooling, 'core'), { recursive: true })
    mkdirSync(join(tooling, 'platforms', 'windows'), { recursive: true })
    copyFileSync(new URL('../release.test.mjs', import.meta.url), join(tooling, 'release.test.mjs'))
    for (const domain of ['core', 'platforms/windows'])
      writeFileSync(
        join(tooling, domain, 'fixture.test.mjs'),
        `import test from 'node:test';test('${domain} discovered',()=>{})`
      )
    const childEnv = { ...process.env }
    delete childEnv.NODE_TEST_CONTEXT
    const output = execFileSync(
      process.execPath,
      ['--test', '--test-reporter=spec', join(tooling, 'release.test.mjs')],
      {
        cwd: work,
        encoding: 'utf8',
        env: childEnv,
      }
    )
    assert(output.includes('core discovered'))
    assert(output.includes('platforms/windows discovered'))
  } finally {
    assert(work.startsWith(join(tmpdir(), 'clipsx-loader-')))
    rmSync(work, { recursive: true, force: true })
  }
})
