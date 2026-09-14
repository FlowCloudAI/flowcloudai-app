// 本模块把组件 hidden 语义编译为最小 HTML 属性补丁；结构策略与可见段落约束由候选分析负责。

import type {HtmlCompositionElement} from '../composition/index.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ComponentVisibilityPatchResult =
    | {readonly status: 'ready'; readonly patch: SourcePatch}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createComponentVisibilityPatch(
    document: SourceDocument,
    element: HtmlCompositionElement,
    expectedHidden: boolean,
    hidden: boolean,
): ComponentVisibilityPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('visibility-source-invalid', '组件可见性只能写入 article.html。')
    }
    const currentlyHidden = element.attrs.some(attribute => attribute.name === 'hidden')
    if (currentlyHidden !== expectedHidden) {
        return rejected('visibility-precondition-failed', '节点 hidden 状态已变化，请重新读取。')
    }
    if (currentlyHidden === hidden) return {status: 'unchanged'}
    if (hidden) {
        const at = startTagInsertionOffset(document.content, element)
        if (at === null) return rejected('source-location-missing', '无法定位节点开始标签。')
        return {
            status: 'ready',
            patch: Object.freeze({
                source: document.key,
                range: utf16Range(at, at),
                expected: '',
                insert: ' hidden',
            }),
        }
    }
    const range = element.sourceCodeLocation?.attrs?.hidden
    if (!range) return rejected('source-location-missing', '无法定位节点 hidden 属性。')
    const from = /[\t ]/u.test(document.content[range.startOffset - 1] ?? '')
        ? range.startOffset - 1
        : range.startOffset
    return {
        status: 'ready',
        patch: Object.freeze({
            source: document.key,
            range: utf16Range(from, range.endOffset),
            expected: document.content.slice(from, range.endOffset),
            insert: '',
        }),
    }
}

function startTagInsertionOffset(source: string, element: HtmlCompositionElement): number | null {
    const range = element.sourceCodeLocation?.startTag
    if (!range) return null
    const raw = source.slice(range.startOffset, range.endOffset)
    return range.endOffset - (raw.endsWith('/>') ? 2 : 1)
}

function rejected(
    code: string,
    message: string,
): Extract<ComponentVisibilityPatchResult, {status: 'rejected'}> {
    return Object.freeze({status: 'rejected', code, message})
}
