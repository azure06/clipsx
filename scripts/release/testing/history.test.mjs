import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertCertified, digest } from '../core/contracts.mjs'
for (const version of ['0.1.0', '0.1.1'])
  test(`published ${version} certification remains verifiable as historical evidence`, () => {
    const fixture = JSON.parse(
      readFileSync(new URL(`fixtures/published-${version}.json`, import.meta.url))
    )
    const candidate = JSON.parse(fixture.candidateBytes)
    assert.equal(candidate.version, version)
    assert.equal(digest(fixture.candidateBytes), fixture.certification.candidateSha256)
    assertCertified(
      candidate,
      fixture.certification,
      Buffer.from(fixture.candidateBytes),
      fixture.inventory
    )
    assert.throws(
      () =>
        assertCertified(
          candidate,
          fixture.certification,
          Buffer.from(fixture.candidateBytes),
          fixture.inventory.slice(1)
        ),
      /assets changed/
    )
  })
