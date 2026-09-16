// 默认构建使用空探针入口，保证共享恶意样例和绕过按钮不进入产物。

import type {PageDocumentCanvasEntryProps} from '../../entry/types.ts'

export function PageDocumentProbeEntry(props: PageDocumentCanvasEntryProps) {
    void props
    return null
}
