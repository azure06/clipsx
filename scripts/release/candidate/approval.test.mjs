import test from 'node:test'
import assert from 'node:assert/strict'
import { operatorFixture } from '../testing/operator-fixture.mjs'
import { selectForPr } from './approval.mjs'

test('candidate selection links its readiness status to the stable release PR', () => {
  const f = operatorFixture()
  try {
    f.release.html_url = 'https://github.com/azure06/clipsx/releases/tag/untagged-old'
    selectForPr(f.candidate, f.release, '45')
    const status = f.trace.find(item => item.method === 'POST' && item.path.includes('/statuses/'))
    assert.equal(status.body.target_url, f.pr.html_url)
  } finally {
    f.restore()
  }
})
