import { afterEach, describe, expect, it } from 'vitest'
import i18n, { detectSupportedLanguage, normalizeLanguage } from './index'
import en from './en.json'
import ja from './ja.json'

const flattenKeys = (value: object, prefix = ''): string[] =>
  Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'object' && child !== null ? flattenKeys(child as object, path) : [path]
  })

describe('localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps the English and Japanese catalogs in exact key parity', () => {
    expect(flattenKeys(ja).sort()).toEqual(flattenKeys(en).sort())
  })

  it('normalizes supported regional codes and falls back to English', () => {
    expect(normalizeLanguage('ja-JP')).toBe('ja')
    expect(normalizeLanguage('en-US')).toBe('en')
    expect(normalizeLanguage('fr-FR')).toBe('en')
    expect(normalizeLanguage(undefined)).toBe('en')
  })

  it('detects Japanese from the ordered system language list', () => {
    expect(detectSupportedLanguage(['ja-JP', 'en-US'])).toBe('ja')
    expect(detectSupportedLanguage(['en-GB', 'ja-JP'])).toBe('en')
    expect(detectSupportedLanguage(['fr-FR', 'ja'])).toBe('ja')
    expect(detectSupportedLanguage(['fr-FR'])).toBe('en')
    expect(detectSupportedLanguage([])).toBe('en')
    expect(detectSupportedLanguage(undefined)).toBe('en')
  })

  it('uses Japanese translations and English fallback', async () => {
    await i18n.changeLanguage('ja')
    expect(i18n.t('settings.title')).toBe('設定')
    expect(i18n.t('titleBar.clipCount', { count: 2 })).toBe('2件のクリップ')

    await i18n.changeLanguage('fr')
    expect(i18n.t('settings.title')).toBe('Settings')
  })
})
