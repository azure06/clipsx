import { invoke } from '@tauri-apps/api/core'

import type { ClipboardOutputRequest, ClipboardOutputSource } from './types/v2'

export async function executeClipboardOutput(
  disposition: ClipboardOutputRequest['disposition'],
  source: ClipboardOutputSource
): Promise<void> {
  await invoke('execute_clipboard_output', {
    request: { disposition, source } satisfies ClipboardOutputRequest,
  })
}

export function copyClipboardOutput(source: ClipboardOutputSource): Promise<void> {
  return executeClipboardOutput('copy', source)
}

export function pasteClipboardOutput(source: ClipboardOutputSource): Promise<void> {
  return executeClipboardOutput('paste', source)
}

export function copyLiteralText(text: string, sourceClipId?: string): Promise<void> {
  return copyClipboardOutput({
    kind: 'literal_text',
    text,
    ...(sourceClipId ? { sourceClipId } : {}),
  })
}
