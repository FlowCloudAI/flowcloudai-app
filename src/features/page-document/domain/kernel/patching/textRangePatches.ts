// 本模块把组件纯文本中的 UTF-16 选区映射回原始文本叶子；格式写入只包装命中片段，不重建范围外行内结构。

import {
    collectTextRangeProperty,
    type ManagedFormatOwner,
    type TextRangePropertyResolver,
    type TextRangeTextUnit,
} from '../analysis/textRangeAnalysis.ts'
import type {HtmlCompositionElement, HtmlCompositionNode} from '../composition/index.ts'
import {
    utf16Range,
    type SourceDocument,
    type SourceOrigin,
    type Utf16SourceRange,
} from '../contracts/source.ts'
import {
    decodedTextSourceRange,
    isUtf16TextBoundary,
    parsePropertyValueSyntax,
} from '../syntax/index.ts'
import {propertyName} from '../styles/index.ts'
import {createInlineStylePropertyPatch} from './inlineStylePatches.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type TextRangeStylePatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

const INLINE_FORMAT_PROPERTIES = new Set([
    'background-color',
    'color',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'letter-spacing',
    'text-decoration-color',
    'text-decoration-line',
    'text-decoration-style',
])

export function createTextRangeStylePatches(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    range: Utf16SourceRange,
    expected: string,
    propertyInput: string,
    value: string | null,
    resolveProperty: TextRangePropertyResolver,
): TextRangeStylePatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('text-range-source-invalid', '文本选区只能写入 article.html。')
    }
    const property = propertyName(propertyInput)
    if (!INLINE_FORMAT_PROPERTIES.has(property)) {
        return rejected('unsupported-inline-format-property', `属性 ${property} 不能用于文本选区。`)
    }
    if (value !== null) {
        const parsedValue = parsePropertyValueSyntax(property, value, document.key)
        const declaration = parsedValue.declarations[0]
        if (parsedValue.diagnostics.length > 0 || !declaration || declaration.important) {
            return rejected('invalid-property-value', `属性 ${property} 的值不是单一普通声明。`)
        }
    }

    const collected = collectTextRangeProperty(
        element,
        originOfNode,
        property,
        document,
        resolveProperty,
    )
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
        return rejected('text-precondition-failed', '文本选区、字符边界或 expected 已漂移。')
    }

    const selectedUnits = collected.units.filter(
        unit => unit.kind === 'text' && Math.max(from, unit.from) < Math.min(to, unit.to),
    )
    if (value === null) return clearManagedOverrides(document, selectedUnits, from, to, property)

    const patches: SourcePatch[] = []
    const patchedOwners = new Set<HtmlCompositionElement>()
    for (const unit of collected.units) {
        const selectedFrom = Math.max(from, unit.from)
        const selectedTo = Math.min(to, unit.to)
        if (selectedFrom >= selectedTo || unit.kind === 'break') continue
        // 与候选验收共用同一判定：变量值读回的是解析结果，只比字符串会把已带同一变量的文字再包一层，
        // 连续输入时逐字嵌套 span。
        if (textUnitHasRequestedStyle(unit, property, value, resolveProperty)) continue
        const owner = unit.writeOwner
        if (owner && owner.from >= from && owner.to <= to && !patchedOwners.has(owner.element)) {
            const ownerPatch = createInlineStylePropertyPatch(
                document,
                owner.element,
                property,
                value,
            )
            if (ownerPatch.status === 'rejected') {
                return rejected(ownerPatch.code, ownerPatch.message)
            }
            if (ownerPatch.status === 'ready') patches.push(ownerPatch.patch)
            patchedOwners.add(owner.element)
            continue
        }
        if (owner && patchedOwners.has(owner.element)) continue
        const sourceRange = sourceRangeWithinUnit(document, unit, selectedFrom, selectedTo)
        if (!sourceRange) {
            return rejected(
                'text-source-boundary-unavailable',
                '选区落在字符实体或代理对内部，无法安全映射到作者源码。',
            )
        }
        const raw = document.content.slice(sourceRange.from, sourceRange.to)
        patches.push(
            Object.freeze({
                source: document.key,
                range: utf16Range(sourceRange.from, sourceRange.to),
                expected: raw,
                insert: `<span data-fc-inline-format="${property}" style="${escapeAttribute(`${property}: ${value};`)}">${raw}</span>`,
            }),
        )
    }
    return patches.length > 0
        ? Object.freeze({status: 'ready', patches: Object.freeze(patches)})
        : Object.freeze({status: 'unchanged'})
}

