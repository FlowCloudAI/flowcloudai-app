// 本模块是页面文档功能区到现有属性内核适配器的唯一绑定点；不持有界面状态。

import {
    createVisualPropertyEditRequest,
    type VisualPropertyEditValue,
    type VisualPropertyName,
} from '../../page-document/application/visualPropertyEditing.ts'
import type {KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'

export function createRibbonPropertyRequest(
    nodeId: string,
    property: VisualPropertyName,
    value: VisualPropertyEditValue,
): KernelDraftEditRequest {
    return createVisualPropertyEditRequest(nodeId, [{property, value}])
}
