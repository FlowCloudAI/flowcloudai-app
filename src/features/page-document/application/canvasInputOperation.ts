// 本模块把已鉴权的画布纯文本意图适配为文档内核请求；它不读取 DOM，也不接受 HTML。

import {
    CANVAS_EDITABLE_KINDS,
    type CanvasInputResolution,
    type CanvasInputIntentMessage,
    type CanvasInputType,
    type CanvasStoredMarkProperty,
    type CanvasStoredMarks,
} from '../canvas/protocol/index.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {
    idempotencyKey,
    interactionId,
    nodeId,
    utf16Range,
    type EditIntent,
    type ReadContext,
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

export interface CanvasInputTarget {
    readonly kind: string
    readonly text: string
}

export interface CanvasInputKernelOperation {
    readonly request: KernelDraftEditRequest
    readonly resolution: CanvasInputResolution
}

export function canvasInputCaretSelection(
    message: CanvasInputIntentMessage,
): NonNullable<CanvasInputResolution['selection']> {
    return Object.freeze({
        nodeId: message.nodeId,
        offset: message.from + message.text.length,
    })
}

export type CanvasTypingStyleProperty = CanvasStoredMarkProperty

export interface CanvasTypingStyleSnapshot extends CanvasStoredMarks {
    readonly nodeId: string
}

export function canvasInputTypingStyleSnapshot(
    message: CanvasInputIntentMessage,
): CanvasTypingStyleSnapshot | null {
    return message.storedMarks ? Object.freeze({nodeId: message.nodeId, ...message.storedMarks}) : null
}

const editableKinds = new Set<string>(CANVAS_EDITABLE_KINDS)

/** 宿主只从当前源码重新派生受管投影，不能相信 iframe 自报的节点身份或文本。 */
export function readCanvasInputTarget(articleHtml: string, nodeId: string): CanvasInputTarget | null {
    const projection = createLayerProjection(articleHtml)
    const node = findManagedLayerNode(projection.nodes, nodeId.toLowerCase())
    return node && editableKinds.has(node.kind)
        ? Object.freeze({kind: node.kind, text: node.textContent})
        : null
}

