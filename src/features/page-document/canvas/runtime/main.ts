// 本模块启动独立画布页；可信命令可授予受限文本编辑，作者 DOM 始终只是可回滚的临时视图。

import {RFC_9562_UUID_PATTERN} from '../../domain/uuidPolicy.ts'
import {
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
    CANVAS_ASSET_REQUEST_MAX_COUNT,
    parseCanvasHostCommand,
    type CanvasInputIntentMessage,
    type CanvasInputType,
    type CanvasRenderCommand,
    type CanvasRuntimeMessage,
} from '../protocol/index.ts'
import {measureCanvasContentSize} from './contentSize.ts'
import {applyCanvasEditingState, isCanvasEditableElement} from './editingState.ts'
import {
    canvasBeforeInputDecision,
    canvasBlockedInputDetail,
    canvasEnterIntent,
    canvasKeyboardIntent,
    canvasPasteDecision,
    createCanvasCompositionTracker,
    createCanvasSelectionReportGate,
    expandCollapsedCanvasDeletion,
    isCanvasSplittableKind,
    refreshCanvasTextSelection,
    shouldDeferCanvasRender,
    type CanvasTextSelectionSnapshot,
} from './inputPolicy.ts'
import {isolatePageDocument} from './isolationPolicy.ts'
import {
    applyCanvasAssetFrame,
    CanvasAssetImageCache,
    missingCanvasAssetIds,
    mountCanvasAssetDisplays,
    type CanvasAssetDisplays,
} from './assetDisplay.ts'
import {createCanvasLinkCandidateTracker} from './linkCandidate.ts'
import {createCanvasLinkHoverTracker} from './linkHover.ts'
import {requireCanvasStartupContext, startCanvasRuntimeWhenReady} from './startup.ts'
import {mountCanvasStyles} from './styleMount.ts'
import {
    applyPendingCanvasInputRender,
    restoreCanvasResolvedSelection,
    type CanvasResolvedSelection,
} from './resolvedSelection.ts'
import {locateTextOffset, semanticOffset, semanticText} from './semanticTextPosition.ts'
import {createCanvasCaretStoredMarksState} from './caretStoredMarks.ts'
import {createCaretAnchor, findCaretAnchors, removeCaretAnchor} from './caretAnchor.ts'
import {createCanvasDebugTrace, describeDomPosition} from './debugTrace.ts'
import {
    absorbableEchoElement,
    buildOptimisticTextFragment,
    echoInsertionPoint,
    storedMarkStyle,
} from './storedMarkEcho.ts'
import runtimeCss from './runtime.css?inline'

let token: string
let root: HTMLElement
let authorStyle: HTMLStyleElement
let outgoingSequence = 0
let incomingSequence = 0
let selectedNodeId: string | null = null
let latestRequestId: string | null = null
let assetDisplays: CanvasAssetDisplays = new Map()
const assetCache = new CanvasAssetImageCache()
let editingEnabled = false
let pendingRender: CanvasRenderCommand | null = null
let rejectedInputPending = false
let compositionOriginalNode: HTMLElement | null = null
let compositionNodeId: string | null = null
let pendingResolvedSelection: CanvasResolvedSelection | null = null
let lastTextSelectionKey: string | null = null
const pendingInputIds = new Set<string>()
const caretState = createCanvasCaretStoredMarksState()
const composition = createCanvasCompositionTracker()
const selectionReportGate = createCanvasSelectionReportGate(callback => requestAnimationFrame(callback))
const linkCandidate = createCanvasLinkCandidateTracker()
const linkHover = createCanvasLinkHoverTracker()
const debugTrace = createCanvasDebugTrace(entries => send({type: 'debug-log', entries}))
let debugFocusNodeId: string | null = null
let debugLastNodeHtml = ''
let debugObserver: MutationObserver | null = null

type RuntimePayload = CanvasRuntimeMessage extends infer Message
    ? Message extends CanvasRuntimeMessage
        ? Omit<Message, 'channel' | 'version' | 'sessionToken' | 'sequence'>
        : never
    : never

function send(payload: RuntimePayload): void {
    parent.postMessage({
        channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
        version: PAGE_DOCUMENT_CANVAS_VERSION,
        sessionToken: token,
        sequence: ++outgoingSequence,
        ...payload,
    }, '*')
}

function managedNode(value: EventTarget | Node | null): HTMLElement | null {
    const element = value instanceof Element
        ? value
        : value instanceof Node
          ? value.parentElement
          : null
    return element?.closest<HTMLElement>('[data-fc-node-id]') ?? null
}

function managedNodeId(value: Element | null): string | null {
    const nodeId = value?.getAttribute('data-fc-node-id')
    return nodeId && RFC_9562_UUID_PATTERN.test(nodeId) ? nodeId.toLowerCase() : null
}

function findManagedNode(nodeId: string | null): HTMLElement | null {
    if (!nodeId || !RFC_9562_UUID_PATTERN.test(nodeId)) return null
    return [...root.querySelectorAll<HTMLElement>('[data-fc-node-id]')]
        .find(node => managedNodeId(node) === nodeId.toLowerCase()) ?? null
}

