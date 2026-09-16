// 本模块启动独立画布页；可信命令可授予受限文本编辑，作者 DOM 始终只是可回滚的临时视图。

import {RFC_9562_UUID_PATTERN} from '../../domain/uuidPolicy.ts'
import {
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
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
    canvasPasteDecision,
    createCanvasCompositionTracker,
    expandCollapsedCanvasDeletion,
    isCanvasSplittableKind,
    shouldDeferCanvasRender,
    type CanvasTextSelectionSnapshot,
} from './inputPolicy.ts'
import {isolatePageDocument} from './isolationPolicy.ts'
import {createCanvasLinkHoverTracker} from './linkHover.ts'
import {requireCanvasStartupContext, startCanvasRuntimeWhenReady} from './startup.ts'
import {mountCanvasStyles} from './styleMount.ts'
import runtimeCss from './runtime.css?inline'

let token: string
let root: HTMLElement
let authorStyle: HTMLStyleElement
let outgoingSequence = 0
let incomingSequence = 0
let selectedNodeId: string | null = null
let latestRequestId: string | null = null
let editingEnabled = false
let pendingRender: CanvasRenderCommand | null = null
let rejectedInputPending = false
let compositionOriginalNode: HTMLElement | null = null
let compositionNodeId: string | null = null
let pendingResolvedSelection: {nodeId: string; offset: number} | null = null
const pendingInputIds = new Set<string>()
const composition = createCanvasCompositionTracker()
const linkHover = createCanvasLinkHoverTracker()

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

function setSelection(nodeId: string | null): void {
    findManagedNode(selectedNodeId)?.removeAttribute('data-fc-canvas-selected')
    selectedNodeId = nodeId?.toLowerCase() ?? null
    findManagedNode(selectedNodeId)?.setAttribute('data-fc-canvas-selected', '')
}

function reportSize(): void {
    const size = measureCanvasContentSize(root)
    send({type: 'size', width: size.width, height: size.height})
}

function clearRenderedDocument(): void {
    const leave = linkHover.clear()
    if (leave) send(leave)
    authorStyle.textContent = ''
    root.replaceChildren()
    selectedNodeId = null
    reportSize()
}

