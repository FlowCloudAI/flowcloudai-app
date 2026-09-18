// 本模块把功能区的容器间距值转换为现有属性内核请求；布局结构字段仍由契约缺口控制。
import {createRibbonPropertyRequest} from './ribbonKernelBinding.ts'
import type {KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'

export function createContainerGapRequest(nodeId: string, value: 'unset' | '0px' | '0.5rem' | '1rem' | '1.5rem'): KernelDraftEditRequest {
    if (value === 'unset') return createRibbonPropertyRequest(nodeId, 'gap', {kind: 'clear-override'})
    const unit = value.endsWith('rem') ? 'rem' : 'px'
    return createRibbonPropertyRequest(nodeId, 'gap', {
        kind: 'numeric', value: Number.parseFloat(value), unit, numberText: value.replace(/(?:rem|px)$/u, ''),
    })
}