function setSelection(nodeId: string | null, restoredByRuntime = false): void {
    const normalizedNodeId = nodeId?.toLowerCase() ?? null
    if (selectedNodeId !== normalizedNodeId) {
        const textSelection = captureSelection()
        if (textSelection && textSelection.nodeId !== normalizedNodeId) getSelection()?.removeAllRanges()
        const focusedNode = managedNode(document.activeElement)
        const focusedNodeId = managedNodeId(focusedNode)
        if (focusedNodeId && focusedNodeId !== normalizedNodeId && focusedNode instanceof HTMLElement) {
            focusedNode.blur()
        }
        if (!restoredByRuntime) caretState.observeSelection(null)
    }
    findManagedNode(selectedNodeId)?.removeAttribute('data-fc-canvas-selected')
    selectedNodeId = normalizedNodeId
    findManagedNode(selectedNodeId)?.setAttribute('data-fc-canvas-selected', '')
}

function reportSize(): void {
    const size = measureCanvasContentSize(root)
    send({type: 'size', width: size.width, height: size.height})
}

function clearRenderedDocument(): void {
    const candidateLeave = linkCandidate.clear()
    if (candidateLeave) send(candidateLeave)
    const leave = linkHover.clear()
    if (leave) send(leave)
    clearTextSelection()
    authorStyle.textContent = ''
    root.replaceChildren()
    assetDisplays = new Map()
    selectedNodeId = null
    pendingResolvedSelection = null
    reportSize()
}

function debugSelectionSummary(): Record<string, unknown> {
    const selection = getSelection()
    if (!selection || selection.rangeCount === 0) return {dom: '无选区'}
    const range = selection.getRangeAt(0)
    const scope = managedNode(range.startContainer)
    return {
        start: describeDomPosition(scope, range.startContainer, range.startOffset),
        end: range.collapsed ? '同起点' : describeDomPosition(scope, range.endContainer, range.endOffset),
        semantic: captureSelection(),
        activeElement: managedNodeId(managedNode(document.activeElement)),
    }
}

function debugState(): Record<string, unknown> {
    return {
        storedMarks: caretState.storedMarks,
        caret: caretState.selection,
        composing: composition.isComposing,
        pendingInputs: pendingInputIds.size,
        pendingRender: pendingRender?.requestId ?? null,
        pendingResolvedSelection,
        gateSuppressed: selectionReportGate.suppressed,
    }
}

function debugSnapshotFocusedNode(reason: string): void {
    if (!debugTrace.enabled || !debugFocusNodeId) return
    const node = findManagedNode(debugFocusNodeId)
    const html = node ? node.outerHTML : '(节点不在画布中)'
    if (html === debugLastNodeHtml) return
    debugLastNodeHtml = html
    debugTrace.trace('dom', {reason, nodeId: debugFocusNodeId, text: node ? semanticText(node) : null, html})
}

function debugFocus(value: EventTarget | Node | null): void {
    if (!debugTrace.enabled) return
    const nodeId = managedNodeId(managedNode(value))
    if (!nodeId || nodeId === debugFocusNodeId) return
    debugFocusNodeId = nodeId
    debugLastNodeHtml = ''
    debugTrace.trace('focus-node', {nodeId})
    debugSnapshotFocusedNode('开始监听')
}

function setDebug(enabled: boolean): void {
    debugObserver?.disconnect()
    debugObserver = null
    debugFocusNodeId = null
    debugLastNodeHtml = ''
    debugTrace.setEnabled(enabled)
    if (!enabled) return
    debugTrace.trace('debug-on', {editingEnabled, selectedNodeId, userAgent: navigator.userAgent, ...debugState()})
    debugObserver = new MutationObserver(records => {
        if (!debugFocusNodeId) return
        const node = findManagedNode(debugFocusNodeId)
        const relevant = records.filter(record => record.target === root || (node?.contains(record.target) ?? false))
        if (relevant.length === 0) return
        debugTrace.trace('mutations', relevant.slice(0, 24).map(record => ({
            type: record.type,
            target: describeDomPosition(node, record.target, 0),
            attribute: record.attributeName,
            old: record.oldValue,
            added: record.addedNodes.length,
            removed: record.removedNodes.length,
        })))
        debugSnapshotFocusedNode('DOM 变化')
    })
    debugObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
        attributes: true,
        attributeOldValue: true,
    })
    debugFocus(getSelection()?.anchorNode ?? document.activeElement)
}

