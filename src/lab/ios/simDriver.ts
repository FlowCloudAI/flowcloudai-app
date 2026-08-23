/*
 * 模拟器筛查驱动。**只用于模拟器，真机验证前必须把 enabled 改回 false。**
 *
 * 为什么需要它：这台 Mac 上驱动模拟器的两条通道都不可用——
 * MCP 原生集成因 xcode-select 未持久化而拒绝启动，osascript 又没有辅助访问权限。
 * 没有合成点击，就无法在模拟器上触发键盘。
 *
 * 它做的事：定时对输入框调用 focus()/blur()，制造成对的键盘升起/收起事务，
 * 让配置矩阵可以靠 Vite 热更新无人值守跑完。
 *
 * 它**不能**用来做什么：程序化聚焦不经过 iOS 的 trusted touch → focus → keyboard 事务，
 * 所以它对需求 7（真实手指点击的呼出成功率）没有任何证明力。那一项只能在真机上数点击。
 * 它也不写入点击统计，避免污染分母。
 */

import type {RefObject} from 'react'

interface SimDriverConfig {
    enabled: boolean
    /** 先聚焦哪个：底部常驻输入框，还是比可视区更高的长输入框 */
    target: 'composer' | 'long'
    /** 首次聚焦前的等待，留出原生桥安装和页面稳定的时间 */
    startDelayMs: number
    /** 键盘保持可见的时长 */
    holdMs: number
    /** 键盘收起后的间隔 */
    gapMs: number
    /** 循环几轮后停下 */
    cycles: number
}

const CONFIG: SimDriverConfig = {
    enabled: false,   /* 实测：程序化 focus() 唤不起 WKWebView 的键盘，此驱动无效，保留仅备查 */
    target: 'composer',
    startDelayMs: 2500,
    holdMs: 3000,
    gapMs: 2500,
    cycles: 3,
}

export function LAB_SIM_DRIVER(
    composer: RefObject<HTMLTextAreaElement | null>,
    long: RefObject<HTMLTextAreaElement | null>,
): (() => void) | undefined {
    if (!CONFIG.enabled) return undefined

    const timers: number[] = []
    let cancelled = false

    const pick = (): HTMLTextAreaElement | null =>
        (CONFIG.target === 'composer' ? composer.current : long.current)

    const runCycle = (index: number): void => {
        if (cancelled || index >= CONFIG.cycles) return
        const element = pick()
        if (!element) return
        element.focus()
        timers.push(window.setTimeout(() => {
            if (cancelled) return
            element.blur()
            timers.push(window.setTimeout(() => runCycle(index + 1), CONFIG.gapMs))
        }, CONFIG.holdMs))
    }

    timers.push(window.setTimeout(() => runCycle(0), CONFIG.startDelayMs))

    return () => {
        cancelled = true
        for (const timer of timers) window.clearTimeout(timer)
    }
}
