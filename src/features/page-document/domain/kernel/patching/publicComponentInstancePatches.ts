// 本模块只修改公共组件实例的公开属性与样式变量覆盖；组件定义内部结构仍由公共模板控制。

import type {HtmlCompositionElement} from '../composition/index.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {createInlineStylePropertiesPatch} from './inlineStylePatches.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type PublicComponentInstancePatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createPublicComponentInstancePatches(
    document: SourceDocument,
    element: HtmlCompositionElement,
    properties: Readonly<Record<string, string | null>>,
    styleVariables: Readonly<Record<string, string | null>>,
): PublicComponentInstancePatchResult {
    if (document.key.scope !== 'entry' || document.key.file !== 'article.html') {
        return rejected('component-instance-source-invalid', '公共组件实例只能写入词条 article.html。')
    }
    if (attribute(element, 'data-fc-node-kind') !== 'component' || !attribute(element, 'data-fc-component')) {
        return rejected('component-instance-target-invalid', '目标不是公共组件实例。')
    }
    const patches: SourcePatch[] = []
    const additions: string[] = []
    for (const [name, value] of Object.entries(properties)) {
        const attributeName = `data-fc-prop-${name}`
        const range = element.sourceCodeLocation?.attrs?.[attributeName]
        const current = attribute(element, attributeName)
        if (value === current) continue
        if (value === null) {
            if (!range) continue
            patches.push(Object.freeze({
                source: document.key,
                range: utf16Range(range.startOffset, range.endOffset),
                expected: document.content.slice(range.startOffset, range.endOffset),
                insert: '',
            }))
        } else if (range) {
            patches.push(Object.freeze({
                source: document.key,
                range: utf16Range(range.startOffset, range.endOffset),
                expected: document.content.slice(range.startOffset, range.endOffset),
                insert: `${attributeName}="${escapeAttribute(value)}"`,
            }))
        } else {
            additions.push(` ${attributeName}="${escapeAttribute(value)}"`)
        }
    }
    if (additions.length > 0) {
        const at = startTagInsertionOffset(document.content, element)
        if (at === null) return rejected('source-location-missing', '无法定位公共组件实例开始标签。')
        patches.push(Object.freeze({source: document.key, range: utf16Range(at, at), expected: '', insert: additions.join('')}))
    }
    const styleChanges = Object.entries(styleVariables).map(([property, value]) => ({property, value}))
    if (styleChanges.length > 0) {
        const style = createInlineStylePropertiesPatch(document, element, styleChanges)
        if (style.status === 'rejected') return style
        if (style.status === 'ready') patches.push(style.patch)
    }
    return patches.length === 0
        ? {status: 'unchanged'}
        : Object.freeze({status: 'ready', patches: Object.freeze(patches)})
}

function attribute(element: HtmlCompositionElement, name: string): string | undefined {
    return element.attrs.find(item => item.name === name)?.value
}

function startTagInsertionOffset(source: string, element: HtmlCompositionElement): number | null {
    const range = element.sourceCodeLocation?.startTag
    if (!range) return null
    const raw = source.slice(range.startOffset, range.endOffset)
    return range.endOffset - (raw.endsWith('/>') ? 2 : 1)
}

function escapeAttribute(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function rejected(code: string, message: string): Extract<PublicComponentInstancePatchResult, {readonly status: 'rejected'}> {
    return Object.freeze({status: 'rejected', code, message})
}
