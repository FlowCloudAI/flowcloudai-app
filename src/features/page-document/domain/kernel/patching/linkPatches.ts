// 本模块对文本选区添加、修改或移除链接；只触及命中叶子或完整链接的 href，不重建范围外行内结构。

import {collectTextSource, type TextSourceUnit} from '../analysis/textRangeAnalysis.ts'
import type {HtmlCompositionElement, HtmlCompositionNode} from '../composition/index.ts'
import {
    utf16Range,
    type SourceDocument,
    type SourceOrigin,
    type Utf16SourceRange,
} from '../contracts/source.ts'
import {validateAuthorHref} from '../policy/index.ts'
import {decodeHtmlSourceWithBoundaries, isUtf16TextBoundary} from '../syntax/index.ts'
import {textUnitSourceRange} from './textContentPatches.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type LinkPatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createTextRangeLinkPatches(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    range: Utf16SourceRange,
    expected: string,
    href: string | null,
): LinkPatchResult {
    if (href !== null) {
        const validation = validateAuthorHref(href)
        if (!validation.allowed) return rejected(validation.code, validation.message)
    }
    const collected = collectTextSource(element, originOfNode, document)
    if ('code' in collected) return rejected(collected.code, collected.message)
    const from = Number(range.from)
    const to = Number(range.to)
    if (
        from >= to ||
        to > collected.text.length ||
        !isUtf16TextBoundary(collected.text, from) ||
        !isUtf16TextBoundary(collected.text, to) ||
        collected.text.slice(from, to) !== expected
    ) {
        return rejected('text-precondition-failed', '链接选区、字符边界或 expected 已漂移。')
    }
    const selected = collected.units.filter(
        unit => Math.max(from, unit.from) < Math.min(to, unit.to),
    )
    const patches: SourcePatch[] = []
    const patchedOwners = new Set<HtmlCompositionElement>()
    for (const unit of selected) {
        const selectedFrom = Math.max(from, unit.from)
        const selectedTo = Math.min(to, unit.to)
        if (unit.linkOwner) {
            if (unit.href === href || patchedOwners.has(unit.linkOwner)) continue
            const ownerRange = linkOwnerTextRange(collected.units, unit.linkOwner)
            if (!ownerRange || from > ownerRange.from || to < ownerRange.to) {
                return rejected(
                    'partial-link-rewrite-requires-structure-plan',
                    '选区只覆盖现有链接的一部分，不能改变未选中文字的链接目标。',
                )
            }
            const patch = createHrefPatch(document, unit.linkOwner, href)
            if (patch.status === 'rejected') return patch
            if (patch.status === 'ready') patches.push(patch.patch)
            patchedOwners.add(unit.linkOwner)
            continue
        }
        if (href === null) continue
        const sourceRange = textUnitSourceRange(document, unit, selectedFrom, selectedTo)
        if (!sourceRange) {
            return rejected('text-source-boundary-unavailable', '链接边界无法映射到作者源码。')
        }
        const raw = document.content.slice(sourceRange.from, sourceRange.to)
        patches.push({
            source: document.key,
            range: utf16Range(sourceRange.from, sourceRange.to),
            expected: raw,
            insert: `<a data-fc-inline-link href="${escapeAttribute(href, '"')}">${raw}</a>`,
        })
    }
    return patches.length > 0
        ? Object.freeze({status: 'ready', patches: Object.freeze(patches)})
        : Object.freeze({status: 'unchanged'})
}

export function textRangeHasHref(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    range: Utf16SourceRange,
    expected: string,
    href: string | null,
): boolean {
    const collected = collectTextSource(element, originOfNode, document)
    if ('code' in collected) return false
    const from = Number(range.from)
    const to = Number(range.to)
    if (collected.text.slice(from, to) !== expected) return false
    const selected = collected.units.filter(
        unit => Math.max(from, unit.from) < Math.min(to, unit.to),
    )
    return selected.length > 0 && selected.every(unit => unit.href === href)
}

