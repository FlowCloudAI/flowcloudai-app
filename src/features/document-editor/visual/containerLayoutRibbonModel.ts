// 本模块把功能区的容器间距值转换为现有属性内核请求；布局结构字段仍由契约缺口控制。
import {createRibbonPropertyRequest} from './ribbonKernelBinding.ts'
import type {KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'

export type ContainerLayoutMode = 'unset' | 'block' | 'flow-root' | 'grid' | 'flex'
export type ContainerColumnPreset = 'unset' | 'one' | 'two' | 'three'
export type ContainerAlignPreset = 'unset' | 'stretch' | 'start' | 'center' | 'end'
export type ContainerJustifyPreset = 'unset' | 'start' | 'center' | 'end' | 'space-between'

export function createContainerGapRequest(nodeId: string, value: 'unset' | '0px' | '0.5rem' | '1rem' | '1.5rem'): KernelDraftEditRequest {
    if (value === 'unset') return createRibbonPropertyRequest(nodeId, 'gap', {kind: 'clear-override'})
    const unit = value.endsWith('rem') ? 'rem' : 'px'
    return createRibbonPropertyRequest(nodeId, 'gap', {
        kind: 'numeric', value: Number.parseFloat(value), unit, numberText: value.replace(/(?:rem|px)$/u, ''),
    })
}

export function createContainerLayoutRequest(
    nodeId: string,
    value: ContainerLayoutMode,
): KernelDraftEditRequest {
    return createRibbonPropertyRequest(
        nodeId,
        'display',
        value === 'unset' ? {kind: 'clear-override'} : {kind: 'display', value},
    )
}

export function createContainerColumnsRequest(
    nodeId: string,
    value: ContainerColumnPreset,
): KernelDraftEditRequest {
    const columns =
        value === 'one'
            ? 'minmax(0, 1fr)'
            : value === 'two'
              ? 'repeat(2, minmax(0, 1fr))'
              : value === 'three'
                ? 'repeat(3, minmax(0, 1fr))'
                : null
    return createRibbonPropertyRequest(
        nodeId,
        'grid-template-columns',
        columns === null ? {kind: 'clear-override'} : {kind: 'grid-columns', value: columns},
    )
}

export function createContainerAlignRequest(
    nodeId: string,
    value: ContainerAlignPreset,
): KernelDraftEditRequest {
    return createRibbonPropertyRequest(
        nodeId,
        'align-items',
        value === 'unset' ? {kind: 'clear-override'} : {kind: 'align-items', value},
    )
}

export function createContainerJustifyRequest(
    nodeId: string,
    value: ContainerJustifyPreset,
): KernelDraftEditRequest {
    return createRibbonPropertyRequest(
        nodeId,
        'justify-content',
        value === 'unset' ? {kind: 'clear-override'} : {kind: 'justify-content', value},
    )
}
