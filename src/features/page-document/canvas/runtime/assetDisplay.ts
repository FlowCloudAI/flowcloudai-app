// 本模块只把可信像素写回原 img；缓存属于当前隔离画布会话，作者资源地址永远不会进入活 DOM。

import type {CanvasAssetFrameCommand} from '../protocol/index.ts'

interface CachedImage {
    url: string
    decoded: boolean
}

interface AssetDisplay {
    image: HTMLImageElement
    status: HTMLSpanElement | null
}

type AssetFailureState = 'loading' | 'unavailable' | 'invalid'

export type CanvasAssetDisplays = Map<string, AssetDisplay[]>

// 与单页受管资产块默认上限一致；宿主只缓存少量原始 RGBA，画布缓存压缩后的图片 URL。
const CACHE_MAX_ENTRIES = 100

export class CanvasAssetImageCache {
    private readonly images = new Map<string, CachedImage>()

    get(assetId: string): CachedImage | null {
        const image = this.images.get(assetId)
        if (!image) return null
        this.images.delete(assetId)
        this.images.set(assetId, image)
        return image
    }

    set(assetId: string, image: CachedImage): void {
        this.images.delete(assetId)
        this.images.set(assetId, image)
        if (this.images.size > CACHE_MAX_ENTRIES) this.images.delete(this.images.keys().next().value!)
    }

    clear(): void {
        this.images.clear()
    }
}

function statusLabel(state: AssetFailureState): string {
    if (state === 'loading') return '正在读取图片…'
    if (state === 'invalid') return '图片格式或内容无效'
    return '图片缺失、无权读取或读取失败'
}

function showStatus(display: AssetDisplay, state: AssetFailureState): void {
    display.image.removeAttribute('src')
    display.image.setAttribute('data-fc-asset-placeholder', '')
    const status = display.status ?? document.createElement('span')
    status.setAttribute('data-fc-asset-state', state)
    status.setAttribute('contenteditable', 'false')
    status.setAttribute('aria-hidden', 'true')
    status.textContent = statusLabel(state)
    if (!display.status) display.image.insertAdjacentElement('afterend', status)
    display.status = status
}

function showImage(display: AssetDisplay, cached: CachedImage): void {
    const {image} = display
    if (cached.decoded) {
        image.removeAttribute('data-fc-asset-placeholder')
        display.status?.remove()
        display.status = null
    }
    const loaded = () => {
        if (image.naturalWidth < 1 || image.naturalHeight < 1) {
            showStatus(display, 'invalid')
            return
        }
        cached.decoded = true
        image.removeAttribute('data-fc-asset-placeholder')
        display.status?.remove()
        display.status = null
    }
    image.addEventListener('load', loaded, {once: true})
    image.addEventListener('error', () => showStatus(display, 'invalid'), {once: true})
    // src 只来自通过信封验证的 RGBA 帧；浏览器在原 img 的层叠、裁剪与变换上下文中绘制。
    image.src = cached.url
    if (cached.decoded && image.complete && image.naturalWidth > 0) loaded()
}

export function imageDataUrlForOriginalSize(
    png: string,
    previewWidth: number,
    previewHeight: number,
    originalWidth: number,
    originalHeight: number,
): string {
    if (originalWidth === previewWidth && originalHeight === previewHeight) return png
    // 预览帧仍最多 512 像素；可信 SVG 只声明原图固有尺寸，内嵌的唯一图片仍是该预览像素。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${previewWidth} ${previewHeight}" preserveAspectRatio="none"><image width="${previewWidth}" height="${previewHeight}" href="${png}"/></svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function encodedImageUrl(command: CanvasAssetFrameCommand): string | null {
    try {
        const raw = atob(command.rgbaBase64)
        if (raw.length !== command.width * command.height * 4) return null
        const pixels = Uint8ClampedArray.from(raw, character => character.charCodeAt(0))
        const canvas = document.createElement('canvas')
        canvas.width = command.width
        canvas.height = command.height
        const context = canvas.getContext('2d')
        if (!context) return null
        context.putImageData(new ImageData(pixels, command.width, command.height), 0, 0)
        const png = canvas.toDataURL('image/png')
        if (!png.startsWith('data:image/png;base64,')) return null
        return imageDataUrlForOriginalSize(png, command.width, command.height,
            command.originalWidth, command.originalHeight)
    } catch {
        return null
    }
}

export function mountCanvasAssetDisplays(root: HTMLElement, cache: CanvasAssetImageCache): CanvasAssetDisplays {
    const displays: CanvasAssetDisplays = new Map()
    for (const image of root.querySelectorAll<HTMLImageElement>('img[data-fc-canvas-asset-id]')) {
        const id = image.getAttribute('data-fc-canvas-asset-id')?.toLowerCase()
        if (!id) continue
        const display: AssetDisplay = {image, status: null}
        const cached = cache.get(id)
        if (cached?.decoded) showImage(display, cached)
        else showStatus(display, 'loading')
        displays.set(id, [...displays.get(id) ?? [], display])
    }
    return displays
}

export function missingCanvasAssetIds(displays: CanvasAssetDisplays, cache: CanvasAssetImageCache): string[] {
    return [...displays.keys()].filter(id => !cache.get(id)?.decoded)
}

export function applyCanvasAssetFrame(
    displays: CanvasAssetDisplays,
    cache: CanvasAssetImageCache,
    command: CanvasAssetFrameCommand,
): boolean {
    const targets = displays.get(command.assetId.toLowerCase())
    if (!targets) return false
    const status = command.status
    if (status !== 'ready') {
        targets.forEach(target => showStatus(target, status))
        return false
    }
    const url = encodedImageUrl(command)
    if (!url) {
        targets.forEach(target => showStatus(target, 'invalid'))
        return false
    }
    const cached: CachedImage = {url, decoded: false}
    cache.set(command.assetId.toLowerCase(), cached)
    targets.forEach(target => showImage(target, cached))
    return true
}
