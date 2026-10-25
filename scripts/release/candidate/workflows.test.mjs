import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = name =>
  readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')

test('release approval is captured before a native environment gate and published through an explicit protected merge job', () => {
  const approval = workflow('release-certify')
  assert(approval.indexOf('approval-snapshot') < approval.indexOf('name: desktop-release'))
  assert.match(approval, /needs: \[snapshot, approve\]/)
  assert.match(approval, /needs: certification/)
  assert.match(approval, /complete-release/)
  assert.doesNotMatch(
    approval,
    /all_platforms_passed|mac_extensions_passed|CERTIFICATION_EVIDENCE|--admin/
  )
  assert.match(approval, /github.ref == 'refs\/heads\/main'/)
  const events = workflow('release-readiness')
  assert.match(events, /Publish certified release/)
  assert.match(events, /types: \[requested, in_progress, completed\]/)
  assert.match(events, /pipeline.mjs controls/)
  assert.match(events, /group: desktop-release-controls/)
  assert.match(workflow('release-controls'), /group: desktop-release-controls/)
  // PR conversation comments require PR write permission, even through /issues.
  assert.match(events, /pull-requests: write/)
  assert.match(workflow('release-controls'), /pull-requests: write/)
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
