// 本模块把段落类组件的 UTF-16 文本替换编译为原始文本叶子补丁；范围外标签、实体和属性保持逐字不变。

import {collectTextSource, type TextSourceUnit} from '../analysis/textRangeAnalysis.ts'
import type {HtmlCompositionElement, HtmlCompositionNode} from '../composition/index.ts'
import {
    utf16Range,
    type SourceDocument,
    type SourceOrigin,
    type Utf16SourceRange,
} from '../contracts/source.ts'
import {decodedTextSourceRange, isUtf16TextBoundary} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type TextReplacementPatchResult =
    | {
          readonly status: 'ready'
          readonly patches: readonly SourcePatch[]
          readonly expectedText: string
      }
    | {readonly status: 'unchanged'; readonly expectedText: string}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

const MAX_INSERTED_TEXT_LENGTH = 100_000

export function createTextReplacementPatches(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    range: Utf16SourceRange,
    expected: string,
    insertedText: string,
): TextReplacementPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('text-range-source-invalid', '文本替换只能写入 article.html。')
    }
    const text = normalizeInsertedText(insertedText)
    if (text.length > MAX_INSERTED_TEXT_LENGTH) {
        return rejected(
            'text-replacement-limit',
            `单次文本替换最多包含 ${MAX_INSERTED_TEXT_LENGTH} 个 UTF-16 单元。`,
        )
    }
    const collected = collectTextSource(element, originOfNode, document)
    if ('code' in collected) return rejected(collected.code, collected.message)
    const from = Number(range.from)
    const to = Number(range.to)
    if (
        to > collected.text.length ||
        !isUtf16TextBoundary(collected.text, from) ||
        !isUtf16TextBoundary(collected.text, to) ||
        collected.text.slice(from, to) !== expected
    ) {
        return rejected('text-precondition-failed', '文本选区、字符边界或 expected 已漂移。')
    }
    const expectedText = `${collected.text.slice(0, from)}${text}${collected.text.slice(to)}`
    if (from === to) {
        if (!text) return Object.freeze({status: 'unchanged', expectedText})
        const insertion = insertionPatch(document, element, collected.units, from, text)
        return insertion
            ? Object.freeze({status: 'ready', patches: Object.freeze([insertion]), expectedText})
            : rejected('text-source-boundary-unavailable', '无法把插入点映射到作者源码。')
    }
    if (text === expected) return Object.freeze({status: 'unchanged', expectedText})
    const selected = collected.units.flatMap(unit => {
        const selectedFrom = Math.max(from, unit.from)
        const selectedTo = Math.min(to, unit.to)
        return selectedFrom < selectedTo ? [{unit, from: selectedFrom, to: selectedTo}] : []
    })
    let covered = from
    const patches: SourcePatch[] = []
    for (const [index, selection] of selected.entries()) {
        if (selection.from !== covered) {
            return rejected('text-source-boundary-unavailable', '选区不能连续映射到作者源码。')
        }
        const sourceRange = textUnitSourceRange(
            document,
            selection.unit,
            selection.from,
            selection.to,
        )
        if (!sourceRange) {
            return rejected('text-source-boundary-unavailable', '选区边界落在实体或代理对内部。')
        }
        patches.push({
            source: document.key,
            range: utf16Range(sourceRange.from, sourceRange.to),
            expected: document.content.slice(sourceRange.from, sourceRange.to),
            insert: index === 0 ? renderInsertedText(text) : '',
        })
        covered = selection.to
    }
    return covered === to
        ? Object.freeze({status: 'ready', patches: Object.freeze(patches), expectedText})
        : rejected('text-source-boundary-unavailable', '选区末端不能连续映射到作者源码。')
}

export function componentTextEquals(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    expectedText: string,
): boolean {
    const collected = collectTextSource(element, originOfNode, document)
    return !('code' in collected) && collected.text === expectedText
}

function insertionPatch(
    document: SourceDocument,
    element: HtmlCompositionElement,
    units: readonly TextSourceUnit[],
    offset: number,
    text: string,
): SourcePatch | null {
    const textCandidates = units.filter(
        unit => unit.kind === 'text' && offset >= unit.from && offset <= unit.to,
    )
    const preferred =
        [...textCandidates].reverse().find(unit => offset > unit.from || offset === unit.to) ??
        textCandidates[0]
    if (preferred) {
        const range = textUnitSourceRange(document, preferred, offset, offset)
        if (!range) return null
        return {
            source: document.key,
            range: utf16Range(range.from, range.to),
            expected: '',
            insert: renderInsertedText(text),
        }
    }
    const inner = elementInnerRange(element)
    if (!inner) return null
    const next = units.find(unit => unit.from >= offset)
    const previous = [...units].reverse().find(unit => unit.to <= offset)
    const at = next
        ? Number(next.origin.range?.from)
        : previous
          ? Number(previous.origin.range?.to)
          : inner.from
    if (!Number.isSafeInteger(at)) return null
    return {
        source: document.key,
        range: utf16Range(at, at),
        expected: '',
        insert: renderInsertedText(text),
    }
}

export function textUnitSourceRange(
    document: SourceDocument,
    unit: TextSourceUnit,
    from: number,
    to: number,
): {readonly from: number; readonly to: number} | null {
    const range = unit.origin.range
    if (!range) return null
    if (unit.kind === 'break') {
        return from === unit.from && to === unit.to
            ? {from: Number(range.from), to: Number(range.to)}
            : null
    }
    return decodedTextSourceRange(
        document.content,
        range,
        unit.text,
        from - unit.from,
        to - unit.from,
    )
}

function elementInnerRange(
    element: HtmlCompositionElement,
): {readonly from: number; readonly to: number} | null {
    const startTag = element.sourceCodeLocation?.startTag
    const endTag = element.sourceCodeLocation?.endTag
    return startTag && endTag ? {from: startTag.endOffset, to: endTag.startOffset} : null
}

function normalizeInsertedText(value: string): string {
    return value.replace(/\r\n?/gu, '\n').replaceAll('\0', '\uFFFD')
}

function renderInsertedText(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\n', '<br>')
}

function rejected(code: string, message: string): TextReplacementPatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
