// 本模块只定义业务页面与可选画布入口之间的窄接口，使关闭构建能替换为空实现。

export interface PageDocumentCanvasEntryProps {
    entryId: string
    projectId: string
    title: string
    summary: string
    markdown: string
    onNavigationIntent: (href: string) => void
    compact?: boolean
}
