/**
 * 桌面端词条标签的分组逻辑。标签是否打开与编辑器是否挂载是两套状态，
 * 本模块只负责从标签列表派生各项目的词条 ID，避免再次混用两者。
 */

export type EntryTabMeta = {
    projectId: string
    entryId: string
    pageDocumentSelection?: {
        nodeId: string
        requestId: number
    }
}

export function groupEntryIdsByProject(
    tabs: readonly { key: string }[],
    entryTabMap: Readonly<Record<string, EntryTabMeta>>,
    includedTabKeys?: ReadonlySet<string>,
): Record<string, string[]> {
    const grouped: Record<string, string[]> = {}
    for (const tab of tabs) {
        const entryMeta = entryTabMap[tab.key]
        if (!entryMeta || (includedTabKeys && !includedTabKeys.has(tab.key))) continue
        if (!grouped[entryMeta.projectId]) grouped[entryMeta.projectId] = []
        grouped[entryMeta.projectId].push(entryMeta.entryId)
    }
    return grouped
}
