// 桌面原生材质必须同时守住运行时、平台和配置三层门控。

import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {URL} from 'node:url'

import {resolveNativeShellBackdrop} from './nativeShellBackdrop.ts'

test('只为 Tauri 桌面端解析原生背景材质', () => {
    assert.equal(resolveNativeShellBackdrop({os: 'windows', formFactor: 'desktop'}, true, true), 'acrylic')
    assert.equal(resolveNativeShellBackdrop({os: 'macos', formFactor: 'desktop'}, true, true), 'vibrancy')
    assert.equal(resolveNativeShellBackdrop({os: 'linux', formFactor: 'desktop'}, true, true), null)
    assert.equal(resolveNativeShellBackdrop({os: 'macos', formFactor: 'mobile'}, true, true), null)
    assert.equal(resolveNativeShellBackdrop({os: 'macos', formFactor: 'desktop'}, false, true), null)
    assert.equal(resolveNativeShellBackdrop({os: 'macos', formFactor: 'desktop'}, true, false), null)
})

test('macOS 平台配置启用透明窗口与系统材质', async () => {
    const [sharedConfig, macosConfig] = await Promise.all([
        readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../../src-tauri/tauri.macos.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    ])
    const mainWindow = macosConfig.app.windows.find(window => window.label === 'main')

    assert.equal(sharedConfig.app.macOSPrivateApi, true)
    assert.equal(mainWindow.create, false)
    assert.equal(mainWindow.transparent, true)
    assert.equal(mainWindow.decorations, true)
    assert.equal(mainWindow.titleBarStyle, 'Overlay')
    assert.deepEqual(mainWindow.windowEffects, {
        effects: ['underWindowBackground'],
        state: 'followsWindowActiveState',
    })
})

test('桌面原生窗口主题在启动与设置切换时跟随应用主题', async () => {
    const [settingsApiSource, startupSource] = await Promise.all([
        readFile(new URL('../../src-tauri/src/apis/app_settings.rs', import.meta.url), 'utf8'),
        readFile(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
    ])

    assert.match(settingsApiSource, /window\s*\.set_theme\(resolve_native_window_theme\(theme\)\)/s)
    assert.match(settingsApiSource, /old_theme\s*!=\s*new_settings\.theme[\s\S]*apply_native_window_theme_setting/)
    assert.match(startupSource, /AppSettings::load[\s\S]*apply_native_window_theme_setting/)
})

test('浅色原生背景共用明亮 tint 且不改写共享主题令牌', async () => {
    const appCss = await readFile(new URL('../App.css', import.meta.url), 'utf8')
    const lightBackdropRule = appCss.match(
        /\[data-theme="light"\]\[data-backdrop\]\s*\{[^}]*\}/s,
    )?.[0]
    const lightVibrancyRule = appCss.match(
        /\[data-theme="light"\]\[data-backdrop="vibrancy"\]\s*\{[^}]*\}/s,
    )?.[0]

    assert.match(appCss, /\[data-backdrop\]\s*\{[^}]*85%/s)
    assert.match(appCss, /\[data-backdrop="vibrancy"\]\s*\{[^}]*68%/s)
    assert.ok(lightBackdropRule)
    assert.ok(lightVibrancyRule)
    assert.match(lightBackdropRule, /--app-shell-light-tint:[^;]*35%[^;]*65%/s)
    assert.match(lightBackdropRule, /--app-shell-bg:[^;]*--app-shell-light-tint[^;]*85%/s)
    assert.match(lightVibrancyRule, /--app-shell-bg:[^;]*--app-shell-light-tint[^;]*74%/s)
    assert.doesNotMatch(`${lightBackdropRule}\n${lightVibrancyRule}`, /--fc-color-bg-secondary\s*:/)
})