function applyRender(
    command: CanvasRenderCommand,
    resolvedSelection: CanvasResolvedSelection | null = null,
): void {
    const leave = linkHover.clear()
    if (leave) send(leave)
    latestRequestId = command.requestId
    // 晚于输入回执到达的规范化预览仍需挂载；先记住纯文本选区，避免全量安全挂载打断连续输入。
    const textSelection = editingEnabled && !resolvedSelection
        ? captureSelection() ?? caretState.selection
        : null
    const result = isolatePageDocument(command.html, command.css)
    if (!result.artifact) {
        clearRenderedDocument()
        send({
            type: 'render-error',
            requestId: command.requestId,
            code: 'invalid-document',
            message: result.errors.join(' ').slice(0, 2_048),
        })
        return
    }
    debugTrace.trace('applyRender', {requestId: command.requestId, resolvedSelection, textSelection, ...debugState()})
    selectionReportGate.beginRender()
    try {
        const template = document.createElement('template')
        template.innerHTML = result.artifact.html
        authorStyle.textContent = result.artifact.css
        root.replaceChildren(template.content.cloneNode(true))
        assetDisplays = mountCanvasAssetDisplays(root, assetCache)
        const missingAssetIds = missingCanvasAssetIds(assetDisplays, assetCache)
        if (missingAssetIds.length > CANVAS_ASSET_REQUEST_MAX_COUNT) throw new Error('画布图片引用超过上限。')
        applyCanvasEditingState(root, editingEnabled)
        setSelection(resolvedSelection?.nodeId ?? selectedNodeId, resolvedSelection !== null)
        let restoredSelection: CanvasTextSelectionSnapshot | null = null
        if (resolvedSelection) {
            // 延迟队列可能先挂上一帧不含新块的预览；目标出现前不消耗宿主落点。
            const restoration = restoreCanvasResolvedSelection(
                resolvedSelection,
                findManagedNode,
                restoreTextSelection,
            )
            restoredSelection = restoration.restoredSelection
            pendingResolvedSelection = restoration.pendingSelection
        } else if (textSelection && restoreTextSelection(textSelection)) {
            restoredSelection = textSelection
        }
        const shouldReportSelection = pendingResolvedSelection === null
        debugTrace.trace('applyRender:done', {requestId: command.requestId, restoredSelection, pendingResolvedSelection, selection: debugSelectionSummary()})
        selectionReportGate.finishRender(() => {
            if (shouldReportSelection) reportTextSelection(restoredSelection, true, true)
        })
        send({
            type: 'rendered',
            requestId: command.requestId,
            managedNodeCount: result.artifact.managedNodeCount,
            missingAssetIds,
        })
        reportSize()
    } catch (error) {
        clearRenderedDocument()
        send({
            type: 'render-error',
            requestId: command.requestId,
            code: 'runtime-error',
            message: String(error).slice(0, 2_048),
        })
    }
}

function render(command: CanvasRenderCommand): void {
    if (shouldDeferCanvasRender(composition.isComposing, pendingInputIds.size)) {
        debugTrace.trace('render:deferred', {requestId: command.requestId, replaced: pendingRender?.requestId ?? null, ...debugState()})
        pendingRender = command
        return
    }
    const resolvedSelection = pendingResolvedSelection
    pendingResolvedSelection = null
    applyRender(command, resolvedSelection)
}

function captureTextRange(
    startContainer: Node,
    startOffset: number,
    endContainer: Node,
    endOffset: number,
): CanvasTextSelectionSnapshot | null {
    const startNode = managedNode(startContainer)
    const endNode = managedNode(endContainer)
    const nodeId = startNode === endNode ? managedNodeId(startNode) : null
    if (!startNode || !nodeId || !isCanvasEditableElement(startNode)) return null
    const from = semanticOffset(startNode, startContainer, startOffset)
    const to = semanticOffset(startNode, endContainer, endOffset)
    if (from === null || to === null || to < from) return null
    return {
        nodeId,
        from,
        to,
        expected: semanticText(startNode).slice(from, to),
        collapsed: from === to,
    }
}

function captureSelection(): CanvasTextSelectionSnapshot | null {
    const selection = getSelection()
    if (!selection || selection.rangeCount !== 1) return null
    const range = selection.getRangeAt(0)
    return captureTextRange(range.startContainer, range.startOffset, range.endContainer, range.endOffset)
}

function reportLinkCandidate(): void {
    if (!editingEnabled || composition.isComposing) return
    const selection = captureSelection()
    const node = selection?.collapsed ? findManagedNode(selection.nodeId) : null
    const snapshot = selection && node
        ? {nodeId: selection.nodeId, text: semanticText(node), caret: selection.from}
        : null
    for (const intent of linkCandidate.update(snapshot)) send(intent)
}

function refreshedTextSelection(snapshot: CanvasTextSelectionSnapshot | null): CanvasTextSelectionSnapshot | null {
    const node = snapshot ? findManagedNode(snapshot.nodeId) : null
    return refreshCanvasTextSelection(snapshot, node ? semanticText(node) : null)
}

function reportTextSelection(
    fallback: CanvasTextSelectionSnapshot | null = null,
    force = false,
    restoredByRuntime = false,
): void {
    if (!editingEnabled || composition.isComposing) return
    const selection = refreshedTextSelection(captureSelection() ?? fallback)
    const marksBefore = caretState.storedMarks
    if (selection && restoredByRuntime) caretState.restoreSelection(selection)
    else caretState.observeSelection(selection)
    if (marksBefore && !caretState.storedMarks) {
        debugTrace.trace('marks-cleared', {by: '选区观察', selection, restoredByRuntime})
    }
    syncCaretAnchor(selection)
    const storedMarks = selection ? caretState.storedMarks : null
    const key = selection
        ? `${selection.nodeId}:${selection.from}:${selection.to}:${selection.expected}:${JSON.stringify(storedMarks)}`
        : null
    if (!force && key === lastTextSelectionKey) return
    lastTextSelectionKey = key
    if (!selection) {
        send({type: 'text-selection', nodeId: null, from: 0, to: 0, expected: '', storedMarks: null})
        return
    }
    // 折叠光标同样是字体工具的可信上下文；切到宿主工具栏时必须保留，供后续输入格式继续使用。
    debugTrace.trace('send:text-selection', {selection, storedMarks, restoredByRuntime})
    send({
        type: 'text-selection',
        nodeId: selection.nodeId,
        from: selection.from,
        to: selection.to,
        expected: selection.expected,
        storedMarks,
    })
}

