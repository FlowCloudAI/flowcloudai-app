// 本模块登记首批可解释属性的继承和值域语义，并把简写安全展开为指定长写；不负责选择器与级联。

import valueParser from 'postcss-value-parser'
import type {
    EffectiveAuthorValue,
    PropertyConfidence,
    PropertyValueCapability,
} from '../contracts/analysis.ts'
import type {ReadContext} from '../contracts/context.ts'
import {sourceKey} from '../contracts/source.ts'
import {parsePropertyValueSyntax} from '../syntax/index.ts'
import type {IndexedStyleDeclaration} from './styleIndex.ts'

const INHERITED_PROPERTIES = new Set([
    'color',
    'cursor',
    'font-family',
    'font-size',
    'font-style',
    'font-variant',
    'font-weight',
    'letter-spacing',
    'line-height',
    'list-style',
    'list-style-image',
    'list-style-position',
    'list-style-type',
    'text-align',
    'text-indent',
    'text-transform',
    'visibility',
    'white-space',
    'word-spacing',
])

const DIRECTLY_EDITABLE_PROPERTIES = new Set([
    'align-content',
    'align-items',
    'align-self',
    'aspect-ratio',
    'background-color',
    'background-image',
    'border',
    'border-color',
    'border-radius',
    'border-style',
    'border-width',
    'box-shadow',
    'color',
    'columns',
    'column-count',
    'column-gap',
    'column-width',
    'display',
    'filter',
    'float',
    'flex',
    'flex-basis',
    'flex-direction',
    'flex-grow',
    'flex-shrink',
    'flex-flow',
    'flex-wrap',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'gap',
    'grid-area',
    'grid-auto-flow',
    'grid-column',
    'grid-column-end',
    'grid-column-start',
    'grid-row',
    'grid-row-end',
    'grid-row-start',
    'grid-template-areas',
    'grid-template-columns',
    'grid-template-rows',
    'height',
    'justify-content',
    'justify-items',
    'justify-self',
    'letter-spacing',
    'line-height',
    'margin',
    'margin-block',
    'margin-block-end',
    'margin-block-start',
    'margin-inline',
    'margin-inline-end',
    'margin-inline-start',
    'max-height',
    'max-width',
    'min-height',
    'min-width',
    'object-fit',
    'object-position',
    'opacity',
    'overflow',
    'padding',
    'padding-block',
    'padding-block-end',
    'padding-block-start',
    'padding-inline',
    'padding-inline-end',
    'padding-inline-start',
    'place-content',
    'place-items',
    'rotate',
    'row-gap',
    'text-align',
    'text-decoration-color',
    'text-decoration-line',
    'text-decoration-style',
    'text-indent',
    'visibility',
    'width',
])

export function isDirectlyEditableProperty(property: string): boolean {
    return DIRECTLY_EDITABLE_PROPERTIES.has(property)
}

export function isInheritedProperty(property: string): boolean {
    return property.startsWith('--') || INHERITED_PROPERTIES.has(property)
}

export function declarationValueForProperty(
    requested: string,
    declaration: IndexedStyleDeclaration,
    context: ReadContext,
): string | null | undefined {
    if (requested === declaration.property) return declaration.rawValue.trim()
    if (declaration.property === 'all') return cssWideKeyword(declaration.rawValue)
    const wideKeyword = cssWideKeyword(declaration.rawValue)
    if (wideKeyword) return wideKeyword
    if (declaration.property === 'gap' && (requested === 'row-gap' || requested === 'column-gap')) {
        const values = spaceSeparated(declaration.rawValue)
        if (values.length < 1 || values.length > 2) return null
        return requested === 'row-gap' ? values[0] : (values[1] ?? values[0])
    }
    if (
        declaration.property === 'columns' &&
        (requested === 'column-count' || requested === 'column-width')
    ) {
        return columnsShorthandValues(declaration.rawValue)?.[requested] ?? null
    }
    if (
        declaration.property === 'border' &&
        (requested === 'border-width' ||
            requested === 'border-style' ||
            requested === 'border-color')
    ) {
        return borderShorthandValues(declaration.rawValue)?.[requested] ?? null
    }
    if (declaration.property === 'background' && requested === 'background-color') {
        return simpleBackgroundColor(declaration.rawValue)
    }
    const boxValue = boxComponentValue(
        requested,
        declaration.property,
        declaration.rawValue,
        context,
    )
    if (boxValue !== NOT_A_BOX_PROPERTY) return boxValue
    if (declaration.property === 'place-items') {
        const values = spaceSeparated(declaration.rawValue)
        if (requested === 'align-items') return values[0] ?? null
        if (requested === 'justify-items') return values[1] ?? values[0] ?? null
    }
    if (declaration.property === 'place-content') {
        const values = spaceSeparated(declaration.rawValue)
        if (requested === 'align-content') return values[0] ?? null
        if (requested === 'justify-content') return values[1] ?? values[0] ?? null
    }
    if (declaration.property === 'flex-flow') {
        const values = spaceSeparated(declaration.rawValue)
        const directions = values.filter(value =>
            /^(row|row-reverse|column|column-reverse)$/u.test(value),
        )
        const wraps = values.filter(value => /^(nowrap|wrap|wrap-reverse)$/u.test(value))
        if (
            values.length < 1 ||
            values.length > 2 ||
            directions.length > 1 ||
            wraps.length > 1 ||
            directions.length + wraps.length !== values.length
        ) {
            return null
        }
        if (requested === 'flex-direction') {
            return directions[0] ?? 'row'
        }
        if (requested === 'flex-wrap') {
            return wraps[0] ?? 'nowrap'
        }
    }
    if (declaration.property === 'flex') {
        const values = flexShorthandValues(declaration.rawValue)
        if (!values) return null
        if (requested === 'flex-grow') return values.grow
        if (requested === 'flex-shrink') return values.shrink
        if (requested === 'flex-basis') return values.basis
    }
    if (
        (declaration.property === 'grid-column' || declaration.property === 'grid-row') &&
        (requested === `${declaration.property}-start` ||
            requested === `${declaration.property}-end`)
    ) {
        const values = slashSeparated(declaration.rawValue)
        if (values.length < 1 || values.length > 2 || values.some(value => !value)) return null
        return requested.endsWith('-start') ? values[0] : (values[1] ?? 'auto')
    }
    return null
}

