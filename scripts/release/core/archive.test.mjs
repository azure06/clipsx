import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter, dirname, resolve } from 'node:path'
import { command } from './github.mjs'

test('archives round-trip absolute paths even with Git Bash tools first on Windows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clipsx-archive-'))
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  const previousPath = process.env.PATH
  try {
    if (process.platform === 'win32')
      process.env.PATH = `${join(process.env.ProgramFiles, 'Git', 'usr', 'bin')}${delimiter}${previousPath}`
    const source = join(directory, 'source')
    const restored = join(directory, 'restored')
    const archive = join(directory, 'saved.tar.gz')
    mkdirSync(source)
    mkdirSync(restored)
    writeFileSync(join(source, 'fixture.txt'), 'Saved bytes: 日本語\n')
    command('tar', ['-czf', archive, '-C', source, '.'])
    command('tar', ['-xzf', archive, '-C', restored])
    assert.equal(readFileSync(join(restored, 'fixture.txt'), 'utf8'), 'Saved bytes: 日本語\n')
  } finally {
    process.env.PATH = previousPath
    rmSync(directory, { recursive: true, force: true })
  }
})

test('symbol archives retain Cargo symlink targets', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'clipsx-symbol-archive-'))
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  try {
    mkdirSync(join(directory, 'deps', 'clipsx-hash.dSYM'), { recursive: true })
    writeFileSync(join(directory, 'deps', 'clipsx-hash.dSYM', 'DWARF'), 'Original symbol bytes')
    symlinkSync('deps/clipsx-hash.dSYM', join(directory, 'clipsx.dSYM'))
    const archive = join(directory, 'symbols.tar.gz')
    command('tar', ['-h', '-czf', archive, '-C', directory, 'clipsx.dSYM'])
    mkdirSync(join(directory, 'restored'))
    command('tar', ['-xzf', archive, '-C', join(directory, 'restored')])
    assert.equal(
      readFileSync(join(directory, 'restored', 'clipsx.dSYM', 'DWARF'), 'utf8'),
      'Original symbol bytes'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