function linkOwnerTextRange(
    units: readonly TextSourceUnit[],
    owner: HtmlCompositionElement,
): {readonly from: number; readonly to: number} | null {
    const owned = units.filter(unit => unit.linkOwner === owner)
    return owned.length > 0
        ? {
              from: Math.min(...owned.map(unit => unit.from)),
              to: Math.max(...owned.map(unit => unit.to)),
          }
        : null
}

function createHrefPatch(
    document: SourceDocument,
    element: HtmlCompositionElement,
    href: string | null,
):
    | {readonly status: 'ready'; readonly patch: SourcePatch}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string} {
    const location = element.sourceCodeLocation?.attrs?.href
    const decodedHref = attribute(element, 'href')
    if (href === null) {
        if (!location) return {status: 'unchanged'}
        const raw = document.content.slice(location.startOffset, location.endOffset)
        return {
            status: 'ready',
            patch: {
                source: document.key,
                range: utf16Range(location.startOffset, location.endOffset),
                expected: raw,
                insert: '',
            },
        }
    }
    if (location) {
        const source = attributeValueSource(
            document.content,
            location.startOffset,
            location.endOffset,
        )
        if (!source || source.decoded !== decodedHref) {
            return rejected('href-source-mismatch', 'href 属性实体无法映射回作者源码。')
        }
        const insert = escapeAttribute(href, source.quote)
        if (insert === source.raw) return {status: 'unchanged'}
        return {
            status: 'ready',
            patch: {
                source: document.key,
                range: utf16Range(source.from, source.to),
                expected: source.raw,
                insert,
            },
        }
    }
    const startTag = element.sourceCodeLocation?.startTag
    if (!startTag) return rejected('source-location-missing', '无法定位链接开始标签。')
    const rawTag = document.content.slice(startTag.startOffset, startTag.endOffset)
    const at = startTag.endOffset - (rawTag.endsWith('/>') ? 2 : 1)
    return {
        status: 'ready',
        patch: {
            source: document.key,
            range: utf16Range(at, at),
            expected: '',
            insert: ` href="${escapeAttribute(href, '"')}"`,
        },
    }
}

function attributeValueSource(
    source: string,
    from: number,
    to: number,
): {
    readonly raw: string
    readonly decoded: string
    readonly from: number
    readonly to: number
    readonly quote: '"' | "'" | null
} | null {
    const attributeSource = source.slice(from, to)
    const equals = attributeSource.indexOf('=')
    if (equals < 0) return null
    let valueFrom = equals + 1
    while (/\s/u.test(attributeSource[valueFrom] ?? '')) valueFrom += 1
    const quote =
        attributeSource[valueFrom] === '"' ? '"' : attributeSource[valueFrom] === "'" ? "'" : null
    const contentFrom = quote ? valueFrom + 1 : valueFrom
    const contentTo = quote ? attributeSource.lastIndexOf(quote) : attributeSource.length
    if (contentTo < contentFrom) return null
    const raw = attributeSource.slice(contentFrom, contentTo)
    return {
        raw,
        decoded: decodeHtmlSourceWithBoundaries(raw, 'attribute').decoded,
        from: from + contentFrom,
        to: from + contentTo,
        quote,
    }
}

function escapeAttribute(value: string, quote: '"' | "'" | null): string {
    const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    if (quote === '"') return escaped.replaceAll('"', '&quot;')
    if (quote === "'") return escaped.replaceAll("'", '&#39;')
    return escaped.replace(/[\t\n\f\r =`"']/gu, character => `&#${character.codePointAt(0) ?? 32};`)
}

function attribute(element: HtmlCompositionElement, name: string): string | null {
    return element.attrs.find(item => item.name === name)?.value ?? null
}

function rejected(code: string, message: string): Extract<LinkPatchResult, {status: 'rejected'}> {
    return Object.freeze({status: 'rejected', code, message})
}
