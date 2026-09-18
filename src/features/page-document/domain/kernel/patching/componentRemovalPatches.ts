// 本模块把单个托管组件子树删除编译为一个精确 HTML 补丁，并报告需要同步回收样式的全部身份。

import type {HtmlCompositionElement} from '../composition/index.ts'
import {
    isDocumentNodeKind,
    nodeId,
    planNodeDeletion,
    type NodeId,
    type NodeIdentityReference,
} from '../contracts/index.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {elementRange, getAttribute, walkElements} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ComponentRemovalPatchResult =
    | {
          readonly status: 'ready'
          readonly patch: SourcePatch
          readonly removedNodeIds: readonly NodeId[]
          readonly remappedReferences: readonly NodeIdentityReference[]
      }
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createComponentRemovalPatch(
    document: SourceDocument,
    component: HtmlCompositionElement,
    references: readonly NodeIdentityReference[] = [],
): ComponentRemovalPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('component-source-invalid', '组件结构只能从 article.html 删除。')
    }
    const range = elementRange(component)
    if (!range) return rejected('source-location-missing', '无法定位待删除组件的作者源码。')
    const removedNodeIds: NodeId[] = []
    try {
        walkElements(component, element => {
            const rawId = getAttribute(element, 'data-fc-node-id')
            const kind = getAttribute(element, 'data-fc-node-kind')
            if (rawId && isDocumentNodeKind(kind)) removedNodeIds.push(nodeId(rawId))
        })
    } catch {
        return rejected('invalid-node-id', '待删除组件子树包含无效身份。')
    }
    if (removedNodeIds.length === 0) {
        return rejected('component-identity-missing', '待删除源码不再包含托管组件身份。')
    }
    let remappedReferences = references
    const retiredNodeIds: NodeId[] = []
    for (const removedNodeId of removedNodeIds) {
        const planned = planNodeDeletion(removedNodeId, remappedReferences)
        retiredNodeIds.push(...planned.retiredNodeIds)
        remappedReferences = planned.references
    }
    return Object.freeze({
        status: 'ready',
        patch: Object.freeze({
            source: document.key,
            range: utf16Range(range.from, range.to),
            expected: document.content.slice(range.from, range.to),
            insert: '',
        }),
        removedNodeIds: Object.freeze(retiredNodeIds),
        remappedReferences: Object.freeze([...remappedReferences]),
    })
}

function rejected(code: string, message: string): ComponentRemovalPatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
