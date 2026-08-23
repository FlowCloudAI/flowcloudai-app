/*
 * 移动端局部视图转场适配：统一处理浏览器能力检测与减少动态效果降级。
 * 业务页面只提交同步状态更新，不直接依赖 View Transition API 的生命周期。
 */

import {flushSync} from 'react-dom'

export function runMobileViewTransition(update: () => void) {
    if (
        typeof document.startViewTransition !== 'function'
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
        update()
        return
    }

    const transition = document.startViewTransition(() => flushSync(update))
    void transition.finished.catch(() => undefined)
}
