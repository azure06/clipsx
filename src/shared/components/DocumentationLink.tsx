import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { BookOpen } from 'lucide-react'
import { Button } from './ui/Button/Button'
import { useToast } from '../contexts/ToastContext'
import { getDocumentationUrl, type DocumentationGuide } from '../utils/documentation'

type Props = {
  guide: DocumentationGuide
  anchor?: string
  label: string
}

export function DocumentationLink({ guide, anchor, label }: Props) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [opening, setOpening] = useState(false)

  const openGuide = async () => {
    const url = getDocumentationUrl(guide, i18n.resolvedLanguage, anchor)
    setOpening(true)
    try {
      await invoke('open_external_url', { url })
    } catch {
      toast({
        type: 'error',
        title: t('documentation.openFailed'),
        description: t('documentation.openManually', { url }),
      })
    } finally {
      setOpening(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="max-w-full whitespace-normal text-left text-violet-600 dark:text-violet-400"
      leftIcon={<BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      isLoading={opening}
      disabled={opening}
      onClick={() => void openGuide()}
    >
      {label}
    </Button>
  )
}