export function readCanvasInputTargetText(articleHtml: string, targetNodeId: string): string | null {
    return readCanvasInputTarget(articleHtml, targetNodeId)?.text ?? null
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

const splittableKinds = new Set(['paragraph', 'heading', 'list-item'])

function replacementIntent(
    message: CanvasInputIntentMessage,
    handle: ReturnType<typeof requireKernelComponentHandle>,
    text = message.text,
): EditIntent {
    return Object.freeze({
        kind: 'replace-text' as const,
        target: Object.freeze({
            kind: 'text-range' as const,
            component: handle,
            range: utf16Range(message.from, message.to),
            expected: message.expected,
        }),
        coordinateSpace: 'current-candidate' as const,
        text,
    })
}

function typingStyleIntents(
    message: CanvasInputIntentMessage,
    handle: ReturnType<typeof requireKernelComponentHandle>,
    snapshot: CanvasTypingStyleSnapshot | null,
): readonly EditIntent[] {
    if (!snapshot || snapshot.nodeId.toLowerCase() !== message.nodeId.toLowerCase() || message.text.length === 0) {
        return []
    }
    const readContext: ReadContext = Object.freeze({
        viewport: snapshot.styleContext,
        interactions: Object.freeze({hover: false, focusWithin: false}),
        direction: 'ltr',
        writingMode: 'horizontal-tb',
    })
    return Object.freeze(
        Object.entries(snapshot.values).map(([property, value]) => Object.freeze({
            kind: 'edit-property' as const,
            target: Object.freeze({
                kind: 'text-range' as const,
                component: handle,
                range: utf16Range(message.from, message.from + message.text.length),
                expected: message.text,
            }),
            coordinateSpace: 'current-candidate' as const,
            property,
            action: Object.freeze({kind: 'set-value' as const, value}),
            readContext,
            destination: Object.freeze({
                scope: 'entry' as const,
                channel: Object.freeze({kind: 'inline' as const}),
            }),
        } satisfies EditIntent)),
    )
}

/** 同一调度窗口的顺序意图在 current-candidate 坐标中批量执行；结构身份只在宿主中分配。 */
export function createCanvasInputKernelOperation(
    messages: readonly CanvasInputIntentMessage[],
    historyGroupId: string,
    targetKind: string,
    allocateNodeId: () => string = () => crypto.randomUUID(),
): CanvasInputKernelOperation {
    const first = messages[0]
    if (!first || messages.some(message => message.nodeId.toLowerCase() !== first.nodeId.toLowerCase())) {
        throw new TypeError('同一画布输入批次必须包含同一受管节点的意图。')
    }
    const structural = messages.filter(message => message.inputType === 'insertParagraph')
    if (structural.length > 0 && messages.length !== 1) {
        throw new TypeError('分段必须作为独立的立即输入提交。')
    }
    if (structural.length > 0 && !splittableKinds.has(targetKind)) {
        throw new TypeError(`${targetKind} 不支持创建后续文本块。`)
    }
    const allocatedNodeIds = structural.map(() => nodeId(allocateNodeId()))
    const last = messages.at(-1)
    const hasTypingStyle = messages.some(message => message.storedMarks !== null)
    const selection = structural.length > 0
        ? Object.freeze({
              nodeId: allocatedNodeIds.at(-1) as string,
              offset: 0,
          })
        : hasTypingStyle && last
          ? canvasInputCaretSelection(last)
          : null
    const request = Object.freeze({
        nodeIds: Object.freeze([first.nodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`canvas-input:${first.intentId.toLowerCase()}`),
        interactionId: interactionId(historyGroupId),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings) {
            const handle = requireKernelComponentHandle(handles, first.nodeId)
            if (first.inputType === 'insertParagraph') {
                return Object.freeze([Object.freeze({
                    kind: 'split-text-block' as const,
                    target: Object.freeze({
                        kind: 'text-range' as const,
                        component: handle,
                        range: utf16Range(first.from, first.to),
                        expected: first.expected,
                    }),
                    coordinateSpace: 'current-candidate' as const,
                    newNodeId: allocatedNodeIds[0],
                } satisfies EditIntent)])
            }
            return Object.freeze(messages.flatMap(message => [
                replacementIntent(message, handle),
                ...typingStyleIntents(message, handle, canvasInputTypingStyleSnapshot(message)),
            ]))
        },
    })
    return Object.freeze({
        request,
        resolution: Object.freeze({accepted: true, selection}),
    })
}

export function createCanvasInputKernelRequest(
    messages: readonly CanvasInputIntentMessage[],
    historyGroupId: string,
    targetKind = 'paragraph',
): KernelDraftEditRequest {
    return createCanvasInputKernelOperation(messages, historyGroupId, targetKind).request
}

export function canvasInputHistoryLabel(inputType: CanvasInputType): string {
    if (inputType === 'insertCompositionText') return '画布中文输入'
    if (inputType === 'insertParagraph') return '画布分段'
    if (inputType === 'insertLineBreak') return '画布软换行'
    if (inputType === 'insertFromPaste') return '画布粘贴纯文本'
    if (inputType.startsWith('delete')) return '画布删除文本'
    return '画布输入文本'
}

export function canvasInputBlockedFeedback(reason: string, inputType: string): string {
    if (reason === 'input-too-large') return '单次画布输入过长，未写入页面草稿。'
    if (reason === 'invalid-selection') return '画布选区已经变化，本次输入未写入页面草稿。'
    if (inputType === 'insertParagraph') return '表格单元格不支持分段。'
    return `画布已阻止不支持的输入：${inputType || 'unknown'}`
}
