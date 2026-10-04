import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { digest } from './contracts.mjs'
import { command } from './github.mjs'

export let directory = resolve(process.env.RELEASE_WORKDIR || '.release')
export const setWorkDirectory = path => {
  directory = resolve(path)
}

export const output = (name, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

export const git = args => command('git', args).trim()

export const filesUnder = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? filesUnder(join(dir, item.name)) : [join(dir, item.name)]
  )

export const record = path => ({
  file: basename(path),
  sha256: digest(readFileSync(path)),
  size: readFileSync(path).length,
})

export function summarize(text) {
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
}
