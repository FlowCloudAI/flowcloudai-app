/**
 * 系统相机能力的前端边界。页面只接收应用私有缓存中的临时图片路径，
 * 不在 WebView 与 Rust 之间复制整张图片，也不把结果直接接入 AI 会话。
 */

import {invoke} from '@tauri-apps/api/core'
import {isTauriRuntime} from '../shared/devPreview'

export interface CapturedPhoto {
    tempPath: string
    mimeType: string
    width: number
    height: number
    byteLength: number
}

/** 调用 Android 系统相机拍摄一张原图，并返回应用私有缓存路径。 */
export function captureSystemPhoto(): Promise<CapturedPhoto> {
    if (!isTauriRuntime()) {
        return Promise.reject(new Error('系统相机只能在 Android 应用中使用'))
    }
    return invoke<CapturedPhoto>('plugin:flow-camera|capture')
}

/** 图片被业务层导入后，删除插件缓存中的重复临时副本。 */
export function discardCapturedPhoto(tempPath: string): Promise<void> {
    if (!isTauriRuntime()) return Promise.resolve()
    return invoke<void>('plugin:flow-camera|discard', {tempPath})
}

/** 原生相机用错误码区分用户主动取消，页面不应把它显示成故障。 */
export function isCameraCaptureCancelled(error: unknown): boolean {
    const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
            ? error
            : JSON.stringify(error)
    return message.includes('CAMERA_CANCELLED') || message.includes('用户取消拍照')
}
