// 本模块收集属性分析真正读取的节点、声明、变量、源码和上下文，供缓存失效与过期计划检查复用。

import type {DocumentDiagnostic} from '../../contract.ts'
import type {HtmlCompositionElement} from '../composition/index.ts'
import type {AuthorDeclarationState} from '../contracts/analysis.ts'
import type {DependencySet, ReadContext} from '../contracts/context.ts'
import {nodeId, type AnalysisStampId, type NodeId} from '../contracts/identity.ts'
import type {ManagedNodeStyleContext} from '../contracts/primitives.ts'
import {sourceKeyString, type SourceKey} from '../contracts/source.ts'

export interface StyleDependencyCollector {
    readonly nodeIds: Set<NodeId>
    readonly parentNodeIds: Set<NodeId>
    readonly sources: Map<string, SourceKey>
    readonly declarations: Set<string>
    readonly variables: Set<string>
    readonly contexts: Set<ManagedNodeStyleContext>
    readonly diagnostics: DocumentDiagnostic[]
}

export function createStyleDependencyCollector(context: ReadContext): StyleDependencyCollector {
    const contexts = new Set<ManagedNodeStyleContext>([context.viewport])
    if (context.interactions.hover) contexts.add('hover')
    if (context.interactions.focusWithin) contexts.add('focus-within')
    return {
        nodeIds: new Set(),
        parentNodeIds: new Set(),
        sources: new Map(),
        declarations: new Set(),
        variables: new Set(),
        contexts,
        diagnostics: [],
    }
}

export function addStyleDeclarationDependency(
    dependencies: StyleDependencyCollector,
    state: AuthorDeclarationState,
): void {
    dependencies.declarations.add(state.id)
    if (state.origin.source) {
        dependencies.sources.set(sourceKeyString(state.origin.source), state.origin.source)
    }
    for (const match of state.rawValue.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/gu)) {
        dependencies.variables.add(match[1])
    }
}

export function addStyleNodeDependency(target: Set<NodeId>, element: HtmlCompositionElement): void {
    const rawId = element.attrs.find(item => item.name === 'data-fc-node-id')?.value
    if (!rawId) return
    try {
        target.add(nodeId(rawId))
    } catch {
        // 组件契约诊断负责非法身份；属性依赖不能伪造品牌 ID。
    }
}

export function finishStyleDependencies(
    dependencies: StyleDependencyCollector,
    analysisStamp: AnalysisStampId,
): DependencySet {
    return Object.freeze({
        nodeIds: Object.freeze([...dependencies.nodeIds]),
        parentNodeIds: Object.freeze([...dependencies.parentNodeIds]),
        sources: Object.freeze([...dependencies.sources.values()]),
        declarations: Object.freeze([...dependencies.declarations]),
        variables: Object.freeze([...dependencies.variables]),
        contexts: Object.freeze([...dependencies.contexts]),
        analysisStamp,
    })
}
