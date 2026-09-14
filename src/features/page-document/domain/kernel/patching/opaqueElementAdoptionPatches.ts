// 本模块把未托管作者元素接管编译为最小身份属性补丁；它不改写元素内部源码，也不接受模板契约节点。

import {inferComponentKindFromTag} from '../components/index.ts'
import type {NodeId} from '../contracts/identity.ts'
import type {DocumentNodeKind} from '../contracts/primitives.ts'
import {utf16Range, type SourceDocument, type Utf16SourceRange} from '../contracts/source.ts'
import {
    elementRange,
    findElementsByAttribute,
    getAttribute,
    hasBlockingDiagnostics,
    parseHtmlSource,
} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type OpaqueElementAdoptionPatchResult =
    | {readonly status: 'ready'; readonly patch: SourcePatch}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

const RESERVED_CONTRACT_ATTRIBUTES = Object.freeze([
    'data-fc-bind',
    'data-fc-slot',
    'data-fc-entry-patch',
    'data-fc-fill',
    'data-fc-append',
    'data-fc-replace',
    'data-fc-remove',
    'data-fc-editor-root',
])

export function createOpaqueElementAdoptionPatch(
    document: SourceDocument,
    range: Utf16SourceRange,
    expected: string,
    newNodeId: NodeId,
    componentKind: DocumentNodeKind,
): OpaqueElementAdoptionPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('opaque-adoption-source-invalid', '源码节点接管只能写入 article.html。')
    }
    if (document.content.slice(range.from, range.to) !== expected) {
        return rejected('source-precondition-failed', '待接管源码与 expected 不一致。')
    }
    const parsed = parseHtmlSource(document.content, {
        mode: document.key.scope === 'project' ? 'document' : 'fragment',
        scope: document.key.scope,
    })
    if (hasBlockingDiagnostics(parsed.diagnostics)) {
        return rejected('candidate-analysis-failed', '当前 HTML 结构无效，不能接管源码节点。')
    }
    if (findElementsByAttribute(parsed, 'data-fc-node-id', newNodeId).length > 0) {
        return rejected('component-identity-conflict', '新组件身份已经被当前文档使用。')
    }
    const matches = parsed.elements.filter(element => {
        const sourceRange = elementRange(element)
        return sourceRange?.from === range.from && sourceRange.to === range.to
    })
    if (matches.length !== 1) {
        return rejected('opaque-adoption-range-invalid', '接管范围必须精确覆盖一个作者元素。')
    }
    const element = matches[0]
    if (getAttribute(element, 'data-fc-node-id') || getAttribute(element, 'data-fc-node-kind')) {
        return rejected('component-already-managed', '该元素已经带有托管身份。')
    }
    const reserved = RESERVED_CONTRACT_ATTRIBUTES.find(
        attribute => getAttribute(element, attribute) !== undefined,
    )
    if (reserved) {
        return rejected(
            'opaque-adoption-contract-node',
            `带 ${reserved} 的模板契约节点不能转为普通可视节点。`,
        )
    }
    if (inferComponentKindFromTag(element.tagName) !== componentKind) {
        return rejected(
            'opaque-adoption-kind-mismatch',
            `${componentKind} 不能接管 <${element.tagName}>。`,
        )
    }
    const startTag = element.sourceCodeLocation?.startTag
    if (!startTag) {
        return rejected('source-location-missing', '无法定位待接管元素的开始标签。')
    }
    const rawStartTag = document.content.slice(startTag.startOffset, startTag.endOffset)
    const offset = startTag.endOffset - (rawStartTag.endsWith('/>') ? 2 : 1)
    return Object.freeze({
        status: 'ready',
        patch: Object.freeze({
            source: document.key,
            range: utf16Range(offset, offset),
            expected: '',
            insert: ` data-fc-node-id="${newNodeId}" data-fc-node-kind="${componentKind}"`,
        }),
    })
}

function rejected(
    code: string,
    message: string,
): Extract<OpaqueElementAdoptionPatchResult, {status: 'rejected'}> {
    return Object.freeze({status: 'rejected', code, message})
}
