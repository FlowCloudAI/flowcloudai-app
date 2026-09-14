// 本模块把标题层级与列表类型转换编译为成对标签名补丁；能力策略由组件定义负责。

import type {HtmlCompositionElement} from '../composition/index.ts'
import type {DocumentMutableNodeTag} from '../contracts/primitives.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ComponentTagPatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createComponentTagPatches(
    document: SourceDocument,
    element: HtmlCompositionElement,
    expectedTag: DocumentMutableNodeTag,
    tag: DocumentMutableNodeTag,
): ComponentTagPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('component-tag-source-invalid', '组件标签只能写入 article.html。')
    }
    if (element.tagName !== expectedTag) {
        return rejected('component-tag-precondition-failed', '组件标签已变化，请重新读取。')
    }
    if (expectedTag === tag) return {status: 'unchanged'}
    const start = tagNameRange(document.content, element.sourceCodeLocation?.startTag, false)
    const end = tagNameRange(document.content, element.sourceCodeLocation?.endTag, true)
    if (!start || !end) {
        return rejected('source-location-missing', '无法定位组件的开始或结束标签。')
    }
    return Object.freeze({
        status: 'ready',
        patches: Object.freeze([
            Object.freeze({
                source: document.key,
                range: utf16Range(start.from, start.to),
                expected: document.content.slice(start.from, start.to),
                insert: tag,
            }),
            Object.freeze({
                source: document.key,
                range: utf16Range(end.from, end.to),
                expected: document.content.slice(end.from, end.to),
                insert: tag,
            }),
        ]),
    })
}

function tagNameRange(
    source: string,
    range: {readonly startOffset: number; readonly endOffset: number} | undefined,
    closing: boolean,
): {readonly from: number; readonly to: number} | null {
    if (!range) return null
    const raw = source.slice(range.startOffset, range.endOffset)
    const match = (closing ? /^<\/\s*([a-z][a-z0-9-]*)/iu : /^<\s*([a-z][a-z0-9-]*)/iu).exec(raw)
    if (!match) return null
    const relative = raw.indexOf(match[1])
    return Object.freeze({
        from: range.startOffset + relative,
        to: range.startOffset + relative + match[1].length,
    })
}

function rejected(
    code: string,
    message: string,
): Extract<ComponentTagPatchResult, {status: 'rejected'}> {
    return Object.freeze({status: 'rejected', code, message})
}