function clearTextSelection(): void {
    selectionReportGate.cancelRender()
    caretState.exitEditing()
    syncCaretAnchor(null)
    if (lastTextSelectionKey === null) return
    lastTextSelectionKey = null
    send({type: 'text-selection', nodeId: null, from: 0, to: 0, expected: '', storedMarks: null})
}

function captureInputRange(event: InputEvent): CanvasTextSelectionSnapshot | null {
    const range = event.getTargetRanges?.()[0]
    return range
        ? captureTextRange(range.startContainer, range.startOffset, range.endContainer, range.endOffset)
        : captureSelection()
}

/** WebKit 未给 target range 时，用原生视觉行边界补齐软行删除；随后恢复原光标，避免污染乐观写回。 */
function captureSoftLineDeletionRange(
    snapshot: CanvasTextSelectionSnapshot,
    inputType: CanvasInputType,
): CanvasTextSelectionSnapshot | null {
    if (!snapshot.collapsed || (inputType !== 'deleteSoftLineBackward' && inputType !== 'deleteSoftLineForward')) {
        return null
    }
    const selection = getSelection()
    if (!selection || selection.rangeCount !== 1 || typeof selection.modify !== 'function') return null
    const original = selection.getRangeAt(0).cloneRange()
    selection.modify(
        'extend',
        inputType === 'deleteSoftLineBackward' ? 'backward' : 'forward',
        'lineboundary',
    )
    const expanded = captureSelection()
    selection.removeAllRanges()
    selection.addRange(original)
    return expanded?.nodeId === snapshot.nodeId ? expanded : null
}

function restoreTextSelection(snapshot: CanvasTextSelectionSnapshot): boolean {
    const node = findManagedNode(snapshot.nodeId)
    const current = node ? semanticText(node) : ''
    if (!node || snapshot.to > current.length) return false
    const start = locateTextOffset(node, snapshot.from)
    const end = locateTextOffset(node, snapshot.to)
    const selection = getSelection()
    if (!start || !end || !selection) return false
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    selection.removeAllRanges()
    selection.addRange(range)
    syncCaretAnchor(snapshot)
    return true
}

function placeCaretInAnchor(anchor: Element): boolean {
    const filler = anchor.firstChild
    const selection = getSelection()
    if (!filler || !selection) return false
    const end = filler.textContent?.length ?? 0
    if (selection.rangeCount === 1) {
        const current = selection.getRangeAt(0)
        if (current.collapsed && current.startContainer === filler && current.startOffset === end) return false
    }
    selection.collapse(filler, end)
    return true
}

/**
 * 让 DOM 光标与待输入标记一致：有标记且光标折叠时，光标停在带同一声明的锚点里，
 * 使原生绘制的光标与输入法候选文字直接呈现所设格式；否则移除全部锚点。
 * 已经一致时不改动 DOM，selectionchange 因此不会反复触发。组合期间锚点由输入法占用，不动它。
 */
function syncCaretAnchor(target: CanvasTextSelectionSnapshot | null = caretState.selection): void {
    if (composition.isComposing) return
    const style = editingEnabled && target?.collapsed ? storedMarkStyle(caretState.storedMarks) : null
    const node = style && target ? findManagedNode(target.nodeId) : null
    const editable = isCanvasEditableElement(node) ? node : null
    const anchors = findCaretAnchors(root)
    const current = anchors.length === 1 ? anchors[0] : null
    if (
        style && target && editable && current && editable.contains(current)
        && current.getAttribute('style') === style
        && semanticOffset(editable, current, 0) === target.from
    ) {
        if (placeCaretInAnchor(current)) debugTrace.trace('anchor:recaret', {target})
        return
    }
    if (anchors.length > 0) debugTrace.trace('anchor:remove', {count: anchors.length, target, style})
    for (const anchor of anchors) {
        const parent = anchor.parentNode
        removeCaretAnchor(anchor)
        parent?.normalize()
    }
    if (!style || !target || !editable) return
    const position = locateTextOffset(editable, target.from)
    if (!position) return
    const {anchor} = createCaretAnchor(document, style)
    const range = document.createRange()
    range.setStart(position.node, position.offset)
    range.collapse(true)
    range.insertNode(anchor)
    placeCaretInAnchor(anchor)
    debugTrace.trace('anchor:insert', {target, style, at: describeDomPosition(editable, position.node, position.offset)})
}

