// 本模块固定画布输入白名单、删除边界与组合期状态；DOM 事件接线只消费这些纯决策。

import type {CanvasInputBlockedReason, CanvasInputType} from '../protocol/index.ts'

export interface CanvasTextSelectionSnapshot {
    readonly nodeId: string
    readonly from: number
    readonly to: number
    readonly expected: string
    readonly collapsed: boolean
}

export type CanvasBeforeInputDecision = 'ignore' | 'native-composition' | 'submit' | 'block'

export function canvasBlockedInputDetail(
    inputType: string,
    reason: CanvasInputBlockedReason,
    nodeId: string | null,
): {inputType: string; reason: CanvasInputBlockedReason; nodeId: string | null} {
    return {inputType: inputType.slice(0, 64), reason, nodeId}
}

const beforeInputTypes = new Set<string>([
    'insertText',
    'insertReplacementText',
    'insertParagraph',
    'insertLineBreak',
    'insertFromPaste',
    'deleteContentBackward',
    'deleteContentForward',
    'deleteWordBackward',
    'deleteWordForward',
] satisfies readonly CanvasInputType[])

const nativeCompositionInputTypes = new Set([
    'insertCompositionText',
    'deleteCompositionText',
    'insertFromComposition',
    'deleteByComposition',
])

const splittableKinds = new Set(['paragraph', 'heading', 'list-item'])

export function isCanvasSplittableKind(kind: string | null): boolean {
    return kind !== null && splittableKinds.has(kind)
}

export type CanvasPasteDecision =
    | {readonly kind: 'ignore'}
    | {readonly kind: 'block'; readonly reason: CanvasInputBlockedReason}
    | {readonly kind: 'submit'; readonly text: string}

/** paste 只读取纯文本；富文本、图片和文件没有进入协议的字段。 */
export function canvasPasteDecision(input: {
    editingEnabled: boolean
    editableTarget: boolean
    isComposing: boolean
    selectionValid: boolean
    plainText: string | null
}): CanvasPasteDecision {
    if (!input.editingEnabled || !input.editableTarget) return {kind: 'ignore'}
    if (input.isComposing) return {kind: 'block', reason: 'unsupported-input-type'}
    if (!input.selectionValid || input.plainText === null || input.plainText.length === 0) {
        return {kind: 'block', reason: 'invalid-selection'}
    }
    const text = input.plainText.replace(/\r\n?/gu, '\n')
    return text.length > 65_536
        ? {kind: 'block', reason: 'input-too-large'}
        : {kind: 'submit', text}
}

export function canvasBeforeInputDecision(input: {
    editingEnabled: boolean
    isComposing: boolean
    inputType: string
}): CanvasBeforeInputDecision {
    if (!input.editingEnabled) return 'ignore'
    // WebKit 的旧式组合事件可能晚于 compositionend；各内核时序不同，不能以当前 isComposing 判定。
    if (nativeCompositionInputTypes.has(input.inputType)) return 'native-composition'
    if (input.isComposing) return 'block'
    return beforeInputTypes.has(input.inputType) ? 'submit' : 'block'
}

function previousCodePointOffset(text: string, offset: number): number {
    if (offset <= 0) return 0
    const trailing = text.charCodeAt(offset - 1)
    if (offset > 1 && trailing >= 0xdc00 && trailing <= 0xdfff) {
        const leading = text.charCodeAt(offset - 2)
        if (leading >= 0xd800 && leading <= 0xdbff) return offset - 2
    }
    return offset - 1
}

function nextCodePointOffset(text: string, offset: number): number {
    if (offset >= text.length) return text.length
    const leading = text.charCodeAt(offset)
    if (offset + 1 < text.length && leading >= 0xd800 && leading <= 0xdbff) {
        const trailing = text.charCodeAt(offset + 1)
        if (trailing >= 0xdc00 && trailing <= 0xdfff) return offset + 2
    }
    return offset + 1
}

export function expandCollapsedCanvasDeletion(
    text: string,
    snapshot: CanvasTextSelectionSnapshot,
    inputType: CanvasInputType,
): CanvasTextSelectionSnapshot {
    if (!snapshot.collapsed) return snapshot
    if (inputType.endsWith('Backward')) {
        const from = previousCodePointOffset(text, snapshot.from)
        return {...snapshot, from, expected: text.slice(from, snapshot.to), collapsed: from === snapshot.to}
    }
    if (inputType.endsWith('Forward')) {
        const to = nextCodePointOffset(text, snapshot.to)
        return {...snapshot, to, expected: text.slice(snapshot.from, to), collapsed: snapshot.from === to}
    }
    return snapshot
}

export interface CanvasCompositionTracker {
    readonly isComposing: boolean
    begin(snapshot: CanvasTextSelectionSnapshot): boolean
    finish(text: string): {snapshot: CanvasTextSelectionSnapshot; text: string} | null
    cancel(): void
}

/** 组合期只保存起点；中间态不产生提交，空 compositionend 表示取消。 */
export function createCanvasCompositionTracker(): CanvasCompositionTracker {
    let snapshot: CanvasTextSelectionSnapshot | null = null
    return {
        get isComposing() {
            return snapshot !== null
        },
        begin(next) {
            if (snapshot) return false
            snapshot = next
            return true
        },
        finish(text) {
            const start = snapshot
            snapshot = null
            return start && text.length > 0 ? {snapshot: start, text} : null
        },
        cancel() {
            snapshot = null
        },
    }
}

export function shouldDeferCanvasRender(isComposing: boolean, pendingInputCount: number): boolean {
    return isComposing || pendingInputCount > 0
}
