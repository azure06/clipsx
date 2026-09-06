export const linkRecallCitations = (markdown: string) =>
  markdown
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, index) =>
      index % 2 === 0
        ? part.replace(/\[(\d+)\]/g, (_match, number) => `[${number}](recall-source:${number})`)
        : part
    )
    .join('')
