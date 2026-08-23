/**
 * 桌面文件打开请求的前端进程队列。
 *
 * Rust 队列负责跨越原生冷启动；本模块在 WebView 内继续串行化请求，并故意放在 React
 * 生命周期之外，避免 StrictMode 首次挂载清理时把已经从 Rust 取出的请求一并丢掉。
 */
import {useSyncExternalStore} from 'react'
import {
    desktop_take_pending_file_open_requests,
    type DesktopFileOpenRequest,
} from '../../api/desktopFileOpen'

const listeners = new Set<() => void>()
const knownRequestIds = new Set<number>()
const pendingRequests: DesktopFileOpenRequest[] = []

let version = 0
let drainRequested = false
let drainInFlight: Promise<void> | null = null

function emit() {
    version += 1
    for (const listener of listeners) listener()
}

function appendRequests(requests: DesktopFileOpenRequest[]) {
    let changed = false
    for (const request of requests) {
        if (knownRequestIds.has(request.id)) continue
        knownRequestIds.add(request.id)
        pendingRequests.push(request)
        changed = true
    }
    if (changed) emit()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getSnapshot() {
    return version
}

/**
 * 拉取 Rust 队列。原生事件若在一次 IPC 尚未结束时再次到达，会把标记留给下一轮，
 * 避免“事件已经发出，但请求刚好错过本次 drain”造成请求滞留。
 */
export function requestDesktopFileOpenDrain(): Promise<void> {
    drainRequested = true
    if (drainInFlight) return drainInFlight

    drainInFlight = (async () => {
        while (drainRequested) {
            drainRequested = false
            appendRequests(await desktop_take_pending_file_open_requests())
        }
    })().finally(() => {
        drainInFlight = null
    })

    return drainInFlight
}

export function takeNextDesktopFileOpenRequest(): DesktopFileOpenRequest | null {
    const request = pendingRequests.shift() ?? null
    if (request) emit()
    return request
}

export function useDesktopFileOpenQueueVersion() {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
