import { clipsxAssetUrl } from '../../shared/rendering'
import type { RenderModel } from '../../shared/types'

export const RenderModelView = ({ model }: { model: RenderModel }) => {
  if (model.kind === 'html')
    return (
      <iframe
        className="mt-3 min-h-48 w-full rounded bg-white"
        sandbox=""
        srcDoc={model.sanitizedHtml}
        title="Sanitized HTML preview"
      />
    )
  if (model.kind === 'image')
    return (
      <img
        className="mt-3 max-h-80 rounded"
        src={clipsxAssetUrl(model.artifactId)}
        alt="Captured clipboard"
      />
    )
  if (model.kind === 'tree')
    return (
      <pre className="mt-3 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-xs">
        {JSON.stringify(model.value, null, 2)}
      </pre>
    )
  if (model.kind === 'table')
    return (
      <div className="mt-3 overflow-auto">
        <table className="text-sm">
          <thead>
            <tr>
              {model.columns.map(column => (
                <th key={column} className="border border-slate-700 p-2 text-left">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-slate-700 p-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  if (model.kind === 'key_value')
    return (
      <dl className="mt-3 space-y-1 text-sm">
        {model.entries.map(([key, value]) => (
          <div key={key}>
            <dt className="inline font-medium">{key}: </dt>
            <dd className="inline text-slate-300">{value}</dd>
          </div>
        ))}
      </dl>
    )
  const text =
    model.kind === 'code'
      ? model.text
      : model.kind === 'text'
        ? model.text
        : model.kind === 'markdown'
          ? model.markdown
          : model.kind === 'error'
            ? model.message
            : 'Binary preview unavailable'
  return (
    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs">
      {text}
    </pre>
  )
}
