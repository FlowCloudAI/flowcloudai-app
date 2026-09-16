// 本模块做无副作用的协议形状校验；任何字段越界、额外字段或非当前会话信封都直接拒绝。

import {RFC_9562_UUID_PATTERN} from '../../domain/uuidPolicy.ts'
import {
    CANVAS_DIMENSION_MAX,
    CANVAS_ERROR_MAX_CODE_UNITS,
    CANVAS_HREF_MAX_CODE_UNITS,
    CANVAS_INPUT_BLOCKED_REASONS,
    CANVAS_INPUT_TYPES,
    CANVAS_MESSAGE_MAX_BYTES,
    CANVAS_PIXEL_RATIO_MAX,
    CANVAS_SOURCE_MAX_CODE_UNITS,
    CANVAS_TEXT_FIELD_MAX_CODE_UNITS,
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
} from './constants.ts'
import type {CanvasHostCommand, CanvasLinkHoverRect, CanvasRuntimeMessage} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const expected = new Set(keys)
    return Object.keys(value).every(key => expected.has(key)) && Object.keys(value).length === keys.length
}

function isBoundedString(value: unknown, max: number, allowEmpty = true): value is string {
    return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0)
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string' && RFC_9562_UUID_PATTERN.test(value)
}

function isSequence(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0
}

function isDimension(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
        && value <= CANVAS_DIMENSION_MAX
}

export function isCanvasLinkHoverRect(value: unknown): value is CanvasLinkHoverRect {
    if (!isRecord(value) || !hasOnlyKeys(value, ['top', 'left', 'width', 'height'])) return false
    return typeof value.top === 'number' && Number.isFinite(value.top)
        && Math.abs(value.top) <= CANVAS_DIMENSION_MAX
        && typeof value.left === 'number' && Number.isFinite(value.left)
        && Math.abs(value.left) <= CANVAS_DIMENSION_MAX
        && isDimension(value.width) && isDimension(value.height)
}

function isEnvelope(value: Record<string, unknown>, token: string): boolean {
    return value.channel === PAGE_DOCUMENT_CANVAS_CHANNEL
        && value.version === PAGE_DOCUMENT_CANVAS_VERSION
        && value.sessionToken === token
        && isSequence(value.sequence)
}

export function canvasMessageByteLength(value: unknown): number | null {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength
    } catch {
        return null
    }
}

function isWithinMessageBudget(value: unknown): boolean {
    const bytes = canvasMessageByteLength(value)
    return bytes !== null && bytes <= CANVAS_MESSAGE_MAX_BYTES
}

const envelopeKeys = ['channel', 'version', 'sessionToken', 'sequence', 'type'] as const

export function parseCanvasHostCommand(value: unknown, token: string): CanvasHostCommand | null {
    if (!isRecord(value) || !isEnvelope(value, token) || !isWithinMessageBudget(value)) return null
    if (value.type === 'render') {
        const keys = [...envelopeKeys, 'requestId', 'html', 'css']
        return hasOnlyKeys(value, keys)
            && isUuid(value.requestId)
            && isBoundedString(value.html, CANVAS_SOURCE_MAX_CODE_UNITS)
            && isBoundedString(value.css, CANVAS_SOURCE_MAX_CODE_UNITS)
            ? value as unknown as CanvasHostCommand
            : null
    }
    if (value.type === 'set-selection') {
        const nodeId = value.nodeId
        return hasOnlyKeys(value, [...envelopeKeys, 'nodeId'])
            && (nodeId === null || isUuid(nodeId))
            ? value as unknown as CanvasHostCommand
            : null
    }
    if (value.type === 'viewport') {
        return hasOnlyKeys(value, [...envelopeKeys, 'width', 'height', 'pixelRatio'])
            && isDimension(value.width)
            && isDimension(value.height)
            && typeof value.pixelRatio === 'number'
            && Number.isFinite(value.pixelRatio)
            && value.pixelRatio > 0
            && value.pixelRatio <= CANVAS_PIXEL_RATIO_MAX
            ? value as unknown as CanvasHostCommand
            : null
    }
    if (value.type === 'set-editing') {
        return hasOnlyKeys(value, [...envelopeKeys, 'enabled'])
            && typeof value.enabled === 'boolean'
            ? value as unknown as CanvasHostCommand
            : null
    }
    if (value.type === 'resolve-input') {
        const selection = value.selection
        const validSelection = selection === null || (
            isRecord(selection)
            && hasOnlyKeys(selection, ['nodeId', 'offset'])
            && isUuid(selection.nodeId)
            && Number.isInteger(selection.offset)
            && (selection.offset as number) >= 0
            && (selection.offset as number) <= CANVAS_TEXT_FIELD_MAX_CODE_UNITS
        )
        return hasOnlyKeys(value, [...envelopeKeys, 'intentId', 'accepted', 'selection'])
            && isUuid(value.intentId)
            && typeof value.accepted === 'boolean'
            && validSelection
            && (value.accepted || selection === null)
            ? value as unknown as CanvasHostCommand
            : null
    }
    return null
}

