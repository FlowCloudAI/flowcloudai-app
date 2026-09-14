// 文档搜索仅返回已保存源码的派生定位；ordinal 随修订重建，不可当作节点 UUID 或源码编辑坐标。
export interface DocumentSearchHit {
    entryId: string
    title: string
    ordinal: number
    nodeId: string | null
    tag: string
    binding: string | null
    text: string
    entryRevision: number
    projectRevision: number
}

export interface DocumentSearchResult {
    query: string
    strategy: 'trigram' | 'substring'
    hits: DocumentSearchHit[]
    hasMore: boolean
}

export interface DocumentSearchOptions {
    entryId?: string
    limit?: number
    offset?: number
}
