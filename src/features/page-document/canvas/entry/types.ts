// 本模块限定词条查看态与默认页面文档预览之间的窄接口。

export interface PageDocumentCanvasEntryProps {
    entryId: string
    projectId: string
    title: string
    summary: string
    markdown: string
    onNavigationIntent: (href: string) => void
    compact?: boolean
}
