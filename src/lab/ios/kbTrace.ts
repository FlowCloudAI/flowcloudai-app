/*
 * 逐帧采样与报告生成。
 *
 * 这个文件存在的前提是：iOS 侧拿不到日志，终态截图也证明不了任何事——
 * 这个需求的失败全部发生在动画过程里。所以两侧各采一份：
 *   - 原生按 CADisplayLink 采（在 UI 进程，键盘事务不影响它）；
 *   - 页面按 rAF 采（在 Web 内容进程，键盘事务期间会被稀疏化，可能漏帧）。
 * 两份用估计出的钟差对齐后并排打印。缺帧本身也是结论的一部分，不做插值掩盖。
 *
 * 判据不看"结果"看"前提"：顶栏是否离开屏幕，等价于
 * (页面侧) rect.top - visualViewport.offsetTop 是否变化，
 * (原生侧) scrollView.contentOffset / contentInset / webView.frame 是否变化。
 * 两条独立链路同时为真，才算这一帧没有问题。
 */

import {
    hasClockOffset,
    type KbNativeDump,
    type KbNativeEvent,
    logToNative,
    nativeToPageTime,
    onNativeEvent,
    pageToNativeTime,
    requestNativeDump,
} from './kbNative'

/*
 * 全部记原始值，不在页面里做任何坐标换算。
 *
 * 第一版曾用 rect.top - visualViewport.offsetTop 当"屏幕坐标"，实测得到 -804 ≈ -2×键盘高度：
 * 键盘弹出时 rect.top 与 vv.offsetTop 各自都包含了同一次位移，减一次就重复扣了。
 * 到底该怎么组合是待查清的问题本身，不能先把它编进采集逻辑里。
 */
export interface JsSample {
    t: number
    appliedKb: number
    shellTop: number
    topbarTop: number
    composerBottom: number
    tabTop: number
    vvHeight: number
    vvOffsetTop: number
    vvPageTop: number
    innerHeight: number
    scrollTop: number
}

export interface TapRecord {
    t: number
    target: string
    keyboardWasVisible: boolean
    /** 点击后 1.5s 内观察到的键盘最大高度。用峰值而不是"1.5s 时刻的状态"，
     *  否则用户在 1.5s 内自己收起键盘会被误判成"没呼出" */
    peak: number
    settled: boolean
}

interface Probes {
    shell: HTMLElement | null
    topbar: HTMLElement | null
    composer: HTMLElement | null
    tabbar: HTMLElement | null
}

const MAX_JS_SAMPLES = 3000

const probes: Probes = {shell: null, topbar: null, composer: null, tabbar: null}
const jsSamples: JsSample[] = []
const localEvents: KbNativeEvent[] = []
const taps: TapRecord[] = []

let sampling = false
let samplingEnabled = true
let samplingUntil = 0
let keyboardVisible = false
let keyboardHeight = 0
/*
 * keyboardLayoutGuide 在键盘收起时并不落到 0，本机实测停在 68pt。
 * 所以"无键盘"的零点要在运行时标定：DidHide 之后观察到的稳定值就是地板。
 */
let probeFloor = 0
const pendingTaps = new Set<TapRecord>()
let keyboardLabel = '系统键盘'
let modeLabel = '未设置'

export function registerProbes(next: Partial<Probes>): void {
    Object.assign(probes, next)
}

export function setKeyboardLabel(label: string): void {
    keyboardLabel = label
}

export function setModeLabel(label: string): void {
    modeLabel = label
}

export function isKeyboardVisible(): boolean {
    return keyboardVisible
}

function rectTop(element: HTMLElement | null): number {
    return element ? element.getBoundingClientRect().top : Number.NaN
}

function rectBottom(element: HTMLElement | null): number {
    return element ? element.getBoundingClientRect().bottom : Number.NaN
}

function sampleOnce(): void {
    const vv = window.visualViewport
    const appliedRaw = getComputedStyle(document.documentElement).getPropertyValue('--fc-kb')
    jsSamples.push({
        t: performance.now(),
        appliedKb: Number.parseFloat(appliedRaw) || 0,
        shellTop: rectTop(probes.shell),
        topbarTop: rectTop(probes.topbar),
        composerBottom: rectBottom(probes.composer),
        tabTop: rectTop(probes.tabbar),
        vvHeight: vv?.height ?? window.innerHeight,
        vvOffsetTop: vv?.offsetTop ?? 0,
        vvPageTop: vv?.pageTop ?? 0,
        innerHeight: window.innerHeight,
        scrollTop: document.scrollingElement?.scrollTop ?? 0,
    })
    if (jsSamples.length > MAX_JS_SAMPLES) jsSamples.splice(0, jsSamples.length - MAX_JS_SAMPLES)
}

