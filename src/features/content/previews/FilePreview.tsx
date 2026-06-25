import { memo } from 'react'
import type { Content, FileMetadata } from '../types'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import {
  File,
  FileText,
  FileImage,
  FileAudio,
  FileVideo,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileArchive,
  Database,
} from 'lucide-react'
import { previewTheme } from './previewTheme'

type FilePreviewProps = {
  readonly content: Content
}

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

const formatDate = (timestamp: number) => {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString()
}

const getFileIcon = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const props = {
    className:
      'w-8 h-8 text-gray-500 group-hover:text-gray-700 transition-colors dark:text-white/60 dark:group-hover:text-white/80',
  }

  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'ico':
      return <FileImage {...props} />
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
      return <FileAudio {...props} />
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'webm':
      return <FileVideo {...props} />
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'py':
    case 'rs':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'css':
    case 'html':
      return <FileCode {...props} />
    case 'json':
      return <FileJson {...props} />
    case 'csv':
    case 'xlsx':
    case 'xls':
      return <FileSpreadsheet {...props} />
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
    case 'rar':
      return <FileArchive {...props} />
    case 'db':
    case 'sql':
    case 'sqlite':
      return <Database {...props} />
    case 'txt':
    case 'md':
    case 'log':
      return <FileText {...props} />
    default:
      return <File {...props} />
  }
}

const FileItem = ({ file }: { file: FileMetadata }) => {
  const handleOpen = async () => {
    try {
      await invoke('open_path', { path: file.path })
    } catch (error) {
      console.error('Failed to open file:', error)
    }
  }

  const ext = file.path.split('.').pop()?.toLowerCase() || ''
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)
  const isVideo = ['mp4', 'mov', 'avi', 'webm', 'ogg'].includes(ext)

  return (
    <div
      className={`flex flex-col p-3 rounded-lg transition-colors group ${previewTheme.surfaceMuted} hover:bg-slate-100 dark:hover:bg-slate-100/10`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="shrink-0">{getFileIcon(file.path)}</div>
          <div className="flex flex-col min-w-0">
            <div className={`font-medium truncate ${previewTheme.textPrimary}`} title={file.name}>
              {file.name}
            </div>
            <div
              className={`text-xs truncate font-mono ${previewTheme.textMuted}`}
              title={file.path}
            >
              {file.path}
            </div>
            <div className={`flex gap-3 text-xs mt-1 ${previewTheme.textSubtle}`}>
              <span>{formatBytes(file.size)}</span>
              <span>•</span>
              <span>{formatDate(file.modified)}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => void handleOpen()}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-slate-200/60 dark:hover:bg-slate-100/10 rounded text-xs text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white shrink-0"
          title="Open File"
        >
          Open
        </button>
      </div>

      {(isImage || isVideo) && (
        <div
          className={`mt-3 rounded-lg overflow-hidden flex items-center justify-center max-h-64 ${previewTheme.surfaceInset}`}
        >
          {isImage ? (
            <img
              src={convertFileSrc(file.path)}
              alt={file.name}
              className="max-h-64 w-auto object-contain"
              onError={e => {
                console.error('Failed to load image preview:', convertFileSrc(file.path))
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <video
              src={convertFileSrc(file.path)}
              controls
              className="max-h-64 w-full object-contain"
              onError={e => {
                console.error('Failed to load video preview:', convertFileSrc(file.path))
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

const FilePreviewComponent = ({ content }: FilePreviewProps) => {
  const files = content.metadata.files || []

  if (files.length === 0) {
    return (
      <div
        className={`w-full h-full p-4 flex flex-col items-center justify-center ${previewTheme.textSubtle}`}
      >
        <FileArchive className="w-16 h-16 mb-4 opacity-50" />
        <div className="text-sm">No file metadata available</div>
        <div className="text-xs mt-2 opacity-50 font-mono">{content.text}</div>
      </div>
    )
  }

  return (
    <div className="w-full h-full p-4 overflow-y-auto">
      <div className="flex flex-col gap-2">
        {files.map((file, index) => (
          <FileItem key={`${file.path}-${index}`} file={file} />
        ))}
      </div>
    </div>
  )
}

export const FilePreview = memo(FilePreviewComponent)
