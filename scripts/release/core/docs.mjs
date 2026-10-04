import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { command } from './github.mjs'
import { classify } from './inputs.mjs'

export function checkDocuments(paths) {
  for (const path of paths.filter(
    path => classify(path) === 'docs' && path.endsWith('.md') && existsSync(path)
  )) {
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1].replace(/^<|>$/g, '').split('#')[0]
      if (!link || /^[a-z]+:|^\//i.test(link)) continue
      if (!existsSync(resolve(dirname(path), decodeURIComponent(link))))
        throw new Error(`${path}: missing local link ${link}`)
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const before = event.pull_request?.base.sha || event.before
  const after = event.pull_request?.head.sha || event.after
  const paths =
    before && !/^0+$/.test(before)
      ? command('git', ['diff', '--name-only', '-z', before, after]).split('\0').filter(Boolean)
      : []
  checkDocuments(paths)
  console.log('Changed documentation links verified.')
}
