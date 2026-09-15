// 这些测试证明宿主正常路径先经过领域解析器与 guard，绕过开关只留给显式隔离探针。

import assert from 'node:assert/strict'
import test from 'node:test'
import {validateCanvasAuthorSources} from './authorSourceValidation.ts'

test('宿主作者预检接受安全段落和合法链接', () => {
    assert.deepEqual(
        validateCanvasAuthorSources('<p>online 中文 <a href="https://example.invalid">链接</a></p>', ''),
        [],
    )
})

test('宿主作者预检在下发画布前拒绝脚本、事件与外部资源', () => {
    const diagnostics = validateCanvasAuthorSources(
        '<script>alert(1)</script><img src="https://example.invalid/a" onerror="alert(1)">',
        '',
    )
    assert.ok(diagnostics.some(item => item.code === 'forbidden_html_element'))
    assert.ok(diagnostics.some(item => item.code === 'forbidden_event_handler'))
    assert.ok(diagnostics.some(item => item.code === 'invalid_asset_reference'))
})
