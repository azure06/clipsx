import { Globe2 } from 'lucide-react'
import type { AiProviderKind } from '../recall/contracts.generated'
import ollama from './provider-logos/ollama.svg'
import claude from './provider-logos/claude.svg'
import openai from './provider-logos/openai.svg'
import openrouter from './provider-logos/openrouter.svg'
import gemini from './provider-logos/gemini.svg'

const logos = { ollama, anthropic: claude, openai, openrouter, gemini }

export function ProviderIcon({
  provider,
  className = 'h-5 w-5',
}: {
  provider: AiProviderKind
  className?: string
}) {
  if (provider === 'tavily') return <Globe2 aria-hidden className={className} />
  const mask = `url("${logos[provider]}") center / contain no-repeat`
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ mask, WebkitMask: mask }}
    />
  )
}
