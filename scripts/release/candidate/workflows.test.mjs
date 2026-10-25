import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = name =>
  readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')

test('the release is verified before a human PR merge, with no deployment gate or automatic merge', () => {
  const verification = workflow('release-certify')
  assert.match(verification, /verify-for-merge/)
  assert.match(verification, /head_revision:/)
  assert.match(verification, /github.ref == 'refs\/heads\/main'/)
  assert.doesNotMatch(verification, /environment:|complete-release|approval-snapshot|--admin/)
  assert.match(workflow('release-publish'), /types: \[closed\]/)
  const events = workflow('release-readiness')
  assert.match(events, /Verify release for merge/)
  assert.match(events, /group: desktop-release-controls/)
  assert.match(workflow('release-controls'), /pull-requests: write/)
  assert.match(workflow('release-finalize'), /gh workflow run release-readiness.yml/)
})

test('readiness links stay on the release PR instead of expiring draft URLs', () => {
  const readiness = readFileSync(new URL('./approval.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(readiness, /release\.html_url/)
})

test('release controllers have the push permission GitHub requires to read draft releases', () => {
  for (const name of ['release-controls', 'release-readiness']) {
    assert.match(workflow(name), /contents: write/)
  }
})
