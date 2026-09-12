import { validateProductionEnvironment } from './production-env.mjs'

const configuration = validateProductionEnvironment(globalThis.process.env)
console.log(
  `Production environment validated: Supabase ${configuration.supabaseUrl}; website ${configuration.websiteOrigin}; provider ${configuration.provider}.`
)
