/*
 * 键盘遮挡高度的三种来源，运行期可切换，用来做同一台真机上的对照。
 *
 *   visual-viewport  纯 Web。kb = innerHeight - vv.height - vv.offsetTop。
 *                    不需要原生代码，但更新时机由 WebKit 决定，动画过程大概率采不到。
 *   native-event     原生 UIKeyboardWillChangeFrame 给目标高度 + 时长 + 曲线，
 *                    页面用一条同时长同曲线的 CSS 过渡去跟。零逐帧 IPC，
 *                    但曲线必须和系统一致，且交互式收起（拖拽关键盘）时系统给的时长是 0。
 *   native-frame     原生 CADisplayLink 逐帧读 keyboardLayoutGuide 的 presentationLayer，
 *                    每帧把真实高度推给页面，页面不做过渡。跟随性最好，代价是每帧一次 IPC。
 *
 * 写入方式统一是给 documentElement 设 --fc-kb，绕开 React 渲染——
 * 逐帧走 setState 会把布局更新压到 React 的调度里，正是"跟不上键盘"的常见原因。
 */

import {logToNative, nativeToPageTime, onNativeEvent, onNativeFrame, requestNativeState} from './kbNative'
import {normalizeProbeHeight, probeFloorValue, setProbeFloor} from './kbTrace'

export type InsetSource = 'off' | 'visual-viewport' | 'native-event' | 'native-frame'
export type InteractiveWidget = 'resizes-visual' | 'resizes-content' | 'overlays-content'

/**
 * UIViewAnimationCurve 7（键盘专用曲线）没有公开定义。
 * 这条值是从真机/模拟器 44 帧升起段的 presentationLayer 采样拟合出来的：
 * 归一化残差 RMS 0.0047，折算到 404px 行程上约 ±1.9px。
 * 广为流传的近似 cubic-bezier(0.38,0.7,0.125,1) 在同一份数据上 RMS 0.0425（约 ±17px），不可用。
 */
const KEYBOARD_CURVE = 'cubic-bezier(0.3, 0.8, 0.225, 1)'
const STANDARD_CURVES: Record<number, string> = {
    0: 'cubic-bezier(0.42, 0, 0.58, 1)',
    1: 'cubic-bezier(0.42, 0, 1, 1)',
    2: 'cubic-bezier(0, 0, 0.58, 1)',
    3: 'linear',
}

/*
 * 系统发出 WillChangeFrame 的时刻，键盘图层动画**还没开始**。
 * 本机实测：通知 t=77.4ms，DidChangeFrame t=485.5ms，485.5 − 383 = 102.5 才是动画起点，
 * 即通知早于动画约 25ms。零补偿时输入区因此领先键盘约 50px（峰值速度约 3px/ms）。
 *
 * 这个值会随系统版本漂移，所以不把它当常量信任：每次事务都用逐帧探针实测一遍，
 * 用指数平滑跟上，并把观测值写进日志，漂移可见。
 */
const startupSamples: number[] = []
/** 观测到位前的兜底值，取自本机实测均值；有观测后一律用中位数 */
let startupOffsetMs = 10
let source: InsetSource = 'off'
let current = 0
let disposers: Array<() => void> = []
const listeners = new Set<(value: number) => void>()

let lastAppliedTransition = ''

function apply(value: number, transition: string, reason = '?'): void {
    const next = Math.max(0, value)
    /* 只在跳变或过渡串变化时记一条，逐帧写不进日志 */
    if (Math.abs(next - current) > 40 || transition !== lastAppliedTransition) {
        logToNative(`JS|apply2|${reason}|${current.toFixed(1)}→${next.toFixed(1)}|${transition}`)
    }
    lastAppliedTransition = transition
    current = next
    const root = document.documentElement
    root.style.setProperty('--fc-kb-transition', transition)
    root.style.setProperty('--fc-kb', `${next.toFixed(2)}px`)
    for (const listener of listeners) listener(next)
}

/*
 * 键盘高度的"可信上限"。
 *
 * 起因：真机上 UIKit 自己 announce 的高度带瞬时尖峰——实测 143 → **587** → 401.7，
 * 以及 401.7 → **629.7** → 401.7，尖峰只存在 57~88ms。屏高 852，629.7 意味着键盘顶边
 * 落在 y=222，忠实跟随它就是把输入区甩到屏幕顶部。60Hz 采样时补间过渡把尖峰削平了，
 * 追不上去；采样提到 120Hz 后追上了，问题才显形——所以这不是新 bug，是精度提高后暴露的旧行为。
 *
 * 规则：只有**真正稳定下来**的高度才能抬高上限。尖峰永远不会稳定，所以永远抬不高它。
 * 判据是"最后一个目标之后 220ms 内没有新目标"——尖峰最长 88ms，留了 2.5 倍余量。
 * 上限按屏高分键持久化：键盘高度是设备属性，学一次就够，不必每次冷启动重学。
 */
