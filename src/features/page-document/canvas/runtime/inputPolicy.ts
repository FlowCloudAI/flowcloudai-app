// 本模块固定画布输入白名单、删除边界与组合期状态；DOM 事件接线只消费这些纯决策。

import type {CanvasInputBlockedReason, CanvasInputType} from '../protocol/index.ts'

export interface CanvasTextSelectionSnapshot {
    readonly nodeId: string
    readonly from: number
    readonly to: number
    readonly expected: string
    readonly collapsed: boolean
}

export type CanvasBeforeInputDecision = 'ignore' | 'native-composition' | 'paste-owned' | 'submit' | 'block'

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
    'deleteContentBackward',
    'deleteContentForward',
    'deleteWordBackward',
    'deleteWordForward',
    'deleteSoftLineBackward',
    'deleteSoftLineForward',
    'deleteHardLineBackward',
    'deleteHardLineForward',
    'deleteByCut',
    'deleteContent',
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

export interface CanvasEnterIntent {
    readonly inputType: 'insertParagraph' | 'insertLineBreak'
    readonly text: '' | '\n'
}

/**
 * 文本块模型把块内换行视为高频文本操作、拆块视为低频结构操作，因此 Enter 换行、Shift+Enter 拆块。
 * 这套分工有意不同于 Word、Docs，且必须由 keydown 归一，不能信任 WebKit 对 beforeinput.inputType 的平台映射。
 */
export function canvasEnterIntent(kind: string | null, shiftKey: boolean): CanvasEnterIntent {
    return shiftKey && isCanvasSplittableKind(kind)
        ? {inputType: 'insertParagraph', text: ''}
        : {inputType: 'insertLineBreak', text: '\n'}
}

export type CanvasKeyboardIntent = 'undo' | 'redo' | 'save' | 'find'

export function canvasKeyboardIntent(input: {
    readonly key: string
    readonly metaKey: boolean
    readonly ctrlKey: boolean
    readonly altKey: boolean
    readonly shiftKey: boolean
    readonly isComposing: boolean
    readonly defaultPrevented: boolean
}): CanvasKeyboardIntent | null {
    if (input.defaultPrevented || input.isComposing || input.altKey || !(input.metaKey || input.ctrlKey)) return null
    const key = input.key.toLowerCase()
    if (key === 'z') return input.shiftKey ? 'redo' : 'undo'
    if (key === 'y' && !input.shiftKey) return 'redo'
    if (key === 's' && !input.shiftKey) return 'save'
    if (key === 'f' && !input.shiftKey) return 'find'
    return null
}

/** DOM 重挂后按当前语义文本刷新 expected；节点或区间失效时不伪造选区。 */
export function refreshCanvasTextSelection(
    snapshot: CanvasTextSelectionSnapshot | null,
    currentText: string | null,
): CanvasTextSelectionSnapshot | null {
    if (!snapshot || currentText === null || snapshot.from < 0 || snapshot.to < snapshot.from
        || snapshot.to > currentText.length) return null
    return {
        ...snapshot,
        expected: currentText.slice(snapshot.from, snapshot.to),
        collapsed: snapshot.from === snapshot.to,
    }
}

export interface CanvasSelectionReportGate {
    readonly suppressed: boolean
    beginRender(): void
    finishRender(report: () => void): void
    cancelRender(): void
}

/** DOM 重挂引发的 selectionchange 不代表作者取消选择；只在下一绘制帧回报稳定落点。 */
export function createCanvasSelectionReportGate(
    schedule: (callback: () => void) => void,
): CanvasSelectionReportGate {
    let generation = 0
    let suppressed = false
    return {
        get suppressed() {
            return suppressed
        },
        beginRender() {
            generation += 1
            suppressed = true
        },
        finishRender(report) {
            const expectedGeneration = generation
            schedule(() => {
                if (!suppressed || generation !== expectedGeneration) return
                suppressed = false
                report()
            })
        },
        cancelRender() {
            generation += 1
            suppressed = false
        },
    }
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
    // paste 事件是唯一读取 clipboardData 并提交纯文本的入口；beforeinput 只阻止浏览器重复写入。
    if (input.inputType === 'insertFromPaste') return 'paste-owned'
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
    softLineRange: CanvasTextSelectionSnapshot | null = null,
): CanvasTextSelectionSnapshot {
    if (!snapshot.collapsed) return snapshot
    if (inputType === 'deleteSoftLineBackward' || inputType === 'deleteSoftLineForward') {
        if (softLineRange && softLineRange.nodeId === snapshot.nodeId) return softLineRange
        const boundary = inputType.endsWith('Backward')
            ? text.lastIndexOf('\n', Math.max(0, snapshot.from - 1)) + 1
            : (() => {
                const nextLineBreak = text.indexOf('\n', snapshot.to)
                return nextLineBreak < 0 ? text.length : nextLineBreak
            })()
        return inputType.endsWith('Backward')
            ? {...snapshot, from: boundary, expected: text.slice(boundary, snapshot.to), collapsed: boundary === snapshot.to}
            : {...snapshot, to: boundary, expected: text.slice(snapshot.from, boundary), collapsed: snapshot.from === boundary}
    }
    if (inputType === 'deleteHardLineBackward') {
        const from = text.lastIndexOf('\n', Math.max(0, snapshot.from - 1)) + 1
        return {...snapshot, from, expected: text.slice(from, snapshot.to), collapsed: from === snapshot.to}
    }
    if (inputType === 'deleteHardLineForward') {
        const nextLineBreak = text.indexOf('\n', snapshot.to)
        const to = nextLineBreak < 0 ? text.length : nextLineBreak
        return {...snapshot, to, expected: text.slice(snapshot.from, to), collapsed: snapshot.from === to}
    }
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
