/* 移动端 5 档字号、touch 作用域与原生缩放桥接的静态回归。 */

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const tokensCss = readFileSync(new URL('./mobileTokens.css', import.meta.url), 'utf8')
const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8')
const formFactorSource = readFileSync(new URL('../../shared/formFactor.ts', import.meta.url), 'utf8')
const mobileNavCss = readFileSync(new URL('./MobileNav.css', import.meta.url), 'utf8')
const androidBridge = readFileSync(new URL('../../../src-tauri/gen/android/app/src/main/java/cn/flowcloudai/www/MainActivity.kt', import.meta.url), 'utf8')
const iosBridge = readFileSync(new URL('../../../src-tauri/ios/Sources/MobileUiBridge.m', import.meta.url), 'utf8')

const touchScopeMatch = tokensCss.match(/:root\[data-fc-density="touch"]\s*\{([\s\S]*?)\n\}/)

test('移动 token 只覆盖 touch density，并在其他移动样式前加载', () => {
    assert.ok(touchScopeMatch, '缺少 touch density 根级作用域')
    const tokensImport = mobileAppSource.indexOf("import './mobileTokens.css'")
    const accessibilityImport = mobileAppSource.indexOf("import './mobileAccessibility.css'")
    const appCssImport = mobileAppSource.indexOf("import './MobileApp.css'")
    assert.ok(tokensImport >= 0 && tokensImport < accessibilityImport && accessibilityImport < appCssImport)
    assert.doesNotMatch(mobileAppSource, /import '\.\/mobileTypography\.css'/)
})

test('iOS 与 Android 共用 touch density，桌面构建保持 comfortable', () => {
    assert.match(formFactorSource, /buildPlatform === 'android' \|\| buildPlatform === 'ios'/)
    assert.match(formFactorSource, /resolveFormFactor\(platformInfo\) === 'mobile' \? 'touch' : 'comfortable'/)
})

test('字号只有 5 个移动角色，flowcloudai-ui 别名指回同一标尺', () => {
    const declarations = touchScopeMatch?.[1] ?? ''
    const expectedAliases = {
        '2xs': 'meta',
        xs: 'meta',
        caption: 'meta',
        sm: 'body-sm',
        control: 'body',
        reading: 'body',
        md: 'body',
        body: 'body',
        lg: 'title',
        'title-sm': 'title',
        xl: 'display',
    }

    for (const role of ['meta', 'body-sm', 'body', 'title', 'display']) {
        assert.match(declarations, new RegExp(`--mobile-text-${role}:\\s*calc\\([^;]+var\\(--mobile-font-scale\\)`))
    }
    for (const [name, role] of Object.entries(expectedAliases)) {
        assert.match(declarations, new RegExp(`--fc-font-size-${name}:\\s*var\\(--mobile-text-${role}\\)\\s*;`))
    }
})

test('两端原生桥把系统字号写入同一个 CSS 变量', () => {
    assert.match(androidBridge, /resources\.configuration\.fontScale/)
    assert.match(androidBridge, /--mobile-font-scale/)
    assert.match(iosBridge, /UIFontMetrics metricsForTextStyle:UIFontTextStyleBody/)
    assert.match(iosBridge, /UIContentSizeCategoryDidChangeNotification/)
    assert.match(iosBridge, /--mobile-font-scale/)
})

test('底栏标签消费移动语义字号', () => {
    assert.match(mobileNavCss, /\.mobile-nav__label[\s\S]*font-size:\s*var\(--mobile-text-meta\)/)
})
