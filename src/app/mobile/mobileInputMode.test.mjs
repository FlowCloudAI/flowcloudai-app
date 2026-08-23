import assert from 'node:assert/strict'
import test from 'node:test'

import {
    getMobileFocusReferenceHeight,
    getMobileViewportState,
    isMobileInputModeActive,
} from './mobileInputMode.ts'
import {
    MOBILE_KEYBOARD_RISE_TRANSITION,
    resolveMobileKeyboardTransition,
} from './mobileKeyboardInset.ts'
import {readFileSync} from 'node:fs'
import {URL} from 'node:url'

const inputModeHookSource = readFileSync(new URL('./useMobileInputMode.ts', import.meta.url), 'utf8')
const mobileAppCss = readFileSync(new URL('./MobileApp.css', import.meta.url), 'utf8')
const immersiveEditorSource = readFileSync(new URL('./pages/MobileEntryImmersiveEditor.tsx', import.meta.url), 'utf8')
const entryEditViewSource = readFileSync(new URL('./pages/MobileEntryDetailEditView.tsx', import.meta.url), 'utf8')
const entryDetailCss = readFileSync(new URL('./pages/MobileEntryDetail.css', import.meta.url), 'utf8')
const overlaySource = readFileSync(new URL('../../shared/ui/overlay/Overlay.tsx', import.meta.url), 'utf8')
const overlayCss = readFileSync(new URL('../../shared/ui/overlay/Overlay.css', import.meta.url), 'utf8')

test('没有 visualViewport 时使用布局视口且不误判键盘', () => {
    assert.deepEqual(getMobileViewportState(844, null), {
        keyboardInset: 0,
        keyboardVisible: false,
    })
})

test('iOS 覆盖式键盘按 visualViewport 差值计算可视高度', () => {
    assert.deepEqual(getMobileViewportState(844, {height: 503, offsetTop: 0}), {
        keyboardInset: 341,
        keyboardVisible: true,
    })
})

test('系统栏的小幅伸缩不会被误判成软键盘', () => {
    assert.deepEqual(getMobileViewportState(844, {height: 790, offsetTop: 0}), {
        keyboardInset: 54,
        keyboardVisible: false,
    })
})

test('Android resize-content 使用聚焦前高度识别软键盘', () => {
    assert.deepEqual(getMobileViewportState(503, {height: 503, offsetTop: 0}, 844), {
        keyboardInset: 341,
        keyboardVisible: true,
    })
})

test('Android adjust-pan 的视口平移不能抵消键盘高度', () => {
    assert.deepEqual(getMobileViewportState(834, {height: 522, offsetTop: 260}), {
        keyboardInset: 312,
        keyboardVisible: true,
    })
})

test('Android 先 resize 后 focus 时仍保留无键盘的完整视口基准', () => {
    assert.equal(getMobileFocusReferenceHeight(
        844,
        503,
        {height: 503, offsetTop: 0},
    ), 844)
})

test('输入聚焦但键盘尚未出现时立即进入输入态', () => {
    assert.equal(isMobileInputModeActive({
        textInputFocused: true,
        keyboardVisible: false,
        keyboardSeenForFocus: false,
        editingRegionActive: false,
    }), true)
})

test('系统收起键盘但输入仍有焦点时退出普通输入态', () => {
    assert.equal(isMobileInputModeActive({
        textInputFocused: true,
        keyboardVisible: false,
        keyboardSeenForFocus: true,
        editingRegionActive: false,
    }), false)
})

test('整页编辑态在键盘收起后仍由离开闸门保护', () => {
    assert.equal(isMobileInputModeActive({
        textInputFocused: true,
        keyboardVisible: false,
        keyboardSeenForFocus: true,
        editingRegionActive: true,
    }), true)
})

