// 桌面应用壳禁止 WebView 页面级缩放；业务画布、时间线和图片查看器仍拥有各自的局部缩放。

import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {URL} from 'node:url'

test('共享与 macOS 窗口都关闭网页缩放并撤销缩放权限', async () => {
    const [sharedConfig, macosConfig, desktopCapability] = await Promise.all([
        readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../../src-tauri/tauri.macos.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../../src-tauri/capabilities/desktop-lifecycle.json', import.meta.url), 'utf8').then(JSON.parse),
    ])
    const sharedMainWindow = sharedConfig.app.windows.find(window => window.label === 'main')
    const macosMainWindow = macosConfig.app.windows.find(window => window.label === 'main')

    assert.equal(sharedMainWindow.zoomHotkeysEnabled, false)
    assert.equal(macosMainWindow.zoomHotkeysEnabled, false)
    assert.equal(desktopCapability.permissions.includes('core:webview:allow-set-webview-zoom'), false)
})
