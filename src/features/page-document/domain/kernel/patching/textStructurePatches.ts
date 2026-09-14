// 本模块把段落类组件的结构分裂编译为最小源码插入；行内标签、属性、实体及未触及文本保持原样。

import {collectTextSource, type TextSourceUnit} from '../analysis/textRangeAnalysis.ts'
import type {HtmlCompositionElement, HtmlCompositionNode} from '../composition/index.ts'
import type {NodeId} from '../contracts/identity.ts'
import type {DocumentNodeKind} from '../contracts/primitives.ts'
import {utf16Range, type SourceDocument, type SourceOrigin} from '../contracts/source.ts'
import {isUtf16TextBoundary} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'
import {textUnitSourceRange} from './textContentPatches.ts'

export type TextBlockSplitPatchResult =
    | {
          readonly status: 'ready'
          readonly patches: readonly SourcePatch[]
          readonly leftText: string
          readonly rightText: string
          readonly newKind: 'paragraph' | 'list-item'
      }
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

interface SplitBoundary {
    readonly sourceOffset: number
    readonly openAncestors: readonly HtmlCompositionElement[]
}

export function createTextBlockSplitPatches(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    kind: DocumentNodeKind,
    offset: number,
    newNodeId: NodeId,
): TextBlockSplitPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('text-range-source-invalid', '文本块分裂只能写入 article.html。')
    }
    if (kind !== 'paragraph' && kind !== 'heading' && kind !== 'list-item') {
        return rejected('text-block-split-not-supported', `${kind} 不支持创建后续文本块。`)
    }
    const collected = collectTextSource(element, originOfNode, document)
    if ('code' in collected) return rejected(collected.code, collected.message)
    if (
        offset < 0 ||
        offset > collected.text.length ||
        !isUtf16TextBoundary(collected.text, offset)
    ) {
        return rejected('text-precondition-failed', '文本分裂位置或字符边界已经漂移。')
    }
    const root = rootLocation(element)
    if (!root) return rejected('source-location-missing', '无法定位待分裂文本组件源码。')
    const boundary = locateSplitBoundary(
        document,
        element,
        collected.units,
        offset,
        originOfNode,
        root.innerFrom,
    )
    if (!boundary) {
        return rejected('text-source-boundary-unavailable', '无法把文本分裂位置映射到作者源码。')
    }
    const ancestorTags = boundary.openAncestors.map(ancestor => sourceStartTag(document, ancestor))
    if (ancestorTags.some(tag => tag === null)) {
        return rejected('source-location-missing', '无法逐字保留分裂位置的行内包装。')
    }
    const nextKind = kind === 'list-item' ? 'list-item' : 'paragraph'
    const nextTag = nextKind === 'list-item' ? 'li' : 'p'
    const closeInline = [...boundary.openAncestors]
        .reverse()
        .map(ancestor => `</${ancestor.tagName}>`)
        .join('')
    const reopenInline = ancestorTags.join('')
    const indent = indentationAt(document.content, root.outerFrom)
    const nextStart = `<${nextTag} data-fc-node-id="${newNodeId}" data-fc-node-kind="${nextKind}">`
    const insertion = `${closeInline}</${element.tagName}>\n${indent}${nextStart}${reopenInline}`
    const patches: SourcePatch[] = [
        {
            source: document.key,
            range: utf16Range(boundary.sourceOffset, boundary.sourceOffset),
            expected: '',
            insert: insertion,
        },
    ]
    if (element.tagName !== nextTag) {
        patches.push({
            source: document.key,
            range: utf16Range(root.endTagFrom, root.outerTo),
            expected: document.content.slice(root.endTagFrom, root.outerTo),
            insert: `</${nextTag}>`,
        })
    }
    return Object.freeze({
        status: 'ready',
        patches: Object.freeze(patches),
        leftText: collected.text.slice(0, offset),
        rightText: collected.text.slice(offset),
        newKind: nextKind,
    })
}

