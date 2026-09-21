// 本模块是页面文档功能区到现有属性内核适配器的唯一绑定点；不持有界面状态。

import {
    createVisualPropertyEditRequest,
    type VisualPropertyEditValue,
    type VisualPropertyName,
} from '../../page-document/application/visualPropertyEditing.ts'
import {
    documentFingerprint,
    idempotencyKey,
    interactionId,
    utf16Range,
    type ReadContext,
} from '../../page-document/domain/kernel/index.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelDraftEditRequest,
} from '../../page-document/application/documentKernelDraftRuntime.ts'

export interface RibbonTextRange {
    readonly nodeId: string
    readonly from: number
    readonly to: number
    readonly expected: string
}

export type RibbonInlineProperty =
    | 'font-size'
    | 'font-weight'
    | 'font-style'
    | 'text-decoration-line'
    | 'color'

export type RibbonTextDecoration = 'underline' | 'line-through'

export const RIBBON_PARAGRAPH_INDENT_LEVELS = Object.freeze([0, 1, 2, 3] as const)
export type RibbonParagraphIndentDirection = 'decrease' | 'increase'

export function ribbonParagraphIndentLevel(value: string): number | null {
    const normalized = value.trim().toLowerCase()
    if (/^0(?:\.0+)?(?:px|rem)?$/u.test(normalized)) return 0
    const matched = /^(\d+(?:\.\d+)?)rem$/u.exec(normalized)
    if (!matched) return null
    const level = Number(matched[1])
    return RIBBON_PARAGRAPH_INDENT_LEVELS.includes(level as (typeof RIBBON_PARAGRAPH_INDENT_LEVELS)[number])
        ? level
        : null
}

export function ribbonParagraphIndentStep(
    value: string,
    direction: RibbonParagraphIndentDirection,
): VisualPropertyEditValue | null {
    const current = ribbonParagraphIndentLevel(value)
    if (current === null) return null
    const currentIndex = RIBBON_PARAGRAPH_INDENT_LEVELS.indexOf(
        current as (typeof RIBBON_PARAGRAPH_INDENT_LEVELS)[number],
    )
    const next = RIBBON_PARAGRAPH_INDENT_LEVELS[currentIndex + (direction === 'increase' ? 1 : -1)]
    return next === undefined
        ? null
        : {kind: 'numeric', value: next, unit: 'rem', numberText: String(next)}
}

export function toggleRibbonTextDecoration(
    value: string | null,
    decoration: RibbonTextDecoration,
): string {
    const tokens = new Set((value ?? '').split(/\s+/u).filter(token => token && token !== 'none'))
    if (tokens.has(decoration)) tokens.delete(decoration)
    else tokens.add(decoration)
    return ['underline', 'line-through'].filter(token => tokens.has(token)).join(' ') || 'none'
}

function inlineReadContext(styleContext: 'mobile' | 'desktop'): ReadContext {
    // 行内目的地不分档；viewport 只描述作者当前所见区间，供回读和影响分析使用。
    return Object.freeze({
        viewport: styleContext,
        interactions: Object.freeze({hover: false, focusWithin: false}),
        direction: 'ltr',
        writingMode: 'horizontal-tb',
    })
}

const INLINE_VALUE_PATTERNS: Readonly<Record<RibbonInlineProperty, RegExp>> = Object.freeze({
    'font-size': /^(?:\d+(?:\.\d+)?)(?:px|rem|em|%)$/u,
    'font-weight': /^(?:400|500|600|700|800|900)$/u,
    'font-style': /^(?:normal|italic)$/u,
    'text-decoration-line': /^(?:none|underline|line-through|underline line-through)$/u,
    color: /^(?:var\(--fc-entry-(?:text|accent|muted)\)|currentcolor)$/u,
})

export function createRibbonPropertyRequest(
    nodeId: string,
    property: VisualPropertyName,
    value: VisualPropertyEditValue,
    styleContext: 'mobile' | 'desktop',
): KernelDraftEditRequest {
    return createVisualPropertyEditRequest(nodeId, [{property, value}], {styleContext})
}

export function createRibbonTextRangePropertyRequest(
    range: RibbonTextRange,
    property: RibbonInlineProperty,
    value: string | null,
    styleContext: 'mobile' | 'desktop',
    allocateRequestId: () => string = () => crypto.randomUUID(),
): KernelDraftEditRequest {
    if (range.from < 0 || range.to <= range.from || range.expected.length !== range.to - range.from) {
        throw new TypeError('行内样式需要非空且未漂移的 UTF-16 文字选区。')
    }
    if (value !== null && !INLINE_VALUE_PATTERNS[property].test(value)) {
        throw new TypeError(`行内样式值不受支持：${property}`)
    }
    const requestId = allocateRequestId()
    return Object.freeze({
        nodeIds: Object.freeze([range.nodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`ribbon-text-range:${requestId}`),
        interactionId: interactionId(`ribbon-text-range:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const component = requireKernelComponentHandle(handles, range.nodeId)
            return Object.freeze([Object.freeze({
                kind: 'edit-property' as const,
                target: Object.freeze({
                    kind: 'text-range' as const,
                    component,
                    range: utf16Range(range.from, range.to),
                    expected: range.expected,
                }),
                property,
                action: value === null
                    ? Object.freeze({kind: 'clear-override' as const})
                    : Object.freeze({kind: 'set-value' as const, value}),
                readContext: inlineReadContext(styleContext),
                destination: Object.freeze({scope: 'entry' as const, channel: Object.freeze({kind: 'inline' as const})}),
            })])
        },
    })
}