test('只观察 visualViewport，不把键盘高度二次回写到应用根节点', () => {
    assert.doesNotMatch(inputModeHookSource, /style\.setProperty\(['"]--mobile-visual-viewport-height/)
    assert.doesNotMatch(mobileAppCss, /--mobile-visual-viewport-height/)
    assert.match(mobileAppCss, /height:\s*100dvh/)
})

test('沉浸正文编辑使用全屏 Portal 隔离下层页面且不二次裁短视口', () => {
    assert.match(immersiveEditorSource, /<Overlay[\s\S]*variant="fullscreen"/)
    assert.match(immersiveEditorSource, /--mobile-entry-visible-height/)
    assert.match(immersiveEditorSource, /--mobile-entry-visible-offset-top/)
    assert.doesNotMatch(entryDetailCss, /--mobile-entry-viewport-(?:height|offset-top)/)
    assert.match(entryEditViewSource, /data-immersive-open=\{p\.immersiveOpen \|\| undefined}/)
    assert.match(entryEditViewSource, /inert=\{p\.immersiveOpen}/)
    assert.match(entryDetailCss, /\.mobile-entry-detail--edit\[data-immersive-open='true']\s*\{[^}]*overflow-y:\s*hidden;/s)
    assert.match(overlaySource, /type OverlayVariant = 'floating' \| 'sheet' \| 'fullscreen'/)
    assert.match(overlayCss, /\.fc-overlay__panel--fullscreen\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s)
    assert.match(entryDetailCss, /\.mobile-entry-detail__immersive-layer\s*\{[^}]*background:\s*var\(--fc-color-bg\);/s)
})

test('聚焦期间补采样键盘可见性，系统收起未派发 resize 时仍能退出输入态', () => {
    assert.match(inputModeHookSource, /setInterval\(scheduleUpdate, 250\)/)
    assert.match(inputModeHookSource, /const scheduleUpdate = \(\) => \{\s*if \(frame\) cancelAnimationFrame\(frame\)\s*frame = requestAnimationFrame\(update\)\s*}/)
})

test('键盘升起走过渡、收起吸附', () => {
    // 升起：拿到终值时 IME 还在动（真机实测 focusin → vv.resize 仅 60~75ms，
    // 而 IME 滑入约 200~300ms），这段过渡有对齐余地。
    assert.equal(resolveMobileKeyboardTransition(0, 312.5), MOBILE_KEYBOARD_RISE_TRANSITION)

    // 收起：拿到 0 时键盘早已消失，任何过渡都只是滞后。
    assert.equal(resolveMobileKeyboardTransition(312.5, 0), '0s')

    // 变矮但没到 0（候选栏收掉、换小键盘）同样吸附：
    // 滞后会让布局比真实键盘高，读起来像输入区莫名变厚。
    assert.equal(resolveMobileKeyboardTransition(312.5, 289), '0s')

    // 高度不变时按吸附处理，不重复起一段动画。
    assert.equal(resolveMobileKeyboardTransition(312.5, 312.5), '0s')
})

test('键盘接管默认关闭，且只重定义保留高度而不散写偏移', () => {
    const insetSource = readFileSync(new URL('./mobileKeyboardInset.ts', import.meta.url), 'utf8')
    // 默认关闭是 iOS 的零回归保证：同一份布局在 iOS 上会复现顶栏离屏。
    assert.match(insetSource, /let enabled = false/)
    assert.match(insetSource, /export function setMobileKeyboardInsetEnabled/)

    // 调用方必须按平台显式打开。
    assert.match(inputModeHookSource, /writeKeyboardInset/)
    assert.match(
        readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8'),
        /writeKeyboardInset:\s*platformInfo\.os === 'android'/,
    )

    // 接入方式是重定义保留高度，不是给元素散写键盘偏移。
    for (const name of ['pages/MobileAiChat.css', 'pages/MobileIdea.css']) {
        const css = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
        assert.match(css, /--mobile-nav-reserved-height:\s*calc\(var\(--mobile-nav-height\) \+ var\(--mobile-keyboard-extra\)\)/)
        assert.match(css, /--mobile-keyboard-extra:\s*max\(var\(--fc-kb, 0px\) - var\(--mobile-nav-height\), 0px\)/)
    }
})

test('聚焦时先按学到的键盘高度让位，避免视觉视口被平移', () => {
    const insetSource = readFileSync(new URL('./mobileKeyboardInset.ts', import.meta.url), 'utf8')

    // 真机实测：聚焦位于「键盘弹出后可视区」之下的输入框时，Chromium 会平移视觉视口
    // （visualViewport.offsetTop 0 → 312.9）去露出它，把固定顶栏推出屏幕上方。
    // 该平移一旦发生就收不回来（scrollTo / scrollTop / overflow:hidden 均实测无效），
    // 唯一可行的是让它压根不发生——聚焦时就把位置让开。
    assert.match(insetSource, /export function predictMobileKeyboardInset/)
    assert.match(inputModeHookSource, /predictMobileKeyboardInset\(\)/)

    // 必须在 focusin 里做，而不是等 visualViewport.resize——那时平移已经发生了。
    const focusIn = inputModeHookSource.slice(inputModeHookSource.indexOf('const handleFocusIn'))
    assert.match(focusIn.slice(0, 600), /predictMobileKeyboardInset/)

    // 没学到高度就不让位：宁可这一次被平移，也不猜一个值。
    assert.match(insetSource, /if \(learned <= 0\) return false/)

    // 乐观让位必须有宽限期回退，否则「只聚焦不弹键盘」（硬件键盘等）会让布局空让一块。
    assert.match(insetSource, /PREDICTION_GRACE_MS/)
})
