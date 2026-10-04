import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { services, clearAssetCache } from '../core/github.mjs'
import { directory, setWorkDirectory } from '../core/context.mjs'
import { digest, encode, targets, assetName, repository, readJson } from '../core/contracts.mjs'
import { appInputs, inputsDigest } from '../core/inputs.mjs'
import { publicEnvironment } from '../core/environment.mjs'

export function githubFixture() {
  const previous = { ...services },
    previousDirectory = directory
  const work = mkdtempSync(join(tmpdir(), 'clipsx-release-'))
  setWorkDirectory(work)
  clearAssetCache()
  const revision = previous.command('git', ['rev-parse', 'HEAD']).trim()
  const candidate = {
    schemaVersion: 2,
    id: '0.1.2-200-1',
    stagingTag: 'candidate-0.1.2-200-1',
    version: '0.1.2',
    branch: 'release/0.1.2',
    sourceRevision: revision,
    sourceTree: 'b'.repeat(40),
    runId: '200',
    runAttempt: '1',
    createdAt: '2026-10-04T00:00:00Z',
    releaseNotesRevision: revision,
    releaseNotesSha256: digest('Original notes\n'),
    artifacts: [],
    evidence: [],
    preparation: {},
    build: {
      production: true,
      updaterPublicKey: readJson('src-tauri/tauri.conf.json').plugins.updater.pubkey,
      appInputs: appInputs(revision),
      appInputsSha256: inputsDigest(appInputs(revision)),
      publicEnvironment: publicEnvironment(),
      origin: { runId: '100', attempt: '1', branch: 'release/0.1.2', sourceRevision: revision },
    },
  }
  const release = {
    id: 1,
    tag_name: candidate.stagingTag,
    draft: true,
    prerelease: true,
    assets: [],
    html_url: 'https://example.test/candidate',
  }
  const blobs = new Map(),
    trace = []
  let next = 1
  function put(name, value) {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === 'string' ? value : encode(value))
    let asset = release.assets.find(asset => asset.name === name)
    if (!asset) {
      asset = { id: next++, name }
      release.assets.push(asset)
    }
    Object.assign(asset, { digest: `sha256:${digest(bytes)}`, size: bytes.length })
    blobs.set(asset.id, bytes)
  }
  for (const target of targets) {
    const file = assetName(candidate.version, target.suffix)
    for (const name of [
      file,
      ...(target.platform === 'macos' ? [file.replace('.dmg', '.app.tar.gz')] : []),
    ]) {
      const bytes = Buffer.from(name)
      put(name, bytes)
      candidate.artifacts.push({ file: name, sha256: digest(bytes), size: bytes.length })
    }
  }
  for (const platform of ['windows-x64', 'macos-arm64', 'macos-x64', 'linux-x64']) {
    const file = `native-evidence-${platform}.json`,
      bytes = Buffer.from(encode({ verified: true, candidateId: candidate.id }))
    put(file, bytes)
    candidate.evidence.push({ file, sha256: digest(bytes), size: bytes.length })
  }
  const submission = {
    candidateId: candidate.id,
    artifact: candidate.artifacts[0],
    evidence: { verified: true },
  }
  put('windows-submission.json', submission)
  put('release-notes.md', 'Original notes\n')
  put('candidate.json', candidate)
  const windowsEvidence = join(work, 'windows.json')
  writeFileSync(
    windowsEvidence,
    encode({
      candidateId: candidate.id,
      verified: true,
      installerSha256: submission.artifact.sha256,
    })
  )
  services.api = (path, method = 'GET', body) => {
    trace.push({ path, method, body })
    if (path.endsWith('/releases/1')) {
      if (method === 'PATCH') Object.assign(release, body)
      return structuredClone(release)
    }
    if (path.includes('/actions/runs/100/attempts/1'))
      return {
        id: 100,
        run_attempt: 1,
        head_sha: revision,
        head_branch: candidate.branch,
        head_repository: { full_name: repository },
        status: 'completed',
        conclusion: 'success',
        event: 'push',
        path: '.github/workflows/release.yml',
      }
    if (path.includes('/commits/')) return { sha: revision }
    throw new Error(`Unexpected API ${method} ${path}`)
  }
  services.command = (program, args, options = {}) => {
    trace.push({ program, args })
    if (program === 'git') {
      if (args[0] === 'show') return 'Corrected notes\n'
      return previous.command(program, args, options)
    }
    if (program === 'gh' && args[0] === 'api') {
      if (args[1].includes('/releases/assets/')) return blobs.get(Number(args[1].split('/').at(-1)))
      if (args[1].includes('/releases?')) return JSON.stringify([[release]])
    }
    if (program === 'gh' && args[0] === 'release' && args[1] === 'upload') {
      for (const path of args.slice(3, args.indexOf('--repo')))
        put(basename(path), readFileSync(path))
      return ''
    }
    if (program === 'node' && args[1] === 'signer') {
      writeFileSync(
        `${args.at(-1)}.sig`,
        Buffer.from(digest(readFileSync(args.at(-1)))).toString('base64')
      )
      return ''
    }
    if (program.includes('clipsx-release-verify')) {
      if (
        args[0] !== candidate.build.updaterPublicKey ||
        readFileSync(args[2], 'utf8') !==
          Buffer.from(digest(readFileSync(args[1]))).toString('base64')
      )
        throw new Error('Wrong updater key or signature')
      return ''
    }
    throw new Error(`Unexpected command ${program} ${args.join(' ')}`)
  }
  return {
    work,
    candidate,
    release,
    trace,
    put,
    blobs,
    windowsEvidence,
    restore() {
      Object.keys(services).forEach(key => delete services[key])
      Object.assign(services, previous)
      setWorkDirectory(previousDirectory)
      clearAssetCache()
    },
  }
}
