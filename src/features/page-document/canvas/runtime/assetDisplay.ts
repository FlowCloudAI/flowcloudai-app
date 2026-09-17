// 本模块让原始 img 继续承担作者样式、布局、可见性和点选；受控 canvas 只覆盖像素，资源 URL 不进活 DOM。

import type {CanvasAssetFrameCommand} from '../protocol/index.ts'

interface AssetDisplay {
    image: HTMLImageElement
    overlay: HTMLSpanElement
    canvas: HTMLCanvasElement
    status: HTMLSpanElement
    originalOpacity: string
    originalOpacityPriority: string
    needsIntrinsicSize: boolean
    state: CanvasAssetFrameCommand['status'] | 'loading'
}

export type CanvasAssetDisplays = Map<string, AssetDisplay[]>

const disposers = new WeakMap<CanvasAssetDisplays, () => void>()

function restoreAuthorOpacity(display: AssetDisplay): void {
    const {image, originalOpacity, originalOpacityPriority} = display
    if (originalOpacity) image.style.setProperty('opacity', originalOpacity, originalOpacityPriority)
    else image.style.removeProperty('opacity')
}

function syncDisplay(root: HTMLElement, display: AssetDisplay): void {
    restoreAuthorOpacity(display)
    const style = getComputedStyle(display.image)
    const imageRect = display.image.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    let opacity = Number(style.opacity)
    for (let parent = display.image.parentElement; parent && parent !== root; parent = parent.parentElement) {
        opacity *= Number(getComputedStyle(parent).opacity)
    }
    // 保留 img 供作者选择器、DOM 身份与点击命中；只遮住无 src 的浏览器占位图。
    display.image.style.setProperty('opacity', '0')
    const visible = !display.image.hidden && style.display !== 'none' && style.visibility === 'visible' &&
        opacity > 0 && imageRect.width > 0 && imageRect.height > 0
    const {overlay, canvas, status} = display
    canvas.hidden = !visible || display.state !== 'ready'
    status.hidden = !visible || display.state === 'ready'
    overlay.hidden = !visible
    if (!visible) return
    const left = imageRect.left - rootRect.left - root.clientLeft + root.scrollLeft
    const top = imageRect.top - rootRect.top - root.clientTop + root.scrollTop
    overlay.style.left = `${left}px`
    overlay.style.top = `${top}px`
    overlay.style.width = `${imageRect.width}px`
    overlay.style.height = `${imageRect.height}px`
    overlay.style.opacity = String(opacity)
    let clipTop = 0
    let clipRight = 0
    let clipBottom = 0
    let clipLeft = 0
    for (let parent = display.image.parentElement; parent && parent !== root; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent)
        if (parentStyle.overflowX === 'visible' && parentStyle.overflowY === 'visible') continue
        const rect = parent.getBoundingClientRect()
        if (parentStyle.overflowY !== 'visible') {
            clipTop = Math.max(clipTop, rect.top - imageRect.top)
            clipBottom = Math.max(clipBottom, imageRect.bottom - rect.bottom)
        }
        if (parentStyle.overflowX !== 'visible') {
            clipLeft = Math.max(clipLeft, rect.left - imageRect.left)
            clipRight = Math.max(clipRight, imageRect.right - rect.right)
        }
    }
    overlay.style.clipPath = clipTop || clipRight || clipBottom || clipLeft
        ? `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)` : 'none'
    canvas.style.objectFit = style.objectFit
    canvas.style.objectPosition = style.objectPosition
    canvas.style.borderRadius = style.borderRadius
    canvas.style.border = style.border
    canvas.style.padding = style.padding
    canvas.style.filter = style.filter
    canvas.style.clipPath = style.clipPath
    canvas.style.boxShadow = style.boxShadow
}

export function syncCanvasAssetDisplays(root: HTMLElement, displays: CanvasAssetDisplays): void {
    for (const targets of displays.values()) {
        for (const display of targets) syncDisplay(root, display)
    }
}

