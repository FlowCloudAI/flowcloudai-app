// 本模块只保存桌面词条编辑器的视图草稿形状与无副作用比较逻辑，不承载保存或页面文档状态。

import type {Category, Entry, EntryTypeView, TagSchema} from '../../../api'
import type {AiMissingPluginKind} from '../../../shared/ui/AiPluginMissingOverlay'
import type {EntryEditorMode} from '../lib/entryEditorShortcutModel.ts'
import {buildTagValueMap, normalizeEntryContent} from '../lib/entryCommon.ts'
import {type EntryImage, normalizeEntryImages} from '../lib/entryImage.ts'

export interface EntryEditorProps {
    entryId: string
    projectId: string
    projectName: string
    active?: boolean
    aiPluginId?: string | null
    aiModel?: string | null
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    initialEditorMode?: EntryEditorMode
    pageDocumentSelection?: {nodeId: string; requestId: number} | null
    onOpenEntry?: (entry: { id: string; title: string }) => void
    onTitleChange?: (entry: Entry) => void | Promise<void>
    onSaved?: (entry: Entry) => void | Promise<void>
    onTagSchemasChange?: (schemas: TagSchema[]) => void | Promise<void>
    onBack?: () => void | Promise<void>
    onDelete?: () => void | Promise<void>
    onDirtyChange?: (dirty: boolean) => void
    onSavingChange?: (saving: boolean) => void
    onStartCharacterChat?: (entry: Entry) => void | Promise<void>
    onOpenWorldMap?: (target: {mapId: string; locationId: string}) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenAiSettings?: (pluginId: string) => void
}

export interface EntryDraft {
    title: string
    summary: string
    content: string
    type: string | null
    categoryId: string | null
    tags: Record<string, string | number | boolean | null>
    images: EntryImage[]
}

export function buildDraft(entry: Entry): EntryDraft {
    return {
        title: entry.title ?? '',
        summary: entry.summary ?? '',
        content: normalizeEntryContent(entry),
        type: entry.type ?? null,
        categoryId: entry.category_id ?? null,
        tags: buildTagValueMap(entry),
        images: normalizeEntryImages(entry.images),
    }
}

export function areImagesEqual(left: EntryImage[], right: EntryImage[]): boolean {
    if (left.length !== right.length) return false
    return left.every((image, index) => {
        const target = right[index]
        return image.path === target.path
            && image.url === target.url
            && image.alt === target.alt
            && Boolean(image.is_cover) === Boolean(target.is_cover)
    })
}
