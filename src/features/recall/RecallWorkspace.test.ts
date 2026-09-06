import { describe, expect, it } from 'vitest'
import { linkRecallCitations } from './recallMarkdown'

describe('linkRecallCitations', () => {
  it('links prose citations without changing recovered code', () => {
    expect(linkRecallCitations('Use it [1].\n```sh\necho [1]\n```')).toBe(
      'Use it [1](recall-source:1).\n```sh\necho [1]\n```'
    )
  })

  it('leaves inline code unchanged', () => {
    expect(linkRecallCitations('Run `[404]` from [2].')).toBe(
      'Run `[404]` from [2](recall-source:2).'
    )
  })
})
