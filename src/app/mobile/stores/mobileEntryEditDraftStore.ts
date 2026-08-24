/**
 * 移动端词条编辑会话草稿：在编辑主页、属性页与关系页之间保留同一份未保存状态。
 * 页面栈只保留顶部两层，第三层打开后更早的页面会卸载，因此草稿不能寄存在页面组件本地。
 */
import {useCallback, useSyncExternalStore} from 'react'
import type {EntryRelationDraft} from '../../../features/project-editor/components/EntryRelations/EntryRelationCreator'
import type {EntryImage} from '../../../features/entries/lib/entryImage'
import type {TagValueMap} from '../pages/MobileEntryDetailUtils'
import {areRelationDraftsEqual} from '../../../features/entries/lib/entryRelation'
import {areImagesEqual} from '../pages/MobileEntryDetailUtils'

export interface MobileEntryEditDraft {
    projectId: string
    entryId: string
    title: string
    content: string
    summary: string
    entryType: string | null
    categoryId: string | null
    tagDraft: TagValueMap
    images: EntryImage[]
    relationDrafts: EntryRelationDraft[]
}

interface MobileEntryEditDraftSnapshot {
    draft: MobileEntryEditDraft | null
    baseline: MobileEntryEditDraft | null
    version: number
}

const EMPTY_SNAPSHOT: MobileEntryEditDraftSnapshot = {draft: null, baseline: null, version: 0}
const snapshots = new Map<string, MobileEntryEditDraftSnapshot>()
const listeners = new Map<string, Set<() => void>>()

export function mobileEntryEditDraftKey(projectId: string, entryId: string): string {
    return `${projectId}:${entryId}`
}

function emit(key: string): void {
    for (const listener of listeners.get(key) ?? []) listener()
}

function getSnapshot(key: string): MobileEntryEditDraftSnapshot {
    return snapshots.get(key) ?? EMPTY_SNAPSHOT
}

function subscribe(key: string, listener: () => void): () => void {
    const current = listeners.get(key) ?? new Set<() => void>()
    current.add(listener)
    listeners.set(key, current)
    return () => {
        current.delete(listener)
        if (current.size === 0) listeners.delete(key)
    }
}

function writeDraft(
    key: string,
    draft: MobileEntryEditDraft | null,
    baseline: MobileEntryEditDraft | null = getSnapshot(key).baseline,
): void {
    const previous = getSnapshot(key)
    snapshots.set(key, {draft, baseline, version: previous.version + 1})
    emit(key)
}

/** 首次进入编辑态时建立会话；页面栈返回导致的重挂载不会覆盖既有修改。 */
export function ensureMobileEntryEditDraft(nextDraft: MobileEntryEditDraft): MobileEntryEditDraft {
    const key = mobileEntryEditDraftKey(nextDraft.projectId, nextDraft.entryId)
    const current = getSnapshot(key).draft
    if (current) return current
    writeDraft(key, nextDraft, nextDraft)
    return nextDraft
}

/** 保存成功或用户主动重新开始编辑时，用服务端真值重置整份会话。 */
export function replaceMobileEntryEditDraft(nextDraft: MobileEntryEditDraft): void {
    writeDraft(mobileEntryEditDraftKey(nextDraft.projectId, nextDraft.entryId), nextDraft, nextDraft)
}

export function updateMobileEntryEditDraft(
    projectId: string,
    entryId: string,
    update: Partial<MobileEntryEditDraft> | ((current: MobileEntryEditDraft) => MobileEntryEditDraft),
): void {
    const key = mobileEntryEditDraftKey(projectId, entryId)
    const current = getSnapshot(key).draft
    if (!current) return
    const next = typeof update === 'function' ? update(current) : {...current, ...update}
    if (next === current) return
    writeDraft(key, next)
}

export function clearMobileEntryEditDraft(projectId: string, entryId: string): void {
    const key = mobileEntryEditDraftKey(projectId, entryId)
    if (!snapshots.has(key)) return
    snapshots.delete(key)
    emit(key)
}

export function getMobileEntryEditDraft(projectId: string, entryId: string): MobileEntryEditDraft | null {
    return getSnapshot(mobileEntryEditDraftKey(projectId, entryId)).draft
}

function areTagDraftsEqual(left: TagValueMap, right: TagValueMap): boolean {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    return Array.from(keys).every(key => Object.is(left[key] ?? null, right[key] ?? null))
}

export function isMobileEntryEditDraftDirty(projectId: string, entryId: string): boolean {
    const {draft, baseline} = getSnapshot(mobileEntryEditDraftKey(projectId, entryId))
    if (!draft || !baseline) return false
    return draft.title !== baseline.title
        || draft.content !== baseline.content
        || draft.summary !== baseline.summary
        || draft.entryType !== baseline.entryType
        || draft.categoryId !== baseline.categoryId
        || !areTagDraftsEqual(draft.tagDraft, baseline.tagDraft)
        || !areImagesEqual(draft.images, baseline.images)
        || !areRelationDraftsEqual(draft.relationDrafts, baseline.relationDrafts)
}

export function useMobileEntryEditDraft(projectId: string, entryId: string): MobileEntryEditDraft | null {
    const key = mobileEntryEditDraftKey(projectId, entryId)
    const subscribeDraft = useCallback((listener: () => void) => subscribe(key, listener), [key])
    const readDraft = useCallback(() => getSnapshot(key), [key])
    return useSyncExternalStore(subscribeDraft, readDraft, readDraft).draft
}