/**
 * 返回可由内核逐分量无损迁移的简写。这里只登记已能完整解释缺省值和分量顺序的语法，
 * 不能因为两个属性存在覆盖关系就假定简写一定可拆。
 */
export function decomposableShorthandLonghands(
    property: string,
    requestedProperty?: string,
): readonly string[] | null {
    switch (property.toLowerCase()) {
        case 'margin':
        case 'padding': {
            const family = property.toLowerCase()
            return requestedProperty && /-(?:block|inline)-(?:start|end)$/u.test(requestedProperty)
                ? [
                      `${family}-block-start`,
                      `${family}-block-end`,
                      `${family}-inline-start`,
                      `${family}-inline-end`,
                  ]
                : [`${family}-top`, `${family}-right`, `${family}-bottom`, `${family}-left`]
        }
        case 'margin-block':
            return Object.freeze(['margin-block-start', 'margin-block-end'])
        case 'margin-inline':
            return Object.freeze(['margin-inline-start', 'margin-inline-end'])
        case 'padding-block':
            return Object.freeze(['padding-block-start', 'padding-block-end'])
        case 'padding-inline':
            return Object.freeze(['padding-inline-start', 'padding-inline-end'])
        case 'gap':
            return Object.freeze(['row-gap', 'column-gap'])
        case 'columns':
            return Object.freeze(['column-count', 'column-width'])
        case 'place-items':
            return Object.freeze(['align-items', 'justify-items'])
        case 'place-content':
            return Object.freeze(['align-content', 'justify-content'])
        case 'flex-flow':
            return Object.freeze(['flex-direction', 'flex-wrap'])
        case 'flex':
            return Object.freeze(['flex-grow', 'flex-shrink', 'flex-basis'])
        case 'grid-column':
            return Object.freeze(['grid-column-start', 'grid-column-end'])
        case 'grid-row':
            return Object.freeze(['grid-row-start', 'grid-row-end'])
        case 'border':
            return Object.freeze(['border-width', 'border-style', 'border-color'])
        default:
            return null
    }
}

export function propertyValueCapability(
    property: string,
    effective: EffectiveAuthorValue | null,
    confidence: PropertyConfidence,
): PropertyValueCapability {
    if (!effective) {
        return confidence.kind === 'proven'
            ? {kind: 'absent'}
            : {kind: 'read-only', rawValue: '', reason: confidence.reason}
    }
    if (confidence.kind !== 'proven' || effective.resolvedValue === null) {
        return {
            kind: 'read-only',
            rawValue: effective.rawValue,
            reason:
                confidence.kind === 'proven' ? '当前声明无法转换为可编辑值。' : confidence.reason,
        }
    }
    if (!isDirectlyEditableProperty(property)) {
        return {
            kind: 'read-only',
            rawValue: effective.rawValue,
            reason: '当前属性尚未登记可视编辑值域。',
        }
    }
    const source = effective.origin.source ?? sourceKey('entry', 'article.html')
    const parsed = parsePropertyValueSyntax(property, effective.resolvedValue, source)
    if (parsed.diagnostics.length > 0) {
        return {
            kind: 'read-only',
            rawValue: effective.rawValue,
            reason: '当前属性值无法按统一 CSS 语法读取。',
        }
    }
    return {
        kind: 'editable',
        normalizedValue: Object.freeze({
            rawValue: effective.rawValue,
            resolvedValue: effective.resolvedValue,
        }),
    }
}

