/**
 * 页面编辑调试日志的宿主侧汇集点：宿主事件与画布回传事件按绝对时间合并，只驻留内存，
 * 由调试浮层展示并一键复制。不持久化、不发往任何网络端点。
 *
 * 画布事件经 bridge 批量到达，时间戳早于到达时刻；导出时按时间戳重排，同一时刻保持到达顺序。
 */

export type PageDocumentDebugSource = 'host' | 'canvas'

export interface PageDocumentDebugEntry {
    readonly at: number
    readonly order: number
    readonly source: PageDocumentDebugSource
    readonly kind: string
    readonly detail: string
}

const MAX_ENTRIES = 30_000
const MAX_DETAIL_CODE_UNITS = 12_000
const NOTIFY_DELAY_MS = 120

let enabled = false
let entries: PageDocumentDebugEntry[] = []
let order = 0
let version = 0
let focusedNodeId: string | null = null
let notifyScheduled = false
const listeners = new Set<() => void>()

/** 只在开发服务、Tauri 调试构建或显式开关下提供入口，发布版不出现调试按钮。 */
export function pageDocumentDebugToolsAvailable(): boolean {
    const env = import.meta.env as Record<string, unknown> | undefined
    return Boolean(env?.DEV) || env?.TAURI_ENV_DEBUG === 'true' || env?.VITE_PAGE_DOCUMENT_DEBUG === '1'
}

export function pageDocumentDebugNow(): number {
    return performance.timeOrigin + performance.now()
}

export function debugDetailString(value: unknown): string {
    let text: string
    if (value === undefined) text = ''
    else if (typeof value === 'string') text = value
    else {
        try {
            text = JSON.stringify(value, (_key, item) => item instanceof Error ? {name: item.name, message: item.message} : item) ?? String(value)
        } catch {
            text = String(value)
        }
    }
    text = text.split('\u200B').join('⟦ZWSP⟧')
    return text.length > MAX_DETAIL_CODE_UNITS
        ? `${text.slice(0, MAX_DETAIL_CODE_UNITS - 16)}…[截断 ${text.length}]`
        : text
}

function notify(): void {
    version += 1
    if (notifyScheduled) return
    notifyScheduled = true
    setTimeout(() => {
        notifyScheduled = false
        for (const listener of listeners) listener()
    }, NOTIFY_DELAY_MS)
}

function push(source: PageDocumentDebugSource, at: number, kind: string, detail: string): void {
    entries.push(Object.freeze({at, order: order++, source, kind, detail}))
    if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES)
}

export function isPageDocumentDebugEnabled(): boolean {
    return enabled
}

export function setPageDocumentDebugEnabled(next: boolean): void {
    if (enabled === next) return
    enabled = next
    push('host', pageDocumentDebugNow(), next ? 'debug-start' : 'debug-stop', '')
    notify()
}

/** 宿主侧记录；未开启时立即返回，调用方无需自行判断。 */
export function debugLog(kind: string, detail?: unknown): void {
    if (!enabled) return
    push('host', pageDocumentDebugNow(), kind, debugDetailString(detail))
    notify()
}

export function appendCanvasDebugEntries(
    list: readonly {readonly at: number; readonly kind: string; readonly detail: string}[],
): void {
    if (!enabled) return
    for (const item of list) push('canvas', item.at, item.kind, item.detail)
    notify()
}

export function setDebugFocusedNode(nodeId: string | null): void {
    if (nodeId === null || nodeId === focusedNodeId) return
    focusedNodeId = nodeId
    debugLog('focus-node', {nodeId})
}

export function debugFocusedNode(): string | null {
    return focusedNodeId
}

export function subscribePageDocumentDebug(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function pageDocumentDebugVersion(): number {
    return version
}

export function pageDocumentDebugEntries(): readonly PageDocumentDebugEntry[] {
    return [...entries].sort((left, right) => left.at - right.at || left.order - right.order)
}

export function clearPageDocumentDebugLog(): void {
    entries = []
    order = 0
    notify()
}

function sourceLabel(source: PageDocumentDebugSource): string {
    return source === 'canvas' ? '画布' : '宿主'
}

export function formatDebugEntry(entry: PageDocumentDebugEntry, origin: number): string {
    const offset = (entry.at - origin).toFixed(1).padStart(10, ' ')
    return `+${offset}ms [${sourceLabel(entry.source)}] ${entry.kind}${entry.detail ? ` ${entry.detail}` : ''}`
}

export function formatPageDocumentDebugLog(context: Readonly<Record<string, unknown>> = {}): string {
    const sorted = pageDocumentDebugEntries()
    const origin = sorted[0]?.at ?? pageDocumentDebugNow()
    const header = [
        'FlowCloudAI 页面编辑调试日志',
        `导出时间：${new Date().toISOString()}`,
        `条目：${sorted.length}${sorted.length >= MAX_ENTRIES ? `（已达上限 ${MAX_ENTRIES}，最早的条目已丢弃）` : ''}`,
        `起点：${new Date(origin).toISOString()}`,
        `UA：${typeof navigator === 'undefined' ? '未知' : navigator.userAgent}`,
        `上下文：${debugDetailString(context)}`,
        '说明：时间为相对首条的毫秒；⟦ZWSP⟧ 为画布插入点锚点的零宽填充字符。',
        '---',
    ]
    return [...header, ...sorted.map(entry => formatDebugEntry(entry, origin))].join('\n')
}