function loop(): void {
    if (!sampling) return
    sampleOnce()
    if (performance.now() > samplingUntil) {
        sampling = false
        flushToNativeLog()
        return
    }
    requestAnimationFrame(loop)
}

let logFlushFrom = 0

/* 采样期间不打日志（会扰动被测时序），结束后一次性推走 */
function flushToNativeLog(): void {
    const pending = jsSamples.slice(logFlushFrom)
    logFlushFrom = jsSamples.length
    if (pending.length === 0) return
    const header = `JS|head|${modeLabel}|${keyboardLabel}|innerH=${window.innerHeight}`
        + `|widget=${document.querySelector('meta[name=viewport]')?.getAttribute('content')?.match(/interactive-widget=([\w-]+)/)?.[1] ?? 'unset'}`
        + `|clockOk=${hasClockOffset()}|probeFloor=${probeFloor.toFixed(1)}`
    const rows = pending.map(sample => [
        'JS|frm',
        pageToNativeTime(sample.t).toFixed(1),
        sample.appliedKb.toFixed(2),
        sample.shellTop.toFixed(2),
        sample.topbarTop.toFixed(2),
        sample.composerBottom.toFixed(2),
        sample.tabTop.toFixed(2),
        sample.vvHeight.toFixed(1),
        sample.vvOffsetTop.toFixed(2),
        sample.vvPageTop.toFixed(2),
        String(sample.innerHeight),
        sample.scrollTop.toFixed(1),
    ].join('|'))
    const tapRows = taps.slice(-8).map(tap => `JS|tap|${tap.target}|${pageToNativeTime(tap.t).toFixed(1)}`
        + `|wasVisible=${tap.keyboardWasVisible}|peak=${tap.peak.toFixed(1)}|settled=${tap.settled}`)
    logToNative([header, ...rows, ...tapRows, 'JS|end'].join('\n'))
}

/*
 * 采样本身是有代价的：每帧 4 次 getBoundingClientRect 加一次 getComputedStyle，
 * 后者强制样式刷新，和键盘驱动的布局更新抢同一个 Web 内容进程。
 * 判断"跟随得丝不丝滑"时必须能关掉它，否则量到的是观测行为的开销。
 */
export function setSamplingEnabled(enabled: boolean): void {
    samplingEnabled = enabled
    if (!enabled) sampling = false
}

export function samplingIsEnabled(): boolean {
    return samplingEnabled
}

export function startSampling(durationMs: number): void {
    if (!samplingEnabled) return
    samplingUntil = Math.max(samplingUntil, performance.now() + durationMs)
    if (sampling) return
    sampling = true
    requestAnimationFrame(loop)
}

export function clearTrace(): void {
    jsSamples.length = 0
    localEvents.length = 0
    logFlushFrom = 0
}

export function clearTaps(): void {
    taps.length = 0
}

/**
 * 记录一次真实手指点击。
 *
 * 只数点击、不数 focus：点击落空时根本不会触发 focus，只数 focus 会让失败案例
 * 不进分母，得到虚假的 100%。键盘是否真的升起由原生通知判定，不用焦点代理。
 */
export function recordTap(target: string): void {
    const record: TapRecord = {
        t: performance.now(),
        target,
        keyboardWasVisible: keyboardVisible,
        peak: keyboardHeight,
        settled: false,
    }
    taps.push(record)
    pendingTaps.add(record)
    startSampling(1800)
    window.setTimeout(() => {
        pendingTaps.delete(record)
        record.settled = true
    }, 1500)
}

/** 峰值高于这个值才算真的把键盘呼出来了；低于它通常只是输入配件栏先冒出来 */
const SUMMON_THRESHOLD = 150

export function tapStats(): { total: number; cold: number; summoned: number; pending: number } {
    const cold = taps.filter(tap => !tap.keyboardWasVisible)
    return {
        total: taps.length,
        cold: cold.length,
        summoned: cold.filter(tap => tap.peak >= SUMMON_THRESHOLD).length,
        pending: cold.filter(tap => !tap.settled).length,
    }
}

onNativeEvent(event => {
    localEvents.push(event)
    if (localEvents.length > 200) localEvents.splice(0, localEvents.length - 200)
    keyboardHeight = event.name.includes('Hide') ? 0 : event.target
    keyboardVisible = keyboardHeight > 0
    for (const tap of pendingTaps) {
        if (keyboardHeight > tap.peak) tap.peak = keyboardHeight
    }
    startSampling(Math.max(1200, event.duration * 1000 + 800))
})