function applyRender(
    command: CanvasRenderCommand,
    resolvedSelection: {nodeId: string; offset: number} | null = null,
): void {
    const leave = linkHover.clear()
    if (leave) send(leave)
    latestRequestId = command.requestId
    // 晚于输入回执到达的规范化预览仍需挂载；先记住纯文本选区，避免全量安全挂载打断连续输入。
    const textSelection = editingEnabled && !resolvedSelection ? captureSelection() : null
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
    try {
        const template = document.createElement('template')
        template.innerHTML = result.artifact.html
        authorStyle.textContent = result.artifact.css
        root.replaceChildren(template.content.cloneNode(true))
        applyCanvasEditingState(root, editingEnabled)
        setSelection(resolvedSelection?.nodeId ?? selectedNodeId)
        if (resolvedSelection) {
            // 结构提交会替换原 contenteditable；重新聚焦宿主指定的新块，下一次输入才不会落回旧节点。
            findManagedNode(resolvedSelection.nodeId)?.focus({preventScroll: true})
            restoreTextSelection({
                nodeId: resolvedSelection.nodeId,
                from: resolvedSelection.offset,
                to: resolvedSelection.offset,
                expected: '',
                collapsed: true,
            })
        } else if (textSelection) restoreTextSelection(textSelection)
        send({
            type: 'rendered',
            requestId: command.requestId,
            managedNodeCount: result.artifact.managedNodeCount,
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
        pendingRender = command
        return
    }
    const resolvedSelection = pendingResolvedSelection
    pendingResolvedSelection = null
    applyRender(command, resolvedSelection)
}

function semanticLength(value: Node): number {
    if (value.nodeType === Node.TEXT_NODE) return value.textContent?.length ?? 0
    if (value instanceof Element && value.tagName === 'BR') return 1
    return [...value.childNodes].reduce((total, child) => total + semanticLength(child), 0)
}

function semanticText(value: Node): string {
    if (value.nodeType === Node.TEXT_NODE) return value.textContent ?? ''
    if (value instanceof Element && value.tagName === 'BR') return '\n'
    return [...value.childNodes].map(semanticText).join('')
}

function semanticOffset(rootNode: Node, container: Node, offset: number): number | null {
    if (container !== rootNode && !rootNode.contains(container)) return null
    let total = 0
    let resolved: number | null = null
    const visit = (value: Node): void => {
        if (resolved !== null) return
        if (value === container) {
            if (value.nodeType === Node.TEXT_NODE) {
                const length = value.textContent?.length ?? 0
                if (Number.isInteger(offset) && offset >= 0 && offset <= length) resolved = total + offset
                return
            }
            if (!Number.isInteger(offset) || offset < 0 || offset > value.childNodes.length) return
            for (let index = 0; index < offset; index += 1) total += semanticLength(value.childNodes[index])
            resolved = total
            return
        }
        if (value.nodeType === Node.TEXT_NODE || (value instanceof Element && value.tagName === 'BR')) {
            total += semanticLength(value)
            return
        }
        value.childNodes.forEach(visit)
    }
    visit(rootNode)
    return resolved
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

function captureInputRange(event: InputEvent): CanvasTextSelectionSnapshot | null {
    const range = event.getTargetRanges?.()[0]
    return range
        ? captureTextRange(range.startContainer, range.startOffset, range.endContainer, range.endOffset)
        : captureSelection()
}

function locateTextOffset(rootNode: Node, offset: number): {node: Node; offset: number} | null {
    if (!Number.isInteger(offset) || offset < 0 || offset > semanticLength(rootNode)) return null
    let remaining = offset
    const locate = (parentNode: Node): {node: Node; offset: number} => {
        const children = [...parentNode.childNodes]
        for (const [index, child] of children.entries()) {
            if (child.nodeType === Node.TEXT_NODE) {
                const length = child.textContent?.length ?? 0
                if (remaining <= length) return {node: child, offset: remaining}
                remaining -= length
                continue
            }
            if (child instanceof Element && child.tagName === 'BR') {
                if (remaining === 0) return {node: parentNode, offset: index}
                remaining -= 1
                if (remaining === 0) return {node: parentNode, offset: index + 1}
                continue
            }
            const length = semanticLength(child)
            if (remaining <= length) return locate(child)
            remaining -= length
        }
        return {node: parentNode, offset: children.length}
    }
    return locate(rootNode)
}

function restoreTextSelection(snapshot: CanvasTextSelectionSnapshot): void {
    const node = findManagedNode(snapshot.nodeId)
    const current = node ? semanticText(node) : ''
    if (!node || snapshot.to > current.length) return
    const start = locateTextOffset(node, snapshot.from)
    const end = locateTextOffset(node, snapshot.to)
    const selection = getSelection()
    if (!start || !end || !selection) return
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    selection.removeAllRanges()
    selection.addRange(range)
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
        const fragment = document.createDocumentFragment()
        for (const [index, part] of text.split('\n').entries()) {
            if (index > 0) fragment.append(document.createElement('br'))
            if (part.length > 0) fragment.append(document.createTextNode(part))
        }
        range.insertNode(fragment)
    }
    node.normalize()
    const caret = snapshot.from + text.length
    restoreTextSelection({
        nodeId: snapshot.nodeId,
        from: caret,
        to: caret,
        expected: '',
        collapsed: true,
    })
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
        reportBlockedInput(inputType, 'invalid-selection', snapshot.nodeId)
        return false
    }
    const intentId = crypto.randomUUID()
    pendingInputIds.add(intentId)
    send({
        type: 'input-intent',
        intentId,
        nodeId: snapshot.nodeId,
        inputType,
        from: snapshot.from,
        to: snapshot.to,
        expected: snapshot.expected,
        text,
    } satisfies Omit<CanvasInputIntentMessage, 'channel' | 'version' | 'sessionToken' | 'sequence'>)
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
        const leave = linkHover.clear()
        if (leave) send(leave)
    }
    editingEnabled = enabled
    if (!enabled && composition.isComposing) {
        composition.cancel()
        restoreCompositionStart()
        releasePendingRenderAfterComposition(false)
    }
    applyCanvasEditingState(root, editingEnabled)
}

