// 本模块启动独立画布页；只接受父 Window 的当前会话命令，并把只读意图回报给宿主。

import {RFC_9562_UUID_PATTERN} from '../../domain/uuidPolicy.ts'
import {
    PAGE_DOCUMENT_CANVAS_CHANNEL,
    PAGE_DOCUMENT_CANVAS_VERSION,
    parseCanvasHostCommand,
    type CanvasRuntimeMessage,
} from '../protocol/index.ts'
import {isolatePageDocument} from './isolationPolicy.ts'
import {readCanvasSessionToken} from './sessionToken.ts'
import './runtime.css'

const tokenCandidate = readCanvasSessionToken(window.location.hash)
const rootCandidate = document.querySelector<HTMLElement>('#page-document-canvas-root')
const authorStyleCandidate = document.querySelector<HTMLStyleElement>('#page-document-author-style')

if (!tokenCandidate || !rootCandidate || !authorStyleCandidate) throw new Error('隔离画布缺少可信启动参数。')

const token = tokenCandidate
const root = rootCandidate
const authorStyle = authorStyleCandidate

let outgoingSequence = 0
let incomingSequence = 0
let selectedNodeId: string | null = null
let latestRequestId: string | null = null

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

function findManagedNode(nodeId: string | null): HTMLElement | null {
    if (!nodeId || !RFC_9562_UUID_PATTERN.test(nodeId)) return null
    return [...root.querySelectorAll<HTMLElement>('[data-fc-node-id]')]
        .find(node => node.getAttribute('data-fc-node-id')?.toLowerCase() === nodeId.toLowerCase()) ?? null
}

function setSelection(nodeId: string | null): void {
    findManagedNode(selectedNodeId)?.removeAttribute('data-fc-canvas-selected')
    selectedNodeId = nodeId?.toLowerCase() ?? null
    findManagedNode(selectedNodeId)?.setAttribute('data-fc-canvas-selected', '')
}

function reportSize(): void {
    const body = document.body
    send({
        type: 'size',
        width: Math.min(100_000, Math.max(body.scrollWidth, body.offsetWidth)),
        height: Math.min(100_000, Math.max(body.scrollHeight, body.offsetHeight)),
    })
}

function render(requestId: string, html: string, css: string): void {
    latestRequestId = requestId
    const result = isolatePageDocument(html, css)
    if (!result.artifact) {
        send({
            type: 'render-error',
            requestId,
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
        setSelection(selectedNodeId)
        send({type: 'rendered', requestId, managedNodeCount: result.artifact.managedNodeCount})
        reportSize()
    } catch (error) {
        send({
            type: 'render-error',
            requestId,
            code: 'runtime-error',
            message: String(error).slice(0, 2_048),
        })
    }
}

window.addEventListener('message', event => {
    if (event.source !== parent) return
    const command = parseCanvasHostCommand(event.data, token)
    if (!command || command.sequence <= incomingSequence) return
    incomingSequence = command.sequence
    if (command.type === 'render') render(command.requestId, command.html, command.css)
    if (command.type === 'set-selection') setSelection(command.nodeId)
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
        const managed = anchor.closest('[data-fc-node-id]')
        const nodeId = managed?.getAttribute('data-fc-node-id') ?? null
        if (href) send({type: 'navigation-intent', href, nodeId: nodeId && RFC_9562_UUID_PATTERN.test(nodeId) ? nodeId : null})
    }
    const managed = target.closest('[data-fc-node-id]')
    const nodeId = managed?.getAttribute('data-fc-node-id')
    if (!nodeId || !RFC_9562_UUID_PATTERN.test(nodeId)) return
    setSelection(nodeId)
    send({type: 'selection', nodeId: nodeId.toLowerCase()})
}, true)

new ResizeObserver(reportSize).observe(document.body)

window.addEventListener('error', event => {
    if (!latestRequestId) return
    send({type: 'render-error', requestId: latestRequestId, code: 'runtime-error', message: event.message.slice(0, 2_048)})
})
