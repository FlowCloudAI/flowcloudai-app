// 本模块把公共组件实例写入作者 HTML；定义内容不复制进源码，只有稳定引用、公开属性和插槽内容会被保存。
import type {HtmlCompositionElement} from '../composition/index.ts'
import type {NodeId} from '../contracts/identity.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {elementInnerRange, elementRange} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export function createPublicComponentInsertionPatch(
    article: SourceDocument,
    sourceContainer: HtmlCompositionElement,
    after: HtmlCompositionElement | null,
    componentId: NodeId,
    revision: number | 'latest',
    instanceId: NodeId,
    newNodeId: NodeId,
    properties: Readonly<Record<string, string>>,
    parts: Readonly<Record<string, string>>,
): SourcePatch | {readonly status: 'rejected'; readonly code: string; readonly message: string} {
    if (article.key.file !== 'article.html') {
        return {status: 'rejected', code: 'component-source-invalid', message: '公共组件实例只能写入 article.html。'}
    }
    const parentInner = elementInnerRange(sourceContainer)
    const afterRange = after ? elementRange(after) : null
    if (!parentInner || (after && !afterRange)) {
        return {status: 'rejected', code: 'source-location-missing', message: '无法定位公共组件插入位置。'}
    }
    const attrs = Object.entries(properties)
        .filter(([name, value]) => /^[a-z][a-z0-9-]{0,63}$/u.test(name) && value.length <= 4096)
        .map(([name, value]) => ' data-fc-prop-' + name + '="' + escapeAttribute(value) + '"')
        .join('')
    const slotMarkup = Object.entries(parts)
        .filter(([name, value]) => /^[a-z][a-z0-9-]{0,63}$/u.test(name) && value.length <= 32_768)
        .map(([name, value]) => '<span data-fc-part="' + name + '">' + escapeHtml(value) + '</span>')
        .join('')
    const markup =
        '<div data-fc-node-id="' + newNodeId + '" data-fc-node-kind="component"' +
        ' data-fc-component="' + componentId + '" data-fc-component-revision="' + revision + '"' +
        ' data-fc-instance="' + instanceId + '"' + attrs + '>' + slotMarkup + '</div>'
    const offset = afterRange?.to ?? parentInner.from
    return Object.freeze({
        source: article.key,
        range: utf16Range(offset, offset),
        expected: '',
        insert: markup,
    })
}

function escapeAttribute(value: string): string {
    return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;')
}

function escapeHtml(value: string): string {
    return escapeAttribute(value).replace(/>/gu, '&gt;')
}
