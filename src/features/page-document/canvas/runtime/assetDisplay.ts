// 本模块仅将宿主授权后下发的有界 RGBA 像素绘入画布；作者资源 URL 永远不进入活 DOM。

import type {CanvasAssetFrameCommand} from '../protocol/index.ts'

interface AssetDisplay {
    canvas: HTMLCanvasElement
    status: HTMLSpanElement
}

export type CanvasAssetDisplays = Map<string, AssetDisplay[]>

export function mountCanvasAssetDisplays(root: HTMLElement): CanvasAssetDisplays {
    const displays: CanvasAssetDisplays = new Map()
    for (const image of root.querySelectorAll<HTMLImageElement>('img[data-fc-canvas-asset-id]')) {
        const id = image.getAttribute('data-fc-canvas-asset-id')
        if (!id) continue
        const canvas = document.createElement('canvas')
        canvas.setAttribute('data-fc-asset-display', id)
        canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', image.alt || '页面图片')
        canvas.className = image.className
        canvas.style.cssText = image.style.cssText
        canvas.hidden = true
        const status = document.createElement('span')
        status.setAttribute('data-fc-asset-state', 'loading')
        status.textContent = '正在读取图片…'
        image.replaceWith(canvas, status)
        displays.set(id, [...displays.get(id) ?? [], {canvas, status}])
    }
    return displays
}

export function applyCanvasAssetFrame(
    displays: CanvasAssetDisplays,
    command: CanvasAssetFrameCommand,
): boolean {
    const targets = displays.get(command.assetId.toLowerCase())
    if (!targets) return false
    let pixels: Uint8ClampedArray | null = null
    if (command.status === 'ready') {
        try {
            const decoded = atob(command.rgbaBase64)
            if (decoded.length !== command.width * command.height * 4) throw new TypeError('像素长度不符')
            pixels = Uint8ClampedArray.from(decoded, character => character.charCodeAt(0))
        } catch {
            pixels = null
        }
    }
    for (const {canvas, status} of targets) {
        const context = pixels ? canvas.getContext('2d') : null
        if (context && pixels) {
            canvas.width = command.width
            canvas.height = command.height
            context.putImageData(new ImageData(new Uint8ClampedArray(pixels), command.width, command.height), 0, 0)
            canvas.hidden = false
            status.hidden = true
            status.setAttribute('data-fc-asset-state', 'ready')
            status.textContent = ''
        } else {
            canvas.hidden = true
            status.hidden = false
            status.setAttribute('data-fc-asset-state', command.status)
            status.textContent = command.status === 'invalid'
                ? '图片格式或内容无效'
                : '图片缺失、无权读取或读取失败'
        }
    }
    return Boolean(pixels)
}
