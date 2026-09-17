// 本组件拥有 iframe 与 bridge 会话；业务页面只接收已鉴权的选择、错误和导航意图。

import classNames from 'classnames'
import {useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref} from 'react'
import {pageDocumentAssetErrorStatus, pageDocumentReadAssetFrame} from '../../../../api/pageDocument.ts'
import {isolatePageDocument} from '../runtime/isolationPolicy.ts'
import {
    createCanvasHostCommandFactory,
    createCanvasRequestId,
    createCanvasRuntimeMessageGate,
    createCanvasSessionToken,
    type CanvasHostCommandPayload,
    type CanvasInputBlockedMessage,
    type CanvasInputIntentMessage,
    type CanvasInputResolution,
    type CanvasLinkCandidateIntentMessage,
    type CanvasLinkHoverRect,
} from '../protocol/index.ts'
import {validateAuthorHref} from '../../domain/kernel/policy/hrefPolicy.ts'
import {createCanvasPageUrl, resolveCanvasHeight} from './canvasPageUrl.ts'
import {canForwardCanvasNavigationIntent} from './navigationIntent.ts'
import {canvasRectToHostViewport} from './linkHoverGeometry.ts'
import './PageDocumentCanvas.css'

export interface PageDocumentCanvasProps {
    ref?: Ref<PageDocumentCanvasHandle>
    documentKey: string
    projectId?: string | null
    html: string
    css: string
    selectedNodeId?: string | null
    title?: string
    className?: string
    minimumHeight?: number
    editingEnabled?: boolean
    onSelectionChange?: (nodeId: string) => void
    onNavigationIntent?: (href: string) => void
    onLinkHover?: (hover: {href: string | null; nodeId: string | null; rect: CanvasLinkHoverRect | null}) => void
    onInputIntent?: (
        message: CanvasInputIntentMessage,
    ) => CanvasInputResolution | Promise<CanvasInputResolution>
    onInputBlocked?: (message: CanvasInputBlockedMessage) => void
    onInputFlush?: (nodeId: string) => void
    onHistoryIntent?: (action: 'undo' | 'redo') => void
    onLinkCandidateIntent?: (message: CanvasLinkCandidateIntentMessage) => void
    onRenderError?: (message: string) => void
    onRendered?: () => void
}

export interface PageDocumentCanvasHandle {
    resolveLinkCandidate(intentId: string, resolution: CanvasInputResolution): void
}

