// 本模块只解析页面模式左栏的展示与返回目标；导航执行和草稿确认仍由宿主组件负责。

export type PageDocumentSidebarReturnTarget =
    | {kind: 'category'; categoryId: string}
    | {kind: 'project'}

export interface PageDocumentSidebarReturnResolution {
    target: PageDocumentSidebarReturnTarget
    requiresConfirmation: boolean
}

export function shouldShowPageDocumentComponentTree(
    activeProjectId: string | null,
    projectId: string,
): boolean {
    return activeProjectId === projectId
}

export function resolvePageDocumentSidebarReturn(
    categoryId: string | null,
    dirty: boolean,
): PageDocumentSidebarReturnResolution {
    return Object.freeze({
        target: categoryId
            ? Object.freeze({kind: 'category' as const, categoryId})
            : Object.freeze({kind: 'project' as const}),
        requiresConfirmation: dirty,
    })
}
