// 默认构建使用这个空入口；它不导入画布、探针或测试样例，确保相关代码不进入产物。

import type {PageDocumentCanvasEntryProps} from './types.ts'

export function PageDocumentCanvasEntry(props: PageDocumentCanvasEntryProps) {
    void props
    return null
}

export type {PageDocumentCanvasEntryProps} from './types.ts'