const CEILING_STABLE_MS = 220
/** 尚未学到上限时的兜底窗口：取最近这段时间里最小的目标值，尖峰因此被它前面的低目标压住 */
const CEILING_BOOTSTRAP_MS = 150

let ceiling = Number.POSITIVE_INFINITY
let ceilingLoaded = false
let commitTimer = 0
const recentTargets: Array<{ t: number; value: number }> = []

function ceilingKey(): string {
    return `fc-kb-ceiling:${window.innerHeight}`
}

function loadCeiling(): void {
    if (ceilingLoaded) return
    ceilingLoaded = true
    try {
        const stored = window.localStorage.getItem(ceilingKey())
        const value = stored === null ? Number.NaN : Number.parseFloat(stored)
        if (Number.isFinite(value) && value > 0) ceiling = value
    } catch {
        /* 隐私模式等情况下 localStorage 会抛异常，退回"未学到"，靠兜底窗口顶着 */
    }
}

function commitCeiling(value: number): void {
    const next = ceiling === Number.POSITIVE_INFINITY ? value : Math.max(ceiling, value)
    if (next === ceiling) return
    ceiling = next
    try {
        window.localStorage.setItem(ceilingKey(), String(next))
    } catch {
        /* 存不下也不影响本次会话，只是下次要重学 */
    }
    logToNative(`JS|ceiling|learned=${next.toFixed(1)}`)
}

function noteTarget(target: number): void {
    if (!(target > 0)) return
    const now = performance.now()
    recentTargets.push({t: now, value: target})
    while (recentTargets.length > 0 && now - recentTargets[0].t > CEILING_BOOTSTRAP_MS) {
        recentTargets.shift()
    }
    window.clearTimeout(commitTimer)
    commitTimer = window.setTimeout(() => commitCeiling(target), CEILING_STABLE_MS)
}

function effectiveCeiling(): number {
    loadCeiling()
    if (ceiling !== Number.POSITIVE_INFINITY) return ceiling
    if (recentTargets.length === 0) return Number.POSITIVE_INFINITY
    return Math.min(...recentTargets.map(item => item.value))
}

export function ceilingValue(): number {
    loadCeiling()
    return ceiling
}

export function currentInset(): number {
    return current
}

