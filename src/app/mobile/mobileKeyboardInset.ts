/*
 * 移动端软键盘遮挡高度的落地写入。
 *
 * 布局只认 documentElement 上的 `--fc-kb` 这一个变量，页面通过重定义
 * `--mobile-nav-reserved-height` 来消费它（方案与接入方式见
 * `docs/mobile_keyboard_layout.md`）。
 *
 * 为什么不走 React state：逐帧 setState 会把布局更新压进 React 调度，
 * 这正是「跟不上键盘」最常见的自制原因。写 CSS 变量则直接交给样式系统。
 *
 * 为什么默认关闭：同一份布局在 iOS 上会**复现顶栏离屏**——WebKit 的自动键盘避让
 * 已经把整页顶上去了，页面再让出一个键盘高度就是双重补偿（见
 * `docs/devlog/2026-08-18-ios-输入视口-二次缩短.md`）。所以这里必须由调用方按平台显式打开，
 * 关闭时直接移除变量，布局逐字退化成接入前的行为。
 */

/**
 * 升起方向的过渡。
 *
 * 真机实测：`focusin → visualViewport.resize` 只有 60~75ms，而 Android IME 滑入约 200~300ms，
 * 说明拿到终值时键盘还在动，这段自演过渡有对齐余地。
 */
export const MOBILE_KEYBOARD_RISE_TRANSITION = '250ms cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * 决定这次写入该用的过渡串。
 *
 * 两个方向**不对称**，这是实测结论不是偏好：变矮时（收起、候选栏收掉、换小键盘）
 * 拿到新值时键盘早已到位，任何过渡都只是滞后，滞后又会让布局比真实键盘高，
 * 读起来像输入区莫名变厚。所以只有变高才走过渡。
 */
export function resolveMobileKeyboardTransition(
    previousInset: number,
    nextInset: number,
    riseTransition: string = MOBILE_KEYBOARD_RISE_TRANSITION,
): string {
    return nextInset > previousInset ? riseTransition : '0s'
}

/** 小于这个变化量不写，避免系统栏微小伸缩造成无意义的样式失效 */
const WRITE_EPSILON = 0.5

/*
 * 聚焦时先按"学到的键盘高度"把布局让开，这是整套方案能成立的关键一步。
 *
 * 真机实测（Xiaomi/Android 16/WebView 143）：聚焦一个位于「键盘弹出后可视区」之下的输入框时，
 * Chromium 会**平移视觉视口**去露出它——`visualViewport.offsetTop` 从 0 跳到 312.9，
 * 而页面里所有元素的 `getBoundingClientRect()` 一动不动。后果是固定顶栏被推出屏幕上方
 * （布局 y=40 − 312.9 < 0）、底部 Tab 被抬到键盘正上方，正是需求 1 和 4 的失败形态。
 * 它与本模块是否写 inset 无关，关掉本特性照样发生。
 *
 * 平移一旦发生就收不回来：`window.scrollTo(0,0)`、`scrollingElement.scrollTop = 0`、
 * 给 html/body 加 `overflow: hidden` 都实测无效（`offsetTop` 恒为 312.9）。
 *
 * 但**平移是可以不发生的**：实测预先把 `--fc-kb` 置成键盘高度、让输入区落进将来的可视区，
 * 再真手指点击，`offsetTop` 全程为 0，顶栏、输入区、Tab 三者同时满足要求。
 * 所以这里在 focusin 时就乐观地按上次学到的高度让位，等真实高度到达再校正。
 */
const LEARNED_KEY_PREFIX = 'fc-mobile-kb:'
/** 乐观让位后等真实键盘的宽限期；超时仍没等到就退回 0，避免硬件键盘/只聚焦不弹键盘时布局空让一块 */
const PREDICTION_GRACE_MS = 900

function learnedKey(): string {
    return `${LEARNED_KEY_PREFIX}${window.innerHeight}`
}

/** 记住这台设备这个视口高度下的键盘高度。按视口分键，转屏/分屏各学各的 */
export function rememberKeyboardInset(inset: number): void {
    if (!(inset > 0)) return
    try {
        window.localStorage.setItem(learnedKey(), inset.toFixed(2))
    } catch {
        /* 隐私模式等情况下存不下，只是下次要重学，不影响本次 */
    }
}

export function learnedKeyboardInset(): number {
    try {
        const raw = window.localStorage.getItem(learnedKey())
        const value = raw === null ? Number.NaN : Number.parseFloat(raw)
        return Number.isFinite(value) && value > 0 ? value : 0
    } catch {
        return 0
    }
}

let enabled = false
let currentInset = 0

function write(inset: number): void {
    const root = document.documentElement
    root.style.setProperty('--fc-kb-transition', resolveMobileKeyboardTransition(currentInset, inset))
    root.style.setProperty('--fc-kb', `${inset.toFixed(2)}px`)
    currentInset = inset
}

function clear(): void {
    predictionUntil = 0
    document.documentElement.style.removeProperty('--fc-kb-pan')
    delete document.documentElement.dataset.mobileKbPan
    const root = document.documentElement
    root.style.removeProperty('--fc-kb')
    root.style.removeProperty('--fc-kb-transition')
    currentInset = 0
}

