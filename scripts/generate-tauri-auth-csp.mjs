import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createTauriAuthCspConfig } from './tauri-auth-csp.mjs'

const outputPath = resolve(globalThis.process.cwd(), 'src-tauri/tauri.auth.csp.conf.json')
const config = createTauriAuthCspConfig(globalThis.process.env.VITE_SUPABASE_URL)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
