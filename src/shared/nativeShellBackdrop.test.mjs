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
