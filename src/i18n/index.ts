import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ja from './ja.json'

export const SUPPORTED_LANGUAGES = ['en', 'ja'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)

export const normalizeLanguage = (value: string | null | undefined): SupportedLanguage => {
  const language = value?.trim().toLowerCase().split('-')[0]
  return language && isSupportedLanguage(language) ? language : 'en'
}

export const detectSupportedLanguage = (
  languages: readonly string[] | null | undefined
): SupportedLanguage => {
  for (const language of languages ?? []) {
    const normalized = normalizeLanguage(language)
    if (normalized === 'ja') return 'ja'
    if (language.toLowerCase().startsWith('en')) return 'en'
  }
  return 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
  },
  supportedLngs: SUPPORTED_LANGUAGES,
  fallbackLng: 'en',
  lng: 'en',
  load: 'languageOnly',
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
})

export default i18n