export function disposeCanvasAssetDisplays(displays: CanvasAssetDisplays): void {
    disposers.get(displays)?.()
    disposers.delete(displays)
}

export function mountCanvasAssetDisplays(root: HTMLElement): CanvasAssetDisplays {
    const displays: CanvasAssetDisplays = new Map()
    root.style.position = 'relative'
    for (const image of root.querySelectorAll<HTMLImageElement>('img[data-fc-canvas-asset-id]')) {
        const id = image.getAttribute('data-fc-canvas-asset-id')
        if (!id) continue
        const canvas = document.createElement('canvas')
        canvas.setAttribute('data-fc-asset-display', id)
        canvas.setAttribute('aria-hidden', 'true')
        canvas.hidden = true
        const status = document.createElement('span')
        status.setAttribute('data-fc-asset-state', 'loading')
        status.textContent = '正在读取图片…'
        status.hidden = true
        const overlay = document.createElement('span')
        overlay.setAttribute('data-fc-asset-overlay', '')
        overlay.style.position = 'absolute'
        overlay.style.pointerEvents = 'none'
        overlay.style.boxSizing = 'border-box'
        overlay.append(canvas, status)
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.boxSizing = 'border-box'
        status.style.position = 'absolute'
        status.style.inset = '0'
        status.style.boxSizing = 'border-box'
        const needsIntrinsicSize = !image.hasAttribute('width') && !image.hasAttribute('height')
        const display: AssetDisplay = {
            image, overlay, canvas, status,
            originalOpacity: image.style.getPropertyValue('opacity'),
            originalOpacityPriority: image.style.getPropertyPriority('opacity'),
            needsIntrinsicSize,
            state: 'loading',
        }
        // 无 src 的 img 没有固有尺寸；仅给缺失的运行时副本补占位比例，原有尺寸属性不改。
        if (needsIntrinsicSize) {
            image.width = 160
            image.height = 96
        }
        root.append(overlay)
        displays.set(id, [...displays.get(id) ?? [], display])
    }
    if (displays.size === 0) return displays
    let active = true
    const sync = () => { if (active) syncCanvasAssetDisplays(root, displays) }
    const observer = new ResizeObserver(sync)
    for (const targets of displays.values()) {
        for (const {image} of targets) observer.observe(image)
    }
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    disposers.set(displays, () => {
        active = false
        observer.disconnect()
        window.removeEventListener('resize', sync)
        window.removeEventListener('scroll', sync, true)
    })
    sync()
    return displays
}

export function selectCanvasAssetDisplays(displays: CanvasAssetDisplays, nodeId: string | null): void {
    for (const targets of displays.values()) {
        for (const {image, canvas} of targets) {
            canvas.toggleAttribute('data-fc-canvas-selected', image.getAttribute('data-fc-node-id') === nodeId && nodeId !== null)
        }
    }
}

export function applyCanvasAssetFrame(
    root: HTMLElement,
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
    for (const display of targets) {
        const {image, canvas, status} = display
        const context = pixels ? canvas.getContext('2d') : null
        if (context && pixels) {
            canvas.width = command.width
            canvas.height = command.height
            context.putImageData(new ImageData(new Uint8ClampedArray(pixels), command.width, command.height), 0, 0)
            if (display.needsIntrinsicSize) {
                image.width = command.width
                image.height = command.height
            }
            display.state = 'ready'
            status.setAttribute('data-fc-asset-state', 'ready')
            status.textContent = ''
        } else {
            display.state = command.status === 'ready' ? 'invalid' : command.status
            status.setAttribute('data-fc-asset-state', display.state)
            status.textContent = display.state === 'invalid'
                ? '图片格式或内容无效'
                : '图片缺失、无权读取或读取失败'
        }
    }
    syncCanvasAssetDisplays(root, displays)
    return Boolean(pixels)
}
