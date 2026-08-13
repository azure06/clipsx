import type { ClipPresentation, RenderModel } from '../../shared/types/v2'

export const renderModelText = (model: RenderModel): string | null => {
  switch (model.kind) {
    case 'text':
    case 'code':
      return model.text
    case 'markdown':
      return model.markdown
    case 'rich_text':
      return model.plainText
    case 'semantic':
      return model.text
    case 'tree':
      return JSON.stringify(model.value, null, 2)
    case 'key_value':
      return model.entries.map(([key, value]) => `${key}: ${value}`).join('\n')
    case 'card':
      return [
        model.title,
        model.subtitle,
        ...model.fields.map(([key, value]) => `${key}: ${value}`),
      ]
        .filter(Boolean)
        .join('\n')
    default:
      return null
  }
}

export const presentationTextStats = (presentation: ClipPresentation) => {
  const text = renderModelText(presentation.model)
  return text === null
    ? null
    : {
        characters: text.length,
        lines: text.length === 0 ? 0 : text.split('\n').length,
        language: presentation.model.kind === 'code' ? presentation.model.language : null,
      }
}
