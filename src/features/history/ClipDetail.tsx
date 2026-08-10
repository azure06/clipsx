import { invoke } from '@tauri-apps/api/core'
import type { ClipDetail as ClipDetailModel, Tag, TransformPreview } from '../../shared/types'
import { RawRepresentations } from '../inspector/RawRepresentations'
import { ViewTabs } from '../inspector/ViewTabs'
import { TransformationPalette } from '../transforms/TransformationPalette'

export const ClipDetail = ({
  detail,
  action,
  tags,
  transformOpen,
  setTransformOpen,
  setActiveTransform,
}: {
  detail: ClipDetailModel
  action: (command: string, args: Record<string, unknown>) => Promise<void>
  tags: Tag[]
  transformOpen: boolean
  setTransformOpen: (value: boolean) => void
  setActiveTransform: (value: TransformPreview | null) => void
}) => (
  <>
    <div className="flex gap-2">
      <button
        className="button"
        onClick={() => void invoke('copy_clip_original', { clipId: detail.clip.id })}
      >
        Copy original
      </button>
      <button className="button" onClick={() => setTransformOpen(!transformOpen)}>
        Transform (T)
      </button>
      <button
        className="button"
        onClick={() =>
          void action('set_clip_pinned', { clipId: detail.clip.id, value: !detail.clip.isPinned })
        }
      >
        {detail.clip.isPinned ? 'Unpin' : 'Pin'}
      </button>
      <button
        className="button"
        onClick={() =>
          void action('set_clip_favorite', {
            clipId: detail.clip.id,
            value: !detail.clip.isFavorite,
          })
        }
      >
        {detail.clip.isFavorite ? 'Unfavorite' : 'Favorite'}
      </button>
      <button
        className="button danger"
        onClick={() => void action('delete_clip', { clipId: detail.clip.id })}
      >
        Delete
      </button>
    </div>
    <textarea
      className="mt-4 w-full rounded bg-slate-800 p-2"
      placeholder="Note"
      defaultValue={detail.clip.note}
      onBlur={event =>
        void action('update_clip_note', {
          clipId: detail.clip.id,
          note: event.currentTarget.value || null,
        })
      }
    />
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map(tag => (
        <button
          key={tag.id}
          className="tag"
          onClick={() =>
            void action(
              detail.clip.tags.some(item => item.id === tag.id)
                ? 'remove_clip_tag'
                : 'add_clip_tag',
              { clipId: detail.clip.id, tagId: tag.id }
            )
          }
        >
          {detail.clip.tags.some(item => item.id === tag.id) ? '✓ ' : ''}
          {tag.name}
        </button>
      ))}
    </div>
    <ViewTabs clipId={detail.clip.id} />
    {transformOpen && (
      <TransformationPalette
        clipId={detail.clip.id}
        representations={detail.representations}
        close={() => setTransformOpen(false)}
        setActive={setActiveTransform}
      />
    )}
    <RawRepresentations representations={detail.representations} />
  </>
)
