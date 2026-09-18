// 本模块在源码校验前以最小补丁补齐或去重托管节点身份；除此之外的作者 HTML 保持逐字不变。

import type {DocumentDiagnostic} from '../../contract.ts'
import {RFC_9562_UUID_PATTERN} from '../../uuidPolicy.ts'
import {allocateFreshNodeId, type NodeIdentityAllocator} from '../contracts/nodeIdentityPolicy.ts'
import {DOCUMENT_NODE_KINDS, type DocumentNodeKind} from '../contracts/primitives.ts'
import {sourceKey} from '../contracts/source.ts'
import {
    attributeRange,
    getAttribute,
    type HtmlElement,
    walkElements,
} from './htmlContract.ts'
import {parseHtmlSyntax} from './htmlSyntax.ts'

interface SourceReplacement {
    readonly from: number
    readonly to: number
    readonly insert: string
}

export interface NodeIdentityNormalizationResult {
    readonly source: string
    readonly changed: boolean
    readonly diagnostics: readonly DocumentDiagnostic[]
}

export function normalizeManagedNodeIdentities(
    source: string,
    allocate: NodeIdentityAllocator,
    retiredNodeIds: Iterable<string> = [],
): NodeIdentityNormalizationResult {
    const syntax = parseHtmlSyntax(source, {
        mode: 'fragment',
        sourceKey: sourceKey('entry', 'article.html'),
    })
    if (syntax.diagnostics.length > 0) {
        return Object.freeze({source, changed: false, diagnostics: Object.freeze([])})
    }

    const elements: HtmlElement[] = []
    walkElements(syntax.root, element => elements.push(element))
    const occupied = new Set<string>([...retiredNodeIds].map(value => value.toLowerCase()))
    for (const element of elements) {
        const raw = getAttribute(element, 'data-fc-node-id')
        if (raw && RFC_9562_UUID_PATTERN.test(raw)) occupied.add(raw.toLowerCase())
    }

    const seen = new Set<string>()
    const replacements: SourceReplacement[] = []
    const diagnostics: DocumentDiagnostic[] = []
    for (const element of elements) {
        const rawKind = getAttribute(element, 'data-fc-node-kind')
        const knownKind = DOCUMENT_NODE_KINDS.includes(rawKind as DocumentNodeKind)
        const rawId = getAttribute(element, 'data-fc-node-id')
        if (rawId === undefined && knownKind) {
            const allocated = allocateFreshNodeId(allocate, occupied)
            occupied.add(allocated)
            const offset = identityInsertionOffset(source, element.sourceCodeLocation?.startTag)
            if (offset === null) continue
            replacements.push({
                from: offset,
                to: offset,
                insert: ` data-fc-node-id="${allocated}"`,
            })
            diagnostics.push({
                severity: 'warning',
                category: 'capability',
                code: 'managed_node_id_assigned',
                message: '源码节点缺少身份，保存前已分配新的 data-fc-node-id。',
                file: 'article.html',
                nodeId: allocated,
                details: {kind: rawKind, assignedNodeId: allocated},
            })
            seen.add(allocated)
            continue
        }
        if (!rawId || !RFC_9562_UUID_PATTERN.test(rawId)) continue
        const normalized = rawId.toLowerCase()
        if (!seen.has(normalized)) {
            seen.add(normalized)
            continue
        }
        const range = attributeRange(element, 'data-fc-node-id')
        if (!range) continue
        const allocated = allocateFreshNodeId(allocate, occupied)
        occupied.add(allocated)
        seen.add(allocated)
        replacements.push({
            from: range.from,
            to: range.to,
            insert: `data-fc-node-id="${allocated}"`,
        })
        diagnostics.push({
            severity: 'warning',
            category: 'capability',
            code: 'duplicate_node_id_reassigned',
            message: '重复节点身份仅保留首次出现者，后续节点已分配新的 data-fc-node-id。',
            file: 'article.html',
            range,
            nodeId: allocated,
            details: {duplicateNodeId: normalized, assignedNodeId: allocated},
        })
    }

    let normalizedSource = source
    for (const replacement of replacements.sort((left, right) => right.from - left.from)) {
        normalizedSource =
            normalizedSource.slice(0, replacement.from) +
            replacement.insert +
            normalizedSource.slice(replacement.to)
    }
    return Object.freeze({
        source: normalizedSource,
        changed: replacements.length > 0,
        diagnostics: Object.freeze(diagnostics),
    })
}

function identityInsertionOffset(
    source: string,
    startTag: {readonly startOffset: number; readonly endOffset: number} | undefined,
): number | null {
    if (!startTag) return null
    const closing = startTag.endOffset - 1
    if (source[closing] !== '>') return null
    return source[closing - 1] === '/' ? closing - 1 : closing
}
