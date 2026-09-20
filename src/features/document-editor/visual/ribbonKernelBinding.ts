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

const INLINE_CONTEXT: ReadContext = Object.freeze({
    viewport: 'desktop',
    interactions: Object.freeze({hover: false, focusWithin: false}),
    direction: 'ltr',
    writingMode: 'horizontal-tb',
})

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
    styleContext: 'mobile' | 'desktop' = 'mobile',
): KernelDraftEditRequest {
    return createVisualPropertyEditRequest(nodeId, [{property, value}], {styleContext})
}

export function createRibbonTextRangePropertyRequest(
    range: RibbonTextRange,
    property: RibbonInlineProperty,
    value: string | null,
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
                readContext: INLINE_CONTEXT,
                destination: Object.freeze({scope: 'entry' as const, channel: Object.freeze({kind: 'inline' as const})}),
            })])
        },
    })
}
