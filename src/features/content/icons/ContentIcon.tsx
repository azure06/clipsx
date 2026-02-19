import { memo } from 'react'
import {
  Link2,
  Mail,
  Code2,
  Braces,
  FileText,
  Key,
  Clock,
  Lock,
  FolderOpen,
  Image as ImageIcon,
  Files,
} from 'lucide-react'
import type { Content } from '../types'

type ContentIconProps = {
  readonly content: Content
  readonly size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
}

const iconSizes = {
  sm: 12,
  md: 16,
  lg: 20,
}

const ContentIconComponent = ({ content, size = 'md' }: ContentIconProps) => {
  const iconSize = iconSizes[size]
  const containerSize = sizeClasses[size]

  // Special case: Color type shows actual color
  if (content.type === 'color') {
    const colorValue = content.metadata.hex || content.metadata.value || content.text
    return (
      <div
        className={`${containerSize} rounded-full ring-2 ring-white/20 shadow-sm transition-transform duration-200 hover:scale-110`}
        style={{ backgroundColor: colorValue }}
      />
    )
  }

  // Icon mapping
  const getIcon = () => {
    switch (content.type) {
      case 'url':
        return <Link2 size={iconSize} strokeWidth={2.5} />
      case 'email':
        return <Mail size={iconSize} strokeWidth={2.5} />
      case 'code':
        return <Code2 size={iconSize} strokeWidth={2.5} />
      case 'json':
        return <Braces size={iconSize} strokeWidth={2.5} />
      case 'csv':
        return <FileText size={iconSize} strokeWidth={2.5} />
      case 'jwt':
        return <Key size={iconSize} strokeWidth={2.5} />
      case 'timestamp':
        return <Clock size={iconSize} strokeWidth={2.5} />
      case 'secret':
        return <Lock size={iconSize} strokeWidth={2.5} />
      case 'path':
        return <FolderOpen size={iconSize} strokeWidth={2.5} />
      case 'image':
        return <ImageIcon size={iconSize} strokeWidth={2.5} />
      case 'files':
        return <Files size={iconSize} strokeWidth={2.5} />
      default:
        return <FileText size={iconSize} strokeWidth={2.5} />
    }
  }

  // Color mapping
  const getColorClasses = () => {
    switch (content.type) {
      case 'url':
        return 'bg-blue-500/20 text-blue-400 ring-blue-500/30'
      case 'email':
        return 'bg-amber-500/20 text-amber-400 ring-amber-500/30'
      case 'code':
        return 'bg-green-500/20 text-green-400 ring-green-500/30'
      case 'json':
        return 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/30'
      case 'csv':
        return 'bg-lime-500/20 text-lime-400 ring-lime-500/30'
      case 'jwt':
        return 'bg-violet-500/20 text-violet-400 ring-violet-500/30'
      case 'timestamp':
        return 'bg-cyan-500/20 text-cyan-400 ring-cyan-500/30'
      case 'secret':
        return 'bg-red-500/20 text-red-400 ring-red-500/30'
      case 'path':
        return 'bg-indigo-500/20 text-indigo-400 ring-indigo-500/30'
      case 'image':
        return 'bg-pink-500/20 text-pink-400 ring-pink-500/30'
      case 'files':
        return 'bg-blue-600/20 text-blue-400 ring-blue-600/30'
      default:
        return 'bg-gray-500/20 text-gray-400 ring-gray-500/30'
    }
  }

  return (
    <div
      className={`${containerSize} rounded-full ${getColorClasses()} ring-2 shadow-sm flex items-center justify-center transition-all duration-200 hover:scale-110 hover:shadow-md`}
    >
      {getIcon()}
    </div>
  )
}

export const ContentIcon = memo(ContentIconComponent)