function applyOptimisticTextEdit(snapshot: CanvasTextSelectionSnapshot, text: string): boolean {
    const node = findManagedNode(snapshot.nodeId)
    if (!isCanvasEditableElement(node)) return false
    const current = semanticText(node)
    if (snapshot.to > current.length || current.slice(snapshot.from, snapshot.to) !== snapshot.expected) return false
    const start = locateTextOffset(node, snapshot.from)
    const end = locateTextOffset(node, snapshot.to)
    if (!start || !end) return false
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    range.deleteContents()
    if (text.length > 0) {
        // 标记集必须在本地先画出来：否则第一帧是文本块默认格式，等权威渲染回来才变，肉眼可见跳变。
        const style = storedMarkStyle(caretState.storedMarks)
        const insertion = echoInsertionPoint(range.startContainer, range.startOffset)
        const absorbed = insertion && absorbableEchoElement(insertion.parentNode, insertion.index, style)
        const fragment = buildOptimisticTextFragment(document, text, absorbed ? null : style)
        debugTrace.trace('echo', {snapshot, text, style, absorbed: Boolean(absorbed), at: describeDomPosition(node, range.startContainer, range.startOffset)})
        if (absorbed) {
            while (fragment.firstChild) absorbed.appendChild(fragment.firstChild)
        } else {
            range.insertNode(fragment)
        }
    }
    node.normalize()
    const caret = snapshot.from + text.length
    const restoredCaret = {
        nodeId: snapshot.nodeId,
        from: caret,
        to: caret,
        expected: '',
        collapsed: true,
    }
    restoreTextSelection(restoredCaret)
    caretState.restoreSelection(restoredCaret)
    reportSize()
    return true
}

function reportBlockedInput(inputType: string, reason: 'invalid-selection' | 'unsupported-input-type' | 'input-too-large', nodeId: string | null): void {
    send({
        type: 'input-blocked',
        ...canvasBlockedInputDetail(
            inputType,
            reason,
            nodeId && RFC_9562_UUID_PATTERN.test(nodeId) ? nodeId.toLowerCase() : null,
        ),
    })
}

function submitInputIntent(
    snapshot: CanvasTextSelectionSnapshot,
    inputType: CanvasInputType,
    text: string,
): boolean {
    if (snapshot.expected.length > 65_536 || text.length > 65_536) {
        reportBlockedInput(inputType, 'input-too-large', snapshot.nodeId)
        return false
    }
    if (!applyOptimisticTextEdit(snapshot, text)) {
        debugTrace.trace('echo:rejected', {inputType, snapshot, text, selection: debugSelectionSummary()})
        reportBlockedInput(inputType, 'invalid-selection', snapshot.nodeId)
        return false
    }
    const intentId = crypto.randomUUID()
    pendingInputIds.add(intentId)
    debugTrace.trace('send:input-intent', {intentId, inputType, snapshot, text, storedMarks: caretState.storedMarks})
    send({
        type: 'input-intent',
        intentId,
        nodeId: snapshot.nodeId,
        inputType,
        from: snapshot.from,
        to: snapshot.to,
        expected: snapshot.expected,
        text,
        storedMarks: caretState.storedMarks,
    } satisfies Omit<CanvasInputIntentMessage, 'channel' | 'version' | 'sessionToken' | 'sequence'>)
    // beforeinput 已拦截原生写入；手动更新 DOM 后不会再有对应的 input 事件。
    if (inputType === 'insertParagraph') {
        const leave = linkCandidate.clear()
        if (leave) send(leave)
    } else reportLinkCandidate()
    return true
}

function restoreCompositionStart(): void {
    if (!compositionOriginalNode || !compositionNodeId) return
    const current = findManagedNode(compositionNodeId)
    if (current) current.replaceWith(compositionOriginalNode)
    compositionOriginalNode = null
    applyCanvasEditingState(root, editingEnabled)
    setSelection(compositionNodeId)
}

function releasePendingRenderAfterComposition(submitted: boolean): void {
    if (submitted || pendingInputIds.size > 0 || !pendingRender) return
    const next = pendingRender
    pendingRender = null
    applyRender(next)
}

function setEditing(enabled: boolean): void {
    if (editingEnabled !== enabled) {
        const candidateLeave = linkCandidate.clear()
        if (candidateLeave) send(candidateLeave)
        const leave = linkHover.clear()
        if (leave) send(leave)
        clearTextSelection()
    }
    editingEnabled = enabled
    if (!enabled && composition.isComposing) {
        composition.cancel()
        restoreCompositionStart()
        releasePendingRenderAfterComposition(false)
    }
    if (!enabled) pendingResolvedSelection = null
    applyCanvasEditingState(root, editingEnabled)
}

