import { invoke } from '@tauri-apps/api/core'
import type { ClipItem, Tag } from '../types/clipboard'

export const getTags = (): Promise<Tag[]> => invoke<Tag[]>('get_tags')

export const createTag = (name: string, color?: string): Promise<Tag> =>
  invoke<Tag>('create_tag', { name, color: color ?? null })

export const deleteTag = (tagId: number): Promise<void> =>
  invoke<void>('delete_tag', { tagId, tag_id: tagId })

export const addTagToClip = (clipId: string, tagId: number): Promise<void> =>
  invoke<void>('add_tag_to_clip', {
    clipId,
    clip_id: clipId,
    tagId,
    tag_id: tagId,
  })

export const removeTagFromClip = (clipId: string, tagId: number): Promise<void> =>
  invoke<void>('remove_tag_from_clip', {
    clipId,
    clip_id: clipId,
    tagId,
    tag_id: tagId,
  })

export const getTagsForClip = (clipId: string): Promise<Tag[]> =>
  invoke<Tag[]>('get_tags_for_clip', { clipId, clip_id: clipId })

export const updateClipNote = (clipId: string, note: string | null): Promise<ClipItem> =>
  invoke<ClipItem>('update_clip_note', { clipId, clip_id: clipId, note }).then(result => {
    console.log('[NOTE_DEBUG][shared/api] update_clip_note resolved', {
      clipId,
      sentNote: note,
      returnedNote: result.note ?? null,
      expected:
        'Tauri command should resolve with the saved ClipItem and returnedNote should match sentNote',
    })
    return result
  })

export const getTagsForClips = (clipIds: string[]): Promise<{ clipId: string; tag: Tag }[]> =>
  invoke<{ clipId: string; tag: Tag }[]>('get_tags_for_clips', {
    clipIds,
    clip_ids: clipIds,
  })