export function defaultDisplay(tagName: string): string {
    if (tagName === 'span' || tagName === 'a' || tagName === 'strong' || tagName === 'em') {
        return 'inline'
    }
    if (tagName === 'table') return 'table'
    if (tagName === 'tr') return 'table-row'
    if (tagName === 'td' || tagName === 'th') return 'table-cell'
    return 'block'
}

function cssWideKeyword(value: string): string | null {
    const normalized = value.trim().toLowerCase()
    return /^(inherit|initial|unset|revert|revert-layer)$/u.test(normalized) ? normalized : null
}

function spaceSeparated(value: string): string[] {
    return valueParser(value)
        .nodes.filter(node => node.type !== 'space' && node.type !== 'comment')
        .map(node => valueParser.stringify([node]))
}

function slashSeparated(value: string): string[] {
    const nodes = valueParser(value).nodes
    const groups: (typeof nodes)[] = [[]]
    for (const node of nodes) {
        if (node.type === 'div' && node.value === '/') groups.push([])
        else groups[groups.length - 1]?.push(node)
    }
    return groups.map(group => valueParser.stringify(group).trim())
}

function flexShorthandValues(
    value: string,
): Readonly<{grow: string; shrink: string; basis: string}> | null {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'none') return {grow: '0', shrink: '0', basis: 'auto'}
    if (normalized === 'auto') return {grow: '1', shrink: '1', basis: 'auto'}
    const values = spaceSeparated(value)
    const number = (candidate: string | undefined) =>
        candidate !== undefined && /^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(candidate)
    if (values.length === 1 && number(values[0])) {
        return {grow: values[0], shrink: '1', basis: '0%'}
    }
    if (values.length === 2 && number(values[0])) {
        return number(values[1])
            ? {grow: values[0], shrink: values[1], basis: '0%'}
            : {grow: values[0], shrink: '1', basis: values[1]}
    }
    if (values.length === 3 && number(values[0]) && number(values[1])) {
        return {grow: values[0], shrink: values[1], basis: values[2]}
    }
    return null
}

function columnsShorthandValues(value: string): Readonly<{
    'column-count': string
    'column-width': string
}> | null {
    const values = spaceSeparated(value)
    if (values.length < 1 || values.length > 2) return null
    let count: string | null = null
    let width: string | null = null
    let autoCount = 0
    for (const raw of values) {
        const normalized = raw.toLowerCase()
        if (normalized === 'auto') {
            autoCount += 1
        } else if (/^[1-9]\d*$/u.test(normalized)) {
            if (count !== null) return null
            count = raw
        } else {
            if (width !== null) return null
            width = raw
        }
    }
    while (autoCount > 0) {
        if (width === null) width = 'auto'
        else if (count === null) count = 'auto'
        else return null
        autoCount -= 1
    }
    return Object.freeze({
        'column-count': count ?? 'auto',
        'column-width': width ?? 'auto',
    })
}

function borderShorthandValues(value: string): Readonly<{
    'border-width': string
    'border-style': string
    'border-color': string
}> | null {
    const nodes = valueParser(value).nodes.filter(
        node => node.type !== 'space' && node.type !== 'comment',
    )
    if (nodes.length < 1 || nodes.some(node => node.type === 'div')) return null
    let width: string | null = null
    let style: string | null = null
    let color: string | null = null
    for (const node of nodes) {
        const raw = valueParser.stringify([node]).trim()
        const normalized = raw.toLowerCase()
        if (
            /^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/u.test(normalized)
        ) {
            if (style !== null) return null
            style = raw
            continue
        }
        if (
            /^(thin|medium|thick)$/u.test(normalized) ||
            /^\+?(?:0+(?:\.0*)?|\.0+|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?[a-z%]+)$/u.test(
                normalized,
            )
        ) {
            if (width !== null) return null
            width = raw
            continue
        }
        if (color !== null) return null
        color = raw
    }
    return Object.freeze({
        'border-width': width ?? 'medium',
        'border-style': style ?? 'none',
        'border-color': color ?? 'currentcolor',
    })
}

