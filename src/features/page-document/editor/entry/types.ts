// 本模块限定词条编辑器与可选页面编辑入口的接口，默认构建可替换为空实现。

export interface PageDocumentEditorEntryProps {
    entryId: string
    projectId: string
    active: boolean
    title: string
    summary: string
    markdown: string
    resetVersion: number
    onDirtyChange: (dirty: boolean) => void
    onNavigationIntent: (href: string) => void
}