/** 原生推来的逐帧高度是探针原值，先扣掉标定出的地板再交给布局 */
export function normalizeProbeHeight(raw: number): number {
    return raw <= probeFloor + 0.75 ? 0 : raw
}

export function setProbeFloor(value: number): void {
    probeFloor = value
}

export function probeFloorValue(): number {
    return probeFloor
}

function fixed(value: number, digits = 1): string {
    return Number.isFinite(value) ? value.toFixed(digits) : 'NaN'
}

function pad(text: string, width: number): string {
    return text.length >= width ? text : ' '.repeat(width - text.length) + text
}

/** 用原生帧线性插值出某个页面时刻的键盘高度；缺帧不插值掩盖，只在两个真实采样之间插 */
function nativeKbAt(pageTime: number, frames: readonly (readonly number[])[]): number {
    if (frames.length === 0) return Number.NaN
    let previous = frames[0]
    for (const frame of frames) {
        const t = nativeToPageTime(frame[0])
        if (t >= pageTime) {
            const previousT = nativeToPageTime(previous[0])
            const span = t - previousT
            if (span <= 0) return frame[1]
            const ratio = (pageTime - previousT) / span
            return previous[1] + (frame[1] - previous[1]) * ratio
        }
        previous = frame
    }
    return frames[frames.length - 1][1]
}

interface TransitionWindow {
    startPage: number
    endPage: number
    events: KbNativeEvent[]
}

function groupTransitions(events: readonly KbNativeEvent[]): TransitionWindow[] {
    const windows: TransitionWindow[] = []
    for (const event of events) {
        const pageTime = nativeToPageTime(event.t)
        const last = windows[windows.length - 1]
        if (last && pageTime - last.startPage < 700) {
            last.events.push(event)
            last.endPage = Math.max(last.endPage, pageTime + event.duration * 1000 + 400)
            continue
        }
        windows.push({
            startPage: pageTime - 60,
            endPage: pageTime + event.duration * 1000 + 400,
            events: [event],
        })
    }
    return windows
}

