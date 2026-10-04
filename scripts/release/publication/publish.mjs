import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertAppInputs, assertPublicEnvironment } from '../core/inputs.mjs'
import {
  assert,
  assertCertified,
  selectedCandidate,
  digest,
  encode,
  publicationMode,
  readJson,
  repository,
} from '../core/contracts.mjs'
import {
  command,
  source,
  downloadAsset,
  loadCandidate,
  releaseById,
  repoApi,
} from '../core/github.mjs'
import { directory, output } from '../core/context.mjs'
import {
  assertOrigin,
  verifySignature,
  verifyFinalized,
  completeInventory,
} from '../core/candidate.mjs'

export function publicationContext() {
  const event = readJson(process.env.GITHUB_EVENT_PATH)
  const pr = event.pull_request || repoApi(`pulls/${process.env.RELEASE_PR_NUMBER}`)
  assert(
    pr.merged &&
      pr.base.ref === 'main' &&
      pr.head.repo.full_name === repository &&
      pr.head.ref.startsWith('release/'),
    'Publication requires a merged release PR'
  )
  const version = pr.head.ref.slice(8)
  assert(/^\d+\.\d+\.\d+$/.test(version), 'Invalid release branch version')
  return { pr, version }
}

// Deliberately separate from publish: this command performs no release/deploy writes.
export function verifyPublishedCommand(prNumber) {
  assert(/^\d+$/.test(prNumber), 'Select the merged release PR number')
  const pr = repoApi(`pulls/${prNumber}`)
  assert(
    pr.merged &&
      pr.base.ref === 'main' &&
      pr.head.repo.full_name === repository &&
      pr.head.ref.startsWith('release/'),
    'Verification requires a merged release PR'
  )
  const release = repoApi(`releases/tags/v${pr.head.ref.slice(8)}`)
  verifyPublished(release, pr)
  console.log(
    `Public release ${release.tag_name} verified; no publication or deployment performed.`
  )
}

export function publish() {
  const { pr, version } = publicationContext()
  const releases = JSON.parse(
    command('gh', ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])
  ).flat()
  const mode = publicationMode(releases, version)
  if (mode.operation === 'verify') {
    verifyPublished(mode.release, pr)
    output('release-version', version)
    output('source-revision', readJson(join(directory, 'candidate.json')).sourceRevision)
    return
  }
  const id = selectedCandidate(pr.body)
  assert(id, 'Merged PR has no explicit candidate selection')
  const release = releases.find(item => item.draft && item.tag_name === `candidate-${id}`)
  assert(release, 'Selected candidate draft does not exist')
  const { candidate, bytes } = loadCandidate(release, directory)
  assertOrigin(candidate)
  assertAppInputs(candidate, source(pr.merge_commit_sha))
  assertPublicEnvironment(candidate)
  const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
  assert(
    certification.releasePrNumber === pr.number &&
      certification.appInputsSha256 === candidate.build.appInputsSha256,
    'Certification selection mismatch'
  )
  assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
  verifyFinalized(release, candidate)
  assertCertified(
    candidate,
    certification,
    bytes,
    completeInventory(releaseById(release.id), candidate)
  )
  const tag = `v${version}`
  const tags = repoApi(`git/matching-refs/tags/${tag}`)
  assert(
    !tags.some(item => item.ref === `refs/tags/${tag}`),
    'Production version tag already exists'
  )
  const publicReleases = releases.filter(
    item => !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/.test(item.tag_name)
  )
  const newer = publicReleases.some(item => compareVersions(item.tag_name.slice(1), version) >= 0)
  assert(!newer, 'Release version must be newer than published versions')
  // Updating the draft is retryable. Do not create a tag separately from publication.
  repoApi(`releases/${release.id}`, 'PATCH', {
    tag_name: tag,
    target_commitish: pr.merge_commit_sha,
    name: `ClipsX ${tag}`,
    prerelease: false,
    draft: false,
    make_latest: 'true',
  })
  verifyPublished(releaseById(release.id), pr)
  output('release-version', version)
  output('source-revision', candidate.sourceRevision)
}

export function compareVersions(left, right) {
  const a = left.split('.').map(Number),
    b = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function verifyPublished(release, pr) {
  const { candidate, bytes } = loadCandidate(release, directory)
  assert(
    release.tag_name === `v${candidate.version}` && !release.draft && !release.prerelease,
    'Unexpected published release identity'
  )
  let tagObject = repoApi(`git/ref/tags/${release.tag_name}`).object
  while (tagObject.type === 'tag') tagObject = repoApi(`git/tags/${tagObject.sha}`).object
  const tagCommit = tagObject.sha
  assert(tagCommit === pr.merge_commit_sha, 'Production tag points to a different merged commit')
  assert(
    selectedCandidate(pr.body) === candidate.id,
    'Published candidate differs from selected release'
  )
  assertAppInputs(candidate, source(pr.merge_commit_sha))
  const certification = JSON.parse(downloadAsset(release, 'certification.json', directory))
  assert(
    certification.releasePrNumber === pr.number &&
      certification.appInputsSha256 === candidate.build.appInputsSha256,
    'Published certification selection mismatch'
  )
  assertCertified(candidate, certification, bytes, completeInventory(release, candidate))
  verifyFinalized(release, candidate)
  const manifests = {}
  const isLatest = repoApi('releases/latest').id === release.id
  for (const name of ['latest.json', 'downloads.json']) {
    const response = command('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '60',
      `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`,
    ])
    manifests[name] = JSON.parse(response)
    assert(
      encode(manifests[name]) === encode(readJson(join(directory, name))),
      `Public manifest changed: ${name}`
    )
    if (isLatest) {
      const stable = command('curl', [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        '60',
        `https://github.com/${repository}/releases/latest/download/${name}`,
      ])
      assert(
        encode(JSON.parse(stable)) === encode(manifests[name]),
        `Stable discovery endpoint differs: ${name}`
      )
    }
  }
  assert(
    manifests['latest.json'].version === candidate.version &&
      manifests['downloads.json'].sourceRevision === candidate.sourceRevision,
    'Public manifest identity mismatch'
  )
  for (const item of candidate.artifacts) {
    const path = join(directory, item.file)
    command('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '300',
      '--output',
      path,
      `https://github.com/${repository}/releases/download/${release.tag_name}/${item.file}`,
    ])
    assert(
      digest(readFileSync(path)) === item.sha256,
      `Public download hash mismatch: ${item.file}`
    )
    if (!item.file.endsWith('.dmg')) {
      command('curl', [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        '60',
        '--output',
        `${path}.sig`,
        `https://github.com/${repository}/releases/download/${release.tag_name}/${item.file}.sig`,
      ])
      verifySignature(path, `${path}.sig`, candidate.build.updaterPublicKey)
    }
  }
}