function resolveInput(
    intentId: string,
    accepted: boolean,
    selection: {nodeId: string; offset: number} | null,
): void {
    if (!pendingInputIds.delete(intentId.toLowerCase())) {
        const candidate = linkCandidate.accept(intentId)
        if (!candidate) return
        if (accepted && selection?.nodeId === candidate.nodeId) {
            pendingResolvedSelection = selection
            const node = findManagedNode(selection.nodeId)
            if (node && !semanticText(node).slice(candidate.from).startsWith('[[')) {
                node.focus({preventScroll: true})
                restoreTextSelection({nodeId: selection.nodeId, from: selection.offset, to: selection.offset, expected: '', collapsed: true})
                pendingResolvedSelection = null
            }
        }
        return
    }
    if (!accepted) rejectedInputPending = true
    if (accepted && selection) pendingResolvedSelection = selection
    debugTrace.trace('resolve-input', {intentId, accepted, selection, ...debugState(), rejectedInputPending})
    if (pendingInputIds.size > 0 || composition.isComposing) return
    const next = pendingRender
    pendingRender = null
    if (applyPendingCanvasInputRender(
        next,
        rejectedInputPending,
        pendingResolvedSelection,
        applyRender,
    )) {
        pendingResolvedSelection = null
    }
    rejectedInputPending = false
}

