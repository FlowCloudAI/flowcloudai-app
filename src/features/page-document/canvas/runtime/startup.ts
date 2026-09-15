// 本模块只协调画布的 DOM 就绪时序与可信启动参数；消息监听及渲染副作用仍由运行时入口拥有。

import {readCanvasSessionToken} from './sessionToken.ts'

export interface CanvasStartupContext {
    token: string
    root: HTMLElement
}

export function requireCanvasStartupContext(
    documentScope: Document,
    windowScope: Pick<Window, 'location'>,
): CanvasStartupContext {
    const token = readCanvasSessionToken(windowScope.location.hash)
    if (!token) throw new Error('隔离画布缺少可信会话令牌。')

    const root = documentScope.querySelector<HTMLElement>('#page-document-canvas-root')
    if (!root) throw new Error('隔离画布缺少根节点。')

    return {token, root}
}

export function startCanvasRuntimeWhenReady(documentScope: Document, start: () => void): void {
    if (documentScope.readyState === 'loading') {
        documentScope.addEventListener('DOMContentLoaded', start, {once: true})
        return
    }
    start()
}