function resolveInput(
    intentId: string,
    accepted: boolean,
    selection: {nodeId: string; offset: number} | null,
): void {
    if (!pendingInputIds.delete(intentId.toLowerCase())) return
    if (!accepted) rejectedInputPending = true
    if (accepted && selection) pendingResolvedSelection = selection
    if (pendingInputIds.size > 0 || composition.isComposing) return
    const next = pendingRender
    pendingRender = null
    if (next && (rejectedInputPending || pendingResolvedSelection)) {
        const resolvedSelection = rejectedInputPending ? null : pendingResolvedSelection
        pendingResolvedSelection = null
        applyRender(next, resolvedSelection)
    }
    rejectedInputPending = false
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
        if (decision === 'ignore' || decision === 'native-composition') return
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
            snapshot = expandCollapsedCanvasDeletion(semanticText(node), snapshot, inputType as CanvasInputType)
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
        } else if (inputType === 'insertFromPaste') {
            const transferred = event.dataTransfer?.getData('text/plain')
            const decision = canvasPasteDecision({
                editingEnabled,
                editableTarget: true,
                isComposing: composition.isComposing,
                selectionValid: true,
                plainText: typeof transferred === 'string' && transferred.length > 0
                    ? transferred
                    : typeof event.data === 'string' ? event.data : null,
            })
            if (decision.kind !== 'submit') {
                event.preventDefault()
                reportBlockedInput(inputType, decision.kind === 'block' ? decision.reason : 'invalid-selection', nodeId)
                return
            }
            text = decision.text
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

    document.addEventListener('compositionstart', event => {
        const leave = linkHover.clear()
        if (leave) send(leave)
        if (!editingEnabled || composition.isComposing) return
        const node = managedNode(event.target)
        const nodeId = managedNodeId(node)
        const snapshot = captureSelection()
        if (!isCanvasEditableElement(node) || !nodeId || !snapshot || snapshot.nodeId !== nodeId) {
            reportBlockedInput('insertCompositionText', 'invalid-selection', nodeId)
            return
        }
        if (!composition.begin(snapshot)) return
        compositionOriginalNode = node.cloneNode(true) as HTMLElement
        compositionNodeId = nodeId
    })

    document.addEventListener('compositionend', event => {
        if (!composition.isComposing) return
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
        if (event.defaultPrevented || event.isComposing) return
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return
        const key = event.key.toLowerCase()
        if (key === 'z') {
            event.preventDefault()
            send({type: 'history-intent', action: event.shiftKey ? 'redo' : 'undo'})
        } else if (key === 'y' && !event.shiftKey) {
            // Windows 习惯：Ctrl+Y 也触发 redo
            event.preventDefault()
            send({type: 'history-intent', action: 'redo'})
        }
    })

    document.addEventListener('focusout', event => {
        const node = managedNode(event.target)
        const nodeId = managedNodeId(node)
        if (!editingEnabled || !isCanvasEditableElement(node) || !nodeId) return
        if (managedNode(event.relatedTarget) === node) return
        send({type: 'input-flush', nodeId})
    })
}

function start(): void {
    const startup = requireCanvasStartupContext(document, window)
    token = startup.token
    root = startup.root
    authorStyle = mountCanvasStyles(document, runtimeCss).authorStyle

    window.addEventListener('message', event => {
        if (event.source !== parent) return
        const command = parseCanvasHostCommand(event.data, token)
        if (!command || command.sequence <= incomingSequence) return
        incomingSequence = command.sequence
        if (command.type === 'render') render(command)
        if (command.type === 'set-selection') setSelection(command.nodeId)
        if (command.type === 'set-editing') setEditing(command.enabled)
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

    installInputListeners()
    new ResizeObserver(reportSize).observe(root)
    window.addEventListener('error', event => {
        if (!latestRequestId) return
        send({type: 'render-error', requestId: latestRequestId, code: 'runtime-error', message: event.message.slice(0, 2_048)})
    })
}

startCanvasRuntimeWhenReady(document, start)
