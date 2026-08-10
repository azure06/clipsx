import type { RepresentationDetail } from '../../shared/types'

export const RawRepresentations = ({
  representations,
}: {
  representations: RepresentationDetail[]
}) => (
  <>
    <h2 className="mt-6 font-semibold">Raw representations</h2>
    {representations.map(rep => (
      <article key={rep.id} className="mt-3 rounded border border-slate-700 p-3">
        <p className="text-sm font-medium">
          {rep.ordinal + 1}. {rep.formatKey}
        </p>
        <p className="text-xs text-slate-400">
          {rep.storageKind} · {rep.byteLength} bytes {rep.nativeType && ` · ${rep.nativeType}`}
        </p>
        {rep.textValue !== undefined && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs">
            {rep.textValue}
          </pre>
        )}
        {rep.fileReferences.length > 0 && (
          <ol className="mt-2 list-decimal pl-5 text-sm">
            {rep.fileReferences.map(file => (
              <li key={file}>{file}</li>
            ))}
          </ol>
        )}
        {rep.binaryFileId && (
          <p className="mt-2 text-xs text-slate-400">Binary asset {rep.sha256}</p>
        )}
      </article>
    ))}
  </>
)
