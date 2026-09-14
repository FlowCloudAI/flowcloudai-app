// 本模块核对源码逃生口前后的托管组件图；内部 HTML 可自由调整，但组件身份、类型、归属与顺序不能暗中漂移。

import type {ComponentDescriptor, ComponentIndex} from '../components/index.ts'
import {sourceKeyString} from '../contracts/source.ts'

export interface ManagedComponentStructureMismatch {
    readonly addedNodeIds: readonly string[]
    readonly removedNodeIds: readonly string[]
    readonly changedNodeIds: readonly string[]
    readonly rootOrderChanged: boolean
}

export function compareManagedComponentStructure(
    before: ComponentIndex,
    after: ComponentIndex,
): ManagedComponentStructureMismatch | null {
    const beforeById = descriptorMap(before)
    const afterById = descriptorMap(after)
    const addedNodeIds = sortedDifference(afterById, beforeById)
    const removedNodeIds = sortedDifference(beforeById, afterById)
    const changedNodeIds = [...beforeById.keys()]
        .filter(nodeId => {
            const beforeComponent = beforeById.get(nodeId)
            const afterComponent = afterById.get(nodeId)
            return (
                beforeComponent &&
                afterComponent &&
                !sameManagedComponent(beforeComponent, afterComponent)
            )
        })
        .sort()
    const rootOrderChanged =
        addedNodeIds.length === 0 &&
        removedNodeIds.length === 0 &&
        !sameStringArray(rootNodeIds(before), rootNodeIds(after))

    if (
        addedNodeIds.length === 0 &&
        removedNodeIds.length === 0 &&
        changedNodeIds.length === 0 &&
        !rootOrderChanged
    ) {
        return null
    }
    return Object.freeze({
        addedNodeIds: Object.freeze(addedNodeIds),
        removedNodeIds: Object.freeze(removedNodeIds),
        changedNodeIds: Object.freeze(changedNodeIds),
        rootOrderChanged,
    })
}

export function describeManagedComponentStructureMismatch(
    mismatch: ManagedComponentStructureMismatch,
): string {
    const details: string[] = []
    if (mismatch.addedNodeIds.length > 0) {
        details.push(`新增 ${summarizeNodeIds(mismatch.addedNodeIds)}`)
    }
    if (mismatch.removedNodeIds.length > 0) {
        details.push(`删除或改写身份 ${summarizeNodeIds(mismatch.removedNodeIds)}`)
    }
    if (mismatch.changedNodeIds.length > 0) {
        details.push(
            `移动、改型、改变语义标签或改变源码归属 ${summarizeNodeIds(mismatch.changedNodeIds)}`,
        )
    }
    if (mismatch.rootOrderChanged) details.push('改变根组件顺序')
    return details.join('；')
}

function descriptorMap(index: ComponentIndex): ReadonlyMap<string, ComponentDescriptor> {
    return new Map(index.components.map(component => [component.handle.nodeId, component]))
}

function sortedDifference(
    left: ReadonlyMap<string, ComponentDescriptor>,
    right: ReadonlyMap<string, ComponentDescriptor>,
): string[] {
    return [...left.keys()].filter(nodeId => !right.has(nodeId)).sort()
}

function rootNodeIds(index: ComponentIndex): readonly string[] {
    return index.components
        .filter(component => component.parentNodeId === null)
        .map(component => component.handle.nodeId)
}

function sameManagedComponent(left: ComponentDescriptor, right: ComponentDescriptor): boolean {
    return (
        left.handle.kind === right.handle.kind &&
        left.tagName === right.tagName &&
        left.parentNodeId === right.parentNodeId &&
        sameStringArray(left.childNodeIds, right.childNodeIds) &&
        sourceIdentity(left) === sourceIdentity(right)
    )
}

function sourceIdentity(component: ComponentDescriptor): string {
    const origin = component.handle.origin
    return `${origin.kind}:${origin.source ? sourceKeyString(origin.source) : 'generated'}`
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
}

function summarizeNodeIds(nodeIds: readonly string[]): string {
    const visible = nodeIds.slice(0, 3).join('、')
    return nodeIds.length > 3 ? `${visible} 等 ${nodeIds.length} 个组件` : visible
}