/** 仅供调试浮层的原生事件记录；捕获阶段注册，先于业务处理器看到事件原貌。 */
function installDebugListeners(): void {
    const keyDetail = (event: KeyboardEvent) => ({
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        repeat: event.repeat,
        eventComposing: event.isComposing,
        modifiers: [event.metaKey && 'meta', event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift']
            .filter(Boolean),
        target: managedNodeId(managedNode(event.target)),
    })
    document.addEventListener('keydown', event => {
        if (debugTrace.enabled) debugTrace.trace('keydown', keyDetail(event))
    }, true)
    document.addEventListener('keyup', event => {
        if (debugTrace.enabled) debugTrace.trace('keyup', keyDetail(event))
    }, true)
    document.addEventListener('input', event => {
        if (!debugTrace.enabled) return
        const input = event as InputEvent
        debugTrace.trace('input', {inputType: input.inputType, data: input.data, eventComposing: input.isComposing})
    }, true)
    document.addEventListener('compositionupdate', event => {
        if (debugTrace.enabled) debugTrace.trace('compositionupdate', {data: event.data, selection: debugSelectionSummary()})
    }, true)
    document.addEventListener('focusin', event => {
        if (!debugTrace.enabled) return
        debugTrace.trace('focusin', {target: managedNodeId(managedNode(event.target))})
        debugFocus(event.target)
    }, true)
    document.addEventListener('focusout', event => {
        if (debugTrace.enabled) debugTrace.trace('focusout', {target: managedNodeId(managedNode(event.target))})
    }, true)
    document.addEventListener('pointerdown', event => {
        if (!debugTrace.enabled) return
        debugTrace.trace('pointerdown', {target: managedNodeId(managedNode(event.target)), x: event.clientX, y: event.clientY})
        debugFocus(event.target)
    }, true)
}

function installInputListeners(): void {
    document.addEventListener('beforeinput', event => {
        const node = managedNode(event.target)
        const nodeId = managedNodeId(node)
        if (!isCanvasEditableElement(node) || !nodeId) return
        const inputType = event.inputType || ''
        const decision = canvasBeforeInputDecision({
            editingEnabled,
            isComposing: composition.isComposing,
            inputType,
        })
        debugTrace.trace('beforeinput', {
            inputType,
            data: event.data,
            decision,
            eventComposing: event.isComposing,
            cancelable: event.cancelable,
            selection: debugTrace.enabled ? debugSelectionSummary() : null,
        })
        if (decision === 'ignore' || decision === 'native-composition') return
        if (decision === 'paste-owned') {
            event.preventDefault()
            return
        }
        if (decision === 'block') {
            event.preventDefault()
            reportBlockedInput(inputType, 'unsupported-input-type', nodeId)
            return
        }
        let snapshot = captureInputRange(event)
        if (!snapshot || snapshot.nodeId !== nodeId) {
            event.preventDefault()
            reportBlockedInput(inputType, 'invalid-selection', nodeId)
            return
        }
        let text = ''
        if (inputType.startsWith('delete')) {
            const typedInput = inputType as CanvasInputType
            const hasTargetRange = (event.getTargetRanges?.().length ?? 0) > 0
            const softLineRange = hasTargetRange ? null : captureSoftLineDeletionRange(snapshot, typedInput)
            snapshot = expandCollapsedCanvasDeletion(semanticText(node), snapshot, typedInput, softLineRange)
        } else if (inputType === 'insertParagraph') {
            if (!isCanvasSplittableKind(node.getAttribute('data-fc-node-kind'))) {
                event.preventDefault()
                reportBlockedInput(inputType, 'unsupported-input-type', nodeId)
                return
            }
            if (!snapshot.collapsed) {
                event.preventDefault()
                reportBlockedInput(inputType, 'invalid-selection', nodeId)
                return
            }
        } else if (inputType === 'insertLineBreak') {
            text = '\n'
        } else if (typeof event.data === 'string') {
            text = event.data
        } else {
            event.preventDefault()
            reportBlockedInput(inputType, 'invalid-selection', nodeId)
            return
        }
        event.preventDefault()
        submitInputIntent(snapshot, inputType as CanvasInputType, text)
    })

    document.addEventListener('input', event => {
        if (editingEnabled && isCanvasEditableElement(managedNode(event.target))) reportLinkCandidate()
    })

    document.addEventListener('selectionchange', () => {
        if (debugTrace.enabled) {
            debugFocus(getSelection()?.anchorNode ?? null)
            debugTrace.trace('selectionchange', {...debugSelectionSummary(), gateSuppressed: selectionReportGate.suppressed, composing: composition.isComposing})
        }
        if (editingEnabled && !composition.isComposing && !selectionReportGate.suppressed) {
            // WebKit 在焦点移向宿主工具栏的瞬间可能暂时读不到 Range；保留上一次
            // 已认证选区，直到明确采集到新选区或会话主动清除。
            reportTextSelection(caretState.selection)
            reportLinkCandidate()
        }
    })

    const reportSettledTextSelection = () => {
        const fallback = caretState.selection
        requestAnimationFrame(() => {
            if (!selectionReportGate.suppressed) reportTextSelection(fallback, true)
        })
    }
    document.addEventListener('pointerup', reportSettledTextSelection)
    document.addEventListener('pointercancel', reportSettledTextSelection)
    document.addEventListener('pointerdown', event => {
        if (editingEnabled && isCanvasEditableElement(managedNode(event.target))) {
            if (caretState.storedMarks) debugTrace.trace('marks-cleared', {by: '指针'})
            caretState.authorPointer()
            syncCaretAnchor(null)
        }
    })

    document.addEventListener('compositionstart', event => {
        const candidateLeave = linkCandidate.clear()
        if (candidateLeave) send(candidateLeave)
        const leave = linkHover.clear()
        if (leave) send(leave)
        // 输入法候选文字尚未进入作者源码，组合期间也不会上报其临时 DOM 选区。
        // 保留组合开始前的可信光标，宿主才能把待输入格式应用到 compositionend 的最终文字。
        if (!editingEnabled || composition.isComposing) return
        const node = managedNode(event.target)
        const nodeId = managedNodeId(node)
        const snapshot = captureSelection()
        if (!isCanvasEditableElement(node) || !nodeId || !snapshot || snapshot.nodeId !== nodeId) {
            reportBlockedInput('insertCompositionText', 'invalid-selection', nodeId)
            return
        }
        caretState.beginComposition(nodeId)
        debugTrace.trace('compositionstart', {data: event.data, snapshot, selection: debugTrace.enabled ? debugSelectionSummary() : null, ...debugState()})
        if (!composition.begin(snapshot)) return
        compositionOriginalNode = node.cloneNode(true) as HTMLElement
        compositionNodeId = nodeId
    })

    document.addEventListener('compositionend', event => {
        if (!composition.isComposing) return
        debugTrace.trace('compositionend', {data: event.data, selection: debugSelectionSummary()})
        const result = composition.finish(event.data ?? '')
        restoreCompositionStart()
        const submitted = result
            ? submitInputIntent(result.snapshot, 'insertCompositionText', result.text)
            : false
        releasePendingRenderAfterComposition(submitted)
        compositionNodeId = null
    })

    document.addEventListener('paste', event => {
        const node = managedNode(event.target)
        const editableTarget = isCanvasEditableElement(node)
        if (!editingEnabled || !editableTarget) return
        event.preventDefault()
        const nodeId = managedNodeId(node)
        const snapshot = captureSelection()
        const types = event.clipboardData ? [...event.clipboardData.types] : []
        const plainText = types.includes('text/plain')
            ? event.clipboardData?.getData('text/plain') ?? null
            : null
        const decision = canvasPasteDecision({
            editingEnabled,
            editableTarget,
            isComposing: composition.isComposing,
            selectionValid: Boolean(snapshot && nodeId && snapshot.nodeId === nodeId),
            plainText,
        })
        if (decision.kind === 'block') {
            reportBlockedInput('insertFromPaste', decision.reason, nodeId)
            return
        }
        if (decision.kind === 'submit' && snapshot) {
            submitInputIntent(snapshot, 'insertFromPaste', decision.text)
        }
    })

    document.addEventListener('drop', event => {
        const node = managedNode(event.target)
        if (!editingEnabled || !isCanvasEditableElement(node)) return
        event.preventDefault()
        reportBlockedInput('insertFromDrop', 'unsupported-input-type', managedNodeId(node))
    })

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            const leave = linkCandidate.clear()
            if (leave) send(leave)
            return
        }
        const keyboardIntent = canvasKeyboardIntent(event)
        if (keyboardIntent) {
            event.preventDefault()
            // iframe 的键盘事件不会冒泡到宿主 Window；这里只发送一次带会话鉴权的意图。
            if (keyboardIntent === 'find') send({type: 'find-intent', action: 'open'})
            else send({type: 'history-intent', action: keyboardIntent})
            return
        }
        if (event.defaultPrevented || event.isComposing || composition.isComposing || !editingEnabled) return
        if (event.key.startsWith('Arrow')) {
            if (caretState.storedMarks) debugTrace.trace('marks-cleared', {by: `方向键 ${event.key}`})
            caretState.authorDirection()
            // 必须在默认动作之前移除，否则方向键会先在零宽填充字符上空走一步。
            syncCaretAnchor(null)
            return
        }
        if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey) return
        const node = managedNode(event.target)
        const nodeId = managedNodeId(node)
        if (!isCanvasEditableElement(node) || !nodeId) return
        const snapshot = captureSelection()
        const intent = canvasEnterIntent(node.getAttribute('data-fc-node-kind'), event.shiftKey)
        event.preventDefault()
        if (!snapshot || snapshot.nodeId !== nodeId) {
            reportBlockedInput(intent.inputType, 'invalid-selection', nodeId)
            return
        }
        // 只有 Shift+Enter 的拆块要求折叠光标；Enter 可用换行替换一段选中文字。
        if (intent.inputType === 'insertParagraph' && !snapshot.collapsed) {
            reportBlockedInput(intent.inputType, 'invalid-selection', nodeId)
            return
        }
        submitInputIntent(snapshot, intent.inputType, intent.text)
    })

    document.addEventListener('focusout', event => {
        const node = managedNode(event.target)
        const nodeId = managedNodeId(node)
        if (!editingEnabled || !isCanvasEditableElement(node) || !nodeId) return
        if (managedNode(event.relatedTarget) === node) return
        const leave = linkCandidate.clear()
        if (leave) send(leave)
        send({type: 'input-flush', nodeId})
    })
}

