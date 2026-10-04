import { assert, assertMutable, digest, encode, repository } from '../core/contracts.mjs'
import { command, repoApi, source, writeAsset, releaseById } from '../core/github.mjs'
import { directory } from '../core/context.mjs'

export function captureNotes(candidate, ref, prNumber) {
  if (!ref && prNumber) {
    const pr = repoApi(`pulls/${prNumber}`)
    assert(
      pr.head.repo.full_name === repository &&
        pr.head.ref === candidate.branch &&
        pr.base.ref === 'main',
      'Wrong release PR for notes'
    )
    ref = pr.head.sha
  }
  let revision = ref || candidate.sourceRevision
  if (!/^[a-f0-9]{40}$/.test(revision))
    revision = repoApi(`commits/${encodeURIComponent(revision)}`).sha
  source(revision)
  const text = command('git', ['show', `${revision}:docs/releases/${candidate.version}.md`])
  assert(text.trim(), 'Release notes must not be empty')
  return { revision, text, sha256: digest(text) }
}

export function updateNotes(release, candidate, ref) {
  assertMutable(candidate, release)
  const notes = captureNotes(candidate, ref)
  const current = releaseById(release.id)
  assertMutable(candidate, current)
  assert(
    current.assets.find(item => item.name === 'candidate.json')?.digest ===
      `sha256:${digest(encode(candidate))}`,
    'Candidate changed during notes update'
  )
  writeAsset(release, 'release-notes.md', notes.text, directory)
  candidate.releaseNotesRevision = notes.revision
  candidate.releaseNotesSha256 = notes.sha256
  writeAsset(release, 'candidate.json', candidate, directory)
}
