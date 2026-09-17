// 本模块限定词条编辑器与正式页面编辑入口之间的接口。

import type {EntryBrief} from '../../../../api/worldflow.ts'

export interface PageDocumentEditorEntryProps {
    entryId: string
    projectId: string
    categoryId: string | null
    active: boolean
    title: string
    summary: string
    markdown: string
    projectEntries: readonly EntryBrief[]
    resetVersion: number
    onDirtyChange: (dirty: boolean) => void
    onSavedDerivedText?: (derivedText: string) => void
    onNavigationIntent: (href: string) => void
    onRequestLeave: () => Promise<boolean>
}
