/**
 * 桌面系统文件打开请求的前端边界。
 *
 * 系统事件先由 Rust 队列持久到当前进程；前端监听提示事件后再主动拉取，避免冷启动丢事件。
 */
import {command} from './base'

export const DESKTOP_FILE_OPEN_PENDING_EVENT = 'desktop-file-open-pending'

export type DesktopFileKind = 'fcworld' | 'fcplug'

export interface DesktopFileOpenRequest {
    id: number
    kind: DesktopFileKind
    path: string
}

export const desktop_take_pending_file_open_requests = () =>
    command<DesktopFileOpenRequest[]>('desktop_take_pending_file_open_requests')
