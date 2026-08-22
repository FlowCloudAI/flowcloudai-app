/*
 * 移动端外壳的最小复现（**iOS 专用**）：固定顶栏 + 内部滚动区 + 常驻输入区 + 底部 Tab。
 *
 * 本页依赖 MobileUiBridge.m 注入的原生桥拿逐帧键盘位置，在 Android 上无法工作。
 * Android 侧的对应结论见 docs/devlog/2026-08-23-android-软键盘布局接管.md（工作区根仓）。
 *
 * 布局约定（键盘处理的全部结构性前提都在这里，不在 JS 里）：
 *   .lab-shell   固定全屏，永不移动、永不缩放。WKWebView 也保持全屏，
 *                所以键盘底下那块区域仍然由页面自己绘制，物理上不存在"透出下层"。
 *   .lab-column  顶栏 + 滚动区 + 输入区。底边 = max(键盘高度, Tab 高度)，
 *                于是键盘只压缩它，顶栏不动，输入区自然贴在键盘上沿。
 *   .lab-tabbar  绝对定位在屏幕底部，键盘弹出时原地不动、被键盘盖住，
 *                不占用键盘上方任何空间。
 *   .lab-kb-filler 键盘那块区域的同色填充，位于 Tab 之上。
 *                跟随有偏差时露出的是输入区同色，而不是 Tab 的颜色。
 */

import {useEffect, useRef} from 'react'
import {LAB_SIM_DRIVER} from './simDriver'
import IosControls from './IosControls'
import {currentInset} from './keyboardInset'
import {isKeyboardVisible, recordTap, registerProbes} from './kbTrace'

function useTapCounter(ref: React.RefObject<HTMLTextAreaElement | null>, name: string): void {
    useEffect(() => {
        const element = ref.current
        if (!element) return
        /*
         * 只计数，不做任何别的事。
         * 绝不能在这里调用 focus() 或 preventDefault()——那会打断 iOS 的
         * trusted touch → focus → keyboard 事务，表现为键盘刚升起就落下。
         * passive 也是为了向 WebKit 明示这个监听器不会取消默认行为。
         */
        const handler = (): void => recordTap(name)
        element.addEventListener('pointerdown', handler, {passive: true})
        return () => element.removeEventListener('pointerdown', handler)
    }, [ref, name])
}

export default function IosLab(): React.ReactElement {
    const shellRef = useRef<HTMLDivElement>(null)
    const topbarRef = useRef<HTMLElement>(null)
    const composerRef = useRef<HTMLDivElement>(null)
    const tabbarRef = useRef<HTMLElement>(null)
    const liveRef = useRef<HTMLSpanElement>(null)
    const longInputRef = useRef<HTMLTextAreaElement>(null)
    const composerInputRef = useRef<HTMLTextAreaElement>(null)

    useTapCounter(longInputRef, 'long')
    useTapCounter(composerInputRef, 'composer')

    useEffect(() => LAB_SIM_DRIVER(composerInputRef, longInputRef), [])

    useEffect(() => {
        registerProbes({
            shell: shellRef.current,
            topbar: topbarRef.current,
            composer: composerRef.current,
            tabbar: tabbarRef.current,
        })
    }, [])

    useEffect(() => {
        /* 实时读数走直接 DOM 写入并降频，读数本身不进入 React 渲染，避免观测行为影响被测对象 */
        const timer = window.setInterval(() => {
            const element = liveRef.current
            if (!element) return
            const vv = window.visualViewport
            const offsetTop = vv?.offsetTop ?? 0
            const top = topbarRef.current?.getBoundingClientRect().top ?? Number.NaN
            element.textContent =
                `kb ${currentInset().toFixed(0)} · 顶栏rect ${top.toFixed(1)}`
                + ` · vvH ${(vv?.height ?? 0).toFixed(0)} · vvTop ${offsetTop.toFixed(0)}`
                + ` · innerH ${window.innerHeight} · ${isKeyboardVisible() ? '键盘可见' : '无键盘'}`
        }, 100)
        return () => window.clearInterval(timer)
    }, [])

    return (
        <div className="lab-shell" ref={shellRef}>
            <div className="lab-column">
                <header className="lab-topbar" ref={topbarRef}>
                    <div className="lab-topbar-title">固定顶栏 — 必须永远可见</div>
                    <span className="lab-live" ref={liveRef}/>
                </header>

                <div className="lab-scroller">
                    <IosControls/>
                    <p className="lab-hint">内部滚动区。下面是一个比键盘上方可视区更高的输入框。</p>
                    <textarea className="lab-long-input" ref={longInputRef} placeholder="长输入框"/>
                    <p className="lab-hint">滚动区里的其他内容。</p>
                    <div className="lab-filler-block">滚动到底部用的占位内容</div>
                </div>

                <div className="lab-composer" ref={composerRef}>
                    <textarea className="lab-composer-input" ref={composerInputRef} placeholder="底部常驻输入框"/>
                </div>
            </div>

            <nav className="lab-tabbar" ref={tabbarRef}>底部 Tab</nav>
            <div className="lab-kb-filler"/>
        </div>
    )
}
