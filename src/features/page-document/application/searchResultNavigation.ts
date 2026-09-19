// 本模块把桌面搜索返回的段落命中转换为词条打开意图；列表、标签和画布之间不共享可变状态。

import type {EntryBrief} from '../../../api/worldflow.ts'

export interface PageDocumentSearchOpenTarget {
    readonly id: string
    readonly title: string
    readonly pageDocumentNodeId?: string
}

export interface PageDocumentSelectionRequest {
    readonly nodeId: string
    readonly requestId: number
}

export function pageDocumentSearchOpenTarget(entry: EntryBrief): PageDocumentSearchOpenTarget {
    return {
        id: entry.id,
        title: entry.title,
        ...(entry.search_hit_node_id ? {pageDocumentNodeId: entry.search_hit_node_id} : {}),
    }
}

export function pageDocumentSearchDescription(entry: EntryBrief): string {
    return entry.search_hit_snippet
        || entry.summary
        || '这个词条还没有摘要，点击后可继续补充设定内容。'
}

export function advancePageDocumentSelectionRequest(
    current: PageDocumentSelectionRequest | undefined,
    nodeId: string | undefined,
): PageDocumentSelectionRequest | undefined {
    if (!nodeId) return current
    return Object.freeze({nodeId, requestId: (current?.requestId ?? 0) + 1})
}