export async function buildReport(reportIndex: number): Promise<string> {
    const dump: KbNativeDump | null = await requestNativeDump()
    const lines: string[] = []
    const state = dump?.state

    lines.push(`== FlowCloudAI 键盘实验 报告 #${reportIndex} ==`)
    lines.push(`时间 ${new Date().toISOString()}`)
    lines.push(`模式 ${modeLabel} / ${keyboardLabel}`)
    if (state) {
        lines.push(
            `设备 iOS ${state.systemVersion} window ${fixed(state.windowWidth, 0)}x${fixed(state.windowHeight, 0)}` +
            ` scale ${state.screenScale} safe ${fixed(state.safeArea[0], 0)}/${fixed(state.safeArea[1], 0)}`,
        )
        lines.push(
            `webview ${state.webViewClass} in ${state.hostClass} frame ` +
            state.webViewFrame.map(value => fixed(value, 0)).join(','),
        )
        lines.push(
            `scrollView offY=${fixed(state.contentOffsetY)} insB=${fixed(state.contentInsetBottom)}` +
            ` adjInsB=${fixed(state.adjustedInsetBottom)} contentH=${fixed(state.contentSizeHeight)}` +
            ` insetBehavior=${state.insetBehavior} bounces=${state.bounces}`,
        )
        lines.push(
            `原生开关 observersRemoved=${state.observersRemoved} clamp=${state.clampScrollView}` +
            `(${state.clampCorrections}次纠正) pushPerFrame=${state.pushPerFrame}` +
            ` resizeWebView=${state.resizeWebViewFrame} probe=${state.probeInstalled}`,
        )
    } else {
        lines.push('！原生未响应 dump——本报告只含页面侧数据')
    }
    lines.push(
        `页面 innerHeight=${window.innerHeight} vvH=${fixed(window.visualViewport?.height ?? 0)}` +
        ` dpr=${window.devicePixelRatio} viewport-meta=${
            document.querySelector('meta[name=viewport]')?.getAttribute('content')?.match(/interactive-widget=[\w-]+/)?.[0] ?? '未设置'
        }`,
    )
    lines.push(`钟差已标定=${hasClockOffset()}`)

    const stats = tapStats()
    lines.push(
        `呼出成功率 ${stats.summoned}/${stats.cold}` +
        `${stats.cold > 0 ? ` (${Math.round((stats.summoned / stats.cold) * 100)}%)` : ''}` +
        ` [总点击 ${stats.total}，其中键盘已可见 ${stats.total - stats.cold} 次不计入分母，待判定 ${stats.pending}]`,
    )

    const frames = dump?.frames ?? []
    const events = dump?.events ?? localEvents
    const windows = groupTransitions(events).slice(-2)

    for (const window_ of windows) {
        lines.push('')
        lines.push(`--- 事件 ---`)
        const base = window_.events[0] ? nativeToPageTime(window_.events[0].t) : 0
        for (const event of window_.events) {
            lines.push(
                `+${pad(fixed(nativeToPageTime(event.t) - base), 6)} ${event.name.replace('UIKeyboard', '').replace('Notification', '')}` +
                ` target=${fixed(event.target)} dur=${event.duration.toFixed(3)} curve=${event.curve} local=${event.isLocal ? 1 : 0}`,
            )
        }

        const nativeRows = frames.filter(frame => {
            const t = nativeToPageTime(frame[0])
            return t >= window_.startPage && t <= window_.endPage
        })
        const jsRows = jsSamples.filter(sample => sample.t >= window_.startPage && sample.t <= window_.endPage)

        lines.push(`--- 原生逐帧 ${nativeRows.length} 帧 (t | kb动 | kb模型 | wvY | wvH | offY | insB) ---`)
        for (const frame of nativeRows) {
            lines.push(
                [
                    pad(fixed(nativeToPageTime(frame[0]) - base), 7),
                    pad(fixed(frame[1]), 6),
                    pad(fixed(frame[2]), 6),
                    pad(fixed(frame[3]), 6),
                    pad(fixed(frame[4]), 6),
                    pad(fixed(frame[7]), 6),
                    pad(fixed(frame[8]), 6),
                ].join(' '),
            )
        }

        lines.push(`--- 页面逐帧 ${jsRows.length} 帧 (t | 已应用kb | 外壳y | 顶栏y | 输入区底 | Tab顶 | vvH | vvTop | vvPageTop | innerH | sTop) ---`)
        for (const sample of jsRows) {
            const kb = nativeKbAt(sample.t, nativeRows.length > 0 ? nativeRows : frames)
            const keyboardTop = sample.innerHeight - kb
            const gap = keyboardTop - sample.composerBottom
            lines.push(
                [
                    pad(fixed(sample.t - base), 7),
                    pad(fixed(sample.appliedKb), 7),
                    pad(fixed(sample.shellTop), 6),
                    pad(fixed(sample.topbarTop), 6),
                    pad(fixed(sample.composerBottom), 7),
                    pad(fixed(sample.tabTop), 6),
                    pad(fixed(sample.vvHeight), 6),
                    pad(fixed(sample.vvOffsetTop), 6),
                    pad(fixed(sample.vvPageTop), 7),
                    pad(fixed(sample.innerHeight, 0), 6),
                    pad(fixed(sample.scrollTop), 5),
                    pad(fixed(gap), 6),
                ].join(' '),
            )
        }

        if (jsRows.length > 0) {
            const topbarValues = jsRows.map(row => row.topbarTop).filter(Number.isFinite)
            const gaps = jsRows.map(row => {
                const kb = nativeKbAt(row.t, nativeRows.length > 0 ? nativeRows : frames)
                return row.innerHeight - kb - row.composerBottom
            }).filter(Number.isFinite)
            const offsets = nativeRows.map(row => row[7])
            const insets = nativeRows.map(row => row[8])
            const deltas: number[] = []
            for (let index = 1; index < jsRows.length; index += 1) {
                deltas.push(jsRows[index].t - jsRows[index - 1].t)
            }
            lines.push('--- 判据 ---')
            lines.push(`顶栏 y 范围 ${fixed(Math.min(...topbarValues), 2)} ~ ${fixed(Math.max(...topbarValues, 2))}（要求恒定）`)
            lines.push(`缝隙 最小 ${fixed(Math.min(...gaps))} 最大 ${fixed(Math.max(...gaps))}（>0 是键盘上方露出，<0 是被键盘盖住）`)
            lines.push(`原生 offY 非零帧 ${offsets.filter(value => Math.abs(value) > 0.01).length}/${nativeRows.length}，insB 非零帧 ${insets.filter(value => Math.abs(value) > 0.01).length}/${nativeRows.length}`)
            lines.push(`页面 rAF 间隔 最大 ${fixed(Math.max(...deltas, 0))}ms（>32ms 说明该段被稀疏化，可能漏掉跳变）`)
        }
    }

    return lines.join('\n')
}

/*
 * 这些模块持有测量状态（采样数组、事件监听、标定基准）。
 * Vite 的就地热替换会留下新旧两份实例：旧实例仍挂着 DOM 监听、继续往它自己的数组里写，
 * 而报告读的是新实例的空数组——2026-08-23 真机上就这样拿到过一份"键盘明明起来了却全 0"的报告，
 * 差点被当成设备行为。宁可丢一次现场，也不能读到假数据，所以强制整页刷新。
 */
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
