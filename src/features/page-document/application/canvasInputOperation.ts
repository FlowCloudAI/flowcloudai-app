// 本模块把已鉴权的画布纯文本意图适配为文档内核请求；它不读取 DOM，也不接受 HTML。

import {
    CANVAS_EDITABLE_KINDS,
    type CanvasInputIntentMessage,
    type CanvasInputType,
} from '../canvas/protocol/index.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {
    idempotencyKey,
    interactionId,
    utf16Range,
    type EditIntent,
} from '../domain/kernel/index.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelDraftEditRequest,
} from './documentKernelDraftRuntime.ts'
import {findManagedLayerNode} from './visualSelectionModel.ts'

export interface CanvasInputTextUpdate {
    readonly accepted: boolean
    readonly text: string
    readonly reason: 'invalid-selection' | null
}

const editableKinds = new Set<string>(CANVAS_EDITABLE_KINDS)

/** 宿主只从当前源码重新派生受管投影，不能相信 iframe 自报的节点身份或文本。 */
export function readCanvasInputTargetText(articleHtml: string, nodeId: string): string | null {
    const projection = createLayerProjection(articleHtml)
    const node = findManagedLayerNode(projection.nodes, nodeId.toLowerCase())
    return node && editableKinds.has(node.kind) ? node.textContent : null
}

function isUtf16Boundary(value: string, offset: number): boolean {
    if (!Number.isInteger(offset) || offset < 0 || offset > value.length) return false
    if (offset === 0 || offset === value.length) return true
    const previous = value.charCodeAt(offset - 1)
    const next = value.charCodeAt(offset)
    return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
}

/** 在宿主的暂存纯文本上复核范围；画布临时 DOM 从不参与内核请求构造。 */
export function applyCanvasInputToText(
    currentText: string,
    message: CanvasInputIntentMessage,
): CanvasInputTextUpdate {
    if (
        message.to > currentText.length ||
        !isUtf16Boundary(currentText, message.from) ||
        !isUtf16Boundary(currentText, message.to) ||
        currentText.slice(message.from, message.to) !== message.expected
    ) {
        return Object.freeze({accepted: false, text: currentText, reason: 'invalid-selection'})
    }
    return Object.freeze({
        accepted: true,
        text: `${currentText.slice(0, message.from)}${message.text}${currentText.slice(message.to)}`,
        reason: null,
    })
}

/** 同一调度窗口的顺序意图在 current-candidate 坐标中批量执行，避免每个按键都完整重编译。 */
export function createCanvasInputKernelRequest(
    messages: readonly CanvasInputIntentMessage[],
    historyGroupId: string,
): KernelDraftEditRequest {
    const first = messages[0]
    if (!first || messages.some(message => message.nodeId.toLowerCase() !== first.nodeId.toLowerCase())) {
        throw new TypeError('同一画布输入批次必须包含同一受管节点的意图。')
    }
    return Object.freeze({
        nodeIds: Object.freeze([first.nodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`canvas-input:${first.intentId.toLowerCase()}`),
        interactionId: interactionId(historyGroupId),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const handle = requireKernelComponentHandle(handles, first.nodeId)
            return Object.freeze(messages.map(message => Object.freeze({
                kind: 'replace-text' as const,
                target: Object.freeze({
                    kind: 'text-range' as const,
                    component: handle,
                    range: utf16Range(message.from, message.to),
                    expected: message.expected,
                }),
                coordinateSpace: 'current-candidate' as const,
                text: message.text,
            } satisfies EditIntent)))
        },
    })
}

export function canvasInputHistoryLabel(inputType: CanvasInputType): string {
    if (inputType === 'insertCompositionText') return '画布中文输入'
    if (inputType.startsWith('delete')) return '画布删除文本'
    return '画布输入文本'
}

export function canvasInputBlockedFeedback(reason: string, inputType: string): string {
    if (reason === 'input-too-large') return '单次画布输入过长，未写入页面草稿。'
    if (reason === 'invalid-selection') return '画布选区已经变化，本次输入未写入页面草稿。'
    return `画布已阻止不支持的输入：${inputType || 'unknown'}`
}