function start(): void {
    const startup = requireCanvasStartupContext(document, window)
    token = startup.token
    root = startup.root
    authorStyle = mountCanvasStyles(document, runtimeCss).authorStyle
    window.addEventListener('pagehide', () => assetCache.clear(), {once: true})

    window.addEventListener('message', event => {
        if (event.source !== parent) return
        const command = parseCanvasHostCommand(event.data, token)
        if (!command || command.sequence <= incomingSequence) return
        incomingSequence = command.sequence
        if (command.type === 'set-debug') setDebug(command.enabled)
        if (debugTrace.enabled && command.type !== 'asset-frame') {
            debugTrace.trace(`recv:${command.type}`, command.type === 'render'
                ? {requestId: command.requestId, htmlLength: command.html.length}
                : {...command, channel: undefined, version: undefined, sessionToken: undefined})
        }
        if (command.type === 'render') render(command)
        if (command.type === 'asset-frame' && command.requestId === latestRequestId) {
            applyCanvasAssetFrame(assetDisplays, assetCache, command)
            reportSize()
        }
        if (command.type === 'set-selection') setSelection(command.nodeId)
        if (command.type === 'set-editing') setEditing(command.enabled)
        if (command.type === 'update-stored-marks') {
            const updated = caretState.updateStoredMarks(command.mode, command.storedMarks)
            debugTrace.trace('marks-updated', {updated, storedMarks: caretState.storedMarks, caret: caretState.selection})
            if (updated) {
                reportTextSelection(caretState.selection, true, true)
            }
        }
        if (command.type === 'resolve-input') {
            resolveInput(command.intentId, command.accepted, command.selection)
        }
        if (command.type === 'viewport') {
            document.documentElement.style.setProperty('--fc-entry-viewport-width', `${command.width}px`)
            document.documentElement.style.setProperty('--fc-entry-viewport-height', `${command.height}px`)
            document.documentElement.style.setProperty('--fc-entry-device-pixel-ratio', String(command.pixelRatio))
        }
    })

    document.addEventListener('click', event => {
        const target = event.target
        if (!(target instanceof Element)) return
        const anchor = target.closest('[href]')
        if (anchor) {
            event.preventDefault()
            const href = anchor.getAttribute('href')
            const nodeId = managedNodeId(anchor.closest('[data-fc-node-id]'))
            if (href) send({type: 'navigation-intent', href, nodeId})
        }
        const nodeId = managedNodeId(target.closest('[data-fc-node-id]'))
        if (!nodeId) return
        setSelection(nodeId)
        send({type: 'selection', nodeId})
    }, true)

    document.addEventListener('mouseover', event => {
        const anchor = event.target instanceof Element
            ? event.target.closest('a[href], area[href]') : null
        if (!anchor) return
        if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return
        const href = anchor.getAttribute('href') ?? ''
        const bounds = anchor.getBoundingClientRect()
        const hover = linkHover.enter(anchor, href, managedNodeId(anchor.closest('[data-fc-node-id]')), {
            top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height,
        }, composition.isComposing)
        if (hover) send(hover)
    })
    document.addEventListener('mouseout', event => {
        const anchor = event.target instanceof Element
            ? event.target.closest('a[href], area[href]') : null
        if (!anchor) return
        if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return
        const leave = linkHover.leave(anchor)
        if (leave) send(leave)
    })
    window.addEventListener('scroll', () => {
        const leave = linkHover.clear()
        if (leave) send(leave)
    }, true)
    window.addEventListener('blur', () => {
        const leave = linkHover.clear()
        if (leave) send(leave)
    })

    installDebugListeners()
    installInputListeners()
    new ResizeObserver(reportSize).observe(root)
    window.addEventListener('error', event => {
        if (!latestRequestId) return
        send({type: 'render-error', requestId: latestRequestId, code: 'runtime-error', message: event.message.slice(0, 2_048)})
    })
}

startCanvasRuntimeWhenReady(document, start)