function parseInputIntent(value: Record<string, unknown>): CanvasRuntimeMessage | null {
    const keys = [
        ...envelopeKeys,
        'intentId',
        'nodeId',
        'inputType',
        'from',
        'to',
        'expected',
        'text',
    ]
    const from = value.from
    const to = value.to
    const validTypePayload = value.inputType === 'insertParagraph'
        ? from === to && value.expected === '' && value.text === ''
        : value.inputType === 'insertLineBreak'
          ? value.text === '\n'
          : true
    return hasOnlyKeys(value, keys)
        && isUuid(value.intentId)
        && isUuid(value.nodeId)
        && typeof value.inputType === 'string'
        && CANVAS_INPUT_TYPES.includes(value.inputType as never)
        && Number.isInteger(from)
        && Number.isInteger(to)
        && (from as number) >= 0
        && (to as number) >= (from as number)
        && (to as number) <= CANVAS_TEXT_FIELD_MAX_CODE_UNITS
        && isBoundedString(value.expected, CANVAS_TEXT_FIELD_MAX_CODE_UNITS)
        && isBoundedString(value.text, CANVAS_TEXT_FIELD_MAX_CODE_UNITS)
        && validTypePayload
        ? value as unknown as CanvasRuntimeMessage
        : null
}

export function parseCanvasRuntimeMessage(value: unknown, token: string): CanvasRuntimeMessage | null {
    if (!isRecord(value) || !isEnvelope(value, token) || !isWithinMessageBudget(value)) return null
    if (value.type === 'rendered') {
        return hasOnlyKeys(value, [...envelopeKeys, 'requestId', 'managedNodeCount'])
            && isUuid(value.requestId)
            && Number.isInteger(value.managedNodeCount)
            && (value.managedNodeCount as number) >= 0
            && (value.managedNodeCount as number) <= 512
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    if (value.type === 'render-error') {
        return hasOnlyKeys(value, [...envelopeKeys, 'requestId', 'code', 'message'])
            && isUuid(value.requestId)
            && (value.code === 'invalid-document' || value.code === 'runtime-error')
            && isBoundedString(value.message, CANVAS_ERROR_MAX_CODE_UNITS, false)
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    if (value.type === 'size') {
        return hasOnlyKeys(value, [...envelopeKeys, 'width', 'height'])
            && isDimension(value.width)
            && isDimension(value.height)
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    if (value.type === 'selection') {
        return hasOnlyKeys(value, [...envelopeKeys, 'nodeId']) && isUuid(value.nodeId)
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    if (value.type === 'navigation-intent') {
        return hasOnlyKeys(value, [...envelopeKeys, 'href', 'nodeId'])
            && isBoundedString(value.href, CANVAS_HREF_MAX_CODE_UNITS, false)
            && (value.nodeId === null || isUuid(value.nodeId))
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    if (value.type === 'link-hover') {
        const validLeave = value.href === null && value.nodeId === null && value.rect === null
        const validEnter = isBoundedString(value.href, CANVAS_HREF_MAX_CODE_UNITS, false)
            && (value.nodeId === null || isUuid(value.nodeId))
            && isCanvasLinkHoverRect(value.rect)
        return hasOnlyKeys(value, [...envelopeKeys, 'href', 'nodeId', 'rect'])
            && (validLeave || validEnter)
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    if (value.type === 'input-intent') return parseInputIntent(value)
    if (value.type === 'input-blocked') {
        return hasOnlyKeys(value, [...envelopeKeys, 'nodeId', 'inputType', 'reason'])
            && (value.nodeId === null || isUuid(value.nodeId))
            && isBoundedString(value.inputType, 64, false)
            && typeof value.reason === 'string'
            && CANVAS_INPUT_BLOCKED_REASONS.includes(value.reason as never)
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    if (value.type === 'input-flush') {
        return hasOnlyKeys(value, [...envelopeKeys, 'nodeId']) && isUuid(value.nodeId)
            ? value as unknown as CanvasRuntimeMessage
            : null
    }
    return null
}
