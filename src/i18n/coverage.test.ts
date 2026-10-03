import ts from 'typescript'
import { expect, it } from 'vitest'
import en from './en.json'

const technicalText = new Set([
  'OCR',
  'Ctrl',
  'null',
  'HEX',
  'RGB',
  'HSL',
  'SMS',
  'ISO 8601',
  'UTC',
  'car OR truck',
  'title*',
  'Recall',
  'Ctrl/Cmd + Enter',
  'K',
  'v',
  '1 MB',
  '5 MB',
  '10 MB',
  '25 MB',
  '50 MB',
  'ClipsX',
])
const labelAttributes = new Set([
  'title',
  'placeholder',
  'aria-label',
  'label',
  'description',
  'message',
  'tooltip',
  'emptyText',
  'text',
  'action',
])

it('keeps static host interface text translated and translation references valid', () => {
  const problems: string[] = []
  const catalogHas = (key: string) =>
    key
      .split('.')
      .reduce<unknown>(
        (value, part) =>
          value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
        en
      ) !== undefined
  const sources = import.meta.glob<string>('../**/*.{ts,tsx}', {
    eager: true,
    query: '?raw',
    import: 'default',
  })
  for (const [file, raw] of Object.entries(sources)) {
    if (/\.test\./.test(file)) continue
    const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true)
    const checkLabel = (node: ts.Node, text: string) => {
      const normalized = text.replace(/\s+/g, ' ').trim()
      if (/[A-Za-z]/.test(normalized) && !technicalText.has(normalized)) {
        problems.push(
          `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${normalized}`
        )
      }
    }
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) checkLabel(node, node.text)
      if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        if (labelAttributes.has(node.name.getText(source))) checkLabel(node, node.initializer.text)
        if (node.name.getText(source) === 'i18nKey' && !catalogHas(node.initializer.text))
          problems.push(`Missing ${node.initializer.text}`)
      }
      if (ts.isCallExpression(node) && ['t', 'i18n.t'].includes(node.expression.getText(source))) {
        const key = node.arguments[0]
        if (
          key &&
          ts.isStringLiteral(key) &&
          !catalogHas(key.text) &&
          !catalogHas(key.text + '_one') &&
          !catalogHas(key.text + '_other')
        )
          problems.push(`Missing ${key.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(problems).toEqual([])
})
