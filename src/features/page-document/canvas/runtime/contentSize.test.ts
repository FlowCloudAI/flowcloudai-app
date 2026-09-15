// 这些测试固定根内容测量边界，防止 100vh 与 iframe 自适应高度形成逐轮增长的反馈环。

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
