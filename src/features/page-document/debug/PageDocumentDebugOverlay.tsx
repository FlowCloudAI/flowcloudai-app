// 本组件是页面编辑调试浮层：开启即开始记录宿主与画布日志，并在草稿变化时记录所聚焦文本块的源码；
// 只在调试构建中由状态栏按钮打开，复制出的纯文本用于交给开发者排查。

import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react'
import {createPortal} from 'react-dom'
import {
    clearPageDocumentDebugLog,
    debugFocusedNode,
    debugLog,
    formatDebugEntry,
    formatPageDocumentDebugLog,
    isPageDocumentDebugEnabled,
    pageDocumentDebugEntries,
    pageDocumentDebugVersion,
    setPageDocumentDebugEnabled,
    subscribePageDocumentDebug,
} from './pageDocumentDebugLog.ts'
import './PageDocumentDebugOverlay.css'

const VISIBLE_LINES = 400

/** 草稿 article.html 是嵌套 <template> 的补丁格式；querySelector 不进入 template.content，必须逐层查找。 */
function nodeSource(html: string, nodeId: string): string {
    try {
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nodeId) : nodeId
        const selector = `[data-fc-node-id="${escaped}"]`
        const pending: ParentNode[] = [parsed]
        while (pending.length > 0) {
            const scope = pending.shift() as ParentNode
            const found = scope.querySelector(selector)
            if (found) return found.outerHTML
            for (const template of Array.from(scope.querySelectorAll('template'))) pending.push(template.content)
        }
        return '(草稿中找不到该节点)'
    } catch (error) {
        return `(解析草稿失败：${String(error)})`
    }
}

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const copied = document.execCommand('copy')
        area.remove()
        return copied
    }
}

export function PageDocumentDebugOverlay({
    source,
    context,
    onClose,
}: {
    /** 当前草稿中的 article.html；每次变化都记录所聚焦文本块的源码。 */
    source: string
    context: () => Readonly<Record<string, unknown>>
    onClose: () => void
}) {
    const version = useSyncExternalStore(subscribePageDocumentDebug, pageDocumentDebugVersion)
    const recording = useSyncExternalStore(subscribePageDocumentDebug, isPageDocumentDebugEnabled)
    const [minimized, setMinimized] = useState(false)
    const [feedback, setFeedback] = useState<string | null>(null)
    const logRef = useRef<HTMLPreElement | null>(null)
    const followRef = useRef(true)
    const lastDraftRef = useRef<string>('')
    const contextRef = useRef(context)
    useLayoutEffect(() => {
        contextRef.current = context
    })

    useEffect(() => {
        setPageDocumentDebugEnabled(true)
        debugLog('overlay-open', contextRef.current())
        return () => setPageDocumentDebugEnabled(false)
    }, [])

    useEffect(() => {
        if (!recording) return
        const nodeId = debugFocusedNode()
        if (!nodeId) return
        const html = nodeSource(source, nodeId)
        const key = `${nodeId}\n${html}`
        if (key === lastDraftRef.current) return
        lastDraftRef.current = key
        debugLog('draft', {nodeId, html})
    }, [recording, source, version])

    const entries = pageDocumentDebugEntries()
    const origin = entries[0]?.at ?? 0
    const visible = entries.slice(-VISIBLE_LINES).map(entry => formatDebugEntry(entry, origin)).join('\n')

    useLayoutEffect(() => {
        const log = logRef.current
        if (log && followRef.current) log.scrollTop = log.scrollHeight
    }, [visible, minimized])

    const copy = async () => {
        const text = formatPageDocumentDebugLog(contextRef.current())
        const copied = await copyText(text)
        setFeedback(copied
            ? `已复制 ${entries.length} 条，约 ${Math.ceil(text.length / 1024)} KB`
            : '复制失败，请重试')
        setTimeout(() => setFeedback(null), 3_000)
    }

    // 挂到 body，避免编辑器外层的 transform 或 overflow 让固定定位失效。
    return createPortal(
        <aside aria-label="页面编辑调试日志" className={`page-document-debug-overlay${minimized ? ' is-minimized' : ''}`}>
            <header>
                <strong>调试日志</strong>
                <span className={recording ? 'is-recording' : undefined}>
                    {recording ? '记录中' : '已暂停'} · {entries.length} 条
                </span>
                {feedback && <span className="page-document-debug-overlay__feedback">{feedback}</span>}
                <div className="page-document-debug-overlay__actions">
                    <button type="button" onClick={() => setPageDocumentDebugEnabled(!recording)}>
                        {recording ? '暂停' : '继续'}
                    </button>
                    <button type="button" onClick={() => {
                        clearPageDocumentDebugLog()
                        lastDraftRef.current = ''
                    }}>清空</button>
                    <button type="button" className="is-primary" onClick={() => void copy()}>复制全部</button>
                    <button type="button" onClick={() => setMinimized(current => !current)}>
                        {minimized ? '展开' : '收起'}
                    </button>
                    <button type="button" onClick={onClose}>关闭</button>
                </div>
            </header>
            {!minimized && (
                <pre
                    ref={logRef}
                    onScroll={event => {
                        const log = event.currentTarget
                        followRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24
                    }}
                >
                    {visible || '在画布文本块内点击或输入即开始记录。'}
                </pre>
            )}
        </aside>,
        document.body,
    )
}
