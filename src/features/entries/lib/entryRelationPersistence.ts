// 桌面词条元数据保存时逐项同步关系；不经过会连带写入旧正文的 bundle 命令。

import type {EntryRelation} from '../../../api'
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelations/EntryRelationCreator.tsx'
import {resolveRelationPayload} from './entryRelation.ts'

interface RelationCommands {
    list: (entryId: string, projectId: string) => Promise<EntryRelation[]>
    create: (payload: {projectId: string; aId: string; bId: string; relation: 'one_way' | 'two_way'; content: string}) => Promise<EntryRelation>
    update: (payload: {id: string; projectId: string; relation: 'one_way' | 'two_way'; content: string}) => Promise<EntryRelation>
    delete: (id: string, projectId: string) => Promise<void>
}

export async function syncEntryRelationDrafts(
    entryId: string,
    projectId: string,
    drafts: EntryRelationDraft[],
    commands: RelationCommands,
): Promise<void> {
    const existing = await commands.list(entryId, projectId)
    const draftIds = new Set(drafts.map(draft => draft.id).filter(Boolean))
    for (const relation of existing) {
        if (!draftIds.has(relation.id) && !drafts.some(draft => {
            if (draft.id) return false
            const payload = resolveRelationPayload(entryId, draft)
            return payload.aId === relation.a_id && payload.bId === relation.b_id
                && payload.relation === relation.relation && payload.content === (relation.content ?? '')
        })) await commands.delete(relation.id, projectId)
    }

    for (const draft of drafts) {
        const payload = resolveRelationPayload(entryId, draft)
        const old = existing.find(relation => relation.id === draft.id)
        if (old && old.a_id === payload.aId && old.b_id === payload.bId) {
            if (old.relation !== payload.relation || (old.content ?? '') !== payload.content) {
                await commands.update({id: old.id, projectId, relation: payload.relation, content: payload.content})
            }
        } else {
            if (old) await commands.delete(old.id, projectId)
            // 部分失败后重试时，已创建的无 ID 草稿不能重复插入。
            if (!existing.some(relation => relation.a_id === payload.aId && relation.b_id === payload.bId
                && relation.relation === payload.relation && (relation.content ?? '') === payload.content && relation.id !== old?.id)) {
                await commands.create({projectId, ...payload})
            }
        }
    }
}
