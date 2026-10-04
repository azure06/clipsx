import { readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
function tests(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(item =>
      item.isDirectory()
        ? tests(join(directory, item.name))
        : item.name.endsWith('.test.mjs') &&
            join(directory, item.name) !== fileURLToPath(import.meta.url)
          ? [join(directory, item.name)]
          : []
    )
}
for (const file of tests(root)) await import(pathToFileURL(file).href)
