// 本模块声明隔离画布信封和消息形状；只读运行时不会处理已保留的输入意图消息。

import type {
    CANVAS_INPUT_BLOCKED_REASONS,
    CANVAS_INPUT_TYPES,
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
} from './constants.ts'

export type CanvasInputType = (typeof CANVAS_INPUT_TYPES)[number]
export type CanvasInputBlockedReason = (typeof CANVAS_INPUT_BLOCKED_REASONS)[number]

export interface CanvasEnvelope {
    channel: typeof PAGE_DOCUMENT_CANVAS_CHANNEL
    version: typeof PAGE_DOCUMENT_CANVAS_VERSION
    sessionToken: string
    sequence: number
}

export interface CanvasRenderCommand extends CanvasEnvelope {
    type: 'render'
    requestId: string
    html: string
    css: string
}

export interface CanvasSetSelectionCommand extends CanvasEnvelope {
    type: 'set-selection'
    nodeId: string | null
}

export interface CanvasViewportCommand extends CanvasEnvelope {
    type: 'viewport'
    width: number
    height: number
    pixelRatio: number
}

export type CanvasHostCommand =
    | CanvasRenderCommand
    | CanvasSetSelectionCommand
    | CanvasViewportCommand

export interface CanvasRenderedMessage extends CanvasEnvelope {
    type: 'rendered'
    requestId: string
    managedNodeCount: number
}

export interface CanvasRenderErrorMessage extends CanvasEnvelope {
    type: 'render-error'
    requestId: string
    code: 'invalid-document' | 'runtime-error'
    message: string
}

export interface CanvasSizeMessage extends CanvasEnvelope {
    type: 'size'
    width: number
    height: number
}

export interface CanvasSelectionMessage extends CanvasEnvelope {
    type: 'selection'
    nodeId: string
}

export interface CanvasNavigationIntentMessage extends CanvasEnvelope {
    type: 'navigation-intent'
    href: string
    nodeId: string | null
}

/** 只迁移并校验形状；M6 只读宿主不会消费这个消息。 */
export interface CanvasInputIntentMessage extends CanvasEnvelope {
    type: 'input-intent'
    intentId: string
    nodeId: string
    inputType: CanvasInputType
    from: number
    to: number
    expected: string
    text: string
}

/** 只迁移并校验形状；M6 只读宿主不会消费这个消息。 */
export interface CanvasInputBlockedMessage extends CanvasEnvelope {
    type: 'input-blocked'
    nodeId: string | null
    inputType: string
    reason: CanvasInputBlockedReason
}

export type CanvasRuntimeMessage =
    | CanvasRenderedMessage
    | CanvasRenderErrorMessage
    | CanvasSizeMessage
    | CanvasSelectionMessage
    | CanvasNavigationIntentMessage
    | CanvasInputIntentMessage
    | CanvasInputBlockedMessage

export interface CanvasMessageEventLike {
    data: unknown
    source: unknown
}
