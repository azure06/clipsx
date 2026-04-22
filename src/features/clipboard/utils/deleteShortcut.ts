export const isMacPlatform = (platform = navigator.platform): boolean =>
  platform.toLowerCase().includes('mac')

export const shouldDeleteSelectedClip = ({
  key,
  metaKey,
  ctrlKey,
  platform = navigator.platform,
}: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  platform?: string
}): boolean => {
  if (isMacPlatform(platform)) {
    return key === 'Backspace' && metaKey && !ctrlKey
  }

  return key === 'Delete' && !metaKey && !ctrlKey
}

export const getDeleteShortcutLabel = (platform = navigator.platform): string =>
  isMacPlatform(platform) ? '⌘⌫' : 'Del'

export const getDeleteShortcutHint = (platform = navigator.platform): string[] =>
  isMacPlatform(platform) ? ['Cmd', 'Delete'] : ['Delete']
