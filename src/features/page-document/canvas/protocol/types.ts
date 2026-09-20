// 本模块声明隔离画布信封和消息形状；输入消息只携带纯文本范围，不携带或回传画布 DOM。

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

export interface CanvasSetEditingCommand extends CanvasEnvelope {
    type: 'set-editing'
    enabled: boolean
}

export interface CanvasResolveInputCommand extends CanvasEnvelope {
    type: 'resolve-input'
    intentId: string
    accepted: boolean
    /** 结构修改后的可信落点只由宿主返回；画布输入意图没有分配节点身份的权限。 */
    selection: {nodeId: string; offset: number} | null
}

/** 受管原件由宿主解码后传像素；画布不取得 URL、路径或网络读取能力。 */
export interface CanvasAssetFrameCommand extends CanvasEnvelope {
    type: 'asset-frame'
    requestId: string
    assetId: string
    status: 'ready' | 'unavailable' | 'invalid'
    width: number
    height: number
    originalWidth: number
    originalHeight: number
    rgbaBase64: string
}

export type CanvasHostCommand =
    | CanvasRenderCommand
    | CanvasSetSelectionCommand
    | CanvasViewportCommand
    | CanvasSetEditingCommand
    | CanvasResolveInputCommand
    | CanvasAssetFrameCommand

export interface CanvasRenderedMessage extends CanvasEnvelope {
    type: 'rendered'
    requestId: string
    managedNodeCount: number
    missingAssetIds: string[]
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

/** 画布提供的可信文字选区；清空时四个字段回到空选区。 */
export interface CanvasTextSelectionMessage extends CanvasEnvelope {
    type: 'text-selection'
    nodeId: string | null
    from: number
    to: number
    expected: string
}

export interface CanvasNavigationIntentMessage extends CanvasEnvelope {
    type: 'navigation-intent'
    href: string
    nodeId: string | null
}

/** 画布视口坐标；离开时 href、nodeId 和 rect 均为 null。 */
export interface CanvasLinkHoverRect {
    top: number
    left: number
    width: number
    height: number
}

export interface CanvasLinkHoverMessage extends CanvasEnvelope {
    type: 'link-hover'
    href: string | null
    nodeId: string | null
    rect: CanvasLinkHoverRect | null
}

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

export interface CanvasInputResolution {
    readonly accepted: boolean
    readonly selection: {readonly nodeId: string; readonly offset: number} | null
}

export interface CanvasInputBlockedMessage extends CanvasEnvelope {
    type: 'input-blocked'
    nodeId: string | null
    inputType: string
    reason: CanvasInputBlockedReason
}

/** 编辑节点失焦时要求宿主立即冲刷连续输入的尾帧。 */
export interface CanvasInputFlushMessage extends CanvasEnvelope {
    type: 'input-flush'
    nodeId: string
}

/** 画布内快捷键触发的历史操作意图；宿主负责执行并重新渲染。 */
export interface CanvasHistoryIntentMessage extends CanvasEnvelope {
    type: 'history-intent'
    action: 'undo' | 'redo' | 'save'
}

/** 画布内快捷键只请求宿主打开查找；查找界面与索引仍由宿主拥有。 */
export interface CanvasFindIntentMessage extends CanvasEnvelope {
    type: 'find-intent'
    action: 'open'
}

/** 只报告双链候选的纯文本范围；null 表示取消同一意图。 */
export interface CanvasLinkCandidateIntentMessage extends CanvasEnvelope {
    type: 'link-candidate-intent'
    intentId: string
    nodeId: string
    query: string | null
    from: number
    to: number
}

export type CanvasRuntimeMessage =
    | CanvasRenderedMessage
    | CanvasRenderErrorMessage
    | CanvasSizeMessage
    | CanvasSelectionMessage
    | CanvasTextSelectionMessage
    | CanvasNavigationIntentMessage
    | CanvasLinkHoverMessage
    | CanvasInputIntentMessage
    | CanvasInputBlockedMessage
    | CanvasInputFlushMessage
    | CanvasHistoryIntentMessage
    | CanvasFindIntentMessage
    | CanvasLinkCandidateIntentMessage

export interface CanvasMessageEventLike {
    data: unknown
    source: unknown
}
