import assert from 'node:assert/strict'
import test from 'node:test'

import {
    getMobileFocusReferenceHeight,
    getMobileViewportState,
    isMobileInputModeActive,
} from './mobileInputMode.ts'
import {installAndroidKeyboardInsetListener} from '../../api/mobileUi.ts'
import {readFileSync} from 'node:fs'
import {URL} from 'node:url'

const inputModeHookSource = readFileSync(new URL('./useMobileInputMode.ts', import.meta.url), 'utf8')
const mobileKeyboardInsetSource = readFileSync(new URL('./mobileKeyboardInset.ts', import.meta.url), 'utf8')
const mobileUiSource = readFileSync(new URL('../../api/mobileUi.ts', import.meta.url), 'utf8')
const mobileAppCss = readFileSync(new URL('./MobileApp.css', import.meta.url), 'utf8')
const mobileAiChatCss = readFileSync(new URL('./pages/MobileAiChat.css', import.meta.url), 'utf8')
const mobileIdeaCss = readFileSync(new URL('./pages/MobileIdea.css', import.meta.url), 'utf8')
const mainActivitySource = readFileSync(new URL(
    '../../../src-tauri/gen/android/app/src/main/java/cn/flowcloudai/www/MainActivity.kt',
    import.meta.url,
), 'utf8')
const androidManifestSource = readFileSync(new URL(
    '../../../src-tauri/gen/android/app/src/main/AndroidManifest.xml',
    import.meta.url,
), 'utf8')
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

test('原生桥用 getter 补初值并用固定回调接后续帧', () => {
    const previousWindow = globalThis.window
    const bridgeWindow = {
        flowcloudaiMobileUi: {
            getKeyboardInset: () => 312.5,
            isKeyboardVisible: () => true,
        },
    }
    globalThis.window = bridgeWindow

    try {
        const snapshots = []
        const dispose = installAndroidKeyboardInsetListener(snapshot => snapshots.push(snapshot))
        assert.deepEqual(snapshots, [{available: true, inset: 312.5, visible: true}])

        bridgeWindow.__flowcloudaiApplyAndroidKeyboardInset(-1, true)
        assert.deepEqual(snapshots.at(-1), {available: true, inset: 0, visible: false})

        dispose()
        assert.equal('__flowcloudaiApplyAndroidKeyboardInset' in bridgeWindow, false)
    } finally {
        if (previousWindow === undefined) delete globalThis.window
        else globalThis.window = previousWindow
    }
})

test('键盘接管默认关闭，且只重定义保留高度而不散写偏移', () => {
    // 默认关闭是 iOS 的零回归保证：同一份布局在 iOS 上会复现顶栏离屏。
    assert.match(mobileKeyboardInsetSource, /let enabled = false/)
    assert.match(mobileKeyboardInsetSource, /export function setMobileKeyboardInsetEnabled/)

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

test('Android 布局只消费原生实际 Insets，不再预测或自演过渡', () => {
    assert.match(mobileKeyboardInsetSource, /installAndroidKeyboardInsetListener\(publish\)/)
    assert.match(mobileKeyboardInsetSource, /style\.setProperty\('--fc-kb'/)
    assert.match(inputModeHookSource, /mobileKeyboardInsetState\(\)/)
    assert.match(inputModeHookSource, /subscribeMobileKeyboardInset\(scheduleUpdate\)/)

    for (const source of [mobileKeyboardInsetSource, inputModeHookSource]) {
        assert.doesNotMatch(source, /localStorage/)
        assert.doesNotMatch(source, /predictMobileKeyboardInset/)
        assert.doesNotMatch(source, /applyMobileKeyboardInset/)
        assert.doesNotMatch(source, /installKeyboardPanCompensation/)
    }
    assert.doesNotMatch(mobileAiChatCss, /--fc-kb-transition/)
    assert.doesNotMatch(mobileIdeaCss, /--fc-kb-transition/)
})

test('原生层兼容旧 WebView，并阻止 WebView 成为第二个键盘布局 owner', () => {
    assert.match(androidManifestSource, /android:windowSoftInputMode="adjustResize"/)
    assert.match(mainActivitySource, /WindowInsetsCompat\.Type\.ime\(\)/)
    assert.match(mainActivitySource, /WindowInsetsAnimationCompat\.Callback/)
    assert.match(mainActivitySource, /mobileImeAnimationDepth == 0/)
    assert.match(mainActivitySource, /override fun onProgress[\s\S]*updateMobileKeyboardInset\(insets\)/)
    assert.match(mainActivitySource, /setInsets\(WindowInsetsCompat\.Type\.ime\(\), Insets\.NONE\)/)
    assert.match(mainActivitySource, /setVisible\(WindowInsetsCompat\.Type\.ime\(\), false\)/)
    assert.match(mainActivitySource, /__flowcloudaiApplyAndroidKeyboardInset/)
    assert.match(mainActivitySource, /fun getKeyboardInset\(\): Double/)
    assert.match(mainActivitySource, /fun isKeyboardVisible\(\): Boolean/)
    assert.match(mobileUiSource, /__flowcloudaiApplyAndroidKeyboardInset/)

    // WebView 和应用壳层都保持原始几何；只有业务页的保留高度消费 --fc-kb。
    assert.doesNotMatch(mainActivitySource, /setPadding\([^)]*mobileKeyboard/)
    assert.doesNotMatch(mainActivitySource, /layoutParams[\s\S]{0,120}mobileKeyboard/)
    assert.doesNotMatch(mobileAppCss, /data-mobile-kb-pan/)
    assert.doesNotMatch(mobileAppCss, /--fc-kb-pan/)
})
