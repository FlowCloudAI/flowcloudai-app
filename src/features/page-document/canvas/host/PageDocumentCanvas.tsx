// 本组件拥有 iframe 与 bridge 会话；业务页面只接收已鉴权的选择、错误和导航意图。

import classNames from 'classnames'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    createCanvasHostCommandFactory,
    createCanvasRequestId,
    createCanvasRuntimeMessageGate,
    createCanvasSessionToken,
    type CanvasHostCommandPayload,
} from '../protocol/index.ts'
import {createCanvasPageUrl, resolveCanvasHeight} from './canvasPageUrl.ts'
import {canForwardCanvasNavigationIntent} from './navigationIntent.ts'
import './PageDocumentCanvas.css'

export interface PageDocumentCanvasProps {
    documentKey: string
    html: string
    css: string
    selectedNodeId?: string | null
    title?: string
    className?: string
    minimumHeight?: number
    onSelectionChange?: (nodeId: string) => void
    onNavigationIntent?: (href: string) => void
    onRenderError?: (message: string) => void
    onRendered?: () => void
}

export function PageDocumentCanvas({
    documentKey,
    html,
    css,
    selectedNodeId = null,
    title = '页面文档预览',
    className,
    minimumHeight = 160,
    onSelectionChange,
    onNavigationIntent,
    onRenderError,
    onRendered,
}: PageDocumentCanvasProps) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const loadedRef = useRef(false)
    const latest = useRef({onSelectionChange, onNavigationIntent, onRenderError, onRendered})
    const session = useMemo(() => {
        const token = createCanvasSessionToken()
        return {documentKey, token, createCommand: createCanvasHostCommandFactory(token)}
    }, [documentKey])
    const source = useMemo(() => createCanvasPageUrl(window.location.href, session.token), [session.token])
    const [height, setHeight] = useState(minimumHeight)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

    useEffect(() => {
        latest.current = {onSelectionChange, onNavigationIntent, onRenderError, onRendered}
    }, [onNavigationIntent, onRenderError, onRendered, onSelectionChange])

    const send = useCallback((payload: CanvasHostCommandPayload) => {
        frameRef.current?.contentWindow?.postMessage(session.createCommand(payload), '*')
    }, [session])

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

    const sendRender = useCallback(() => {
        send({type: 'render', requestId: createCanvasRequestId(), html, css})
    }, [css, html, send])

    useEffect(() => {
        loadedRef.current = false
        setHeight(minimumHeight)
        setStatus('loading')
    }, [minimumHeight, session.token])

    useEffect(() => {
        const expectedSource = frameRef.current?.contentWindow
        if (!expectedSource) return
        const gate = createCanvasRuntimeMessageGate(expectedSource, session.token)
        const handleMessage = (event: MessageEvent) => {
            const message = gate.accept(event)
            if (!message) return
            if (message.type === 'size') setHeight(resolveCanvasHeight(message.height, minimumHeight))
            if (message.type === 'selection') latest.current.onSelectionChange?.(message.nodeId)
            if (message.type === 'navigation-intent' && canForwardCanvasNavigationIntent(message.href)) {
                latest.current.onNavigationIntent?.(message.href)
            }
            if (message.type === 'rendered') {
                setStatus('ready')
                latest.current.onRendered?.()
            }
            if (message.type === 'render-error') {
                setStatus('error')
                latest.current.onRenderError?.(message.message)
            }
            // 输入类消息虽有协议形状，但 M6 只读宿主有意不处理。
        }
        window.addEventListener('message', handleMessage)
        return () => {
            gate.destroy()
            window.removeEventListener('message', handleMessage)
        }
    }, [minimumHeight, session.token])

    useEffect(() => {
        if (loadedRef.current) sendRender()
    }, [sendRender])

    useEffect(() => {
        if (loadedRef.current) send({type: 'set-selection', nodeId: selectedNodeId})
    }, [selectedNodeId, send])

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