export function PageDocumentCanvas({
    ref,
    documentKey,
    projectId = null,
    html,
    css,
    selectedNodeId = null,
    title = '页面文档预览',
    className,
    minimumHeight = 160,
    editingEnabled = false,
    onSelectionChange,
    onNavigationIntent,
    onLinkHover,
    onInputIntent,
    onInputBlocked,
    onInputFlush,
    onHistoryIntent,
    onLinkCandidateIntent,
    onRenderError,
    onRendered,
}: PageDocumentCanvasProps) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const loadedRef = useRef(false)
    const renderRequestIdRef = useRef<string | null>(null)
    const latest = useRef({
        html,
        css,
        onSelectionChange,
        onNavigationIntent,
        onLinkHover,
        onInputIntent,
        onInputBlocked,
        onInputFlush,
        onHistoryIntent,
        onLinkCandidateIntent,
        onRenderError,
        onRendered,
    })
    const session = useMemo(() => {
        const token = createCanvasSessionToken()
        return {documentKey, token, createCommand: createCanvasHostCommandFactory(token)}
    }, [documentKey])
    const source = useMemo(() => createCanvasPageUrl(window.location.href, session.token), [session.token])
    const [height, setHeight] = useState(minimumHeight)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

    useEffect(() => {
        latest.current = {
            html,
            css,
            onSelectionChange,
            onNavigationIntent,
            onLinkHover,
            onInputIntent,
            onInputBlocked,
            onInputFlush,
            onHistoryIntent,
            onLinkCandidateIntent,
            onRenderError,
            onRendered,
        }
    }, [css, html, onHistoryIntent, onInputBlocked, onInputFlush, onInputIntent, onLinkCandidateIntent, onLinkHover, onNavigationIntent, onRenderError, onRendered, onSelectionChange])

    const send = useCallback((payload: CanvasHostCommandPayload) => {
        frameRef.current?.contentWindow?.postMessage(session.createCommand(payload), '*')
    }, [session])

    useImperativeHandle(ref, () => ({
        resolveLinkCandidate(intentId, resolution) {
            if (!loadedRef.current) return
            send({type: 'resolve-input', intentId, accepted: resolution.accepted, selection: resolution.selection})
        },
    }), [send])

    const sendViewport = useCallback(() => {
        const rect = frameRef.current?.getBoundingClientRect()
        if (!rect) return
        send({
            type: 'viewport',
            width: Math.max(0, rect.width),
            height: Math.max(0, rect.height),
            pixelRatio: Math.max(0.01, Math.min(16, window.devicePixelRatio || 1)),
        })
    }, [send])

    const loadAssets = useCallback((requestId: string, htmlSource: string, cssSource: string) => {
        const isolated = isolatePageDocument(htmlSource, cssSource)
        for (const assetId of isolated.artifact?.assetIds ?? []) {
            if (!projectId) {
                send({type: 'asset-frame', requestId, assetId, status: 'unavailable', width: 0, height: 0, rgbaBase64: ''})
                continue
            }
            void pageDocumentReadAssetFrame(projectId, assetId).then(frame => {
                if (renderRequestIdRef.current !== requestId || !loadedRef.current) return
                send({type: 'asset-frame', requestId, assetId, status: 'ready',
                    width: frame.width, height: frame.height, rgbaBase64: frame.rgbaBase64})
            }).catch(error => {
                if (renderRequestIdRef.current !== requestId || !loadedRef.current) return
                send({type: 'asset-frame', requestId, assetId, status: pageDocumentAssetErrorStatus(error),
                    width: 0, height: 0, rgbaBase64: ''})
            })
        }
    }, [projectId, send])

    const sendRender = useCallback(() => {
        latest.current.onLinkHover?.({href: null, nodeId: null, rect: null})
        const requestId = createCanvasRequestId()
        renderRequestIdRef.current = requestId
        send({
            type: 'render',
            requestId,
            html,
            css,
        })
        loadAssets(requestId, html, css)
    }, [css, html, loadAssets, send])

    const sendLatestRender = useCallback(() => {
        latest.current.onLinkHover?.({href: null, nodeId: null, rect: null})
        const requestId = createCanvasRequestId()
        renderRequestIdRef.current = requestId
        send({
            type: 'render',
            requestId,
            html: latest.current.html,
            css: latest.current.css,
        })
        loadAssets(requestId, latest.current.html, latest.current.css)
    }, [loadAssets, send])

    useEffect(() => {
        loadedRef.current = false
        renderRequestIdRef.current = null
        setHeight(minimumHeight)
        setStatus('loading')
    }, [minimumHeight, session.token])

    useEffect(() => {
        const expectedSource = frameRef.current?.contentWindow
        if (!expectedSource) return
        const gate = createCanvasRuntimeMessageGate(expectedSource, session.token)
        let active = true
        const handleMessage = (event: MessageEvent) => {
            const message = gate.accept(event)
            if (!message) return
            if (message.type === 'size') setHeight(resolveCanvasHeight(message.height, minimumHeight))
            if (message.type === 'selection') latest.current.onSelectionChange?.(message.nodeId)
            if (message.type === 'navigation-intent' && canForwardCanvasNavigationIntent(message.href)) {
                latest.current.onNavigationIntent?.(message.href)
            }
            if (message.type === 'link-hover') {
                if (message.href === null) {
                    latest.current.onLinkHover?.({href: null, nodeId: null, rect: null})
                } else if (message.rect && validateAuthorHref(message.href).allowed) {
                    const frameRect = frameRef.current?.getBoundingClientRect()
                    if (frameRect) latest.current.onLinkHover?.({
                        href: message.href,
                        nodeId: message.nodeId,
                        rect: canvasRectToHostViewport(frameRect, message.rect),
                    })
                }
            }
            if (message.type === 'input-blocked') latest.current.onInputBlocked?.(message)
            if (message.type === 'input-flush') latest.current.onInputFlush?.(message.nodeId)
            if (message.type === 'history-intent') latest.current.onHistoryIntent?.(message.action)
            if (message.type === 'link-candidate-intent') latest.current.onLinkCandidateIntent?.(message)
            if (message.type === 'input-intent') {
                const intent = {...message, intentId: message.intentId.toLowerCase(), nodeId: message.nodeId.toLowerCase()}
                void (async () => {
                    let resolution: CanvasInputResolution = {accepted: false, selection: null}
                    try {
                        resolution = (await latest.current.onInputIntent?.(intent)) ?? resolution
                    } catch {
                        resolution = {accepted: false, selection: null}
                    }
                    if (!active) return
                    const selection = resolution.accepted ? resolution.selection : null
                    // 拒绝时先把当前草稿排进画布的 pendingRender，再解除意图以原子回滚临时 DOM。
                    if (!resolution.accepted) sendLatestRender()
                    if (selection) {
                        latest.current.onSelectionChange?.(selection.nodeId)
                    }
                    send({
                        type: 'resolve-input',
                        intentId: intent.intentId,
                        accepted: resolution.accepted,
                        selection,
                    })
                })()
            }
            if (message.type === 'rendered') {
                setStatus('ready')
                latest.current.onRendered?.()
            }
            if (message.type === 'render-error') {
                setStatus('error')
                latest.current.onRenderError?.(message.message)
            }
        }
        window.addEventListener('message', handleMessage)
        return () => {
            active = false
            latest.current.onLinkHover?.({href: null, nodeId: null, rect: null})
            gate.destroy()
            window.removeEventListener('message', handleMessage)
        }
    }, [minimumHeight, send, sendLatestRender, session.token])

    useEffect(() => {
        if (loadedRef.current) sendRender()
    }, [sendRender])

    useEffect(() => {
        if (loadedRef.current) send({type: 'set-selection', nodeId: selectedNodeId})
    }, [selectedNodeId, send])

    useEffect(() => {
        if (loadedRef.current) send({type: 'set-editing', enabled: editingEnabled})
    }, [editingEnabled, send])

    useEffect(() => {
        const frame = frameRef.current
        if (!frame) return
        const observer = new ResizeObserver(() => {
            if (loadedRef.current) sendViewport()
        })
        observer.observe(frame)
        return () => observer.disconnect()
    }, [sendViewport])

    const handleLoad = () => {
        loadedRef.current = true
        sendRender()
        send({type: 'set-selection', nodeId: selectedNodeId})
        send({type: 'set-editing', enabled: editingEnabled})
        sendViewport()
    }

    return (
        <section className={classNames('page-document-canvas', className)} data-canvas-status={status}>
            <iframe
                key={session.token}
                ref={frameRef}
                className="page-document-canvas__frame"
                src={source}
                sandbox="allow-scripts"
                title={title}
                style={{height}}
                onLoad={handleLoad}
            />
            <span className="page-document-canvas__status" role="status" aria-live="polite">
                {status === 'loading' ? '正在加载隔离预览…' : status === 'error' ? '隔离预览无法渲染' : ''}
            </span>
        </section>
    )
}
