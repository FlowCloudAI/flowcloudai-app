// 默认构建使用空入口，避免页面源码编辑器及其依赖进入发布产物。

import type {ReactNode} from 'react'
import type {PageDocumentEditorEntryProps} from './types.ts'

export function PageDocumentEditorEntry(props: PageDocumentEditorEntryProps) {
    void props
    return null
}

export function PageDocumentProjectSidebar({children}: {projectId: string; children: ReactNode}) {
    return <>{children}</>
}

export function PageDocumentProjectSidebarHeader({
    defaultLabel,
    onDefaultBack,
}: {
    projectId: string
    defaultLabel: string
    onDefaultBack: () => void
    onReturnCategory: (categoryId: string) => void
    onReturnProject: () => void
}) {
    return (
        <button type="button" className="pe-tree-header-btn" onClick={onDefaultBack}>
            {defaultLabel}
        </button>
    )
}

export function PageDocumentPropertiesDockHost() {
    return null
}

export type {PageDocumentEditorEntryProps} from './types.ts'
export const PAGE_DOCUMENT_EDITOR_ENABLED = false
