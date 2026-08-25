/**
 * 顶层导航兜底防护。
 *
 * Tauri 的 WebView 里主文档一旦导航离开应用地址，整个应用就被直接替换掉：
 * `fc://` / `entry-title://` 这类自定义协议会得到 `net::ERR_UNKNOWN_URL_SCHEME`
 * 错误页，http(s) 外链则把站点加载进应用窗口。两种情况都会连同未保存的编辑内容
 * 一起丢失，且没有任何应用内的返回路径——只能靠系统返回键退回冷启动状态。
 *
 * 各个 Markdown 预览面板都应当自己拦截链接并决定行为（跳转词条、走系统浏览器等），
 * 这个 hook 只是最后一道防线，防止将来新增的预览面板漏接又把应用打没。
 *
 * 只在捕获阶段调用 `preventDefault`，不调用 `stopPropagation`：业务侧注册在冒泡阶段的
 * React 处理器仍然照常执行，既有行为不受影响。应用内没有任何链接依赖浏览器的默认导航
 * （外链统一走 `api/opener` 的 `window.open`，不受 `preventDefault` 影响）。
 */
import {useEffect} from 'react'
import {logger} from '../logger'

/** 页内锚点与同文档链接属于正常跳转，不拦。 */
function isSameDocumentTarget(anchor: HTMLAnchorElement): boolean {
    const raw = anchor.getAttribute('href')
    if (!raw || raw.startsWith('#')) return true
    try {
        const url = new URL(raw, document.baseURI)
        return url.origin === window.location.origin
            && url.pathname === window.location.pathname
            && url.search === window.location.search
    } catch {
        // 解析不出来的 href 一律当成不安全的顶层导航。
        return false
    }
}

export function useTopLevelNavigationGuard(): void {
    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            const target = event.target
            if (!(target instanceof Element)) return
            const anchor = target.closest('a')
            if (!anchor || isSameDocumentTarget(anchor)) return
            event.preventDefault()
            logger.warn('已阻止顶层导航：链接未被任何预览面板接管', anchor.getAttribute('href'))
        }

        document.addEventListener('click', handleClick, true)
        return () => document.removeEventListener('click', handleClick, true)
    }, [])
}
