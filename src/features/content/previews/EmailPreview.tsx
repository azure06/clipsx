import { memo } from 'react'
import { Mail, AtSign, Send } from 'lucide-react'
import type { Content } from '../types'

type EmailPreviewProps = {
  readonly content: Content
}

const EmailPreviewComponent = ({ content }: EmailPreviewProps) => {
  const email = content.metadata.email || content.text
  const [user, domain] = email.split('@')
  const gravatarUrl = `https://www.gravatar.com/avatar/${email.toLowerCase()}?d=mp&s=120`

  const handleSend = () => {
    window.open(`mailto:${email}`, '_blank')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compact email card */}
      <div 
        onClick={handleSend}
        className="group relative p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 hover:border-amber-400/40 cursor-pointer transition-all duration-300 hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] overflow-hidden"
      >
        {/* Animated background */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
        
        <div className="relative flex items-center gap-3">
          {/* Compact avatar */}
          <div className="shrink-0 w-12 h-12 rounded-full bg-amber-500/20 ring-1 ring-amber-500/30 overflow-hidden group-hover:scale-110 transition-transform duration-200">
            <img 
              src={gravatarUrl}
              alt={user}
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                const parent = target.parentElement
                if (parent) {
                  parent.innerHTML = '<Mail size={24} class="text-amber-400 m-auto" />'
                }
              }}
            />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <Mail size={12} className="text-amber-400 shrink-0" />
              <span className="text-xs text-amber-300 font-semibold uppercase tracking-wider">Email</span>
            </div>
            
            <div className="flex items-baseline gap-1">
              <span className="text-base font-semibold text-white/90">{user}</span>
              <AtSign size={14} className="text-amber-400/60" />
              <span className="text-sm font-medium text-amber-300/80">{domain}</span>
            </div>
          </div>
          
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0">
            <Send size={16} className="text-amber-400" />
          </div>
        </div>
      </div>

      {/* Compact hint */}
      <div className="text-center text-[10px] text-gray-500 font-medium">
        Click to compose email
      </div>
    </div>
  )
}

export const EmailPreview = memo(EmailPreviewComponent)
