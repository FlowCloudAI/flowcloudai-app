// 本模块只决定页面编辑器读取态的呈现优先级，避免空会话遮蔽真实读取错误。

export type PageDocumentEditorLoadView = 'loading' | 'error' | 'ready'

export function resolvePageDocumentEditorLoadView(
    loadStatus: PageDocumentEditorLoadView,
    hasState: boolean,
): PageDocumentEditorLoadView {
    if (loadStatus === 'error') return 'error'
    if (loadStatus === 'loading' || !hasState) return 'loading'
    return 'ready'
}