/**
 * 按平台开关。关闭时立即清除变量——页面 CSS 里的 `var(--fc-kb, 0px)` 会回落到 `0px`，
 * 于是 `--mobile-nav-reserved-height` 退化成 `--mobile-nav-height`，与接入前等价。
 *
 * **这是 iOS 的接缝**：iOS 侧原生桥转正后，只需放开这里并提供 iOS 的高度来源，
 * 页面 CSS 一行都不用动。
 */
export function setMobileKeyboardInsetEnabled(next: boolean): void {
    if (enabled === next) return
    enabled = next
    if (!enabled) clear()
}

let predictionUntil = 0

/**
 * 聚焦时的乐观让位。没学到高度就什么都不做——宁可这一次被平移，也不猜一个值。
 * 返回是否真的让位了，调用方据此决定要不要安排宽限期回退。
 */
export function predictMobileKeyboardInset(): boolean {
    if (!enabled) return false
    const learned = learnedKeyboardInset()
    if (learned <= 0) return false
    predictionUntil = performance.now() + PREDICTION_GRACE_MS
    if (Math.abs(learned - currentInset) >= WRITE_EPSILON) write(learned)
    return true
}

/**
 * @param inset 本帧测到的遮挡高度
 * @param keyboardVisible 键盘是否真的可见。为假且仍在宽限期内时保持乐观值不动，
 *                        否则每一帧都会把刚让开的位置又写回 0，和乐观让位互相打架。
 */
export function applyMobileKeyboardInset(inset: number, keyboardVisible: boolean): void {
    if (!enabled) return
    if (keyboardVisible) {
        predictionUntil = 0
        rememberKeyboardInset(inset)
        const safe = Math.max(0, inset)
        if (Math.abs(safe - currentInset) < WRITE_EPSILON) return
        write(safe)
        return
    }
    if (predictionUntil > 0 && performance.now() < predictionUntil) return
    predictionUntil = 0
    if (currentInset === 0) return
    write(0)
}

/*
 * 视觉视口平移补偿。
 *
 * 键盘弹出后布局视口（834）仍比可视区（521.5）高，Chromium 允许用户把**视觉视口**
 * 拖进这 312.5px 的差值里去看被键盘挡住的部分。实测拖一下 `visualViewport.offsetTop`
 * 就到 227，且**松手不回弹**：固定顶栏被拖出屏幕、底部 Tab 和让出的余量全露出来，
 * 需求 1 和 5 当场失效。期间 `scrollTop` / `scrollY` 以及内层滚动区全程为 0——
 * 动的只有视觉视口，页面自己一动没动。
 *
 * 这个平移**挡不住**：`overflow: hidden`、`overscroll-behavior: none` 实测均无效；
 * 把外壳缩到可视区高度也只是让手势被可滚动的内层消费掉，换个没内容的页面照样能拖。
 * 「Tab 被键盘盖住」本身就要求可视区之下存在内容，也就必然存在可拖区间——
 * 想同时做到「Tab 被盖住」和「拖不动」在 Android 上是互斥的。
 *
 * 所以不去阻止平移，而是**抵消**它：外壳整体跟着 `offsetTop` 平移同样的距离，
 * 于是屏幕坐标恒定不变，平移在视觉上成为空操作。实测拖动后
 * 顶栏仍 [40,100]、输入区缝隙仍为 0、Tab 仍在键盘之下 205px。
 *
 * 只在真的发生平移时才挂 transform：常态下不加，避免给整个外壳强制独立合成层——
 * `AGENTS.md` §5.1 记着 Chromium 上这么做会撞 tile 内存上限。同理不加 `will-change`。
 */
const PAN_ATTRIBUTE = 'mobileKbPan'

function syncPan(): void {
    const root = document.documentElement
    const offset = window.visualViewport?.offsetTop ?? 0
    if (!enabled || offset <= 0.5) {
        delete root.dataset[PAN_ATTRIBUTE]
        root.style.removeProperty('--fc-kb-pan')
        return
    }
    root.style.setProperty('--fc-kb-pan', `${offset.toFixed(2)}px`)
    root.dataset[PAN_ATTRIBUTE] = 'on'
}

/** 挂上平移补偿。返回卸载函数；卸载时必须清干净，否则关掉特性后外壳会留着一个 transform */
export function installKeyboardPanCompensation(): () => void {
    const viewport = window.visualViewport
    if (!viewport) return () => undefined
    viewport.addEventListener('scroll', syncPan)
    viewport.addEventListener('resize', syncPan)
    syncPan()
    return () => {
        viewport.removeEventListener('scroll', syncPan)
        viewport.removeEventListener('resize', syncPan)
        const root = document.documentElement
        delete root.dataset[PAN_ATTRIBUTE]
        root.style.removeProperty('--fc-kb-pan')
    }
}

export function resetMobileKeyboardInset(): void {
    predictionUntil = 0
    clear()
}

export function mobileKeyboardInset(): number {
    return currentInset
}

/*
 * 本模块持有模块级状态（enabled / currentInset / predictionUntil）与 localStorage 学习值。
 * Vite 就地热替换会留下新旧两份实例：旧实例继续写 --fc-kb，新实例的学习逻辑却从没跑过——
 * 2026-08-23 真机联调时就因此出现「--fc-kb 正常写入、但高度死活学不到」，白查了一轮。
 * 宁可丢一次现场，也不要读到半新半旧的行为。
 */
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
