// 默认构建使用空入口，避免页面源码编辑器及其依赖进入发布产物。

import type {PageDocumentEditorEntryProps} from './types.ts'

export function PageDocumentEditorEntry(props: PageDocumentEditorEntryProps) {
    void props
    return null
}

export type {PageDocumentEditorEntryProps} from './types.ts'
export const PAGE_DOCUMENT_EDITOR_ENABLED = false
