// 这些测试固定根内容测量与盒模型边界，防止外边距漏量或 iframe 高度形成逐轮增长的反馈环。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {resolveCanvasHeight} from '../host/canvasPageUrl.ts'
import {measureCanvasContentSize} from './contentSize.ts'

test('100vh 根节点带边框时连续回报只取内容高度并保持稳定', () => {
    const authorCss = '#page-document-canvas-root { min-height: 100vh; border: 1px solid; }'
    assert.match(authorCss, /min-height:\s*100vh/u)

    let iframeHeight = 160
    const reportedHeights: number[] = []
    for (let round = 0; round < 8; round += 1) {
        const rootWithBorder = {
            scrollWidth: 640,
            scrollHeight: iframeHeight,
            offsetHeight: iframeHeight + 2,
        }
        const report = measureCanvasContentSize(rootWithBorder)
        assert.equal(report.height < rootWithBorder.offsetHeight, true)
        iframeHeight = resolveCanvasHeight(report.height, 160)
        reportedHeights.push(iframeHeight)
    }
    assert.deepEqual(reportedHeights, Array.from({length: 8}, () => 160))

    const runtime = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
    assert.match(runtime, /measureCanvasContentSize\(root\)/u)
    assert.match(runtime, /ResizeObserver\(reportSize\)\.observe\(root\)/u)
    assert.doesNotMatch(runtime, /document\.body\.(?:scroll|offset)(?:Width|Height)/u)
})

test('画布根建立独立格式化上下文并把子级首尾外边距纳入完整高度', () => {
    const runtimeCss = readFileSync(new URL('./runtime.css', import.meta.url), 'utf8')
    const rootRule = /#page-document-canvas-root\s*\{(?<body>[^}]*)\}/u.exec(runtimeCss)?.groups?.body ?? ''

    assert.match(rootRule, /display:\s*flow-root/u)
    assert.match(rootRule, /box-sizing:\s*border-box/u)
    assert.match(rootRule, /margin:\s*0/u)
    assert.match(rootRule, /border:\s*0/u)
    assert.match(rootRule, /padding:\s*0/u)
    assert.doesNotMatch(rootRule, /overflow:\s*hidden/u)

    // WebKit 中未约束的根会漏掉首尾折叠外边距；flow-root 后根、body 与文档高度同为 404。
    const measured = measureCanvasContentSize({scrollWidth: 640, scrollHeight: 404})
    assert.deepEqual(measured, {width: 640, height: 404})
})
