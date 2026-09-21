/**
 * 画布调试采集：宿主开启调试浮层后，记录输入事件、选区、内部决策与所聚焦文本块的 DOM 变化，
 * 批量经 bridge 回传宿主。关闭时每个采集点立即返回，不产生任何消息或 DOM 读取。
 *
 * 只用于诊断，不驱动编辑行为；单条与批量都有上限，避免调试本身撑爆消息预算。
 */

import {
    CANVAS_DEBUG_BATCH_MAX_ENTRIES,
    CANVAS_DEBUG_DETAIL_MAX_CODE_UNITS,
    CANVAS_DEBUG_KIND_MAX_CODE_UNITS,
    type CanvasDebugLogEntry,
} from '../protocol/index.ts'
import {CARET_ANCHOR_ATTRIBUTE, CARET_ANCHOR_FILLER} from './caretAnchor.ts'

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const FLUSH_DELAY_MS = 60

/** 零宽填充字符在日志里必须可见，否则锚点问题无从判断。 */
export function visibleDebugText(value: string): string {
    return value.split(CARET_ANCHOR_FILLER).join('⟦ZWSP⟧')
}

export function debugDetailText(value: unknown): string {
    let text: string
    if (value === undefined) text = ''
    else if (typeof value === 'string') text = value
    else {
        try {
            text = JSON.stringify(value) ?? String(value)
        } catch {
            text = String(value)
        }
    }
    text = visibleDebugText(text)
    return text.length > CANVAS_DEBUG_DETAIL_MAX_CODE_UNITS
        ? `${text.slice(0, CANVAS_DEBUG_DETAIL_MAX_CODE_UNITS - 16)}…[截断 ${text.length}]`
        : text
}

function nodeLabel(value: Node): string {
    if (value.nodeType === TEXT_NODE) return '#text'
    if (value.nodeType !== ELEMENT_NODE) return `#${value.nodeType}`
    const element = value as Element
    const name = element.tagName.toLowerCase()
    if (element.hasAttribute(CARET_ANCHOR_ATTRIBUTE)) return `${name}(锚点)`
    if (element.hasAttribute('data-fc-canvas-echo')) return `${name}(回显)`
    const nodeId = element.getAttribute('data-fc-node-id')
    return nodeId ? `${name}#${nodeId.slice(0, 8)}` : name
}

/**
 * 把 DOM 位置描述成从受管节点出发的路径，例如 `p#1a2b3c4d/span(回显)[1]/#text[0]@2 "词条"`。
 * container 不在 scope 内时如实标明，不猜测。
 */
export function describeDomPosition(scope: Node | null, container: Node | null, offset: number): string {
    if (!container) return '无'
    const segments: string[] = []
    let current: Node | null = container
    while (current && current !== scope) {
        const parent: Node | null = current.parentNode
        const index = parent ? Array.from(parent.childNodes).indexOf(current as ChildNode) : -1
        segments.unshift(`${nodeLabel(current)}[${index}]`)
        current = parent
    }
    const inside = current === scope && scope !== null
    const head = inside && scope ? nodeLabel(scope) : '(范围外)'
    const tail = container.nodeType === TEXT_NODE
        ? ` ${JSON.stringify(visibleDebugText(container.nodeValue ?? ''))}`
        : ''
    return `${[head, ...segments].join('/')}@${offset}${tail}`
}

export interface CanvasDebugTrace {
    readonly enabled: boolean
    setEnabled(enabled: boolean): void
    trace(kind: string, detail?: unknown): void
    flush(): void
}

export function createCanvasDebugTrace(
    send: (entries: CanvasDebugLogEntry[]) => void,
    now: () => number = () => performance.timeOrigin + performance.now(),
    schedule: (callback: () => void, delayMs: number) => unknown = (callback, delayMs) => setTimeout(callback, delayMs),
): CanvasDebugTrace {
    let enabled = false
    let buffer: CanvasDebugLogEntry[] = []
    let scheduled = false
    const flush = () => {
        scheduled = false
        while (buffer.length > 0) send(buffer.splice(0, CANVAS_DEBUG_BATCH_MAX_ENTRIES))
    }
    return {
        get enabled() {
            return enabled
        },
        setEnabled(next) {
            enabled = next
            if (!next) buffer = []
        },
        trace(kind, detail) {
            if (!enabled) return
            buffer.push({
                at: now(),
                kind: kind.slice(0, CANVAS_DEBUG_KIND_MAX_CODE_UNITS) || '未命名',
                detail: debugDetailText(detail),
            })
            if (buffer.length >= CANVAS_DEBUG_BATCH_MAX_ENTRIES) {
                flush()
                return
            }
            if (!scheduled) {
                scheduled = true
                schedule(flush, FLUSH_DELAY_MS)
            }
        },
        flush,
    }
}
