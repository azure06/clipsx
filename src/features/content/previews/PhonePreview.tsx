import { memo } from 'react'
import { Phone, MessageSquare } from 'lucide-react'
import type { Content } from '../types'
import { invoke } from '@tauri-apps/api/core'
import { InlineCTAButton } from './PreviewShell'
import { previewTheme } from './previewTheme'
import { useTranslation } from 'react-i18next'

type PhonePreviewProps = {
  readonly content: Content
}

const PhonePreviewComponent = ({ content }: PhonePreviewProps) => {
  const { t } = useTranslation()
  const number = content.text

  const handleCall = () => {
    void invoke('start_phone_action', { number, message: false })
  }
  const handleSms = () => {
    void invoke('start_phone_action', { number, message: true })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Number display */}
      <div className="flex flex-col items-center gap-2 p-6 rounded-xl bg-linear-to-br from-green-500/10 to-teal-500/10 border border-green-500/20">
        <div className="p-3 rounded-full bg-green-500/20 text-green-400 ring-1 ring-green-500/30">
          <Phone size={24} strokeWidth={2} />
        </div>
        <span
          className={`text-2xl font-semibold font-mono tracking-wide ${previewTheme.textPrimary}`}
        >
          {number}
        </span>
      </div>

      {/* CTAs */}
      <div className="flex gap-2 justify-center">
        <InlineCTAButton
          icon={<Phone size={16} />}
          label={t('preview.call')}
          onClick={handleCall}
          variant="primary"
        />
        <InlineCTAButton
          icon={<MessageSquare size={16} />}
          label={t('preview.sendSms')}
          onClick={handleSms}
        />
      </div>
    </div>
  )
}

export const PhonePreview = memo(PhonePreviewComponent)