function simpleBackgroundColor(value: string): string | null {
    const nodes = valueParser(value).nodes.filter(
        node => node.type !== 'space' && node.type !== 'comment',
    )
    if (nodes.length !== 1) return null
    const node = nodes[0]
    const raw = valueParser.stringify([node]).trim()
    if (node.type === 'word') {
        return /^(?:#[0-9a-f]{3,8}|transparent|currentcolor|[a-z]+)$/iu.test(raw) ? raw : null
    }
    if (node.type !== 'function') return null
    return /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)$/iu.test(node.value)
        ? raw
        : null
}

function physicalBoxValues(
    value: string,
): Readonly<Record<'top' | 'right' | 'bottom' | 'left', string>> | null {
    const values = spaceSeparated(value)
    if (values.length < 1 || values.length > 4) return null
    const [top, right = top, bottom = top, left = right] = values
    return {top, right, bottom, left}
}

const NOT_A_BOX_PROPERTY = Symbol('not-a-box-property')
type BoxSide =
    | 'top'
    | 'right'
    | 'bottom'
    | 'left'
    | 'block-start'
    | 'block-end'
    | 'inline-start'
    | 'inline-end'
type BoxProperty =
    | {readonly family: 'padding' | 'margin'; readonly kind: 'all'}
    | {
          readonly family: 'padding' | 'margin'
          readonly kind: 'axis'
          readonly axis: 'block' | 'inline'
      }
    | {readonly family: 'padding' | 'margin'; readonly kind: 'side'; readonly side: BoxSide}

function boxComponentValue(
    requested: string,
    declared: string,
    rawValue: string,
    context: ReadContext,
): string | null | undefined | typeof NOT_A_BOX_PROPERTY {
    const target = parseBoxProperty(requested)
    const source = parseBoxProperty(declared)
    if (!target || !source || target.family !== source.family) return NOT_A_BOX_PROPERTY
    if (target.kind !== 'side') return null
    const targetSide = logicalSideToPhysical(target.side, context)
    if (targetSide === null) return null
    if (source.kind === 'all') {
        return physicalBoxValues(rawValue)?.[targetSide] ?? null
    }
    if (source.kind === 'side') {
        if (source.side === target.side) return rawValue.trim()
        if (isPhysicalBoxSide(source.side) === isPhysicalBoxSide(target.side)) {
            return undefined
        }
        const sourceSide = logicalSideToPhysical(source.side, context)
        if (sourceSide === null) return null
        return sourceSide === targetSide ? rawValue.trim() : undefined
    }
    const values = spaceSeparated(rawValue)
    if (values.length < 1 || values.length > 2) return null
    const logicalSides: readonly [BoxSide, BoxSide] =
        source.axis === 'block' ? ['block-start', 'block-end'] : ['inline-start', 'inline-end']
    for (let index = 0; index < logicalSides.length; index += 1) {
        const sourceSide = logicalSideToPhysical(logicalSides[index], context)
        if (sourceSide === null) return null
        if (sourceSide === targetSide) return values[index] ?? values[0]
    }
    return undefined
}

function isPhysicalBoxSide(side: BoxSide): boolean {
    return side === 'top' || side === 'right' || side === 'bottom' || side === 'left'
}

function parseBoxProperty(property: string): BoxProperty | null {
    const match =
        /^(padding|margin)(?:-(block|inline)(?:-(start|end))?|-(top|right|bottom|left))?$/u.exec(
            property,
        )
    if (!match) return null
    const family = match[1] as 'padding' | 'margin'
    if (match[4]) return {family, kind: 'side', side: match[4] as BoxSide}
    if (match[2] && match[3]) {
        return {family, kind: 'side', side: `${match[2]}-${match[3]}` as BoxSide}
    }
    if (match[2]) return {family, kind: 'axis', axis: match[2] as 'block' | 'inline'}
    return {family, kind: 'all'}
}

function logicalSideToPhysical(
    side: BoxSide,
    context: ReadContext,
): 'top' | 'right' | 'bottom' | 'left' | null {
    if (side === 'top' || side === 'right' || side === 'bottom' || side === 'left') return side
    if (context.writingMode === 'unknown') return null
    if (context.writingMode === 'horizontal-tb') {
        if (side === 'block-start') return 'top'
        if (side === 'block-end') return 'bottom'
        if (context.direction === 'unknown') return null
        if (side === 'inline-start') return context.direction === 'rtl' ? 'right' : 'left'
        return context.direction === 'rtl' ? 'left' : 'right'
    }
    if (side === 'block-start') return context.writingMode === 'vertical-rl' ? 'right' : 'left'
    if (side === 'block-end') return context.writingMode === 'vertical-rl' ? 'left' : 'right'
    if (context.direction === 'unknown') return null
    if (side === 'inline-start') return context.direction === 'rtl' ? 'bottom' : 'top'
    return context.direction === 'rtl' ? 'top' : 'bottom'
}
