// 本模块在画布启动后创建可信运行时样式和作者样式，避免静态 style 元素触发 Tauri 的 nonce 改写。

export interface CanvasStyleElements {
    runtimeStyle: HTMLStyleElement
    authorStyle: HTMLStyleElement
}

function createStyleElement(documentScope: Document, scope: 'runtime' | 'author', css: string): HTMLStyleElement {
    const element = documentScope.createElement('style')
    element.setAttribute('data-fc-canvas-style', scope)
    element.textContent = css
    return element
}

export function mountCanvasStyles(documentScope: Document, runtimeCss: string): CanvasStyleElements {
    const runtimeStyle = createStyleElement(documentScope, 'runtime', runtimeCss)
    const authorStyle = createStyleElement(documentScope, 'author', '')
    // runtime 内的默认层必须先声明，后挂载的作者层才能以更高优先级覆盖主题变量和排版。
    documentScope.head.append(runtimeStyle, authorStyle)
    return {runtimeStyle, authorStyle}
}
