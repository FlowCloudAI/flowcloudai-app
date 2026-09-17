// 本模块只把可信像素写回原 img；缓存属于当前隔离画布会话，作者资源地址永远不会进入活 DOM。

import type {CanvasAssetFrameCommand} from '../protocol/index.ts'

interface CachedImage {
    url: string
    state: 'ready' | 'unavailable' | 'invalid'
    decoded: boolean
}

interface AssetDisplay {
    image: HTMLImageElement
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

function statusImageUrl(state: AssetFailureState): string {
    const label = statusLabel(state)
    // 固定文案的可信 SVG 只作为原 img 的 src；它不引入作者 URL、外部资源或额外 DOM 节点。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="96" viewBox="0 0 240 96"><rect x="1" y="1" width="238" height="94" fill="Canvas" stroke="GrayText" stroke-dasharray="5 4"/><text x="120" y="50" text-anchor="middle" dominant-baseline="middle" fill="GrayText" font-family="sans-serif" font-size="13">${label}</text></svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function showStatus(display: AssetDisplay, state: AssetFailureState): void {
    display.image.removeAttribute('data-fc-asset-placeholder')
    display.image.setAttribute('data-fc-asset-state', state)
    display.image.src = statusImageUrl(state)
}

function showImage(display: AssetDisplay, cached: CachedImage, onInvalid: () => void): void {
    const {image} = display
    image.removeAttribute('data-fc-asset-placeholder')
    image.removeAttribute('data-fc-asset-state')
    const loaded = () => {
        if (image.src !== cached.url) return
        if (image.naturalWidth < 1 || image.naturalHeight < 1) {
            onInvalid()
            return
        }
        cached.decoded = true
    }
    image.addEventListener('load', loaded, {once: true})
    image.addEventListener('error', () => {
        if (image.src === cached.url) onInvalid()
    }, {once: true})
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
        const display: AssetDisplay = {image}
        const cached = cache.get(id)
        if (!cached) showStatus(display, 'loading')
        else if (cached.state === 'ready') showImage(display, cached, () => {
            cache.set(id, {url: statusImageUrl('invalid'), state: 'invalid', decoded: true})
            showStatus(display, 'invalid')
        })
        else showStatus(display, cached.state)
        displays.set(id, [...displays.get(id) ?? [], display])
    }
    return displays
}

export function missingCanvasAssetIds(displays: CanvasAssetDisplays, cache: CanvasAssetImageCache): string[] {
    return [...displays.keys()].filter(id => !cache.get(id))
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
        cache.set(command.assetId.toLowerCase(), {url: statusImageUrl(status), state: status, decoded: true})
        targets.forEach(target => showStatus(target, status))
        return false
    }
    const url = encodedImageUrl(command)
    if (!url) {
        cache.set(command.assetId.toLowerCase(), {url: statusImageUrl('invalid'), state: 'invalid', decoded: true})
        targets.forEach(target => showStatus(target, 'invalid'))
        return false
    }
    const cached: CachedImage = {url, state: 'ready', decoded: false}
    cache.set(command.assetId.toLowerCase(), cached)
    targets.forEach(target => showImage(target, cached, () => {
        cache.set(command.assetId.toLowerCase(), {url: statusImageUrl('invalid'), state: 'invalid', decoded: true})
        showStatus(target, 'invalid')
    }))
    return true
}
