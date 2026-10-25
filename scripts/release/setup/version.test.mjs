import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { versionUpdates } from './version.mjs'

test('one mechanical version update keeps all five manifests and locks aligned and preserves existing notes', () => {
  const root = mkdtempSync(join(tmpdir(), 'clipsx-version-'))
  try {
    mkdirSync(join(root, 'src-tauri'))
    mkdirSync(join(root, 'docs/releases'), { recursive: true })
    const files = {
      'package.json': '{"version":"0.1.9","dependencies":{"example":"1.2.3"}}',
      'package-lock.json':
        '{"version":"0.1.9","packages":{"":{"version":"0.1.9"},"example":{"version":"1.2.3"}}}',
      'src-tauri/tauri.conf.json':
        '{"version":"0.1.9","plugins":{"updater":{"pubkey":"unchanged"}}}',
      'src-tauri/Cargo.toml':
        '[package]\nname = "clipsx"\nversion = "0.1.9"\n\n[dependencies]\nexample = "1.2.3"\n',
      'src-tauri/Cargo.lock':
        '[[package]]\nname = "clipsx"\nversion = "0.1.9"\n\n[[package]]\nname = "example"\nversion = "1.2.3"\n',
    }
    for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content)
    const updates = versionUpdates(root, '0.1.10', 'fix: preview\nfeat: navigation\n')
    assert.equal(JSON.parse(updates['package.json']).version, '0.1.10')
    assert.match(updates['src-tauri/Cargo.toml'], /version = "0.1.10"/)
    assert.equal(JSON.parse(updates['package-lock.json']).packages[''].version, '0.1.10')
    assert.equal(
      JSON.parse(updates['src-tauri/tauri.conf.json']).plugins.updater.pubkey,
      'unchanged'
    )
    assert.match(updates['src-tauri/Cargo.lock'], /name = "clipsx"\nversion = "0.1.10"/)
    assert.match(updates['src-tauri/Cargo.lock'], /name = "example"\nversion = "1.2.3"/)
    assert.match(updates['docs/releases/0.1.10.md'], /- fix: preview\n- feat: navigation/)
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), files['package.json'])
    writeFileSync(join(root, 'docs/releases/0.1.10.md'), 'Reviewed notes')
    assert.equal(versionUpdates(root, '0.1.10', 'draft')['docs/releases/0.1.10.md'], undefined)
    assert.throws(() => versionUpdates(root, '0.1.8', 'draft'), /newer/)
    assert.throws(() => versionUpdates(root, '0.1.10-beta', 'draft'), /stable/)
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), '{"version":"0.1.8"}')
    assert.throws(() => versionUpdates(root, '0.1.10', 'draft'), /disagree/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
