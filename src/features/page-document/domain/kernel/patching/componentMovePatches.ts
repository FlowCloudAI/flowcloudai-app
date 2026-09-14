// 本模块把一次组件移动编译为同一作者 HTML 上的删除与插入补丁；不重建节点内部源码。

import type {HtmlCompositionElement} from '../composition/index.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {elementInnerRange, elementRange} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ComponentMovePatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createComponentMovePatches(
    document: SourceDocument,
    target: HtmlCompositionElement,
    sourceContainer: HtmlCompositionElement,
    after: HtmlCompositionElement | null,
): ComponentMovePatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('component-source-invalid', '组件只能在 article.html 中移动。')
    }
    const targetRange = elementRange(target)
    const parentInner = elementInnerRange(sourceContainer)
    const afterRange = after ? elementRange(after) : null
    if (!targetRange || !parentInner || (after && !afterRange)) {
        return rejected('source-location-missing', '无法定位组件移动所需的作者源码。')
    }
    const insertionOffset = afterRange?.to ?? parentInner.from
    if (insertionOffset >= targetRange.from && insertionOffset <= targetRange.to) {
        return rejected('component-move-overlap', '组件移动位置与自身源码范围重叠。')
    }
    const movedSource = document.content.slice(targetRange.from, targetRange.to)
    return Object.freeze({
        status: 'ready',
        patches: Object.freeze([
            Object.freeze({
                source: document.key,
                range: utf16Range(targetRange.from, targetRange.to),
                expected: movedSource,
                insert: '',
            }),
            Object.freeze({
                source: document.key,
                range: utf16Range(insertionOffset, insertionOffset),
                expected: '',
                insert: movedSource,
            }),
        ]),
    })
}

function rejected(code: string, message: string): ComponentMovePatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
