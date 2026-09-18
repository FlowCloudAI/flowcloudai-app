// 本模块把已鉴权的画布纯文本意图适配为文档内核请求；它不读取 DOM，也不接受 HTML。

import {
    CANVAS_EDITABLE_KINDS,
    type CanvasInputResolution,
    type CanvasInputIntentMessage,
    type CanvasInputType,
} from '../canvas/protocol/index.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {
    idempotencyKey,
    interactionId,
    mapPastedNodeIdentities,
    nodeId,
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

export interface CanvasInputTarget {
    readonly kind: string
    readonly text: string
}

export interface CanvasInputKernelOperation {
    readonly request: KernelDraftEditRequest
    readonly resolution: CanvasInputResolution
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

interface CanvasPastePlan {
    readonly insertedText: string
    readonly splitOffsets: readonly number[]
    readonly finalOffset: number
}

export interface CanvasPasteIdentityOptions {
    readonly sourceNodeIds: readonly string[]
    readonly sameDocument: boolean
    readonly operation: 'copy' | 'move'
    readonly unavailable?: Iterable<string>
}

/** 文本粘贴产生的新块也必须经过同一身份映射器；调用方不能自行拼接或复用 UUID。 */
export function mapCanvasPastedNodeIdentities(
    options: CanvasPasteIdentityOptions,
    allocate: () => string,
): ReadonlyMap<ReturnType<typeof nodeId>, ReturnType<typeof nodeId>> {
    return mapPastedNodeIdentities(options.sourceNodeIds, {
        sameDocument: options.sameDocument,
        operation: options.operation,
        allocate,
        unavailable: options.unavailable ?? [],
    })
}

/** 空行是块边界，单个换行保留给 replace-text 编译为 br。 */
export function planCanvasPlainTextPaste(text: string, from: number): CanvasPastePlan {
    const paragraphs = text.replace(/\r\n?/gu, '\n').split(/\n(?:[\t ]*\n)+/gu)
    const splitOffsets: number[] = []
    let offset = from
    for (const paragraph of paragraphs.slice(0, -1)) {
        offset += paragraph.length
        splitOffsets.push(offset)
    }
    return Object.freeze({
        insertedText: paragraphs.join(''),
        splitOffsets: Object.freeze(splitOffsets),
        finalOffset: paragraphs.at(-1)?.length ?? 0,
    })
}

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

/** 同一调度窗口的顺序意图在 current-candidate 坐标中批量执行；结构身份只在宿主中分配。 */
export function createCanvasInputKernelOperation(
    messages: readonly CanvasInputIntentMessage[],
    historyGroupId: string,
    targetKind: string,
    allocateNodeId: () => string = () => crypto.randomUUID(),
    pasteIdentity?: CanvasPasteIdentityOptions,
): CanvasInputKernelOperation {
    const first = messages[0]
    if (!first || messages.some(message => message.nodeId.toLowerCase() !== first.nodeId.toLowerCase())) {
        throw new TypeError('同一画布输入批次必须包含同一受管节点的意图。')
    }
    const structural = messages.filter(message => (
        message.inputType === 'insertParagraph'
        || (message.inputType === 'insertFromPaste' && planCanvasPlainTextPaste(message.text, message.from).splitOffsets.length > 0)
    ))
    if (structural.length > 0 && messages.length !== 1) {
        throw new TypeError('分段与多段粘贴必须作为独立的立即输入提交。')
    }
    if (structural.length > 0 && !splittableKinds.has(targetKind)) {
        throw new TypeError(`${targetKind} 不支持创建后续文本块。`)
    }
    const structuralCount = structural.length === 0
        ? 0
        : structural[0].inputType === 'insertParagraph'
          ? 1
          : planCanvasPlainTextPaste(structural[0].text, structural[0].from).splitOffsets.length
    const pasteSourceIds = pasteIdentity?.sourceNodeIds ?? Array.from(
        {length: structuralCount},
        () => crypto.randomUUID(),
    )
    const pastedMapping = structuralCount === 0
        ? new Map<string, string>()
        : mapCanvasPastedNodeIdentities(
              pasteIdentity ?? {
                  sourceNodeIds: pasteSourceIds,
                  sameDocument: false,
                  operation: 'copy',
              },
              allocateNodeId,
          )
    const allocatedNodeIds = structural.length === 0
        ? []
        : pasteSourceIds.map(sourceId =>
              nodeId(pastedMapping.get(nodeId(sourceId)) ?? allocateNodeId()),
          )
    const selection = structural.length === 0
        ? null
        : Object.freeze({
              nodeId: allocatedNodeIds.at(-1) as string,
              offset: structural[0].inputType === 'insertParagraph'
                  ? 0
                  : planCanvasPlainTextPaste(structural[0].text, structural[0].from).finalOffset,
          })
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
            if (first.inputType === 'insertFromPaste') {
                const paste = planCanvasPlainTextPaste(first.text, first.from)
                const intents: EditIntent[] = [replacementIntent(first, handle, paste.insertedText)]
                for (let index = paste.splitOffsets.length - 1; index >= 0; index -= 1) {
                    intents.push(Object.freeze({
                        kind: 'split-text-block' as const,
                        target: Object.freeze({
                            kind: 'text-range' as const,
                            component: handle,
                            range: utf16Range(paste.splitOffsets[index], paste.splitOffsets[index]),
                            expected: '',
                        }),
                        coordinateSpace: 'current-candidate' as const,
                        newNodeId: allocatedNodeIds[index],
                    }))
                }
                return Object.freeze(intents)
            }
            return Object.freeze(messages.map(message => replacementIntent(message, handle)))
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
