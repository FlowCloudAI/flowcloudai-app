// 本模块把固定节点样式修改编译为精确 HTML 源码补丁；实体映射与未触及声明按作者字节保留。

import type {Declaration} from 'postcss'
import type {HtmlCompositionElement} from '../composition/index.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {
    decodeHtmlSourceWithBoundaries,
    parseDeclarationListSyntax,
    parsePropertyValueSyntax,
} from '../syntax/index.ts'
import {propertiesOverlap, propertyName} from '../styles/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type InlineStylePatchResult =
    | {readonly status: 'ready'; readonly patch: SourcePatch}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export interface InlineStylePropertyChange {
    readonly property: string
    readonly value: string | null
}

type InlineStylePatchRejection = Extract<InlineStylePatchResult, {readonly status: 'rejected'}>
type PatchedStyleValue =
    {readonly status: 'ready'; readonly value: string} | InlineStylePatchRejection

interface AttributeSource {
    readonly quote: '"' | "'" | null
    readonly value: string
    readonly decodedValue: string
    readonly valueFrom: number
    readonly valueTo: number
    readonly attributeFrom: number
    readonly attributeTo: number
}

interface StringEdit {
    readonly from: number
    readonly to: number
    readonly insert: string
}

export function createInlineStylePropertyPatch(
    document: SourceDocument,
    element: HtmlCompositionElement,
    propertyInput: string,
    value: string | null,
): InlineStylePatchResult {
    return createInlineStylePropertiesPatch(document, element, [{property: propertyInput, value}])
}

/** 在同一份 style 属性源码上顺序应用多项声明变化，并只生成一个不重叠补丁。 */
export function createInlineStylePropertiesPatch(
    document: SourceDocument,
    element: HtmlCompositionElement,
    changes: readonly InlineStylePropertyChange[],
): InlineStylePatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('inline-style-source-invalid', '行内样式只能写入 article.html。')
    }
    const normalizedChanges = changes.map(change => ({
        property: propertyName(change.property),
        value: change.value,
    }))
    for (const change of normalizedChanges) {
        if (change.value === null) continue
        const parsedValue = parsePropertyValueSyntax(change.property, change.value, document.key)
        const declaration = parsedValue.declarations[0]
        if (parsedValue.diagnostics.length > 0 || !declaration || declaration.important) {
            return rejected(
                'invalid-property-value',
                `属性 ${change.property} 的值不是单一普通声明。`,
            )
        }
    }

    const decodedStyle = attributeValue(element, 'style') ?? ''
    const attribute = styleAttributeSource(document.content, element)
    if (hasAttribute(element, 'style') && !attribute) {
        return rejected('source-location-missing', '无法定位现有 style 属性源码。')
    }
    if (attribute && attribute.decodedValue !== decodedStyle) {
        return rejected('inline-style-source-mismatch', 'style 属性实体无法映射回原始源码。')
    }

    const quote = attribute?.quote ?? '"'
    let patchedValue = attribute?.value ?? ''
    for (const change of normalizedChanges) {
        const patched = patchStyleValue(
            patchedValue,
            change.property,
            change.value,
            quote,
            document,
        )
        if (patched.status !== 'ready') return patched
        patchedValue = patched.value
    }
    if (attribute) {
        if (patchedValue === attribute.value) return {status: 'unchanged'}
        if (!patchedValue.trim()) {
            const from = /[\t ]/u.test(document.content[attribute.attributeFrom - 1] ?? '')
                ? attribute.attributeFrom - 1
                : attribute.attributeFrom
            return {
                status: 'ready',
                patch: Object.freeze({
                    source: document.key,
                    range: utf16Range(from, attribute.attributeTo),
                    expected: document.content.slice(from, attribute.attributeTo),
                    insert: '',
                }),
            }
        }
        return {
            status: 'ready',
            patch: Object.freeze({
                source: document.key,
                range: utf16Range(attribute.valueFrom, attribute.valueTo),
                expected: attribute.value,
                insert: patchedValue,
            }),
        }
    }
    if (!patchedValue) return {status: 'unchanged'}
    const at = startTagInsertionOffset(document.content, element)
    if (at === null) return rejected('source-location-missing', '无法定位节点开始标签。')
    return {
        status: 'ready',
        patch: Object.freeze({
            source: document.key,
            range: utf16Range(at, at),
            expected: '',
            insert: ` style="${patchedValue}"`,
        }),
    }
}