export function onInsetChange(listener: (value: number) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function fromVisualViewport(): number {
    const vv = window.visualViewport
    if (!vv) return 0
    return Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
}

/*
 * 探针零点标定。
 *
 * keyboardLayoutGuide 在键盘收起时并不落到 0，两台机器实测都停在 68pt。
 * 第一版用"整段会话里的最小值"当地板，结果被动画中途的采样污染——
 * 地板被标到 79，于是键盘已经升了 158px 布局还纹丝不动。
 * 正确做法是只在键盘**确定收起后**读一次原生探针值。
 */
function calibrateProbeFloor(): void {
    void requestNativeState().then(state => {
        if (state) setProbeFloor(state.probeKeyboardHeight)
    })
}

export function setInsetSource(next: InsetSource): void {
    for (const dispose of disposers) dispose()
    disposers = []
    source = next
    followPerFrame = false
    apply(0, '0s', 'setSource')
    if (next === 'native-frame') calibrateProbeFloor()

    if (next === 'visual-viewport') {
        const handler = (): void => apply(fromVisualViewport(), '0s', 'vv')
        window.visualViewport?.addEventListener('resize', handler)
        window.visualViewport?.addEventListener('scroll', handler)
        disposers.push(() => {
            window.visualViewport?.removeEventListener('resize', handler)
            window.visualViewport?.removeEventListener('scroll', handler)
        })
        handler()
        return
    }

    if (next === 'native-event') {
        disposers.push(onNativeEvent(event => noteTarget(event.target)))
        disposers.push(onNativeFrame((raw, nativeTime) => {
            observeStartup(raw, nativeTime)
            if (followPerFrame) apply(Math.min(normalizeProbeHeight(raw), effectiveCeiling()), '0s', 'follow')
        }))
        disposers.push(onNativeEvent(event => {
            if (event.name !== 'UIKeyboardWillChangeFrameNotification'
                && event.name !== 'UIKeyboardWillHideNotification') return
            const easing = event.curve === 7 ? KEYBOARD_CURVE : (STANDARD_CURVES[event.curve] ?? KEYBOARD_CURVE)
            /*
             * 收起方向系统一律报 duration=0（✓ 收起、手指拖拽收起都是），
             * 所以这个方向没有时长和曲线可用，CSS 过渡无从谈起——瞬时跳会让输入区
             * 抢在键盘前面落到底、被还没走完的键盘盖住（实测偏差 −265px）。
             * 这个方向改为交给逐帧探针跟随，顺带也就正确处理了交互式拖拽收起。
             */
            if (event.duration <= 0) {
                followPerFrame = true
                return
            }
            followPerFrame = false
            /*
             * 关于起步时刻的补偿，实测推翻了一个想当然的假设：
             * WillChangeFrame 发出时键盘动画**还没开始**——本机实测通知早于图层动画约 25ms
             * （通知 77.4ms，DidChangeFrame 485.5ms，485.5 − 383 = 102.5 才是真正的起点）。
             * 所以"页面收到事件时动画已跑了一段、要用负 delay 追回来"是错的，
             * 那样会让输入区领先键盘（实测最多 72px），在键盘上方露出一条带——比落后更糟。
             *
             * IPC 迟到量与这 25ms 启动延迟方向相反、量级相当，净补偿接近 0，
             * 所以这里不做补偿。真实偏差由逐帧数据判定，不靠推理。
             */
            /*
             * 页面应当在 动画起点 = 通知时刻 + startupOffset 起步。
             * 它收到事件的时刻是 通知时刻 + IPC 延迟，两者之差就是该用的 delay：
             * 正值表示还早、等一等，负值表示已经晚了、从中途接上。
             */
            const arrivalOffset = performance.now() - nativeToPageTime(event.t)
            const delay = Math.max(-(event.duration * 1000 - 16), startupOffsetMs - arrivalOffset)
            apply(Math.min(event.target, effectiveCeiling()), `${event.duration.toFixed(3)}s ${easing} ${delay.toFixed(0)}ms`, 'show')
            logToNative(`JS|apply|target=${event.target.toFixed(0)}|dur=${event.duration.toFixed(3)}`
                + `|arrival=${arrivalOffset.toFixed(1)}|startup=${startupOffsetMs.toFixed(1)}|delay=${delay.toFixed(1)}`)
            beginStartupProbe(event.t, event.target)
        }))
        return
    }

    if (next === 'native-frame') {
        disposers.push(onNativeEvent(event => noteTarget(event.target)))
        let lastPushTime = 0
        const intervals: number[] = []
        disposers.push(onNativeFrame(raw => {
            /*
             * 推送间隔不均（真机实测 25~40ms），每次都用 0s 硬写，运动就是台阶状的——
             * 用户观察到的"抖动"就是这个。给每次推送配一段等于推送间隔的线性过渡，
             * 把采样点之间补起来。代价是约半个间隔的额外延迟，换连续运动。
             */
            const now = performance.now()
            if (lastPushTime > 0) {
                intervals.push(now - lastPushTime)
                if (intervals.length > 12) intervals.shift()
            }
            lastPushTime = now
            const sorted = [...intervals].sort((a, b) => a - b)
            const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 24
            const span = Math.min(48, Math.max(16, median))
            apply(Math.min(normalizeProbeHeight(raw), effectiveCeiling()), `${span.toFixed(0)}ms linear`, 'frame')
            /*
             * 推送速率是这套方案能不能成立的分水岭：
             * 逐帧驱动只有在推送接近屏幕刷新率时才谈得上流畅。
             * 用户体感是"个位数帧"，与我此前量到的 25~40ms 间隔矛盾，这里直接测。
             */
            if (intervals.length >= 12) {
                logToNative(`JS|rate|n=${intervals.length}|median=${median.toFixed(1)}ms`
                    + `|min=${sorted[0].toFixed(1)}|max=${sorted[sorted.length - 1].toFixed(1)}`
                    + `|fps=${(1000 / median).toFixed(1)}`)
                intervals.length = 0
            }
        }))
        /*
         * 这里**不能**在 Did* 事件上直接写目标值。
         *
         * 真机键盘是分级弹出的（配件栏 143 → 键盘 401.7 → 候选面板 629.7），
         * 前一级的 DidChangeFrame 会在后一级还在动的时刻到达，此时写入最终值
         * 会让输入区先蹿到位、下一帧再被探针拉回真实位置——正是"先错误抬升再回弹"。
         * 探针自己会收敛到真实终值，且采样在最后一个事件后还持续 2s，足够覆盖静止态。
         * 只保留 DidHide→0：键盘确定消失后落零是安全的。
         */
        disposers.push(onNativeEvent(event => {
            if (event.name === 'UIKeyboardDidHideNotification') {
                apply(0, '0s', 'settle:DidHide')
                window.setTimeout(calibrateProbeFloor, 400)
            }
        }))
    }
}

/*
 * 实测本次事务的启动偏移：从通知时刻到键盘**真正开始移动**的时刻。
 *
 * 探针在键盘收起时被地板夹住（本机 68pt），所以"第一次观察到移动"本身就晚了一点。
 * 用拟合出的曲线把这段夹住的行程折算回时间：走完 floor/target 这段占用的时间比例
 * 就是要减掉的量。不这样折算会把启动偏移高估约 19ms。
 */
let startupProbe: { eventTime: number; target: number } | null = null
/** 本次事务是否改用逐帧跟随（收起方向没有时长信息时） */
let followPerFrame = false

function beginStartupProbe(eventNativeTime: number, target: number): void {
    if (target <= 0) return
    startupProbe = {eventTime: nativeToPageTime(eventNativeTime), target}
}

/** 反解 cubic-bezier(0.3,0.8,0.225,1)：给定进度 y，求时间比例 x */
function curveTimeAtProgress(y: number): number {
    const [p1x, p1y, p2x, p2y] = [0.3, 0.8, 0.225, 1]
    let lo = 0
    let hi = 1
    for (let index = 0; index < 40; index += 1) {
        const m = (lo + hi) / 2
        const by = 3 * (1 - m) ** 2 * m * p1y + 3 * (1 - m) * m * m * p2y + m ** 3
        if (by < y) lo = m
        else hi = m
    }
    const m = (lo + hi) / 2
    return 3 * (1 - m) ** 2 * m * p1x + 3 * (1 - m) * m * m * p2x + m ** 3
}

function observeStartup(raw: number, nativeTime: number): void {
    const probe = startupProbe
    if (!probe) return
    const height = normalizeProbeHeight(raw)
    if (height <= 0) return
    startupProbe = null
    const hiddenFraction = Math.min(0.9, probeFloorValue() / probe.target)
    const hiddenMs = curveTimeAtProgress(hiddenFraction) * 383
    const observed = nativeToPageTime(nativeTime) - probe.eventTime - hiddenMs
    if (observed < -50 || observed > 200) return
    startupSamples.push(observed)
    if (startupSamples.length > 9) startupSamples.shift()
    /* 用中位数而不是指数平滑：偶发的一次长采样间隔不该把补偿量拖走 */
    const sorted = [...startupSamples].sort((a, b) => a - b)
    startupOffsetMs = sorted[Math.floor(sorted.length / 2)]
    logToNative(`JS|startup|observed=${observed.toFixed(1)}|smoothed=${startupOffsetMs.toFixed(1)}`
        + `|floor=${probeFloorValue().toFixed(1)}|hiddenMs=${hiddenMs.toFixed(1)}`)
}

export function startupOffset(): number {
    return startupOffsetMs
}

export function insetSource(): InsetSource {
    return source
}

/**
 * 运行期改 viewport meta 的 interactive-widget。
 *
 * WebKit 的 MetaViewportInteractiveWidgetEnabled 在 Cocoa 平台默认开启，
 * 而 overlays-content 会让 WKWebView 跳过 -[UIScrollView _adjustForAutomaticKeyboardInfo:]，
 * 也就是跳过"把整页顶上去"这件事——这是唯一一个不需要原生代码就能关掉它的开关。
 * 但它是否在本机这版 WebKit 上真的生效，只能实测。
 */
export function setInteractiveWidget(value: InteractiveWidget): void {
    const meta = document.querySelector('meta[name=viewport]')
    if (!meta) return
    const content = meta.getAttribute('content') ?? ''
    const without = content
        .split(',')
        .map(part => part.trim())
        .filter(part => part.length > 0 && !part.startsWith('interactive-widget'))
    without.push(`interactive-widget=${value}`)
    meta.setAttribute('content', without.join(', '))
}

export function currentInteractiveWidget(): string {
    const content = document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? ''
    return content.match(/interactive-widget=([\w-]+)/)?.[1] ?? '未设置'
}

/*
 * 这些模块持有测量状态（采样数组、事件监听、标定基准）。
 * Vite 的就地热替换会留下新旧两份实例：旧实例仍挂着 DOM 监听、继续往它自己的数组里写，
 * 而报告读的是新实例的空数组——2026-08-23 真机上就这样拿到过一份"键盘明明起来了却全 0"的报告，
 * 差点被当成设备行为。宁可丢一次现场，也不能读到假数据，所以强制整页刷新。
 */
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