export function textRangeHasStyle(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    range: Utf16SourceRange,
    expected: string,
    propertyInput: string,
    value: string,
    resolveProperty: TextRangePropertyResolver,
): boolean {
    const property = propertyName(propertyInput)
    const collected = collectTextRangeProperty(
        element,
        originOfNode,
        property,
        document,
        resolveProperty,
    )
    if ('code' in collected) return false
    const from = Number(range.from)
    const to = Number(range.to)
    if (collected.text.slice(from, to) !== expected) return false
    const selected = collected.units.filter(
        unit => Math.max(from, unit.from) < Math.min(to, unit.to),
    )
    return (
        selected.length > 0 &&
        selected.every(
            unit =>
                unit.kind === 'break' ||
                textUnitHasRequestedStyle(unit, property, value, resolveProperty),
        )
    )
}

function textUnitHasRequestedStyle(
    unit: TextRangeTextUnit,
    property: string,
    value: string,
    resolveProperty: TextRangePropertyResolver,
): boolean {
    if (normalizeValue(unit.propertyValue) === normalizeValue(value)) return true
    if (!value.includes('var(') || !unit.writeOwner?.hasDirectProperty) return false
    const inspection = resolveProperty(unit.writeOwner.element, property)
    return (
        inspection.confidence.kind === 'proven' &&
        normalizeValue(inspection.effectiveValue?.rawValue ?? null) === normalizeValue(value) &&
        normalizeValue(inspection.effectiveValue?.resolvedValue ?? null) === normalizeValue(unit.propertyValue)
    )
}

export function textRangeHasNoManagedOverride(
    document: SourceDocument,
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    range: Utf16SourceRange,
    expected: string,
    propertyInput: string,
    resolveProperty: TextRangePropertyResolver,
): boolean {
    const property = propertyName(propertyInput)
    const collected = collectTextRangeProperty(
        element,
        originOfNode,
        property,
        document,
        resolveProperty,
    )
    if ('code' in collected) return false
    const from = Number(range.from)
    const to = Number(range.to)
    if (collected.text.slice(from, to) !== expected) return false
    const selected = collected.units.filter(
        unit => unit.kind === 'text' && Math.max(from, unit.from) < Math.min(to, unit.to),
    )
    return selected.length > 0 && selected.every(unit => unit.overrideOwners.length === 0)
}

function clearManagedOverrides(
    document: SourceDocument,
    units: readonly TextRangeTextUnit[],
    from: number,
    to: number,
    property: string,
): TextRangeStylePatchResult {
    const owners = new Set<ManagedFormatOwner>()
    for (const unit of units) {
        for (const owner of unit.overrideOwners) {
            if (owner.from < from || owner.to > to) {
                return rejected(
                    'text-range-clear-requires-structure-plan',
                    '选区只覆盖现有格式包装的一部分，需要先规划包装拆分。',
                )
            }
            owners.add(owner)
        }
    }
    const patches: SourcePatch[] = []
    for (const owner of owners) {
        const result = createInlineStylePropertyPatch(document, owner.element, property, null)
        if (result.status === 'rejected') return rejected(result.code, result.message)
        if (result.status !== 'ready') continue
        const unwrapped = managedOwnerUnwrapPatches(document, owner, result.patch)
        patches.push(...(unwrapped ?? [result.patch]))
    }
    return patches.length > 0
        ? Object.freeze({status: 'ready', patches: Object.freeze(patches)})
        : Object.freeze({status: 'unchanged'})
}

function managedOwnerUnwrapPatches(
    document: SourceDocument,
    owner: ManagedFormatOwner,
    propertyPatch: SourcePatch,
): readonly SourcePatch[] | null {
    if (
        propertyPatch.insert !== '' ||
        !owner.element.attrs.some(item => item.name === 'style') ||
        owner.element.attrs.some(
            item => item.name !== 'data-fc-inline-format' && item.name !== 'style',
        )
    ) {
        return null
    }
    const location = owner.element.sourceCodeLocation
    if (!location?.startTag || !location.endTag) return null
    return Object.freeze([
        Object.freeze({
            source: document.key,
            range: utf16Range(location.startTag.startOffset, location.startTag.endOffset),
            expected: document.content.slice(
                location.startTag.startOffset,
                location.startTag.endOffset,
            ),
            insert: '',
        }),
        Object.freeze({
            source: document.key,
            range: utf16Range(location.endTag.startOffset, location.endTag.endOffset),
            expected: document.content.slice(
                location.endTag.startOffset,
                location.endTag.endOffset,
            ),
            insert: '',
        }),
    ])
}

function sourceRangeWithinUnit(
    document: SourceDocument,
    unit: TextRangeTextUnit,
    from: number,
    to: number,
): {readonly from: number; readonly to: number} | null {
    const range = unit.origin.range
    if (!range || unit.kind !== 'text') return null
    return decodedTextSourceRange(
        document.content,
        range,
        unit.text,
        from - unit.from,
        to - unit.from,
    )
}

function normalizeValue(value: string | null): string | null {
    return value?.trim().replace(/\s+/gu, ' ') ?? null
}

function escapeAttribute(value: string): string {
    return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;')
}

function rejected(code: string, message: string): TextRangeStylePatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