function patchStyleValue(
    raw: string,
    property: string,
    value: string | null,
    quote: AttributeSource['quote'],
    document: SourceDocument,
): PatchedStyleValue {
    const decoded = decodeHtmlSourceWithBoundaries(raw, 'attribute')
    const parsed = parseDeclarationListSyntax(decoded.decoded, document.key)
    if (parsed.diagnostics.length > 0) {
        return rejected('invalid-inline-style', '节点包含无法按源码区间修改的行内样式。')
    }
    const declarations = [...parsed.declarations]
    const matches = declarations.filter(declaration => propertyName(declaration.prop) === property)
    if (value === null) {
        const edits: StringEdit[] = []
        for (const declaration of matches) {
            const decodedValueRange = declarationValueRange(declaration)
            const start = declaration.source?.start?.offset
            if (!decodedValueRange || start === undefined) {
                return rejected('source-location-missing', '无法定位待清除的行内声明。')
            }
            const valueRange = mapDecodedRange(decodedValueRange, decoded.boundaries)
            const from = decoded.boundaries.get(start - 2)
            if (!valueRange || from === undefined) {
                return rejected('source-location-missing', '无法把行内声明映射到作者源码。')
            }
            edits.push({
                from,
                to: raw[valueRange.to] === ';' ? valueRange.to + 1 : valueRange.to,
                insert: '',
            })
        }
        return {status: 'ready', value: applyStringEdits(raw, edits)}
    }

    const escaped = escapeAttributeStyleValue(value, quote)
    const last = matches.at(-1)
    const lastIndex = last ? declarations.indexOf(last) : -1
    const shadowedLater =
        lastIndex >= 0 &&
        declarations
            .slice(lastIndex + 1)
            .some(declaration => propertiesOverlap(property, propertyName(declaration.prop)))
    if (last && !shadowedLater) {
        if (last.value === value) return {status: 'ready', value: raw}
        const decodedRange = declarationValueRange(last)
        const range = decodedRange ? mapDecodedRange(decodedRange, decoded.boundaries) : null
        if (!range) return rejected('source-location-missing', '无法定位待修改的行内声明值。')
        return {
            status: 'ready',
            value: applyStringEdits(raw, [{...range, insert: escaped}]),
        }
    }
    return {
        status: 'ready',
        value: appendDeclaration(raw, `${property}: ${escaped}`, declarations, decoded.boundaries),
    }
}

function styleAttributeSource(
    source: string,
    element: HtmlCompositionElement,
): AttributeSource | null {
    const range = element.sourceCodeLocation?.attrs?.style
    if (!range) return null
    const raw = source.slice(range.startOffset, range.endOffset)
    const equals = raw.indexOf('=')
    if (equals < 0) return null
    let start = equals + 1
    while (/\s/u.test(raw[start] ?? '')) start += 1
    const quote: AttributeSource['quote'] =
        raw[start] === '"' ? '"' : raw[start] === "'" ? "'" : null
    if (quote) {
        const end = raw.lastIndexOf(quote)
        if (end <= start) return null
        const value = raw.slice(start + 1, end)
        return {
            quote,
            value,
            decodedValue: decodeHtmlSourceWithBoundaries(value, 'attribute').decoded,
            valueFrom: range.startOffset + start + 1,
            valueTo: range.startOffset + end,
            attributeFrom: range.startOffset,
            attributeTo: range.endOffset,
        }
    }
    const value = raw.slice(start)
    return {
        quote: null,
        value,
        decodedValue: decodeHtmlSourceWithBoundaries(value, 'attribute').decoded,
        valueFrom: range.startOffset + start,
        valueTo: range.endOffset,
        attributeFrom: range.startOffset,
        attributeTo: range.endOffset,
    }
}

function declarationValueRange(declaration: Declaration): {from: number; to: number} | null {
    const start = declaration.source?.start?.offset
    if (start === undefined) return null
    const rawValue = declaration.raws.value?.raw ?? declaration.value
    const from = start - 2 + declaration.prop.length + (declaration.raws.between ?? ':').length
    return {from, to: from + rawValue.length}
}

function mapDecodedRange(
    range: {from: number; to: number},
    boundaries: ReadonlyMap<number, number>,
): {from: number; to: number} | null {
    const from = boundaries.get(range.from)
    const to = boundaries.get(range.to)
    return from === undefined || to === undefined ? null : {from, to}
}

function appendDeclaration(
    source: string,
    declaration: string,
    declarations: readonly Declaration[],
    boundaries: ReadonlyMap<number, number>,
): string {
    const trailingWhitespace = source.match(/\s*$/u)?.[0] ?? ''
    const at = source.length - trailingWhitespace.length
    const last = declarations.at(-1)
    const decodedLastValue = last ? declarationValueRange(last) : null
    const lastValue = decodedLastValue ? mapDecodedRange(decodedLastValue, boundaries) : null
    const hasSemicolon = lastValue ? source[lastValue.to] === ';' : false
    const separator = at === 0 ? '' : last && !hasSemicolon ? '; ' : ' '
    return `${source.slice(0, at)}${separator}${declaration};${source.slice(at)}`
}

function applyStringEdits(source: string, edits: readonly StringEdit[]): string {
    return [...edits]
        .sort((left, right) => right.from - left.from || right.to - left.to)
        .reduce(
            (current, edit) =>
                `${current.slice(0, edit.from)}${edit.insert}${current.slice(edit.to)}`,
            source,
        )
}

function escapeAttributeStyleValue(value: string, quote: AttributeSource['quote']): string {
    let escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    if (quote === '"') return escaped.replaceAll('"', '&quot;')
    if (quote === "'") return escaped.replaceAll("'", '&#39;')
    escaped = escaped.replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    return escaped.replace(/[\t\n\f\r =`]/gu, character => `&#${character.codePointAt(0) ?? 32};`)
}

function startTagInsertionOffset(source: string, element: HtmlCompositionElement): number | null {
    const startTag = element.sourceCodeLocation?.startTag
    if (!startTag) return null
    const raw = source.slice(startTag.startOffset, startTag.endOffset)
    return startTag.endOffset - (raw.endsWith('/>') ? 2 : 1)
}

function attributeValue(element: HtmlCompositionElement, name: string): string | undefined {
    return element.attrs.find(attribute => attribute.name === name)?.value
}

function hasAttribute(element: HtmlCompositionElement, name: string): boolean {
    return element.attrs.some(attribute => attribute.name === name)
}

function rejected(code: string, message: string): InlineStylePatchRejection {
    return Object.freeze({status: 'rejected', code, message})
}