function locateSplitBoundary(
    document: SourceDocument,
    root: HtmlCompositionElement,
    units: readonly TextSourceUnit[],
    offset: number,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    emptyOffset: number,
): SplitBoundary | null {
    const next = units.find(unit => unit.from === offset)
    if (next) {
        const boundaryElement = outerBoundaryElement(next.node, root, units, offset, 'start')
        if (boundaryElement) {
            const start = boundaryElement.sourceCodeLocation?.startTag?.startOffset
            return Number.isSafeInteger(start)
                ? boundary(
                      Number(start),
                      containingAncestors(boundaryElement, root),
                      originOfNode,
                      document,
                  )
                : null
        }
        const sourceOffset = unitBoundaryOffset(document, next, offset)
        return sourceOffset === null
            ? null
            : boundary(sourceOffset, containingAncestors(next.node, root), originOfNode, document)
    }
    const containing = units.find(unit => unit.from < offset && offset < unit.to)
    if (containing) {
        const sourceOffset = unitBoundaryOffset(document, containing, offset)
        return sourceOffset === null
            ? null
            : boundary(
                  sourceOffset,
                  containingAncestors(containing.node, root),
                  originOfNode,
                  document,
              )
    }
    const previous = [...units].reverse().find(unit => unit.to === offset)
    if (previous) {
        const boundaryElement = outerBoundaryElement(previous.node, root, units, offset, 'end')
        if (boundaryElement) {
            const end = boundaryElement.sourceCodeLocation?.endOffset
            return Number.isSafeInteger(end)
                ? boundary(
                      Number(end),
                      containingAncestors(boundaryElement, root),
                      originOfNode,
                      document,
                  )
                : null
        }
        const sourceOffset = unitBoundaryOffset(document, previous, offset)
        return sourceOffset === null
            ? null
            : boundary(
                  sourceOffset,
                  containingAncestors(previous.node, root),
                  originOfNode,
                  document,
              )
    }
    return units.length === 0 ? Object.freeze({sourceOffset: emptyOffset, openAncestors: []}) : null
}

function boundary(
    sourceOffset: number,
    ancestors: readonly HtmlCompositionElement[],
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    document: SourceDocument,
): SplitBoundary | null {
    const valid = ancestors.every(ancestor => {
        const origin = originOfNode(ancestor)
        return (
            origin?.kind === 'author' &&
            origin.source?.scope === document.key.scope &&
            origin.source.file === document.key.file &&
            origin.range !== null
        )
    })
    return valid ? Object.freeze({sourceOffset, openAncestors: Object.freeze(ancestors)}) : null
}

function outerBoundaryElement(
    node: HtmlCompositionNode,
    root: HtmlCompositionElement,
    units: readonly TextSourceUnit[],
    offset: number,
    edge: 'start' | 'end',
): HtmlCompositionElement | null {
    let current = parentElement(node)
    let result: HtmlCompositionElement | null = null
    while (current && current !== root) {
        const span = textSpan(current, units)
        if (!span || span[edge === 'start' ? 'from' : 'to'] !== offset) break
        result = current
        current = parentElement(current)
    }
    return result
}

function containingAncestors(
    node: HtmlCompositionNode,
    root: HtmlCompositionElement,
): readonly HtmlCompositionElement[] {
    const result: HtmlCompositionElement[] = []
    let current = parentElement(node)
    while (current && current !== root) {
        result.push(current)
        current = parentElement(current)
    }
    return Object.freeze(result.reverse())
}

function textSpan(
    element: HtmlCompositionElement,
    units: readonly TextSourceUnit[],
): {readonly from: number; readonly to: number} | null {
    const descendants = units.filter(unit => isDescendantOf(unit.node, element))
    return descendants.length > 0
        ? {from: descendants[0].from, to: descendants[descendants.length - 1].to}
        : null
}

function isDescendantOf(node: HtmlCompositionNode, element: HtmlCompositionElement): boolean {
    let current = parentOf(node)
    while (current) {
        if (current === element) return true
        current = parentOf(current)
    }
    return false
}

function unitBoundaryOffset(
    document: SourceDocument,
    unit: TextSourceUnit,
    offset: number,
): number | null {
    if (unit.kind === 'text') {
        return textUnitSourceRange(document, unit, offset, offset)?.from ?? null
    }
    if (offset === unit.from) return Number(unit.origin.range?.from ?? NaN)
    if (offset === unit.to) return Number(unit.origin.range?.to ?? NaN)
    return null
}

function sourceStartTag(document: SourceDocument, element: HtmlCompositionElement): string | null {
    const tag = element.sourceCodeLocation?.startTag
    return tag ? document.content.slice(tag.startOffset, tag.endOffset) : null
}

function rootLocation(element: HtmlCompositionElement): {
    readonly outerFrom: number
    readonly innerFrom: number
    readonly endTagFrom: number
    readonly outerTo: number
} | null {
    const location = element.sourceCodeLocation
    const startTag = location?.startTag
    const endTag = location?.endTag
    return location && startTag && endTag
        ? {
              outerFrom: location.startOffset,
              innerFrom: startTag.endOffset,
              endTagFrom: endTag.startOffset,
              outerTo: location.endOffset,
          }
        : null
}

function parentElement(node: HtmlCompositionNode): HtmlCompositionElement | null {
    const parent = parentOf(node)
    return parent && 'tagName' in parent ? parent : null
}

function parentOf(node: HtmlCompositionNode): HtmlCompositionNode | null {
    return 'parentNode' in node ? (node.parentNode as HtmlCompositionNode | null) : null
}

function indentationAt(source: string, offset: number): string {
    const lineStart = Math.max(source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1, 0)
    return source.slice(lineStart, offset).match(/^[\t ]*/u)?.[0] ?? ''
}

function rejected(code: string, message: string): TextBlockSplitPatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
